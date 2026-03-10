#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

// The local path where we expect to find our bundled/downloaded yt-dlp tool
const YTDLP_BIN = path.join(__dirname, 'yt-dlp.exe');

const downloadYtdlp = () => {
    return new Promise((resolve, reject) => {
        const fileStream = fs.createWriteStream(YTDLP_BIN);
        // Follow redirects since GitHub releases redirect to objects
        const attemptDownload = (url) => {
            https.get(url, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    attemptDownload(res.headers.location);
                } else if (res.statusCode === 200) {
                    res.pipe(fileStream);
                    fileStream.on('finish', () => {
                        fileStream.close();
                        resolve();
                    });
                } else {
                    reject(new Error(`Server returned ${res.statusCode}`));
                }
            }).on('error', (err) => {
                fs.unlink(YTDLP_BIN, () => {});
                reject(err);
            });
        };
        attemptDownload('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe');
    });
};

// Native Messaging helpers for Chrome
const getMessage = () => {
    return new Promise((resolve) => {
        let lengthBytes = Buffer.alloc(0);
        let messageBytes = Buffer.alloc(0);
        let length = -1;

        process.stdin.on('data', (chunk) => {
            if (length === -1) {
                lengthBytes = Buffer.concat([lengthBytes, chunk]);
                if (lengthBytes.length >= 4) {
                    length = lengthBytes.readUInt32LE(0);
                    messageBytes = lengthBytes.slice(4);
                }
            } else {
                messageBytes = Buffer.concat([messageBytes, chunk]);
            }

            if (length !== -1 && messageBytes.length >= length) {
                const messageString = messageBytes.toString('utf8', 0, length);
                resolve(JSON.parse(messageString));
            }
        });
    });
};

const sendMessage = (msg) => {
    const buffer = Buffer.from(JSON.stringify(msg));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(buffer.length, 0);
    process.stdout.write(header);
    process.stdout.write(buffer);
};

// Main loop
async function main() {
    sendMessage({ status: 'ready', message: 'Native host started' });

    while (true) {
        try {
            const request = await getMessage();

            if (request.action === 'download_video') {
                const { videoId, title, videoQuality, qualityHeight, isAudioOnly } = request;

                if (!videoId) {
                    sendMessage({ status: 'error', message: 'No videoId provided.' });
                    continue;
                }

                if (!fs.existsSync(YTDLP_BIN)) {
                    sendMessage({ status: 'info', message: 'Local yt-dlp.exe not found! Downloading it now...' });
                    try {
                        await downloadYtdlp();
                        sendMessage({ status: 'info', message: 'Successfully downloaded yt-dlp.exe!' });
                    } catch (e) {
                        sendMessage({ status: 'error', message: 'Failed to download yt-dlp.exe: ' + e.message });
                        continue;
                    }
                }

                const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;

                // Normalize quality label for use in filename (strip chars unsafe for Windows paths)
                const safeQuality = (videoQuality || 'best')
                    .replace(/[/\\<>:"|?*\x00-\x1f]/g, '_')
                    .trim();

                // Keep full Unicode title (Windows NTFS handles it), only strip truly unsafe chars
                const safeTitle = (title || 'video')
                    .replace(/[/\\<>:"|?*\x00-\x1f]/g, '_')
                    .replace(/\.{2,}/g, '.')
                    .trim()
                    .substring(0, 150);

                // ── Build yt-dlp format selector ───────────────────────────────
                //
                // Codec priority (best quality first):
                //   AV1 (av01) > VP9 (vp9) > H.264 (avc1)
                //
                // We do NOT restrict [ext=mp4] on the video stream because YouTube's
                // highest-quality streams are usually WebM/AV1 or WebM/VP9.
                // --merge-output-format mp4 re-muxes everything into mp4 at the end,
                // so the final file is always a standard mp4 regardless of source codec.
                //
                // Audio: always grab bestaudio (typically m4a/opus ~128-160kbps).
                //
                let formatSelector;
                let outExt = 'mp4';

                if (isAudioOnly) {
                    formatSelector = null; // handled via -x flag below
                    outExt = 'mp3';
                } else if (qualityHeight) {
                    // Prefer AV1, then VP9, then H.264 — all at the exact requested height
                    formatSelector = [
                        `bestvideo[height=${qualityHeight}][vcodec^=av01]+bestaudio`,
                        `bestvideo[height=${qualityHeight}][vcodec^=vp9]+bestaudio`,
                        `bestvideo[height=${qualityHeight}]+bestaudio`,
                        `bestvideo[height<=${qualityHeight}][vcodec^=av01]+bestaudio`,
                        `bestvideo[height<=${qualityHeight}][vcodec^=vp9]+bestaudio`,
                        `bestvideo[height<=${qualityHeight}]+bestaudio`,
                        `best[height<=${qualityHeight}]`
                    ].join('/');
                } else {
                    formatSelector = 'bestvideo[vcodec^=av01]+bestaudio/bestvideo[vcodec^=vp9]+bestaudio/bestvideo+bestaudio/best';
                }

                const outTemplate = path.join(
                    process.env.USERPROFILE || process.env.HOME,
                    'Downloads',
                    isAudioOnly
                        ? `${safeTitle} [${safeQuality}].%(ext)s`
                        : `${safeTitle} [${safeQuality}].mp4`
                );

                // Common quality flags applied to every download:
                //   --concurrent-fragments 4  → parallel fragment download (faster)
                //   --no-playlist             → never accidentally grab a playlist
                //   --no-part                 → write directly, no .part temp file clutter
                const commonArgs = [
                    '--concurrent-fragments', '4',
                    '--no-playlist',
                    '--no-part'
                ];

                let args;
                if (isAudioOnly) {
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

                sendMessage({ status: 'info', message: `Starting yt-dlp: ${args.join(' ')}` });

                const ytdlp = spawn(YTDLP_BIN, args, { windowsHide: true });

                ytdlp.stdout.on('data', (data) => {
                    sendMessage({ status: 'progress', data: data.toString() });
                });
                ytdlp.stderr.on('data', (data) => {
                    sendMessage({ status: 'error_log', data: data.toString() });
                });
                ytdlp.on('close', (code) => {
                    if (code === 0) {
                        sendMessage({ 
                            action: 'download_video_result', 
                            status: 'success', 
                            message: 'Download completed.',
                            videoId: videoId,
                            title: safeTitle
                        });
                    } else {
                        sendMessage({ 
                            action: 'download_video_result',
                            status: 'error', 
                            message: `yt-dlp error code: ${code}`,
                            videoId: videoId,
                            title: safeTitle
                        });
                    }
                });

            } else if (request.action === 'update_ytdlp') {
                if (!fs.existsSync(YTDLP_BIN)) {
                    sendMessage({ status: 'info', message: 'yt-dlp.exe is missing. Downloading the latest version now...' });
                    try {
                        await downloadYtdlp();
                        sendMessage({ status: 'update_success', message: 'Successfully installed yt-dlp.exe!' });
                    } catch (e) {
                        sendMessage({ status: 'error', message: 'Failed to download yt-dlp.exe: ' + e.message });
                    }
                } else {
                    sendMessage({ status: 'info', message: 'Checking for yt-dlp updates...' });
                    const ytdlp = spawn(YTDLP_BIN, ['-U'], { windowsHide: true });
    
                    ytdlp.stdout.on('data', (data) => {
                        sendMessage({ status: 'progress', data: data.toString() });
                    });
                    ytdlp.stderr.on('data', (data) => {
                        sendMessage({ status: 'error_log', data: data.toString() });
                    });
                    ytdlp.on('close', (code) => {
                        if (code === 0) {
                            sendMessage({ status: 'update_success', message: 'Update check finished.' });
                        } else {
                            sendMessage({ status: 'error', message: `yt-dlp updater error code: ${code}` });
                        }
                    });
                }

            } else if (request.action === 'ping') {
                sendMessage({ status: 'pong' });
            }

        } catch (e) {
            sendMessage({ status: 'error', message: e.toString() });
        }
    }
}

main();