#!/usr/bin/env node
// native-host.js – v1.16.0

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { parseYouTubeUrl } = require('./download-policy');

// The local path where we expect to find our bundled/downloaded yt-dlp tool
const YTDLP_BIN = path.join(__dirname, 'yt-dlp.exe');
const FFMPEG_HOME = path.join(__dirname, 'ffmpeg');
const FFMPEG_BIN = path.join(FFMPEG_HOME, 'ffmpeg.exe');
// Dated BtbN autobuilds expire. Resolve the maintained 8.1 build and its
// published digest together instead of retaining a dead dated download URL.
const FFMPEG_RELEASE_API = 'https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest';
const FFMPEG_ARCHIVE_NAME = 'ffmpeg-n8.1-latest-win64-gpl-shared-8.1.zip';
const YOUTUBE_PLAYER_CLIENT = 'web_embedded';
const YTDLP_JS_RUNTIME = 'node';

let ytdlpInstallPromise = null;
let ffmpegInstallPromise = null;
let appUpdater = null;

function requestBuffer(url, headers = {}, redirectCount = 0, maxBytes = 100 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
        if (redirectCount > 5) {
            reject(new Error('Too many redirects while contacting GitHub.'));
            return;
        }

        const request = https.get(url, {
            headers: { 'User-Agent': 'Paracci-YouTube-Toolkit-Native-Host', ...headers }
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                try {
                    const redirectUrl = new URL(res.headers.location, url).toString();
                    if (!redirectUrl.startsWith('https://')) {
                        throw new Error('Refusing a non-HTTPS GitHub redirect.');
                    }
                    requestBuffer(redirectUrl, headers, redirectCount + 1, maxBytes)
                        .then(resolve, reject);
                } catch (error) {
                    reject(error);
                }
                return;
            }

            const contentLength = Number(res.headers['content-length']);
            if (Number.isFinite(contentLength) && contentLength > maxBytes) {
                res.resume();
                reject(new Error('GitHub response is larger than the allowed limit.'));
                return;
            }

            const chunks = [];
            let totalBytes = 0;
            let aborted = false;
            res.on('data', chunk => {
                totalBytes += chunk.length;
                if (totalBytes > maxBytes) {
                    aborted = true;
                    res.destroy();
                    reject(new Error('GitHub response is larger than the allowed limit.'));
                    return;
                }
                chunks.push(chunk);
            });
            res.on('error', error => {
                if (!aborted) reject(error);
            });
            res.on('aborted', () => reject(new Error('GitHub download was interrupted. Please retry.')));
            res.on('end', () => {
                if (aborted) return;
                if (res.statusCode !== 200) {
                    reject(new Error(`Server returned ${res.statusCode}`));
                    return;
                }
                resolve(Buffer.concat(chunks));
            });
        });
        request.on('error', reject);
        request.setTimeout(30000, () => {
            request.destroy(new Error('GitHub download timed out. Check your connection and retry.'));
        });
    });
}

async function downloadYtdlp() {
    const releaseBuffer = await requestBuffer(
        'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest',
        { Accept: 'application/vnd.github+json' }
    );
    const release = JSON.parse(releaseBuffer.toString('utf8'));
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const executable = assets.find(asset => asset.name === 'yt-dlp.exe');
    if (!executable?.browser_download_url) throw new Error('yt-dlp.exe asset not found.');

    let expectedHash = typeof executable.digest === 'string'
        ? executable.digest.replace(/^sha256:/i, '').toLowerCase()
        : '';

    // Older GitHub API responses may omit asset.digest. Use the release's
    // published SHA2-256SUMS asset in that case; never install an unchecked
    // binary downloaded from a redirect URL.
    if (!/^[a-f0-9]{64}$/.test(expectedHash)) {
        const sumsAsset = assets.find(asset => /^sha2-256sums$/i.test(asset.name));
        if (sumsAsset?.browser_download_url) {
            const sums = (await requestBuffer(sumsAsset.browser_download_url)).toString('utf8');
            const escapedName = executable.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const match = sums.match(new RegExp(`^([a-f0-9]{64})\\s+\\*?${escapedName}\\s*$`, 'im'));
            expectedHash = match ? match[1].toLowerCase() : '';
        }
    }
    if (!/^[a-f0-9]{64}$/.test(expectedHash)) {
        throw new Error('No trusted SHA-256 digest was published for yt-dlp.exe.');
    }

    const binary = await requestBuffer(executable.browser_download_url);
    const actualHash = crypto.createHash('sha256').update(binary).digest('hex');
    if (actualHash !== expectedHash) {
        throw new Error('yt-dlp.exe SHA-256 verification failed.');
    }

    const tempPath = `${YTDLP_BIN}.download`;
    const backupPath = `${YTDLP_BIN}.previous`;
    fs.writeFileSync(tempPath, binary);
    try {
        fs.rmSync(backupPath, { force: true });
        if (fs.existsSync(YTDLP_BIN)) fs.renameSync(YTDLP_BIN, backupPath);
        fs.renameSync(tempPath, YTDLP_BIN);
        fs.rmSync(backupPath, { force: true });
    } catch (error) {
        try { fs.rmSync(tempPath, { force: true }); } catch (_) { }
        try {
            if (!fs.existsSync(YTDLP_BIN) && fs.existsSync(backupPath)) {
                fs.renameSync(backupPath, YTDLP_BIN);
            }
        } catch (_) { }
        throw error;
    }
}

// ── Native Messaging stdin reader ─────────────────────────────────────────────
// The old implementation called process.stdin.on('data', ...) inside getMessage()
// which is called in a while(true) loop — each iteration added a NEW listener
// without removing the previous one. After N messages, N listeners were all
// reading the same bytes simultaneously, causing duplicate/corrupt parses.
//
// Fix: one single persistent data handler with a queue of pending resolvers.
// Chrome's Native Messaging protocol: 4-byte LE length header + UTF-8 JSON body.

const _messageQueue = [];   // resolved messages waiting to be consumed
const _resolverQueue = [];  // pending getMessage() callers waiting for a message
let _stdinBuf = Buffer.alloc(0);

function startNativeMessaging() {
    process.stdin.on('data', (chunk) => {
    _stdinBuf = Buffer.concat([_stdinBuf, chunk]);

    // A single chunk may contain multiple complete messages — drain all of them
    while (true) {
        if (_stdinBuf.length < 4) break; // not enough bytes for the length header yet

        const msgLen = _stdinBuf.readUInt32LE(0);

        if (_stdinBuf.length < 4 + msgLen) break; // message body not fully arrived yet

        const msgBody = _stdinBuf.slice(4, 4 + msgLen).toString('utf8');
        _stdinBuf = _stdinBuf.slice(4 + msgLen); // advance past this message

        let parsed;
        try { parsed = JSON.parse(msgBody); }
        catch (e) { continue; } // malformed JSON — skip

        if (_resolverQueue.length > 0) {
            // Someone is already waiting — resolve them directly
            _resolverQueue.shift()(parsed);
        } else {
            // No one waiting yet — buffer the message
            _messageQueue.push(parsed);
        }
    }
    });

    process.stdin.on('end', () => process.exit(0));
    process.stdout.on('error', () => process.exit(0));
}

const getMessage = () => {
    return new Promise((resolve) => {
        if (_messageQueue.length > 0) {
            // A message already arrived before anyone asked for it
            resolve(_messageQueue.shift());
        } else {
            _resolverQueue.push(resolve);
        }
    });
};

const encodeNativeMessage = (msg) => {
    const buffer = Buffer.from(JSON.stringify(msg));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(buffer.length, 0);
    return Buffer.concat([header, buffer]);
};

const sendMessage = (msg) => {
    try {
        process.stdout.write(encodeNativeMessage(msg));
    } catch (_) {
        // Chrome closed the native-messaging pipe.
    }
};

// Main loop
const activeNativeDownloads = new Set(); // videoId + quality → prevents duplicate spawns
const activeVideoDownloads = new Map(); // downloadId → { child, videoId, downloadKey, cancelled }
const activePageDownloads = new Map(); // jobId → { child, requestId, cancelled }
const pageJobReservations = new Set(); // covers metadata/tool setup before child spawn
const pendingPageCancellations = new Map(); // jobId → requestId

const PAGE_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const FORMAT_ID_PATTERN = /^[A-Za-z0-9_.-]{1,40}$/;
const DOWNLOAD_ID_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;
const PROFILE_ID_PATTERN = /^(best_mp4|height_(2160|1440|1080|720)|audio_(mp3|m4a))$/;
const OUTPUT_FORMATS = new Set(['mp4', 'webm', 'mkv', 'mp3', 'm4a', 'opus']);

function isPageId(value) {
    return typeof value === 'string' && PAGE_ID_PATTERN.test(value);
}

function isDownloadId(value) {
    return typeof value === 'string' && DOWNLOAD_ID_PATTERN.test(value);
}

function isSafeFormatId(value) {
    return typeof value === 'string' && FORMAT_ID_PATTERN.test(value);
}

function isSafeProfileId(value) {
    return typeof value === 'string' && PROFILE_ID_PATTERN.test(value);
}

function isSafeOutputFormat(value) {
    return typeof value === 'string' && OUTPUT_FORMATS.has(value);
}

function sanitizeFilePart(value, fallback = 'video') {
    const safe = String(value || fallback)
        .replace(/[/\\<>:"|?*\x00-\x1f]/g, '_')
        .replace(/\.{2,}/g, '.')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 150);
    return safe || fallback;
}

function redactStreamUrls(value) {
    return String(value || '').replace(
        /https?:\/\/[^\s"'<>]*googlevideo\.com[^\s"'<>]*/gi,
        '[stream URL hidden]'
    );
}

function redactDiagnosticText(value) {
    return redactStreamUrls(String(value || ''))
        .replace(/\b(authorization|proxy-authorization|cookie|set-cookie)\s*[:=]\s*[^\r\n;]+/gi, '$1: [redacted]')
        .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]')
        .replace(/([?&](?:sig|signature|token|auth|key|poToken|visitorData|expire)=)[^&#\s]*/gi, '$1[redacted]')
        .replace(/(?:[A-Za-z]:\\Users\\[^\r\n]+|[A-Za-z]:\\[^\r\n]+\\Downloads\\[^\r\n]*)/gi, '[local path hidden]')
        .replace(/\/Users\/[^\r\n]+/gi, '[local path hidden]');
}

function getYtdlpRuntimeArgs() {
    // The native host is already running under Node. Passing its exact
    // executable path avoids relying on Chrome's inherited PATH, which can be
    // different from the interactive shell used during setup.
    const executable = typeof process.execPath === 'string' && process.execPath
        ? process.execPath
        : YTDLP_JS_RUNTIME;
    return ['--js-runtimes', `${YTDLP_JS_RUNTIME}:${executable}`];
}

function getYtdlpYouTubeArgs() {
    return [
        ...getYtdlpRuntimeArgs(),
        '--extractor-args',
        `youtube:player_client=${YOUTUBE_PLAYER_CLIENT}`
    ];
}

function emitDeveloperLog(request, level, message, stream = '', phase = '', event = '') {
    if (request?.developerMode !== true) return;
    const lines = redactDiagnosticText(String(message || ''))
        .replace(/\r/g, '')
        .split('\n')
        .map(line => line.trim().slice(0, 2000))
        .filter(Boolean);
    if (!lines.length) return;

    lines.forEach(line => sendMessage({
        action: 'developer_log',
        scope: 'native-host',
        module: request.module || phase || 'native-host',
        event: event || `native.${phase || stream || 'output'}`,
        requestId: isPageId(request.requestId) ? request.requestId : '',
        jobId: isPageId(request.jobId) ? request.jobId : '',
        downloadId: isDownloadId(request.downloadId) ? request.downloadId : '',
        videoId: /^[A-Za-z0-9_-]{6,}$/.test(String(request.videoId || '')) ? request.videoId : '',
        level: ['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info',
        stream: stream || '',
        phase: phase || '',
        timestamp: Date.now(),
        message: line
    }));
}

function emitPageLog(request, level, message, stream = '', phase = '') {
    emitDeveloperLog(request, level, message, stream, phase, `download.${phase || 'output'}`);
}

function appendOutputTail(current, chunk, maxLength = 8000) {
    const next = String(current || '') + String(chunk || '');
    return next.length > maxLength ? next.slice(-maxLength) : next;
}

function runCaptured(binary, args, maxBytes = 24 * 1024 * 1024, onOutput = null) {
    return new Promise((resolve, reject) => {
        let child;
        try {
            child = spawn(binary, args, { windowsHide: true });
        } catch (error) {
            reject(error);
            return;
        }

        let stdout = '';
        let stderr = '';
        let tooLarge = false;

        const append = (target, chunk) => {
            if (tooLarge) return target;
            const next = target + chunk.toString();
            if (Buffer.byteLength(next, 'utf8') > maxBytes) {
                tooLarge = true;
                try { child.kill(); } catch (_) { }
                return target;
            }
            return next;
        };

        child.stdout.on('data', chunk => {
            if (typeof onOutput === 'function') onOutput('stdout', chunk.toString());
            stdout = append(stdout, chunk);
        });
        child.stderr.on('data', chunk => {
            if (typeof onOutput === 'function') onOutput('stderr', chunk.toString());
            stderr = append(stderr, chunk);
        });
        child.on('error', reject);
        child.on('close', code => {
            if (tooLarge) {
                reject(new Error('yt-dlp output exceeded the safety limit.'));
            } else if (code !== 0) {
                reject(new Error((stderr || stdout || ('Process exited with code ' + code)).trim().slice(-1200)));
            } else {
                resolve({ stdout, stderr, code });
            }
        });
    });
}

function parseJsonOutput(output) {
    const text = String(output || '');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('yt-dlp returned no media metadata.');
    return JSON.parse(text.slice(start, end + 1));
}

function normalizeYtdlpFormat(format) {
    const id = String(format?.format_id || '');
    const vcodec = typeof format?.vcodec === 'string' ? format.vcodec : '';
    const acodec = typeof format?.acodec === 'string' ? format.acodec : '';
    const hasVideo = Boolean(vcodec && vcodec !== 'none');
    const hasAudio = Boolean(acodec && acodec !== 'none');
    if (!id || (!hasVideo && !hasAudio)) return null;

    const type = hasVideo && hasAudio ? 'muxed' : hasVideo ? 'video' : 'audio';
    const numeric = (value) => Number.isFinite(Number(value)) && Number(value) > 0
        ? Number(value)
        : null;
    const filesize = numeric(format.filesize) || numeric(format.filesize_approx);

    return {
        id,
        type,
        ext: String(format.ext || '').replace(/[^a-z0-9]/gi, '').slice(0, 10),
        width: numeric(format.width),
        height: numeric(format.height),
        fps: numeric(format.fps),
        vcodec: hasVideo ? vcodec.slice(0, 32) : '',
        acodec: hasAudio ? acodec.slice(0, 32) : '',
        filesize,
        hasVideo,
        hasAudio
    };
}

async function extractVideoMetadata(url, options = {}) {
    const developerMode = options?.developerMode === true;
    const args = [
        ...getYtdlpYouTubeArgs(),
        '--dump-single-json',
        '--skip-download',
        '--no-playlist',
        '--no-warnings',
        url
    ];
    if (developerMode) args.unshift('--verbose');
    const result = await runCaptured(YTDLP_BIN, args, 24 * 1024 * 1024, options?.onOutput);
    const data = parseJsonOutput(result.stdout);
    const formats = Array.isArray(data.formats) ? data.formats : [];
    const unique = new Map();
    for (const rawFormat of formats) {
        const normalized = normalizeYtdlpFormat(rawFormat);
        if (normalized && !unique.has(normalized.id)) unique.set(normalized.id, normalized);
    }

    const normalizedFormats = [...unique.values()]
        .sort((a, b) => {
            const typeOrder = { muxed: 0, video: 1, audio: 2 };
            const typeDiff = (typeOrder[a.type] || 9) - (typeOrder[b.type] || 9);
            if (typeDiff) return typeDiff;
            return (b.height || 0) - (a.height || 0) || (b.fps || 0) - (a.fps || 0);
        })
        .slice(0, 128);

    return {
        title: sanitizeFilePart(data.title || 'video'),
        duration: numericDuration(data.duration),
        formats: normalizedFormats
    };
}

function numericDuration(value) {
    return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;
}

function installYtdlp() {
    if (!ytdlpInstallPromise) {
        ytdlpInstallPromise = downloadYtdlp().finally(() => {
            ytdlpInstallPromise = null;
        });
    }
    return ytdlpInstallPromise;
}

async function ensureYtdlp() {
    if (fs.existsSync(YTDLP_BIN)) return;
    await installYtdlp();
    if (!fs.existsSync(YTDLP_BIN)) throw new Error('yt-dlp.exe was not installed.');
}

function powershellLiteral(value) {
    return "'" + String(value).replace(/'/g, "''") + "'";
}

function expandZipArchive(zipPath, destination) {
    const script = [
        "$ErrorActionPreference = 'Stop'",
        'Expand-Archive -LiteralPath ' + powershellLiteral(zipPath) +
            ' -DestinationPath ' + powershellLiteral(destination) + ' -Force'
    ].join('; ');

    return new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            script
        ], { windowsHide: true });
        let stderr = '';
        child.stderr.on('data', chunk => { stderr += chunk.toString(); });
        child.on('error', reject);
        child.on('close', code => {
            if (code === 0) resolve();
            else reject(new Error((stderr || 'Could not extract ffmpeg archive.').trim()));
        });
    });
}

function findFileRecursive(directory, filename) {
    if (!fs.existsSync(directory)) return null;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const candidate = path.join(directory, entry.name);
        if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) {
            return candidate;
        }
        if (entry.isDirectory()) {
            const nested = findFileRecursive(candidate, filename);
            if (nested) return nested;
        }
    }
    return null;
}

function selectFfmpegAsset(release) {
    const asset = release?.assets?.find(item => item.name === FFMPEG_ARCHIVE_NAME);
    const expectedHash = typeof asset?.digest === 'string' && /^sha256:[a-f0-9]{64}$/i.test(asset.digest)
        ? asset.digest.slice(7).toLowerCase()
        : '';
    if (!asset || !expectedHash) {
        throw new Error('No trusted SHA-256 digest was published for the ffmpeg archive.');
    }
    const url = new URL(asset.browser_download_url);
    if (url.origin !== 'https://github.com' ||
        !url.pathname.startsWith('/BtbN/FFmpeg-Builds/releases/download/') ||
        !url.pathname.endsWith('/' + FFMPEG_ARCHIVE_NAME) || url.username || url.password || url.search || url.hash) {
        throw new Error('Unexpected ffmpeg release download URL.');
    }
    return { url: url.href, expectedHash };
}

async function downloadFfmpeg() {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'paracci-ffmpeg-'));
    const archivePath = path.join(tempRoot, FFMPEG_ARCHIVE_NAME);
    const extractPath = path.join(tempRoot, 'extract');
    const stagedPath = path.join(__dirname, 'ffmpeg.download');

    try {
        sendMessage({ status: 'media_tool_progress', message: 'Downloading verified ffmpeg...' });
        const release = JSON.parse((await requestBuffer(FFMPEG_RELEASE_API,
            { Accept: 'application/vnd.github+json' }, 0, 2 * 1024 * 1024)).toString('utf8'));
        const { url, expectedHash } = selectFfmpegAsset(release);
        const archive = await requestBuffer(url, {}, 0, 120 * 1024 * 1024);
        const actualHash = crypto.createHash('sha256').update(archive).digest('hex');
        if (actualHash !== expectedHash) {
            throw new Error('ffmpeg archive SHA-256 verification failed.');
        }

        fs.writeFileSync(archivePath, archive);
        fs.mkdirSync(extractPath, { recursive: true });
        await expandZipArchive(archivePath, extractPath);

        const executable = findFileRecursive(extractPath, 'ffmpeg.exe');
        if (!executable) throw new Error('ffmpeg.exe was not found in the verified archive.');

        const binDirectory = path.dirname(executable);
        fs.rmSync(stagedPath, { recursive: true, force: true });
        // Node 22.18's Windows cpSync can garble non-ASCII destination paths.
        // The upstream bin directory is flat; copy its EXEs/DLLs with the
        // Unicode-safe copyFileSync API before the atomic directory swap.
        fs.mkdirSync(stagedPath, { recursive: true });
        for (const entry of fs.readdirSync(binDirectory, { withFileTypes: true })) {
            if (entry.isFile()) {
                fs.copyFileSync(path.join(binDirectory, entry.name), path.join(stagedPath, entry.name));
            }
        }

        // Swap the complete directory only after the archive has been
        // verified and extracted. If the rename fails, restore the previous
        // directory instead of leaving the host without its old binary.
        const backupPath = path.join(__dirname, 'ffmpeg.previous');
        let movedPrevious = false;
        try {
            fs.rmSync(backupPath, { recursive: true, force: true });
            if (fs.existsSync(FFMPEG_HOME)) {
                fs.renameSync(FFMPEG_HOME, backupPath);
                movedPrevious = true;
            }
            fs.renameSync(stagedPath, FFMPEG_HOME);
            if (!fs.existsSync(FFMPEG_BIN)) throw new Error('Verified ffmpeg installation is incomplete.');
            fs.rmSync(backupPath, { recursive: true, force: true });
        } catch (error) {
            try { fs.rmSync(FFMPEG_HOME, { recursive: true, force: true }); } catch (_) { }
            if (movedPrevious && fs.existsSync(backupPath)) {
                try { fs.renameSync(backupPath, FFMPEG_HOME); } catch (_) { }
            }
            throw error;
        }
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
        fs.rmSync(stagedPath, { recursive: true, force: true });
    }
}

async function ensureFfmpeg() {
    if (fs.existsSync(FFMPEG_BIN)) return FFMPEG_BIN;
    try {
        if (!ffmpegInstallPromise) {
            ffmpegInstallPromise = downloadFfmpeg().finally(() => {
                ffmpegInstallPromise = null;
            });
        }
        await ffmpegInstallPromise;
    } catch (error) {
        const wrapped = new Error('ffmpeg setup failed: ' + String(error?.message || error));
        wrapped.code = 'ffmpeg_required';
        throw wrapped;
    }
    if (!fs.existsSync(FFMPEG_BIN)) throw new Error('ffmpeg.exe is not available.');
    return FFMPEG_BIN;
}

function getToolStatus() {
    return {
        ytdlpReady: fs.existsSync(YTDLP_BIN),
        ffmpegReady: fs.existsSync(FFMPEG_BIN)
    };
}

function parseProgressLine(line) {
    const message = redactStreamUrls(String(line || '').replace(/\s+/g, ' ').trim()).slice(-300);
    const match = message.match(/(\d+(?:\.\d+)?)%/);
    const speedMatch = message.match(/\bat\s+([\d.]+\s*(?:B|K|M|G)i?B\/s)/i);
    const etaMatch = message.match(/\bETA\s+([\d:]+)/i);
    return {
        percent: match ? Math.max(0, Math.min(100, Number(match[1]))) : null,
        speed: speedMatch ? speedMatch[1].replace(/\s+/g, '') : null,
        eta: etaMatch ? etaMatch[1] : null,
        message
    };
}

function terminateProcessTree(child) {
    if (!child || !child.pid) return;
    if (process.platform === 'win32') {
        try {
            spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
        } catch (_) {
            try { child.kill(); } catch (_) { }
        }
    } else {
        try { child.kill('SIGTERM'); } catch (_) { }
    }
}

async function resolvePageSelector(request, metadata) {
    const outputFormat = String(request.outputFormat || 'mp4').toLowerCase();
    if (!isSafeOutputFormat(outputFormat)) throw new Error('Unsupported output format.');

    if (request.profileId) {
        if (!isSafeProfileId(request.profileId)) throw new Error('Unsupported download profile.');
        if (request.profileId === 'best_mp4') {
            if (outputFormat !== 'mp4') throw new Error('Quality profiles use MP4 output.');
            return { selector: 'bestvideo+bestaudio/best', audioOnly: false };
        }
        if (request.profileId.startsWith('height_')) {
            if (outputFormat !== 'mp4') throw new Error('Quality profiles use MP4 output.');
            const height = Number(request.profileId.slice(7));
            return {
                selector: 'bestvideo[height<=' + height + ']+bestaudio/best[height<=' + height + ']',
                audioOnly: false
            };
        }
        if (outputFormat !== request.profileId.slice(6)) {
            throw new Error('Audio profile output does not match the profile.');
        }
        const audioFormat = request.profileId.slice(6);
        return { selector: 'bestaudio', audioOnly: true, outputFormat: audioFormat };
    }

    if (!isSafeFormatId(request.formatId)) throw new Error('Unsupported format id.');
    const selected = metadata.formats.find(format => format.id === request.formatId);
    if (!selected) throw new Error('The selected format is no longer available.');

    const audioOutput = outputFormat === 'mp3' || outputFormat === 'm4a' || outputFormat === 'opus';
    if (selected.type === 'audio') {
        if (!audioOutput) throw new Error('Audio formats require an audio output.');
        return { selector: request.formatId, audioOnly: true };
    }
    if (audioOutput) throw new Error('Audio output requires an audio format.');
    return {
        selector: selected.hasAudio ? request.formatId : request.formatId + '+bestaudio',
        audioOnly: false
    };
}

function resolveDownloadFolderPath(requestedPath, homeDirectory = process.env.USERPROFILE || process.env.HOME || '') {
    const value = typeof requestedPath === 'string' ? requestedPath.trim() : '';
    const resolvedHome = typeof homeDirectory === 'string' && homeDirectory.trim()
        ? homeDirectory.trim()
        : os.homedir();
    const defaultPath = path.join(resolvedHome, 'Downloads');
    if (value && !path.isAbsolute(value)) {
        throw new Error('The download folder must be an absolute local path.');
    }
    return path.resolve(value || defaultPath);
}

function buildPageDownloadArgs({ saveDir, title, label, outputFormat, ffmpegPath, selector, audioOnly, url, developerMode = false }) {
    const outputTemplate = path.join(saveDir, title + ' [' + label + '].%(ext)s');
    const args = [
        ...getYtdlpYouTubeArgs(),
        '--newline',
        '--no-playlist',
        '--no-part',
        '--no-overwrites',
        '--concurrent-fragments',
        '4',
        '--ffmpeg-location',
        path.dirname(ffmpegPath),
        '-f',
        selector,
        '-o',
        outputTemplate
    ];

    if (developerMode === true) args.unshift('--verbose');

    if (audioOnly) {
        args.push('-x', '--audio-format', outputFormat, '--audio-quality', '0');
    } else {
        args.push('--merge-output-format', outputFormat);
    }
    args.push(url);
    return args;
}

async function handlePageDownload(request) {
    const requestId = String(request.requestId || '');
    const jobId = String(request.jobId || '');
    const parsed = parseYouTubeUrl(request.url);
    if (!isPageId(requestId) || !isPageId(jobId) || !parsed.ok) {
        sendMessage({
            action: 'download_page_result',
            status: 'error',
            errorCode: 'invalid_download_request',
            requestId,
            jobId,
            message: 'Invalid YouTube download request.'
        });
        return;
    }

    if (pendingPageCancellations.get(jobId) === requestId) {
        pendingPageCancellations.delete(jobId);
        sendMessage({
            action: 'download_page_result',
            status: 'cancelled',
            requestId,
            jobId,
            message: 'Download cancelled.'
        });
        return;
    }

    if (activePageDownloads.has(jobId) || pageJobReservations.has(jobId)) {
        sendMessage({
            action: 'download_page_result',
            status: 'error',
            errorCode: 'already_downloading',
            requestId,
            jobId,
            message: 'This download is already active.'
        });
        return;
    }

    pageJobReservations.add(jobId);

    const developerMode = request.developerMode === true;
    let stdoutTail = '';
    let stderrTail = '';
    const log = (level, message, stream = '', phase = 'download') => {
        emitPageLog(request, level, message, stream, phase);
    };

    try {
        log('info', 'Preparing yt-dlp and media tools.');
        await ensureYtdlp();
        log('info', 'yt-dlp is ready; reading video metadata.');
        const metadata = await extractVideoMetadata(parsed.canonicalUrl, {
            developerMode,
            onOutput: (stream, chunk) => log('debug', chunk, stream, 'metadata')
        });
        log('info', 'Metadata loaded: ' + metadata.formats.length + ' compatible formats.', '', 'metadata');
        const selection = await resolvePageSelector(request, metadata);
        log('debug', 'Selected yt-dlp format selector: ' + selection.selector, '', 'selection');
        log('info', 'Checking ffmpeg availability.', '', 'tools');
        const ffmpegPath = await ensureFfmpeg();
        log('info', 'ffmpeg is ready.', '', 'tools');

        if (pendingPageCancellations.get(jobId) === requestId) {
            pendingPageCancellations.delete(jobId);
            sendMessage({
                action: 'download_page_result',
                status: 'cancelled',
                requestId,
                jobId,
                message: 'Download cancelled.'
            });
            return;
        }

        const savePath = typeof request.savePath === 'string' ? request.savePath.trim() : '';
        const saveDir = resolveDownloadFolderPath(savePath);
        if (!saveDir) throw new Error('No download folder is available.');
        if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });

        const outputFormat = selection.outputFormat || String(request.outputFormat || 'mp4').toLowerCase();
        if (!isSafeOutputFormat(outputFormat)) throw new Error('Unsupported output format.');
        if (selection.audioOnly && !['mp3', 'm4a', 'opus'].includes(outputFormat)) {
            throw new Error('Audio downloads require MP3, M4A, or Opus output.');
        }
        if (!selection.audioOnly && !['mp4', 'webm', 'mkv'].includes(outputFormat)) {
            throw new Error('Video downloads require MP4, WebM, or MKV output.');
        }

        const title = sanitizeFilePart(request.title || metadata.title || 'video');
        const label = sanitizeFilePart(
            request.profileId || request.formatId || outputFormat,
            outputFormat
        );
        const args = buildPageDownloadArgs({
            saveDir,
            title,
            label,
            outputFormat,
            ffmpegPath,
            selector: selection.selector,
            audioOnly: selection.audioOnly,
            url: parsed.canonicalUrl,
            developerMode
        });

        log('debug', 'Starting yt-dlp with output format ' + outputFormat + '.', '', 'download');

        sendMessage({
            action: 'download_page_progress',
            status: 'progress',
            requestId,
            jobId,
            percent: 0,
            message: 'Starting download...'
        });

        const child = spawn(YTDLP_BIN, args, { windowsHide: true });
        const job = { child, requestId, cancelled: false, finished: false };
        activePageDownloads.set(jobId, job);

        const finish = (status, message, details = '') => {
            if (job.finished) return;
            job.finished = true;
            activePageDownloads.delete(jobId);
            const result = {
                action: 'download_page_result',
                status,
                requestId,
                jobId,
                message
            };
            if (developerMode && details) {
                result.details = redactDiagnosticText(String(details)).trim().slice(-6000);
            }
            sendMessage(result);
        };

        child.stdout.on('data', chunk => {
            const output = chunk.toString();
            stdoutTail = appendOutputTail(stdoutTail, output);
            log('debug', output, 'stdout', 'download');
            const progress = parseProgressLine(output);
            sendMessage({
                action: 'download_page_progress',
                status: 'progress',
                requestId,
                jobId,
                percent: progress.percent,
                message: progress.message
            });
        });
        child.stderr.on('data', chunk => {
            const output = chunk.toString();
            stderrTail = appendOutputTail(stderrTail, output);
            log('warn', output, 'stderr', 'download');
            const progress = parseProgressLine(output);
            if (progress.message) {
                sendMessage({
                    action: 'download_page_progress',
                    status: 'progress',
                    requestId,
                    jobId,
                    percent: progress.percent,
                    message: progress.message
                });
            }
        });
        child.on('error', error => {
            log('error', error.message, 'stderr', 'process');
            finish('error', 'Could not start yt-dlp.', error.message);
        });
        child.on('close', code => {
            if (job.cancelled) {
                finish('cancelled', 'Download cancelled.');
            } else if (code === 0) {
                finish('success', 'Download completed.');
            } else {
                const details = stderrTail.trim() || stdoutTail.trim();
                if (!details) log('error', 'yt-dlp exited without diagnostic output.', 'stderr', 'process');
                finish('error', 'yt-dlp exited with code ' + code + '.', details);
            }
        });
    } catch (error) {
        const message = redactDiagnosticText(String(error?.message || error));
        log('error', message, 'stderr', 'setup');
        const errorCode = error?.code === 'ffmpeg_required' || /ffmpeg/i.test(message)
            ? 'ffmpeg_required'
            : 'download_failed';
        const result = {
            action: 'download_page_result',
            status: 'error',
            errorCode,
            requestId,
            jobId,
            message
        };
        if (developerMode) result.details = message.slice(-6000);
        sendMessage(result);
    } finally {
        pageJobReservations.delete(jobId);
    }
}

function isAllowedDirectUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' &&
            (url.hostname === 'googlevideo.com' || url.hostname.endsWith('.googlevideo.com'));
    } catch (_) {
        return false;
    }
}

async function main() {
    startNativeMessaging();
    sendMessage({ status: 'ready', message: 'Native host started', ...getToolStatus() });

    while (true) {
        try {
            const request = await getMessage();

            if (['check_app_update', 'install_app_update'].includes(request.action)) {
                try {
                    if (process.env.PARACCI_UPDATE_BOOTSTRAP !== '1') {
                        throw new Error('Run the updated native-host/install_host.bat once to enable update recovery.');
                    }
                    if (activeVideoDownloads.size || pageJobReservations.size || ytdlpInstallPromise || ffmpegInstallPromise) {
                        throw new Error('Downloads or media-tool preparation are active. Please retry when they finish.');
                    }
                    if (!appUpdater) appUpdater = require('./app-updater').createUpdater({
                        root: path.resolve(__dirname, '..'), request: requestBuffer
                    });
                    // Ports may have closed since the daily check. Re-discover
                    // and verify the package on every installation attempt.
                    const discovered = await appUpdater.check();
                    let result = discovered;
                    if (request.action === 'install_app_update') {
                        if (discovered.status !== 'available' || discovered.version !== request.version) {
                            throw new Error('The available release changed. Check for updates again.');
                        }
                        if (activeVideoDownloads.size || pageJobReservations.size || ytdlpInstallPromise || ffmpegInstallPromise) {
                            throw new Error('Downloads are active. Please retry when they finish.');
                        }
                        result = appUpdater.apply(request.version);
                    }
                    sendMessage({ action: 'app_update_result', requestId: String(request.requestId || ''), ...result });
                } catch (error) {
                    sendMessage({ action: 'app_update_result', requestId: String(request.requestId || ''),
                        status: 'error', message: redactDiagnosticText(String(error.message || error)) });
                }
                continue;
            }

            if (request.action === 'resolve_formats') {
                const requestId = String(request.requestId || '');
                const parsed = parseYouTubeUrl(request.url);
                if (!isPageId(requestId) || !parsed.ok) {
                    sendMessage({
                        action: 'download_page_formats',
                        status: 'error',
                        requestId,
                        errorCode: 'invalid_url',
                        message: 'Only a valid public YouTube video URL is allowed.'
                    });
                    continue;
                }

                const developerMode = request.developerMode === true;
                const pageRequest = { requestId, developerMode };
                const log = (level, message, stream = '', phase = 'resolve') => {
                    emitPageLog(pageRequest, level, message, stream, phase);
                };

                try {
                    log('info', 'Starting yt-dlp metadata lookup.');
                    await ensureYtdlp();
                    log('info', 'yt-dlp is ready; reading available formats.');
                    const metadata = await extractVideoMetadata(parsed.canonicalUrl, {
                        developerMode,
                        onOutput: (stream, chunk) => log('debug', chunk, stream, 'metadata')
                    });
                    log('info', 'Metadata lookup completed: ' + metadata.formats.length + ' compatible formats.');
                    if (!metadata.formats.length) {
                        sendMessage({
                            action: 'download_page_formats',
                            status: 'error',
                            requestId,
                            errorCode: 'no_formats',
                            message: 'No downloadable formats were found.'
                        });
                    } else {
                        sendMessage({
                            action: 'download_page_formats',
                            status: 'success',
                            requestId,
                            url: parsed.canonicalUrl,
                            videoId: parsed.videoId,
                            title: metadata.title,
                            duration: metadata.duration,
                            formats: metadata.formats
                        });
                    }
                } catch (error) {
                    const detail = redactDiagnosticText(String(error?.message || error)).slice(-6000);
                    log('error', detail, 'stderr', 'resolve');
                    const result = {
                        action: 'download_page_formats',
                        status: 'error',
                        requestId,
                        errorCode: 'resolve_failed',
                        message: detail.slice(-1200)
                    };
                    if (developerMode) result.errorDetail = detail;
                    sendMessage(result);
                }
                continue;
            }

            if (request.action === 'cancel_download') {
                const requestId = String(request.requestId || '');
                const jobId = String(request.jobId || '');
                const job = activePageDownloads.get(jobId);
                if (job && isPageId(requestId) && isPageId(jobId) && job.requestId === requestId) {
                    job.cancelled = true;
                    terminateProcessTree(job.child);
                } else if (isPageId(requestId) && isPageId(jobId)) {
                    pendingPageCancellations.set(jobId, requestId);
                }
                continue;
            }

            if (request.action === 'cancel_video_download') {
                const downloadId = String(request.downloadId || '');
                const videoId = String(request.videoId || '');
                if (!isDownloadId(downloadId) || !/^[A-Za-z0-9_-]{6,}$/.test(videoId)) continue;

                const job = activeVideoDownloads.get(downloadId);
                if (job && job.videoId === videoId) {
                    job.cancelled = true;
                    terminateProcessTree(job.child);
                }
                continue;
            }

            if (request.action === 'download_video') {
                if (request.mode === 'page') {
                    // Keep the native message loop responsive so a subsequent
                    // cancel_download request can terminate the child process.
                    void handlePageDownload(request);
                    continue;
                }

                const videoId = String(request.videoId || '');
                const downloadId = isDownloadId(request.downloadId)
                    ? request.downloadId
                    : `legacy-${videoId}-${Date.now()}`;
                const title = typeof request.title === 'string' ? request.title : 'video';
                const videoQuality = typeof request.videoQuality === 'string' ? request.videoQuality : 'best';
                const qualityHeight = Number.isInteger(request.qualityHeight) &&
                    request.qualityHeight >= 144 && request.qualityHeight <= 4320
                    ? request.qualityHeight
                    : null;
                const isAudioOnly = request.isAudioOnly === true;
                const isDirectUrl = request.isDirectUrl === true;
                const url = typeof request.url === 'string' ? request.url : '';
                const savePath = typeof request.savePath === 'string' ? request.savePath : '';
                const developerMode = request.developerMode === true;
                const log = (level, message, stream = '', phase = 'download', event = '') =>
                    emitDeveloperLog({ ...request, developerMode }, level, message, stream, phase, event);

                if (!/^[A-Za-z0-9_-]{6,}$/.test(videoId)) {
                    log('warn', 'Invalid videoId.', 'stderr', 'validation', 'download.invalid_video_id');
                    sendMessage({ action: 'download_video_result', status: 'error', message: 'Invalid videoId.', downloadId, videoId, title });
                    continue;
                }
                if (isDirectUrl && !isAllowedDirectUrl(url)) {
                    log('warn', 'Direct stream URL is not an allowed YouTube host.', 'stderr', 'validation', 'download.invalid_direct_url');
                    sendMessage({ action: 'download_video_result', status: 'error', message: 'Direct stream URL is not an allowed YouTube host.', downloadId, videoId, title });
                    continue;
                }

                log('info', 'Preparing native video download.', '', 'download', 'download.started');

                if (activeVideoDownloads.has(downloadId)) {
                    log('warn', 'This download is already active.', '', 'validation', 'download.duplicate_id');
                    sendMessage({ action: 'download_video_result', status: 'error', message: 'This download is already active.', downloadId, videoId, title });
                    continue;
                }

                // Second-line dedup defence (first is in background.js)
                const downloadKey = `${videoId}|${isAudioOnly ? 'audio' : (qualityHeight || videoQuality || 'best')}`;
                if (activeNativeDownloads.has(downloadKey)) {
                    log('warn', `Already downloading ${videoId} — ignoring duplicate.`, '', 'validation', 'download.duplicate_key');
                    sendMessage({ action: 'download_video_result', status: 'error', message: `Already downloading ${videoId} — ignoring duplicate.`, downloadId, videoId, title });
                    continue;
                }
                activeNativeDownloads.add(downloadKey);
                const videoJob = { child: null, videoId, downloadKey, cancelled: false };
                activeVideoDownloads.set(downloadId, videoJob);

                const finishBeforeSpawnIfCancelled = () => {
                    if (!videoJob.cancelled) return false;
                    videoJob.cancelled = true;
                    activeNativeDownloads.delete(downloadKey);
                    activeVideoDownloads.delete(downloadId);
                    sendMessage({
                        action: 'download_video_result',
                        status: 'cancelled',
                        message: 'Download cancelled.',
                        downloadId,
                        videoId,
                        title
                    });
                    return true;
                };

                if (!fs.existsSync(YTDLP_BIN)) {
                    sendMessage({ status: 'info', message: 'Local yt-dlp.exe not found! Downloading it now...' });
                    log('info', 'Local yt-dlp.exe not found; installing it.', '', 'setup', 'native.ytdlp_install_started');
                    try {
                        await installYtdlp();
                        sendMessage({ status: 'info', message: 'Successfully downloaded yt-dlp.exe!' });
                        log('info', 'Successfully downloaded yt-dlp.exe.', '', 'setup', 'native.ytdlp_install_completed');
                    } catch (e) {
                        log('error', 'Failed to download yt-dlp.exe.', 'stderr', 'setup', 'native.ytdlp_install_failed');
                        activeNativeDownloads.delete(downloadKey);
                        activeVideoDownloads.delete(downloadId);
                        sendMessage({
                            action: 'download_video_result', status: 'error',
                            message: 'Failed to download yt-dlp.exe: ' + e.message,
                            downloadId, videoId, title
                        });
                        continue;
                    }
                }

                if (finishBeforeSpawnIfCancelled()) continue;

                let ffmpegPath;
                if (!isDirectUrl) {
                    sendMessage({ action: 'download_video_progress', status: 'progress',
                        downloadId, videoId, percent: 0, speed: null, eta: null });
                    log('info', 'Preparing verified ffmpeg.', '', 'setup', 'native.ffmpeg_install_started');
                    try {
                        ffmpegPath = await ensureFfmpeg();
                        log('info', 'ffmpeg is ready.', '', 'setup', 'native.ffmpeg_ready');
                    } catch (error) {
                        const detail = redactDiagnosticText(String(error?.message || error));
                        log('error', detail, 'stderr', 'setup', 'native.ffmpeg_install_failed');
                        activeNativeDownloads.delete(downloadKey);
                        activeVideoDownloads.delete(downloadId);
                        sendMessage({ action: 'download_video_result', status: 'error',
                            errorCode: 'ffmpeg_required', message: detail,
                            downloadId, videoId, title });
                        continue;
                    }
                    if (finishBeforeSpawnIfCancelled()) continue;
                }

                // ── Output directory ───────────────────────────────────────────
                // Use custom savePath if provided & non-empty; otherwise default Downloads.
                const normalizedSavePath = savePath.trim();
                const saveDir = normalizedSavePath
                    ? normalizedSavePath
                    : path.join(process.env.USERPROFILE || process.env.HOME, 'Downloads');

                // Ensure the target directory exists (create recursively if needed)
                try {
                    if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });
                } catch (mkdirErr) {
                    log('error', 'Cannot create save folder.', 'stderr', 'filesystem', 'download.save_folder_failed');
                    sendMessage({
                        action: 'download_video_result', status: 'error',
                        message: `Cannot create save folder: ${mkdirErr.message}`,
                        downloadId, videoId, title
                    });
                    activeNativeDownloads.delete(downloadKey);
                    activeVideoDownloads.delete(downloadId);
                    continue;
                }

                const ytUrl = isDirectUrl ? url : `https://www.youtube.com/watch?v=${videoId}`;

                // Normalize quality label for use in filename (strip chars unsafe for Windows paths)
                const safeQuality = videoQuality
                    .replace(/[/\\<>:"|?*\x00-\x1f]/g, '_')
                    .trim();

                // Keep full Unicode title (Windows NTFS handles it), only strip truly unsafe chars
                const safeTitle = title
                    .replace(/[/\\<>:"|?*\x00-\x1f]/g, '_')
                    .replace(/\.{2,}/g, '.')
                    .trim()
                    .substring(0, 150) || 'video';

                // ── Build yt-dlp format selector ───────────────────────────────
                //
                // Codec priority — H.264 (avc1) FIRST for maximum device compatibility:
                //
                //   H.264 (avc1): Plays on ALL devices — iPhone, iPad, old Android,
                //                  Smart TVs, QuickTime, Windows Media Player, etc.
                //                  This is the only codec Apple's native player supports.
                //
                //   VP9  (vp9):   iOS QuickTime/Dosyalar/Fotoğraflar do NOT play VP9.
                //                  Even when muxed into mp4, the video track is silent/black
                //                  on Apple devices. Only VLC or modern browsers handle it.
                //
                //   AV1  (av01):  Only iPhone 12+ / iOS 16+. Very limited compatibility.
                //
                // Summary: We intentionally prefer H.264 over VP9/AV1 so that downloaded
                // files play natively on every device without needing a third-party player.
                // The quality difference at ≤1080p is imperceptible for most content.
                //
                // Audio: m4a (mp4a) is paired with H.264 for full iOS compatibility.
                // bestaudio is kept as fallback since opus/webm audio also re-muxes fine.
                //
                // --merge-output-format mp4 ensures the final file is always .mp4
                // regardless of which streams were selected.
                //
                let formatSelector;
                let outExt = 'mp4';

                if (isAudioOnly) {
                    formatSelector = null; // handled via -x flag below
                    outExt = 'mp3';
                } else if (qualityHeight) {
                    formatSelector = [
                        // ① H.264 at exact requested height — best device compatibility
                        `bestvideo[height=${qualityHeight}][vcodec^=avc1]+bestaudio[acodec^=mp4a]`,
                        `bestvideo[height=${qualityHeight}][vcodec^=avc1]+bestaudio`,
                        // ② H.264 at any height ≤ requested
                        `bestvideo[height<=${qualityHeight}][vcodec^=avc1]+bestaudio[acodec^=mp4a]`,
                        `bestvideo[height<=${qualityHeight}][vcodec^=avc1]+bestaudio`,
                        // ③ VP9 fallback (for devices/players that support it)
                        `bestvideo[height=${qualityHeight}][vcodec^=vp9]+bestaudio`,
                        `bestvideo[height<=${qualityHeight}][vcodec^=vp9]+bestaudio`,
                        // ④ AV1 fallback
                        `bestvideo[height=${qualityHeight}][vcodec^=av01]+bestaudio`,
                        `bestvideo[height<=${qualityHeight}][vcodec^=av01]+bestaudio`,
                        // ⑤ Any codec — last resort
                        `bestvideo[height=${qualityHeight}]+bestaudio`,
                        `bestvideo[height<=${qualityHeight}]+bestaudio`,
                        `best[height<=${qualityHeight}]`
                    ].join('/');
                } else {
                    formatSelector = [
                        // ① H.264 — universal compatibility
                        'bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]',
                        'bestvideo[vcodec^=avc1]+bestaudio',
                        // ② VP9 fallback
                        'bestvideo[vcodec^=vp9]+bestaudio',
                        // ③ AV1 fallback
                        'bestvideo[vcodec^=av01]+bestaudio',
                        // ④ Any codec
                        'bestvideo+bestaudio',
                        'best'
                    ].join('/');
                }

                if (developerMode) args.unshift('--verbose');
                log('debug', 'Starting yt-dlp process.', '', 'process', 'native.ytdlp_spawn');

                const outTemplate = path.join(
                    saveDir,
                    isAudioOnly
                        ? `${safeTitle} [${safeQuality}].%(ext)s`
                        : `${safeTitle} [${safeQuality}].mp4`
                );

                // Common quality flags applied to every download:
                //   --concurrent-fragments 4  → parallel fragment download (faster)
                //   --no-playlist             → never accidentally grab a playlist
                //   --no-part                 → write directly, no .part temp file clutter
                const commonArgs = [
                    ...getYtdlpYouTubeArgs(),
                    '--ffmpeg-location', path.dirname(ffmpegPath || FFMPEG_BIN),
                    '--newline',
                    '--concurrent-fragments', '4',
                    '--no-playlist',
                    '--no-part'
                ];

                let args;
                if (isDirectUrl) {
                    // Direct stream URL (browser fallback routed to native for custom path)
                    args = [
                        '--newline',
                        '--no-playlist',
                        '--no-part',
                        '-o', outTemplate,
                        ytUrl
                    ];
                } else if (isAudioOnly) {
                    args = [
                        ...commonArgs,
                        '-x', '--audio-format', 'mp3', '--audio-quality', '0',
                        '-o', outTemplate, ytUrl
                    ];
                } else {
                    args = [
                        ...commonArgs,
                        '-f', formatSelector,
                        '--merge-output-format', 'mp4',
                        '-o', outTemplate, ytUrl
                    ];
                }

                sendMessage({
                    action: 'download_video_progress',
                    status: 'progress',
                    downloadId,
                    videoId,
                    percent: 0,
                    speed: null,
                    eta: null
                });

                let ytdlp;
                try {
                    ytdlp = spawn(YTDLP_BIN, args, { windowsHide: true });
                } catch (error) {
                    log('error', `Could not start yt-dlp: ${error.message}`, 'stderr', 'process', 'native.ytdlp_spawn_failed');
                    activeNativeDownloads.delete(downloadKey);
                    activeVideoDownloads.delete(downloadId);
                    sendMessage({
                        action: 'download_video_result',
                        status: 'error',
                        message: `Could not start yt-dlp: ${error.message}`,
                        downloadId,
                        videoId,
                        title: safeTitle
                    });
                    continue;
                }
                videoJob.child = ytdlp;
                let stdoutTail = '';
                let stderrTail = '';
                let finished = false;
                const finishDownload = (code, errorMessage = '', details = '') => {
                    if (finished) return;
                    finished = true;
                    activeNativeDownloads.delete(downloadKey);
                    activeVideoDownloads.delete(downloadId);
                    if (videoJob.cancelled) {
                        sendMessage({
                            action: 'download_video_result', status: 'cancelled',
                            message: 'Download cancelled.', downloadId, videoId, title: safeTitle
                        });
                    } else if (code === 0) {
                        log('info', 'Native download completed.', '', 'process', 'download.completed');
                        sendMessage({
                            action: 'download_video_result', status: 'success',
                            message: 'Download completed.', downloadId, videoId, title: safeTitle
                        });
                    } else {
                        const diagnostic = details || stderrTail.trim() || stdoutTail.trim();
                        log('error', errorMessage || `yt-dlp error code: ${code}`, 'stderr', 'process', 'download.failed');
                        sendMessage({
                            action: 'download_video_result', status: 'error',
                            message: errorMessage || `yt-dlp error code: ${code}`,
                            downloadId, videoId, title: safeTitle,
                            ...(developerMode && diagnostic ? { details: redactDiagnosticText(diagnostic).slice(-6000) } : {})
                        });
                    }
                };

                ytdlp.stdout.on('data', (data) => {
                    const output = data.toString();
                    if (developerMode) {
                        stdoutTail = appendOutputTail(stdoutTail, output);
                        log('debug', output, 'stdout', 'download', 'native.ytdlp_stdout');
                    }
                    const progress = parseProgressLine(output);
                    sendMessage({
                        action: 'download_video_progress',
                        status: 'progress',
                        downloadId,
                        videoId,
                        percent: progress.percent,
                        speed: progress.speed,
                        eta: progress.eta,
                        message: progress.message
                    });
                });
                ytdlp.stderr.on('data', (data) => {
                    const output = data.toString();
                    if (developerMode) {
                        stderrTail = appendOutputTail(stderrTail, output);
                        log('warn', output, 'stderr', 'download', 'native.ytdlp_stderr');
                    }
                    const progress = parseProgressLine(output);
                    sendMessage({
                        action: 'download_video_progress',
                        status: 'progress',
                        downloadId,
                        videoId,
                        percent: progress.percent,
                        speed: progress.speed,
                        eta: progress.eta,
                        message: progress.message
                    });
                });
                ytdlp.on('error', error => finishDownload(null, `Could not start yt-dlp: ${error.message}`, error.message));
                ytdlp.on('close', code => finishDownload(code));

            } else if (request.action === 'pick_folder') {
                // ── IFileOpenDialog (Vista-style File Explorer picker) ────────
                // C# compiled at runtime via Add-Type in a temp PS1 (STA thread).
                // Falls back to WinForms FolderBrowserDialog if COM compile fails.

                const initialPath = (request.currentPath && request.currentPath.trim())
                    ? request.currentPath.trim()
                    : path.join(process.env.USERPROFILE || process.env.HOME, 'Downloads');

                const safeInit = initialPath.replace(/\\/g, '\\\\').replace(/'/g, "''");

                // C# lines — single-quoted PS here-string safe (no backticks, no $ expansion)
                const csLines = [
                    'using System;',
                    'using System.Runtime.InteropServices;',
                    'public class VistaPicker {',
                    '  [DllImport("shell32.dll", CharSet=CharSet.Unicode, PreserveSig=false)]',
                    '  public static extern void SHCreateItemFromParsingName(',
                    '    string pszPath, IntPtr pbc, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out object ppv);',
                    '  [ComImport]',
                    '  [Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]',
                    '  [CoClass(typeof(object))]',
                    '  public interface FileOpenDialogRCW {}',
                    '  [ComImport]',
                    '  [Guid("42F85136-DB7E-439C-85F1-E4075D135FC8")]',
                    '  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
                    '  public interface IFileDialog {',
                    '    [PreserveSig] uint Show([In] IntPtr parent);',
                    '    void SetFileTypes(uint c, [In, MarshalAs(UnmanagedType.LPArray)] IntPtr[] p);',
                    '    void SetFileTypeIndex(uint i);',
                    '    void GetFileTypeIndex(out uint pi);',
                    '    void Advise(IntPtr pfde, out uint pdwCookie);',
                    '    void Unadvise(uint dwCookie);',
                    '    void SetOptions([In] uint fos);',
                    '    void GetOptions(out uint pfos);',
                    '    void SetDefaultFolder([In, MarshalAs(UnmanagedType.Interface)] object psi);',
                    '    void SetFolder([In, MarshalAs(UnmanagedType.Interface)] object psi);',
                    '    void GetFolder([MarshalAs(UnmanagedType.Interface)] out object ppsi);',
                    '    void GetCurrentSelection([MarshalAs(UnmanagedType.Interface)] out object ppsi);',
                    '    void SetFileName([In, MarshalAs(UnmanagedType.LPWStr)] string pszName);',
                    '    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);',
                    '    void SetTitle([In, MarshalAs(UnmanagedType.LPWStr)] string pszTitle);',
                    '    void SetOkButtonLabel([In, MarshalAs(UnmanagedType.LPWStr)] string pszText);',
                    '    void SetFileNameLabel([In, MarshalAs(UnmanagedType.LPWStr)] string pszLabel);',
                    '    void GetResult([MarshalAs(UnmanagedType.Interface)] out object ppsi);',
                    '    void AddPlace([In, MarshalAs(UnmanagedType.Interface)] object psi, int alignment);',
                    '    void SetDefaultExtension([In, MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);',
                    '    void Close([MarshalAs(UnmanagedType.Error)] int hr);',
                    '    void SetClientGuid([In] ref Guid guid);',
                    '    void ClearClientData();',
                    '    void SetFilter([MarshalAs(UnmanagedType.Interface)] object pFilter);',
                    '  }',
                    '  [ComImport]',
                    '  [Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE")]',
                    '  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
                    '  public interface IShellItem {',
                    '    void BindToHandler(IntPtr pbc, [In] ref Guid bhid, [In] ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out object ppv);',
                    '    void GetParent([MarshalAs(UnmanagedType.Interface)] out IShellItem ppsi);',
                    '    void GetDisplayName([In] uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);',
                    '    void GetAttributes([In] uint sfgaoMask, out uint psfgaoAttribs);',
                    '    void Compare([In, MarshalAs(UnmanagedType.Interface)] IShellItem psi, [In] uint hint, out int piOrder);',
                    '  }',
                    '  public static string PickFolder(string startPath) {',
                    '    try {',
                    '      var clsid = new Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7");',
                    '      var iid   = new Guid("42F85136-DB7E-439C-85F1-E4075D135FC8");',
                    '      var dlg = (IFileDialog)Activator.CreateInstance(Type.GetTypeFromCLSID(clsid));',
                    '      uint opts; dlg.GetOptions(out opts);',
                    '      dlg.SetOptions(opts | 0x20 | 0x40 | 0x8);', // FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST
                    '      dlg.SetTitle("Select Download Folder");',
                    '      dlg.SetOkButtonLabel("Select");',
                    '      try {',
                    '        var shellGuid = new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");',
                    '        object siObj;',
                    '        SHCreateItemFromParsingName(startPath, IntPtr.Zero, ref shellGuid, out siObj);',
                    '        dlg.SetFolder(siObj);',
                    '      } catch {}',
                    '      uint hr = dlg.Show(IntPtr.Zero);',
                    '      if (hr != 0) return "";',
                    '      object result;',
                    '      dlg.GetResult(out result);',
                    '      var si = (IShellItem)result;',
                    '      string name;',
                    '      si.GetDisplayName(0x80058000, out name);', // SIGDN_FILESYSPATH
                    '      return name ?? "";',
                    '    } catch (Exception ex) {',
                    '      return "ERR:" + ex.Message;',
                    '    }',
                    '  }',
                    '}'
                ];

                const psLines = [
                    // Use single-quoted here-string @'...'@ — NO variable expansion, NO escaping needed
                    "Add-Type -TypeDefinition @'",
                    ...csLines,
                    "'@",
                    `$r = [VistaPicker]::PickFolder('${safeInit}')`,
                    // If C# COM fails (returns ERR:... or empty), fall back to WinForms
                    "if ($r -eq $null -or $r -eq '' -or $r.StartsWith('ERR:')) {",
                    "    Add-Type -AssemblyName System.Windows.Forms",
                    "    [System.Windows.Forms.Application]::EnableVisualStyles()",
                    "    $d = New-Object System.Windows.Forms.FolderBrowserDialog",
                    "    $d.Description = 'Select download folder'",
                    "    $d.ShowNewFolderButton = $true",
                    `    $d.SelectedPath = '${safeInit}'`,
                    "    if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath } else { Write-Output '' }",
                    "} else {",
                    "    Write-Output $r",
                    "}"
                ];

                const tmpPs1 = path.join(
                    process.env.TEMP || process.env.TMP || __dirname,
                    `fp-${Date.now()}.ps1`
                );

                try {
                    // BOM ensures PowerShell reads UTF-8 correctly on all locales
                    fs.writeFileSync(tmpPs1, '\ufeff' + psLines.join('\r\n'), 'utf8');
                } catch (e) {
                    sendMessage({ action: 'pick_folder_result', path: '', error: 'tmp write: ' + e.message });
                    continue;
                }

                let ps;
                try {
                    ps = spawn('powershell.exe', [
                        '-NoProfile',
                        '-STA',
                        '-ExecutionPolicy', 'Bypass',
                        '-File', tmpPs1
                    ], { windowsHide: false, detached: false });
                } catch (error) {
                    try { fs.unlinkSync(tmpPs1); } catch (_) { }
                    sendMessage({ action: 'pick_folder_result', path: '', error: error.message });
                    continue;
                }

                let psOut = '', psErr = '';
                ps.stdout.on('data', d => { psOut += d.toString(); });
                ps.stderr.on('data', d => { psErr += d.toString(); });
                ps.on('close', (code) => {
                    try { fs.unlinkSync(tmpPs1); } catch (_) { }
                    sendMessage({
                        action: 'pick_folder_result',
                        path: psOut.trim(),
                        _exitCode: code,
                        _stderr: psErr.trim()
                    });
                });
                ps.on('error', err => {
                    try { fs.unlinkSync(tmpPs1); } catch (_) { }
                    sendMessage({ action: 'pick_folder_result', path: '', error: err.message });
                });

            } else if (request.action === 'update_media_tools') {
                const developerMode = request.developerMode === true;
                const log = (level, message, phase = 'tools', event = '') =>
                    emitDeveloperLog({ ...request, developerMode }, level, message, '', phase, event);
                log('info', 'Preparing verified media tools.', 'setup', 'native.media_tools_started');
                sendMessage({ status: 'info', message: 'Preparing verified media tools...' });
                try {
                    await ensureYtdlp();
                    await ensureFfmpeg();
                    log('info', 'Verified media tools are ready.', 'setup', 'native.media_tools_ready');
                    sendMessage({ status: 'media_tools_ready', ...getToolStatus() });
                } catch (e) {
                    log('error', 'Failed to prepare media tools: ' + e.message, 'setup', 'native.media_tools_failed');
                    sendMessage({ status: 'error', message: 'Failed to prepare media tools: ' + e.message, ...getToolStatus() });
                }

            } else if (request.action === 'update_ytdlp') {
                const developerMode = request.developerMode === true;
                const log = (level, message, phase = 'update', event = '') =>
                    emitDeveloperLog({ ...request, developerMode }, level, message, '', phase, event);
                log('info', 'Downloading and verifying the latest yt-dlp version.', 'update', 'native.ytdlp_update_started');
                sendMessage({ status: 'info', message: 'Downloading and verifying the latest yt-dlp version...' });
                try {
                    await installYtdlp();
                    log('info', 'Successfully installed the verified yt-dlp version.', 'update', 'native.ytdlp_update_completed');
                    sendMessage({ status: 'update_success', message: 'Successfully installed the verified yt-dlp version!' });
                } catch (e) {
                    log('error', 'Failed to update yt-dlp: ' + e.message, 'update', 'native.ytdlp_update_failed');
                    sendMessage({ status: 'error', message: 'Failed to update yt-dlp: ' + e.message });
                }

            } else if (request.action === 'ping') {
                sendMessage({ status: 'pong', ...getToolStatus() });
            }

        } catch (e) {
            emitDeveloperLog(request, 'error', e.toString(), 'stderr', 'protocol', 'native.protocol_error');
            sendMessage({ status: 'error', message: e.toString() });
        }
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    main,
    FFMPEG_ARCHIVE_NAME,
    FFMPEG_RELEASE_API,
    selectFfmpegAsset,
    YOUTUBE_PLAYER_CLIENT,
    YTDLP_JS_RUNTIME,
    OUTPUT_FORMATS,
    PAGE_ID_PATTERN,
    PROFILE_ID_PATTERN,
    FORMAT_ID_PATTERN,
    encodeNativeMessage,
    isAllowedDirectUrl,
    isPageId,
    isDownloadId,
    isSafeFormatId,
    isSafeOutputFormat,
    isSafeProfileId,
    sanitizeFilePart,
    redactStreamUrls,
    redactDiagnosticText,
    parseJsonOutput,
    normalizeYtdlpFormat,
    numericDuration,
    parseProgressLine,
    resolvePageSelector,
    resolveDownloadFolderPath,
    buildPageDownloadArgs,
    getYtdlpRuntimeArgs,
    getYtdlpYouTubeArgs
};
