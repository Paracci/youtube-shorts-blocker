// ─────────────────────────────────────────────────────────────────────────────
// downloader.js – Video format fetching, download triggering, modal UI,
//                 Shorts download button, and video-player download button
// Depends on: utils.js, state.js, notifications.js
// ─────────────────────────────────────────────────────────────────────────────

// ═════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═════════════════════════════════════════════════════════════════════════════

function isShortPage() {
    return window.location.pathname.startsWith('/shorts/');
}

function getCurrentVideoId() {
    const m = window.location.pathname.match(/\/shorts\/([^/?#]+)/);
    const candidate = m ? m[1] : new URLSearchParams(window.location.search).get('v');
    return candidate && /^[A-Za-z0-9_-]{6,}$/.test(candidate) ? candidate : null;
}

// ═════════════════════════════════════════════════════════════════════════════
//  FORMAT PARSING & SORTING
// ═════════════════════════════════════════════════════════════════════════════

const QUALITY_ORDER = {
    '2160p60': 0, '2160p': 1, '1440p60': 2, '1440p': 3, '1080p60': 4, '1080p': 5,
    '720p60': 6, '720p': 7, '480p': 8, '360p': 9, '240p': 10, '144p': 11
};

const CODEC_PRIORITY  = { 'av01': 4, 'vp9': 3, 'vp09': 3, 'avc1': 2, 'mp4v': 1 };
const SOURCE_PRIORITY = { 'IOS': 4, 'ANDROID': 3, 'TVHTML5': 2, 'WEB': 1 };

function _positiveNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
}

function _formatHeight(formatOrLabel) {
    const directHeight = typeof formatOrLabel === 'object'
        ? _positiveNumber(formatOrLabel?.height)
        : null;
    if (directHeight) return Math.round(directHeight);

    const label = typeof formatOrLabel === 'string'
        ? formatOrLabel
        : String(formatOrLabel?.quality || formatOrLabel?.qualityLabel || '');
    const match = label.match(/(\d{2,5})p/i);
    return match ? parseInt(match[1], 10) : null;
}

function _formatFps(format) {
    const fps = _positiveNumber(format?.fps);
    return fps ? Math.round(fps) : null;
}

function _hasDirectUrl(format) {
    return typeof format?.url === 'string' && format.url.trim().length > 0;
}

function _formatQuality(format, type, height, fps) {
    const rawQuality = typeof format?.qualityLabel === 'string' && format.qualityLabel.trim()
        ? format.qualityLabel.trim()
        : typeof format?.quality === 'string' && format.quality.trim()
            ? format.quality.trim()
            : '';

    if (type === 'audio') {
        const aqMap = {
            AUDIO_QUALITY_HIGH: 'High',
            AUDIO_QUALITY_MEDIUM: 'Medium',
            AUDIO_QUALITY_LOW: 'Low'
        };
        const aqLabel = aqMap[format?.audioQuality] || null;
        return 'Audio Only' + (aqLabel ? ` (${aqLabel})` : '');
    }

    if (rawQuality) return rawQuality;
    if (height) return `${height}p${fps ? `${fps}` : ''}`;
    return '?';
}

function _normalizePlayerFormat(format, preferredType) {
    if (!format || typeof format !== 'object') return null;

    const mime = typeof format.mimeType === 'string' && format.mimeType.trim()
        ? format.mimeType.trim()
        : 'video/mp4';
    const isAudioMime = mime.toLowerCase().startsWith('audio/');
    const type = preferredType || (isAudioMime ? 'audio' : 'video');
    const height = _formatHeight(format);
    const fps = _formatFps(format);
    const hasDirectUrl = _hasDirectUrl(format);
    const hasItag = _positiveNumber(format.itag) !== null;
    const hasVideoMetadata = Boolean(height || format.qualityLabel || format.quality || mime.toLowerCase().startsWith('video/'));
    const hasAudioMetadata = Boolean(format.audioQuality || format.audioSampleRate || isAudioMime);

    // A metadata-only adaptive entry is useful only when it can still be
    // described and selected by quality. Cipher/signature fields are never
    // retained; yt-dlp resolves the actual stream in the native host.
    if (!hasDirectUrl && (!hasItag || (type === 'audio' ? !hasAudioMetadata : !hasVideoMetadata))) {
        return null;
    }

    const record = {
        quality: _formatQuality(format, type, height, fps) + (type === 'video' ? ' (High Quality)' : ''),
        mime,
        itag: format.itag || 0,
        size: format.contentLength || null,
        type,
        height,
        fps,
        hasDirectUrl
    };

    if (hasDirectUrl) record.url = format.url;
    return record;
}

function parseStreamingData(data) {
    if (!data || !data.streamingData) return [];

    const formats = (data.streamingData.formats || [])
        .map(f => _normalizePlayerFormat(f, 'video_audio'))
        .filter(Boolean);

    const adaptive = (data.streamingData.adaptiveFormats || [])
        .map(f => _normalizePlayerFormat(
            f,
            typeof f.mimeType === 'string' && f.mimeType.toLowerCase().startsWith('audio/')
                ? 'audio'
                : 'video'
        ))
        .filter(Boolean);

    return [...formats, ...adaptive];
}

function _getCodecPriority(mime) {
    if (!mime) return 0;
    const m = mime.match(/codecs="?([^",]+)/);
    if (!m) return 0;
    return CODEC_PRIORITY[m[1].trim().toLowerCase().slice(0, 4)] || 0;
}

function getCodecLabel(mime) {
    if (!mime) return 'MP4';
    const m = mime.match(/codecs="?([^",]+)/);
    if (!m) return mime.includes('webm') ? 'VP9' : 'H.264';
    const c = m[1].trim().toLowerCase();
    if (c.startsWith('av01')) return 'AV1';
    if (c.startsWith('vp9') || c.startsWith('vp09')) return 'VP9';
    if (c.startsWith('avc')) return 'H.264';
    return 'MP4';
}

function getMimeLabel(mime) {
    if (!mime) return 'MP4';
    if (mime.includes('mp4'))  return 'MP4';
    if (mime.includes('webm')) return 'WebM';
    if (mime.includes('3gpp')) return '3GP';
    return 'Video';
}

function formatSize(bytes) {
    if (!bytes) return '';
    const mb = parseInt(bytes) / (1024 * 1024);
    return mb >= 1 ? '~' + mb.toFixed(0) + ' MB' : '';
}

function _qualityOrder(format) {
    const clean = String(format?.quality || '')
        .replace(' (High Quality)', '')
        .replace(/Audio Only.*/, 'Audio Only')
        .trim();

    if (QUALITY_ORDER[clean] !== undefined) return QUALITY_ORDER[clean];

    const height = _formatHeight(format);
    if (height) {
        const knownHeights = [2160, 1440, 1080, 720, 480, 360, 240, 144];
        const index = knownHeights.findIndex(value => height >= value);
        if (index >= 0) return index * 2 + 1;
    }
    return 99;
}

function _deduplicateAndSort(allFormats, title) {
    const uniqueFormatsMap = new Map();

    for (const f of allFormats) {
        const height = _formatHeight(f) || f.quality;
        const key = height + '|' + f.type;

        if (uniqueFormatsMap.has(key)) {
            const existing = uniqueFormatsMap.get(key);
            const existingCodec  = _getCodecPriority(existing.mime);
            const newCodec       = _getCodecPriority(f.mime);
            const existingSource = SOURCE_PRIORITY[existing.source] || 0;
            const newSource      = SOURCE_PRIORITY[f.source] || 0;
            const existingDirect = existing.hasDirectUrl === true || _hasDirectUrl(existing);
            const newDirect = f.hasDirectUrl === true || _hasDirectUrl(f);
            if (newDirect !== existingDirect
                ? newDirect
                : newCodec > existingCodec || (newCodec === existingCodec && newSource > existingSource)) {
                uniqueFormatsMap.set(key, f);
            }
        } else {
            uniqueFormatsMap.set(key, f);
        }
    }

    let finalList = Array.from(uniqueFormatsMap.values());

    // Remove video-only streams that duplicate a muxed stream at the same height
    const muxedHeights = new Set(
        finalList
            .filter(f => f.type === 'video_audio')
            .map(f => _formatHeight(f))
            .filter(Boolean)
    );
    finalList = finalList.filter(f => {
        if (f.type !== 'video') return true;
        const height = _formatHeight(f);
        if (!height) return true;
        return !muxedHeights.has(height);
    });

    finalList = finalList.map(f => ({
        ...f, codec: getCodecLabel(f.mime),
        size: f.type === 'video_audio' ? f.size : null
    }));

    finalList.sort((a, b) => {
        const typeOrder = { 'video_audio': 0, 'video': 1, 'audio': 2 };
        if (typeOrder[a.type] !== typeOrder[b.type]) return typeOrder[a.type] - typeOrder[b.type];
        return _qualityOrder(a) - _qualityOrder(b);
    });

    return { formats: finalList, title };
}

function mergeFormatResults(results, title) {
    const allFormats = (Array.isArray(results) ? results : [])
        .flatMap(result => Array.isArray(result?.formats) ? result.formats : []);
    return allFormats.length ? _deduplicateAndSort(allFormats, title) : { formats: [], title };
}

// ═════════════════════════════════════════════════════════════════════════════
//  N-DESCRAMBLER (throttle-param bypass)
// ═════════════════════════════════════════════════════════════════════════════

let _nDescrambler = null;

async function getNDescrambler() {
    if (_nDescrambler) return _nDescrambler;
    try {
        let playerUrl = null;
        for (const s of document.querySelectorAll('script:not([src])')) {
            const m = s.textContent.match(/"jsUrl"\s*:\s*"([^"]+\.js)"/);
            if (m) { playerUrl = m[1]; break; }
        }
        if (!playerUrl) return null;

        const res  = await fetch(playerUrl);
        const code = await res.text();

        const patterns = [
            /\.get\("n"\)\)&&\(b=([a-zA-Z0-9$]{2,4})\[(\d+)\]\(b\)/,
            /([a-zA-Z0-9$]+)\[(\d+)\]\s*\(b\)/
        ];

        let arrName = null, arrIndex = null;
        for (const p of patterns) {
            const m = code.match(p);
            if (m) {
                arrName = m[1]; arrIndex = m[2];
                if (code.includes(`var ${arrName.replace('$', '\\$')} = [`)) break;
            }
        }
        if (!arrName) return null;

        const arrMatch = code.match(
            new RegExp('var ' + arrName.replace('$', '\\$') + '\\s*=\\s*\\[(.+?)\\]\\s*[,;]')
        );
        if (!arrMatch) return null;

        const fnNames = arrMatch[1].split(',').map(s => s.trim());
        const fnName  = fnNames[parseInt(arrIndex)];
        if (!fnName) return null;

        const fnBodyMatch = code.match(
            new RegExp('(?:function ' + fnName + '|' + fnName + '\\s*=\\s*function)\\s*\\(([^)]+)\\)\\s*\\{([\\s\\S]+?)\\}\\s*[;,]')
        );
        if (!fnBodyMatch) return null;

        // eslint-disable-next-line no-new-func
        _nDescrambler = new Function(fnBodyMatch[1], fnBodyMatch[2]);
        return _nDescrambler;
    } catch (e) {
        console.warn('[YT-DL] n-descrambler load failed:', e.message);
        return null;
    }
}

async function descrambleUrl(url) {
    try {
        const u = new URL(url);
        const n = u.searchParams.get('n');
        if (!n) return url;
        const fn = await getNDescrambler();
        if (!fn) return url;
        u.searchParams.set('n', fn(n));
        return u.toString();
    } catch (_) { return url; }
}

// ═════════════════════════════════════════════════════════════════════════════
//  INNERTUBE CLIENT FETCHERS
// ═════════════════════════════════════════════════════════════════════════════

async function fetchViaInnerTubeClient(videoId, clientName, clientVersion, osName, osVersion, extraHeaders = {}) {
    try {
        const payload = {
            videoId,
            context: {
                client: {
                    clientName, clientVersion,
                    hl: document.documentElement.lang || 'tr',
                    gl: 'US'
                }
            }
        };
        if (osName)    payload.context.client.osName    = osName;
        if (osVersion) payload.context.client.osVersion = osVersion;

        const res = await fetch('/youtubei/v1/player?prettyPrint=false', {
            method: 'POST',
            credentials: 'omit',
            headers: { 'Content-Type': 'application/json', ...extraHeaders },
            body: JSON.stringify(payload)
        });
        if (!res.ok) return { formats: [], title: null };
        const json = await res.json();
        return { formats: parseStreamingData(json), title: json?.videoDetails?.title || null };
    } catch (_) { return { formats: [], title: null }; }
}

async function fetchViaEmbeddedPlayer(videoId) {
    return fetchViaInnerTubeClient(videoId, 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', '2.0', null, null, {
        'X-YouTube-Client-Name': '85', 'X-YouTube-Client-Version': '2.0',
    });
}

async function fetchViaAndroid(videoId) {
    return fetchViaInnerTubeClient(videoId, 'ANDROID', '21.02.35', 'Android', '11', {
        'X-YouTube-Client-Name': '3', 'X-YouTube-Client-Version': '21.02.35',
        'User-Agent': 'com.google.android.youtube/21.02.35 (Linux; U; Android 11) gzip'
    });
}

async function fetchViaIOS(videoId) {
    return fetchViaInnerTubeClient(videoId, 'IOS', '21.02.3', 'iPhone', '18.3.2.22D82', {
        'X-YouTube-Client-Name': '5', 'X-YouTube-Client-Version': '21.02.3',
        'User-Agent': 'com.google.ios.youtube/21.02.3 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)'
    });
}

// ─── Main fetch entry point ───────────────────────────────────────────────────
async function fetchVideoFormats() {
    const videoId = getCurrentVideoId();
    if (!videoId) return { formats: [], title: 'video' };

    let title = 'video';
    let titleVerified = false;

    // Try the embedded ytInitialPlayerResponse first (fastest, no extra request)
    const webResult = await (async () => {
        if (isShortPage()) {
            const activeShort = document.querySelector('ytd-reel-video-renderer[is-active]');
            if (activeShort) {
                const el = activeShort.querySelector('.title, h2.title, yt-formatted-string.title');
                if (el?.textContent) title = el.textContent.trim();
            }
        }

        if (title === 'video') {
            const meta = document.querySelector('meta[name="title"]') ||
                document.querySelector('meta[property="og:title"]');
            if (meta?.content) title = meta.content;
            else if (document.title && document.title !== 'YouTube')
                title = document.title.replace(/ - YouTube$/, '').trim();
        }

        for (const s of document.querySelectorAll('script:not([src])')) {
            if (!s.textContent.includes('ytInitialPlayerResponse')) continue;
            const m = s.textContent.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\})\s*;/);
            if (!m) continue;
            try {
                const data      = JSON.parse(m[1]);
                const embeddedId = data.videoDetails?.videoId;
                if (embeddedId && embeddedId !== videoId) continue;
                if (data.videoDetails?.title) { title = data.videoDetails.title; titleVerified = true; }
                const parsed = parseStreamingData(data);
                if (parsed.length > 0) {
                    const formats = await Promise.all(parsed.map(async f => {
                        if (!f.hasDirectUrl) return { ...f, source: 'WEB' };
                        return { ...f, url: await descrambleUrl(f.url), source: 'WEB' };
                    }));
                    return { formats, title };
                }
            } catch (_) { }
        }
        return { formats: [], title };
    })();

    // Always combine the client responses. A client can expose a low-quality
    // muxed stream while another client exposes higher adaptive metadata
    // without a direct URL (for example 1440p/2160p Android entries).
    const clients = [
        { fetcher: fetchViaIOS,            name: 'IOS'     },
        { fetcher: fetchViaAndroid,        name: 'ANDROID' },
        { fetcher: fetchViaEmbeddedPlayer, name: 'TVHTML5' },
    ];

    const sourceResults = [webResult];
    if (webResult.title && title === 'video') title = webResult.title;

    for (const { fetcher, name } of clients) {
        try {
            const result  = await fetcher(videoId);
            const formats = (result.formats || []).map(f => ({ ...f, source: name }));
            if (result.title && !titleVerified) { title = result.title; titleVerified = true; }
            sourceResults.push({ formats, title: result.title });
        } catch (_) { }
    }

    return mergeFormatResults(sourceResults, title);
}

// ═════════════════════════════════════════════════════════════════════════════
//  TRIGGER DOWNLOAD
// ═════════════════════════════════════════════════════════════════════════════

const activeNativeDownloadToasts = new Map();
const activeDirectDownloads = new Map();

function createDownloadId() {
    const randomPart = Math.random().toString(36).slice(2, 12);
    return `download-${Date.now().toString(36)}-${randomPart}`;
}

function getDownloadFormatLabel(format, outputFormat = null) {
    const height = _formatHeight(format);
    const quality = String(format?.quality || format?.qualityLabel || '').trim();
    const qualityLabel = quality || (height ? `${height}p` : 'Download');
    if (format?.type === 'audio') return String(outputFormat || 'MP3').toUpperCase();

    const mime = String(format?.mime || format?.mimeType || '').toLowerCase();
    const extension = outputFormat || (mime.includes('webm') ? 'webm' : 'mp4');
    return `${qualityLabel} ${String(extension).toUpperCase()}`.trim();
}

function formatByteRate(bytesPerSecond) {
    if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '—';
    const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    let value = bytesPerSecond;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
        value /= 1024;
        index++;
    }
    return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function formatDownloadEta(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '—';
    const rounded = Math.ceil(seconds);
    if (rounded < 60) return `${rounded}s`;
    const minutes = Math.floor(rounded / 60);
    const remainder = rounded % 60;
    return `${minutes}m ${String(remainder).padStart(2, '0')}s`;
}

function openDownloadFolderFromNotification(button) {
    if (!button) return;
    button.disabled = true;

    const resetButton = () => {
        button.disabled = false;
    };

    try {
        chrome.runtime.sendMessage({ action: 'open_download_folder' }, (response) => {
            if (chrome.runtime.lastError || !response || response.status !== 'ok') {
                resetButton();
                showYouTubeNotification('', i18n.t('downloadOpenFolderError'), null, 'error');
                return;
            }

            button.textContent = i18n.t('downloadFolderOpened');
            button.style.borderColor = 'rgba(123, 220, 137, .7)';
            button.style.background = 'rgba(43, 166, 64, .22)';
            // Keep the action reusable. Opening the folder is independent from
            // the completed download, so one notification can open it again.
            resetButton();
        });
    } catch (_) {
        resetButton();
        showYouTubeNotification('', i18n.t('downloadOpenFolderError'), null, 'error');
    }
}

function registerNativeDownloadToast(downloadId, videoId, toast) {
    if (!downloadId || !toast) return;
    activeNativeDownloadToasts.set(String(downloadId), { videoId: String(videoId || ''), toast });
}

function getNativeDownloadEntry(downloadId, videoId) {
    const directEntry = downloadId ? activeNativeDownloadToasts.get(String(downloadId)) : null;
    if (directEntry) return { downloadId: String(downloadId), ...directEntry };

    const candidates = [...activeNativeDownloadToasts.entries()]
        .filter(([, entry]) => String(entry.videoId) === String(videoId || ''));
    return candidates.length === 1
        ? { downloadId: candidates[0][0], ...candidates[0][1] }
        : null;
}

function takeNativeDownloadToast(downloadId, videoId) {
    const entry = getNativeDownloadEntry(downloadId, videoId);
    if (entry) activeNativeDownloadToasts.delete(entry.downloadId);
    return entry;
}

function sendNativeDownloadCancel(downloadId, videoId, toast) {
    try {
        chrome.runtime.sendMessage({
            action: 'cancel_video_download',
            downloadId,
            videoId
        }, (response) => {
            if (chrome.runtime.lastError || !response || response.status !== 'cancel_requested') {
                toast.setState('error', i18n.t('notifDownloadFailed'));
                toast.showRetry?.();
            }
        });
    } catch (_) {
        toast.setState('error', i18n.t('notifDownloadFailed'));
        toast.showRetry?.();
    }
}

async function readDirectResponseWithProgress(response, toast) {
    const totalBytes = Number(response.headers?.get?.('content-length'));
    if (!response.body?.getReader) {
        const blob = await response.blob();
        toast.update(i18n.t('notifDownloading'), { percent: Number.isFinite(totalBytes) ? 100 : null });
        return blob;
    }

    const reader = response.body.getReader();
    const chunks = [];
    const startedAt = Date.now();
    let receivedBytes = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        chunks.push(value);
        receivedBytes += value.byteLength;
        const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
        const bytesPerSecond = receivedBytes / elapsedSeconds;
        const remainingBytes = Number.isFinite(totalBytes) ? Math.max(totalBytes - receivedBytes, 0) : null;
        toast.update(i18n.t('notifDownloading'), {
            percent: Number.isFinite(totalBytes) && totalBytes > 0 ? (receivedBytes / totalBytes) * 100 : null,
            speed: formatByteRate(bytesPerSecond),
            eta: remainingBytes !== null ? formatDownloadEta(remainingBytes / bytesPerSecond) : '—'
        });
    }

    return new Blob(chunks, {
        type: response.headers?.get?.('content-type') || 'application/octet-stream'
    });
}

async function triggerDownload(fmt, rawFilename, allFormats = []) {
    const videoId = getCurrentVideoId();
    const downloadId = createDownloadId();
    const qualityHeight = _formatHeight(fmt);

    // Prefer H.264 over WebM for muxed streams (wider compatibility)
    let actualFmt = fmt;
    const isMuxedWebm = fmt.type === 'video_audio' && fmt.mime && fmt.mime.includes('webm');
    if (isMuxedWebm && allFormats.length > 0) {
        if (qualityHeight) {
            const h264 = allFormats.find(f =>
                f.type === 'video_audio' && _hasDirectUrl(f) && f.mime && !f.mime.includes('webm') &&
                _formatHeight(f) === qualityHeight
            );
            if (h264) actualFmt = h264;
        }
    }

    const isWebmContainer = actualFmt.mime && actualFmt.mime.includes('webm');
    const containerExt    = isWebmContainer ? '.webm' : '.mp4';

    const safeFilename = (rawFilename || 'video')
        .replace(/[/\\<>:"|?*\x00-\x1f]/g, '_')
        .replace(/\.(mp4|webm|mkv|m4v|3gp)$/i, '')
        .trim()
        .substring(0, 180) + containerExt;

    // Context guard: Prevent 'Extension context invalidated' if script from old version is still running
    if (!chrome.runtime?.id) {
        alert(i18n.t('alertContextInvalidated') || 'Extension updated. Please refresh the page to continue.');
        return;
    }

    // High-quality / adaptive streams → route through native host for proper mux
    const hasDirectUrl = actualFmt.hasDirectUrl !== false && _hasDirectUrl(actualFmt);
    const qualityLabel = String(fmt.quality || 'best');
    if (!hasDirectUrl || fmt.type === 'video' || fmt.type === 'audio' || qualityLabel.includes('Quality') ||
        qualityLabel.includes('Audio') || (qualityHeight !== null && qualityHeight >= 1080)) {

        const toast = showYouTubeNotification(rawFilename, i18n.t('notifPreparing'), videoId, 'preparing', {
            kind: 'download',
            downloadId,
            formatLabel: getDownloadFormatLabel(fmt, fmt.type === 'audio' ? 'mp3' : 'mp4'),
            actionLabel: i18n.t('downloadOpenFolder'),
            onAction: openDownloadFolderFromNotification,
            onCancel: (id, card) => sendNativeDownloadCancel(id, videoId, card),
            onRetry: () => { void triggerDownload(fmt, rawFilename, allFormats); }
        });
        registerNativeDownloadToast(downloadId, videoId, toast);
        safeMsg({
            action: 'download_video_native',
            downloadId, videoId, title: rawFilename, videoQuality: qualityLabel,
            qualityHeight, isAudioOnly: fmt.type === 'audio', isVideoAudio: fmt.type === 'video_audio'
        }).then((response) => {
            if (response && response.status === 'sent_to_native') {
                toast.setState('downloading', i18n.t('notifDownloadingBg'), { percent: 0 });
            } else {
                takeNativeDownloadToast(downloadId, videoId);
                toast.setState('error', i18n.t('alertNativeNotFound'));
                toast.showRetry?.();
            }
        }).catch(() => {
            takeNativeDownloadToast(downloadId, videoId);
            toast.setState('error', i18n.t('alertNativeNotFound'));
            toast.showRetry?.();
        });
        return;
    }

    // Simple muxed stream → fetch blob directly
    if (!hasDirectUrl) {
        alert(i18n.t('alertNativeNotFound') || 'Native host is required for this format.');
        return;
    }
    const url = actualFmt.url;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const toast = showYouTubeNotification(rawFilename, i18n.t('notifPreparing'), videoId, 'preparing', {
        kind: 'download',
        downloadId,
        formatLabel: getDownloadFormatLabel(actualFmt),
        actionLabel: i18n.t('downloadOpenFolder'),
        onAction: openDownloadFolderFromNotification,
        onCancel: () => controller?.abort(),
        onRetry: () => { void triggerDownload(fmt, rawFilename, allFormats); }
    });
    activeDirectDownloads.set(downloadId, { controller, toast });

    try {
        const fetchOptions = { credentials: 'include' };
        if (controller) fetchOptions.signal = controller.signal;
        const response = await fetch(url, fetchOptions);
        if (!response.ok) throw new Error('HTTP ' + response.status);

        toast.setState('downloading', i18n.t('notifDownloading'), { percent: 0 });
        const blob = await readDirectResponseWithProgress(response, toast);
        const blobUrl = URL.createObjectURL(blob);
        const a       = document.createElement('a');
        a.href = blobUrl; a.download = safeFilename; a.style.display = 'none';
        document.body.appendChild(a); a.click();
        setTimeout(() => { a.remove(); URL.revokeObjectURL(blobUrl); }, 5000);

        toast.success(i18n.t('notifDownloadComplete'), { percent: 100 });
    } catch (err) {
        if (controller?.signal.aborted || err?.name === 'AbortError') {
            toast.setState('cancelled', i18n.t('downloadCancelled'));
        } else {
            toast.setState('error', i18n.t('notifDownloadFailed'));
            toast.showRetry?.();
        }
    } finally {
        activeDirectDownloads.delete(downloadId);
    }
}

// Listen for native-host download result broadcast from background.js
chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.action === 'download_video_progress') {
        const entry = getNativeDownloadEntry(msg.downloadId, msg.videoId);
        if (entry && (msg.status === 'progress' || msg.status === 'info')) {
            entry.toast.update(i18n.t('notifDownloadingBg'), {
                percent: msg.percent,
                speed: msg.speed,
                eta: msg.eta
            });
        }
        return;
    }

    if (msg && msg.action === 'download_video_result') {
        const entry = takeNativeDownloadToast(msg.downloadId, msg.videoId);
        if (!entry) return;

        if (msg.status === 'success') {
            entry.toast.success(i18n.t('notifDownloadComplete'), { percent: 100 });
            entry.toast.showAction?.();
        } else if (msg.status === 'cancelled') {
            entry.toast.setState('cancelled', i18n.t('downloadCancelled'));
            entry.toast.showRetry?.();
        } else {
            entry.toast.setState('error', i18n.t('notifDownloadFailed'));
            entry.toast.showRetry?.();
        }
    }
});

// ═════════════════════════════════════════════════════════════════════════════
//  DOWNLOAD MODAL
// ═════════════════════════════════════════════════════════════════════════════

let activeModal             = null;
let activeOutsideClickHandler = null;
let autohideObserver        = null;

function toggleFullscreenOverlay(hide) {
    document.querySelectorAll('.ytp-overlay-bottom-right, .ytp-fullscreen-quick-actions')
        .forEach(o => {
            o.style.opacity      = hide ? '0' : '';
            o.style.pointerEvents = hide ? 'none' : '';
        });
}

function closeModal() {
    if (activeModal) {
        activeModal.remove(); activeModal = null;
        toggleFullscreenOverlay(false);
    }
    if (activeOutsideClickHandler) {
        document.removeEventListener('click', activeOutsideClickHandler, true);
        activeOutsideClickHandler = null;
    }
    if (autohideObserver) { autohideObserver.disconnect(); autohideObserver = null; }
}

function showDownloadModal(anchor, data, isShorts) {
    closeModal();
    const { formats, title } = data;

    if (isShorts) {
        // ── Shorts modal (floating card beside the download button) ──────────
        const modal = document.createElement('div');
        modal.className = 'yt-dl-modal yt-dl-modal--shorts';
        activeModal = modal;

        const header = document.createElement('div');
        header.className = 'yt-dl-header';
        header.textContent = i18n.t('dlModalSelectQuality');
        modal.appendChild(header);

        if (formats.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'yt-dl-empty';
            empty.textContent = i18n.t('dlModalNoStreams');
            modal.appendChild(empty);
        } else {
            formats.forEach(fmt => {
                const opt = document.createElement('button');
                opt.className = 'yt-dl-option';
                opt.type = 'button';
                const sizeLabel  = formatSize(fmt.size);
                const codecBadge = fmt.type === 'audio' ? 'MP3' : (fmt.codec || getMimeLabel(fmt.mime));
                opt.innerHTML =
                    `<span class="yt-dl-quality">${escapeHtml(fmt.quality)}</span>` +
                    `<span class="yt-dl-badges"><span class="yt-dl-badge-mime">${escapeHtml(codecBadge)}</span>` +
                    (sizeLabel ? `<span class="yt-dl-badge-size">${escapeHtml(sizeLabel)}</span>` : '') +
                    `</span><svg class="yt-dl-arrow" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>`;

                opt.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const cleanTitle = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim() || 'video';
                    await triggerDownload(fmt, cleanTitle, formats);
                    closeModal();
                });
                modal.appendChild(opt);
            });
        }
        document.body.appendChild(modal);

        requestAnimationFrame(() => {
            const rect = anchor.getBoundingClientRect();
            const mh   = modal.offsetHeight || 160;
            const vh   = window.innerHeight;
            const left = rect.right + 10;
            let top    = rect.top + rect.height / 2 - mh / 2;
            top = Math.max(8, Math.min(top, vh - mh - 8));
            modal.style.right = 'auto';
            modal.style.left  = left + 'px';
            modal.style.top   = top + 'px';
        });

    } else {
        // ── Regular video modal (YouTube settings-style panel) ───────────────
        const modal = document.createElement('div');
        modal.className = 'ytp-popup ytp-settings-menu yt-dl-video-popup';
        activeModal = modal;

        const panel = document.createElement('div');
        panel.className = 'ytp-panel';
        const menu = document.createElement('div');
        menu.className = 'ytp-panel-menu';
        menu.setAttribute('role', 'menu');

        const headerOption = document.createElement('div');
        headerOption.className = 'ytp-menuitem ytp-panel-header';
        headerOption.innerHTML = `<div class="ytp-menuitem-label" style="font-weight:500;font-size:14px;color:#fff;padding-left:2px;">${i18n.t('dlModalSelectQuality')}</div>`;
        menu.appendChild(headerOption);

        if (formats.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'ytp-menuitem';
            empty.textContent = i18n.t('dlModalNoStreams');
            menu.appendChild(empty);
        } else {
            formats.forEach(fmt => {
                const opt = document.createElement('div');
                opt.className = 'ytp-menuitem';
                opt.setAttribute('role', 'menuitem');
                opt.tabIndex = 0;
                const sizeLabel  = formatSize(fmt.size);
                const codecBadge = fmt.type === 'audio' ? 'MP3' : (fmt.codec || getMimeLabel(fmt.mime));
                opt.innerHTML = `
                    <div class="ytp-menuitem-label">${escapeHtml(fmt.quality)}</div>
                    <div class="ytp-menuitem-content">
                        <span class="yt-dl-badge-mime" style="margin-right:8px;">${escapeHtml(codecBadge)}</span>
                        ${sizeLabel ? `<span class="yt-dl-badge-size" style="margin-right:8px;">${escapeHtml(sizeLabel)}</span>` : ''}
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="white" style="opacity:0.6;vertical-align:middle;"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                    </div>`;
                opt.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const cleanTitle = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim() || 'video';
                    await triggerDownload(fmt, cleanTitle, formats);
                    closeModal();
                });
                menu.appendChild(opt);
            });
        }

        panel.appendChild(menu);
        modal.appendChild(panel);

        let playerContainer = document.querySelector('.html5-video-player') || document.body;
        playerContainer.appendChild(modal);

        if (playerContainer.classList) {
            playerContainer.classList.remove('ytp-autohide');
            autohideObserver = new MutationObserver(() => {
                if (playerContainer.classList.contains('ytp-autohide')) {
                    playerContainer.classList.remove('ytp-autohide');
                }
            });
            autohideObserver.observe(playerContainer, { attributes: true, attributeFilter: ['class'] });
        }

        requestAnimationFrame(() => {
            const mw = 300;
            modal.style.width  = `${mw}px`;
            panel.style.width  = `${mw}px`;
            if (menu.scrollHeight > 0) {
                const maxHeight = Math.min(menu.scrollHeight + 10, window.innerHeight * 0.7);
                modal.style.height = `${maxHeight}px`;
                panel.style.height = `${maxHeight}px`;
                menu.style.height  = `${maxHeight}px`;
            }
            modal.style.right    = '12px';
            const chromeBtm      = document.querySelector('.ytp-chrome-bottom');
            const controlsHeight = chromeBtm ? chromeBtm.offsetHeight : 48;
            modal.style.bottom   = `${controlsHeight + 3}px`;
            modal.style.position = 'absolute';
            toggleFullscreenOverlay(true);
        });
    }

    // Close when clicking outside the modal
    const outsideClick = (e) => {
        if (!activeModal) return;
        if (!activeModal.contains(e.target) && !anchor.contains(e.target)) {
            const controlsItem = e.target.closest('.ytp-chrome-bottom');
            if (!controlsItem) { e.stopPropagation(); e.preventDefault(); }
            closeModal();
        }
    };
    activeOutsideClickHandler = outsideClick;
    setTimeout(() => document.addEventListener('click', outsideClick, true), 10);
}

// ═════════════════════════════════════════════════════════════════════════════
//  SHORTS DOWNLOAD BUTTON
// ═════════════════════════════════════════════════════════════════════════════

function createShortsDownloadButton(container) {
    const btn = document.createElement('button');
    btn.className = 'my-block-button my-dl-btn-shorts';
    btn.dataset.shortsControl = 'download';
    btn.title = i18n.t('dlBtnTitle');
    btn.innerHTML = `
        <div class="my-btn-circle">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="white">
                <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
            </svg>
        </div>
        <span class="my-btn-text">${i18n.t('btnDownload')}</span>`;

    btn.addEventListener('click', async (e) => {
        e.stopPropagation(); e.preventDefault();
        if (activeModal) { closeModal(); return; }

        btn.style.opacity = '0.55';
        btn.querySelector('.my-btn-text').textContent = i18n.t('btnDownloadLoading');

        const data = await fetchVideoFormats();
        btn.style.opacity = '1';
        btn.querySelector('.my-btn-text').textContent = i18n.t('btnDownload');
        showDownloadModal(btn, data, true);
    });

    if (typeof appendShortsControl === 'function') appendShortsControl(container, btn);
    else container.appendChild(btn);
    return btn;
}

// ═════════════════════════════════════════════════════════════════════════════
//  VIDEO PLAYER DOWNLOAD BUTTON
// ═════════════════════════════════════════════════════════════════════════════

const VIDEO_BUTTON_TOOLTIP_ID = 'my-video-dl-tooltip';
const VIDEO_BUTTON_TOOLTIP_DELAY = 300;
let videoButtonTooltip = null;
let videoButtonTooltipTimer = null;
let videoButtonTooltipAnchor = null;

function getVideoButtonTooltip() {
    if (videoButtonTooltip && videoButtonTooltip.parentNode) return videoButtonTooltip;

    const existing = document.getElementById?.(VIDEO_BUTTON_TOOLTIP_ID);
    if (existing) {
        videoButtonTooltip = existing;
        return existing;
    }

    if (!document.body || typeof document.createElement !== 'function') return null;

    const tooltip = document.createElement('div');
    tooltip.id = VIDEO_BUTTON_TOOLTIP_ID;
    tooltip.className = 'my-video-dl-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.setAttribute('aria-hidden', 'true');
    tooltip.hidden = true;
    document.body.appendChild(tooltip);
    videoButtonTooltip = tooltip;
    return tooltip;
}

function positionVideoButtonTooltip(button, tooltip) {
    if (!button?.getBoundingClientRect || !tooltip) return;

    const rect = button.getBoundingClientRect();
    const tooltipHeight = tooltip.offsetHeight || 0;
    const gap = 8;
    let top = rect.top - tooltipHeight - gap;

    // Keep the label visible for controls close to the top of the viewport.
    if (top < 8) top = rect.bottom + gap;

    const viewportWidth = window.innerWidth || document.documentElement?.clientWidth || 1024;
    const left = Math.min(Math.max(rect.left + (rect.width / 2), 8), viewportWidth - 8);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(8, top)}px`;
}

function showVideoButtonTooltip(button) {
    const text = button?.getAttribute?.('data-title') || button?.getAttribute?.('aria-label');
    if (!text) return;

    const tooltip = getVideoButtonTooltip();
    if (!tooltip) return;

    if (videoButtonTooltipAnchor && videoButtonTooltipAnchor !== button) {
        videoButtonTooltipAnchor.removeAttribute?.('aria-describedby');
    }

    tooltip.textContent = text;
    tooltip.hidden = false;
    tooltip.setAttribute('aria-hidden', 'false');
    positionVideoButtonTooltip(button, tooltip);
    tooltip.classList.add('is-visible');
    button.setAttribute('aria-describedby', VIDEO_BUTTON_TOOLTIP_ID);
    videoButtonTooltipAnchor = button;
}

function hideVideoButtonTooltip(button = null) {
    if (videoButtonTooltipTimer) {
        clearTimeout(videoButtonTooltipTimer);
        videoButtonTooltipTimer = null;
    }

    if (videoButtonTooltip) {
        videoButtonTooltip.classList.remove('is-visible');
        videoButtonTooltip.hidden = true;
        videoButtonTooltip.setAttribute('aria-hidden', 'true');
    }

    const anchor = button || videoButtonTooltipAnchor;
    anchor?.removeAttribute?.('aria-describedby');
    if (!button || videoButtonTooltipAnchor === button) videoButtonTooltipAnchor = null;
}

function scheduleVideoButtonTooltip(button) {
    if (videoButtonTooltipTimer) clearTimeout(videoButtonTooltipTimer);
    videoButtonTooltipTimer = setTimeout(() => {
        videoButtonTooltipTimer = null;
        showVideoButtonTooltip(button);
    }, VIDEO_BUTTON_TOOLTIP_DELAY);
}

function bindVideoButtonTooltip(button) {
    button.addEventListener('mouseenter', () => scheduleVideoButtonTooltip(button));
    button.addEventListener('focus', () => scheduleVideoButtonTooltip(button));
    button.addEventListener('mouseleave', () => hideVideoButtonTooltip(button));
    button.addEventListener('blur', () => hideVideoButtonTooltip(button));
}

function addVideoDownloadButton() {
    if (isShortPage()) return;
    const controlsLeft = document.querySelector('.ytp-right-controls-left');
    if (!controlsLeft) return;
    if (controlsLeft.querySelector('.my-video-dl-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'ytp-button my-video-dl-btn';
    btn.setAttribute('data-title', i18n.t('dlBtnTitle'));
    btn.setAttribute('data-tooltip-text', i18n.t('dlBtnTitle'));
    btn.setAttribute('aria-label', i18n.t('dlBtnAriaLabel'));
    btn.innerHTML = `<svg height="24" viewBox="0 0 24 24" width="24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" fill="white"/></svg>`;
    bindVideoButtonTooltip(btn);

    btn.addEventListener('click', async (e) => {
        e.stopPropagation(); e.preventDefault();
        hideVideoButtonTooltip(btn);
        if (activeModal) { closeModal(); return; }

        const settingsBtn = document.querySelector('.ytp-settings-button');
        if (settingsBtn && settingsBtn.getAttribute('aria-expanded') === 'true') settingsBtn.click();

        btn.classList.add('my-video-dl-btn--loading');
        const data = await fetchVideoFormats();
        btn.classList.remove('my-video-dl-btn--loading');
        showDownloadModal(btn, data, false);
    });

    const settingsBtn = controlsLeft.querySelector('.ytp-settings-button');
    if (settingsBtn) {
        settingsBtn.parentNode.insertBefore(btn, settingsBtn);
    } else {
        controlsLeft.appendChild(btn);
    }
}

let videoPlayerInterval = null;
let videoPlayerObserver = null;
const VIDEO_PLAYER_POLL_INTERVAL = 100;
const VIDEO_PLAYER_MAX_ATTEMPTS = 100;

function stopVideoPlayerWatchers() {
    if (videoPlayerInterval) {
        clearInterval(videoPlayerInterval);
        videoPlayerInterval = null;
    }
    if (videoPlayerObserver) {
        videoPlayerObserver.disconnect();
        videoPlayerObserver = null;
    }
}

function attachVideoDownloadButtonIfReady() {
    const controlsLeft = document.querySelector('.ytp-right-controls-left');
    if (!controlsLeft) return false;

    const existing = controlsLeft.querySelector('.my-video-dl-btn');
    if (existing) {
        existing.style.display = '';
        return true;
    }

    addVideoDownloadButton();
    return Boolean(controlsLeft.querySelector('.my-video-dl-btn'));
}

function mutationContainsVideoControls(mutations) {
    const selector = '.ytp-right-controls-left, .ytp-settings-button, #movie_player, .html5-video-player';
    return mutations.some(mutation => {
        if (mutation.type !== 'childList') return false;
        return [...mutation.addedNodes].some(node => {
            if (!node || node.nodeType !== 1) return false;
            return Boolean(node.matches?.(selector) || node.querySelector?.(selector));
        });
    });
}

function watchForVideoControls() {
    if (videoPlayerObserver || !document.body || typeof MutationObserver !== 'function') return;

    videoPlayerObserver = new MutationObserver((mutations) => {
        if (mutationContainsVideoControls(mutations) && attachVideoDownloadButtonIfReady()) {
            stopVideoPlayerWatchers();
        }
    });
    videoPlayerObserver.observe(document.body, { childList: true, subtree: true });
}

/**
 * Periodically checks for the YouTube player controls and injects the download button.
 * Uses a limited number of attempts to avoid infinite loops.
 */
function initVideoDownloadButton() {
    // Keep one watcher alive while YouTube is constructing the player. Repeated
    // mutation events must not restart the retry window and delay attachment.
    if (!EXTENSION_ENABLED || !DOWNLOADER_ENABLED || isShortPage()) {
        hideVideoButtonTooltip();
        stopVideoPlayerWatchers();
        const existing = document.querySelector('.my-video-dl-btn');
        if (existing) existing.style.display = 'none';
        return;
    }

    if (videoPlayerInterval || videoPlayerObserver) {
        attachVideoDownloadButtonIfReady();
        return;
    }

    // Try synchronously first, then use a fast retry while the player is built.
    if (attachVideoDownloadButtonIfReady()) return;
    watchForVideoControls();

    let attempts = 0;
    videoPlayerInterval = setInterval(() => {
        attempts++;
        if (attachVideoDownloadButtonIfReady()) {
            stopVideoPlayerWatchers();
        } else if (attempts >= VIDEO_PLAYER_MAX_ATTEMPTS) {
            clearInterval(videoPlayerInterval);
            videoPlayerInterval = null;
        }
    }, VIDEO_PLAYER_POLL_INTERVAL);
}

// ─────────────────────────────────────────────────────────────────────────────
//  NAVIGATION & CLEANUP: Close modal on scroll or navigation
// ─────────────────────────────────────────────────────────────────────────────

window.addEventListener('yt-navigate-finish', () => {
    hideVideoButtonTooltip();
    if (activeModal) closeModal();
    initVideoDownloadButton();
});

window.addEventListener('popstate', () => {
    hideVideoButtonTooltip();
    if (activeModal) closeModal();
    initVideoDownloadButton();
});
