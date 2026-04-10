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
    if (m) return m[1];
    return new URLSearchParams(window.location.search).get('v');
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

function parseStreamingData(data) {
    if (!data || !data.streamingData) return [];

    const formats = (data.streamingData.formats || []).filter(f => f.url).map(f => ({
        url: f.url,
        quality: f.qualityLabel || f.quality || '?',
        mime: f.mimeType || 'video/mp4',
        itag: f.itag || 0,
        size: f.contentLength || null,
        type: 'video_audio'
    }));

    const adaptive = (data.streamingData.adaptiveFormats || []).filter(f => f.url).map(f => {
        const isAudio = f.mimeType && f.mimeType.includes('audio');
        let q    = f.qualityLabel || f.quality || (isAudio ? 'Audio' : '?');
        let type = isAudio ? 'audio' : 'video';
        if (type === 'video') q += ' (High Quality)';
        if (type === 'audio') {
            const aqMap = { 'AUDIO_QUALITY_HIGH': 'High', 'AUDIO_QUALITY_MEDIUM': 'Medium', 'AUDIO_QUALITY_LOW': 'Low' };
            const aqLabel = (f.audioQuality && aqMap[f.audioQuality]) ? aqMap[f.audioQuality] : null;
            q = 'Audio Only' + (aqLabel ? ` (${aqLabel})` : '');
        }
        return {
            url: f.url,
            quality: q,
            mime: f.mimeType || (isAudio ? 'audio/mp4' : 'video/mp4'),
            itag: f.itag || 0,
            size: f.contentLength || null,
            type
        };
    });

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

function _deduplicateAndSort(allFormats, title) {
    const uniqueFormatsMap = new Map();

    for (const f of allFormats) {
        const heightMatch = f.quality.match(/(\d+)p/);
        const height = heightMatch ? heightMatch[1] : f.quality;
        const key = height + '|' + f.type;

        if (uniqueFormatsMap.has(key)) {
            const existing = uniqueFormatsMap.get(key);
            const existingCodec  = _getCodecPriority(existing.mime);
            const newCodec       = _getCodecPriority(f.mime);
            const existingSource = SOURCE_PRIORITY[existing.source] || 0;
            const newSource      = SOURCE_PRIORITY[f.source] || 0;
            if (newCodec > existingCodec || (newCodec === existingCodec && newSource > existingSource)) {
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
            .map(f => { const m = f.quality.match(/(\d+)p/); return m ? m[1] : null; })
            .filter(Boolean)
    );
    finalList = finalList.filter(f => {
        if (f.type !== 'video') return true;
        const m = f.quality.match(/(\d+)p/);
        if (!m) return true;
        return !muxedHeights.has(m[1]);
    });

    finalList = finalList.map(f => ({
        ...f, codec: getCodecLabel(f.mime),
        size: f.type === 'video_audio' ? f.size : null
    }));

    finalList.sort((a, b) => {
        const typeOrder = { 'video_audio': 0, 'video': 1, 'audio': 2 };
        if (typeOrder[a.type] !== typeOrder[b.type]) return typeOrder[a.type] - typeOrder[b.type];

        let cleanA = a.quality.replace(' (High Quality)', '').replace(/Audio Only.*/, 'Audio Only').trim();
        let cleanB = b.quality.replace(' (High Quality)', '').replace(/Audio Only.*/, 'Audio Only').trim();

        const matchA = cleanA.match(/^(\d+px?|Audio Only)/);
        const matchB = cleanB.match(/^(\d+px?|Audio Only)/);

        if (matchA && matchB) {
            const baseA  = matchA[1]; const baseB = matchB[1];
            const orderA = QUALITY_ORDER[cleanA] !== undefined ? QUALITY_ORDER[cleanA] : (QUALITY_ORDER[baseA] ?? 99);
            const orderB = QUALITY_ORDER[cleanB] !== undefined ? QUALITY_ORDER[cleanB] : (QUALITY_ORDER[baseB] ?? 99);
            if (orderA !== orderB) return orderA - orderB;
        }
        return (QUALITY_ORDER[cleanA] ?? 99) - (QUALITY_ORDER[cleanB] ?? 99);
    });

    return { formats: finalList, title };
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
                    const formats = await Promise.all(
                        parsed.map(async f => ({ ...f, url: await descrambleUrl(f.url), source: 'WEB' }))
                    );
                    return { formats, title };
                }
            } catch (_) { }
        }
        return { formats: [], title };
    })();

    const webMuxed = webResult.formats.filter(f => f.type === 'video_audio');
    if (webMuxed.length > 0) {
        if (!titleVerified && webResult.title) title = webResult.title;
        return _deduplicateAndSort(webResult.formats, title);
    }

    // Fall back to API clients in priority order
    const clients = [
        { fetcher: fetchViaIOS,            name: 'IOS'     },
        { fetcher: fetchViaAndroid,        name: 'ANDROID' },
        { fetcher: fetchViaEmbeddedPlayer, name: 'TVHTML5' },
    ];

    let allFormats = [...webResult.formats];
    if (webResult.title && title === 'video') title = webResult.title;

    for (const { fetcher, name } of clients) {
        try {
            const result  = await fetcher(videoId);
            const formats = (result.formats || []).map(f => ({ ...f, source: name }));
            if (result.title && !titleVerified) { title = result.title; titleVerified = true; }
            allFormats.push(...formats);
            if (formats.some(f => f.type === 'video_audio')) break;
        } catch (_) { }
    }

    if (allFormats.length === 0) return { formats: [], title };
    return _deduplicateAndSort(allFormats, title);
}

// ═════════════════════════════════════════════════════════════════════════════
//  TRIGGER DOWNLOAD
// ═════════════════════════════════════════════════════════════════════════════

async function triggerDownload(fmt, rawFilename, allFormats = []) {
    const videoId = getCurrentVideoId();

    // Prefer H.264 over WebM for muxed streams (wider compatibility)
    let actualFmt = fmt;
    const isMuxedWebm = fmt.type === 'video_audio' && fmt.mime && fmt.mime.includes('webm');
    if (isMuxedWebm && allFormats.length > 0) {
        const heightMatch = fmt.quality.match(/(\d+)p/);
        if (heightMatch) {
            const h    = heightMatch[1];
            const h264 = allFormats.find(f =>
                f.type === 'video_audio' && f.url && f.mime && !f.mime.includes('webm') &&
                f.quality.startsWith(h + 'p')
            );
            if (h264) actualFmt = h264;
        }
    }

    const isWebmContainer = actualFmt.mime && actualFmt.mime.includes('webm');
    const containerExt    = isWebmContainer ? '.webm' : '.mp4';

    const safeFilename = rawFilename
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
    if (fmt.type === 'video' || fmt.type === 'audio' || fmt.quality.includes('Quality') ||
        fmt.quality.includes('Audio') || parseInt(fmt.quality) >= 1080 ||
        fmt.quality.includes('1080p') || fmt.quality.includes('1440p')) {

        const toast = showYouTubeNotification(rawFilename, i18n.t('notifPreparing'), videoId, 'preparing');
        const heightMatch = fmt.quality.match(/(\d+)p/);
        const qualityHeight = heightMatch ? parseInt(heightMatch[1]) : null;

        safeMsg({
            action: 'download_video_native',
            videoId, title: rawFilename, videoQuality: fmt.quality,
            qualityHeight, isAudioOnly: fmt.type === 'audio', isVideoAudio: fmt.type === 'video_audio'
        }).then((response) => {
            if (response && response.status === 'sent_to_native') {
                toast.success(i18n.t('notifDownloadingBg'));
            } else {
                toast.remove();
                alert(i18n.t('alertNativeNotFound'));
            }
        });
        return;
    }

    // Simple muxed stream → fetch blob directly
    const url   = actualFmt.url;
    const toast = showYouTubeNotification(rawFilename, i18n.t('notifDownloading'), videoId, 'preparing');

    try {
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) throw new Error('HTTP ' + response.status);

        const blob    = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a       = document.createElement('a');
        a.href = blobUrl; a.download = safeFilename; a.style.display = 'none';
        document.body.appendChild(a); a.click();
        setTimeout(() => { a.remove(); URL.revokeObjectURL(blobUrl); }, 5000);

        toast.success(i18n.t('notifDownloadComplete'));
    } catch (err) {
        toast.remove();
        if (confirm(i18n.t('confirmOpenInTab').replace('%s', err.message))) {
            window.open(url, '_blank');
        }
    }
}

// Listen for native-host download result broadcast from background.js
chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.action === 'download_video_result') {
        if (msg.status === 'success') {
            showYouTubeNotification(msg.title, i18n.t('notifDownloadComplete'), msg.videoId, 'success');
        } else {
            showYouTubeNotification(msg.title, i18n.t('notifDownloadFailed'),  msg.videoId, 'error');
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
            const vid = getCurrentVideoId();
            empty.innerHTML = i18n.t('dlModalNoStreams') +
                (vid ? `<a class="yt-dl-fallback-link" href="https://y2mate.com/youtube/${vid}" target="_blank" rel="noopener">${i18n.t('dlModalWebService')}</a>` : '');
            modal.appendChild(empty);
        } else {
            formats.forEach(fmt => {
                const opt = document.createElement('button');
                opt.className = 'yt-dl-option';
                opt.type = 'button';
                const sizeLabel  = formatSize(fmt.size);
                const codecBadge = fmt.type === 'audio' ? 'MP3' : (fmt.codec || getMimeLabel(fmt.mime));
                opt.innerHTML =
                    `<span class="yt-dl-quality">${fmt.quality}</span>` +
                    `<span class="yt-dl-badges"><span class="yt-dl-badge-mime">${codecBadge}</span>` +
                    (sizeLabel ? `<span class="yt-dl-badge-size">${sizeLabel}</span>` : '') +
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
            const vid = getCurrentVideoId();
            empty.innerHTML = `<div class="ytp-menuitem-label" style="white-space:normal;line-height:1.5;">
                ${i18n.t('dlModalNoStreams')}
                ${vid ? `<a href="https://y2mate.com/youtube/${vid}" target="_blank" style="color:#3ea6ff;display:block;margin-top:4px;">${i18n.t('dlModalWebService')}</a>` : ''}
            </div>`;
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
                    <div class="ytp-menuitem-label">${fmt.quality}</div>
                    <div class="ytp-menuitem-content">
                        <span class="yt-dl-badge-mime" style="margin-right:8px;">${codecBadge}</span>
                        ${sizeLabel ? `<span class="yt-dl-badge-size" style="margin-right:8px;">${sizeLabel}</span>` : ''}
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

    container.appendChild(btn);
    return btn;
}

// ═════════════════════════════════════════════════════════════════════════════
//  VIDEO PLAYER DOWNLOAD BUTTON
// ═════════════════════════════════════════════════════════════════════════════

function addVideoDownloadButton() {
    if (isShortPage()) return;
    const controlsLeft = document.querySelector('.ytp-right-controls-left');
    if (!controlsLeft) return;
    if (controlsLeft.querySelector('.my-video-dl-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'ytp-button my-video-dl-btn';
    btn.setAttribute('data-title', i18n.t('dlBtnTitle'));
    btn.setAttribute('aria-label', i18n.t('dlBtnAriaLabel'));
    btn.innerHTML = `<svg height="24" viewBox="0 0 24 24" width="24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" fill="white"/></svg>`;

    btn.addEventListener('click', async (e) => {
        e.stopPropagation(); e.preventDefault();
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

/**
 * Periodically checks for the YouTube player controls and injects the download button.
 * Uses a limited number of attempts to avoid infinite loops.
 */
function initVideoDownloadButton() {
    // 1. Cleanup if already running or if disabled
    if (videoPlayerInterval) clearInterval(videoPlayerInterval);
    
    if (!EXTENSION_ENABLED || !DOWNLOADER_ENABLED || isShortPage()) {
        const existing = document.querySelector('.my-video-dl-btn');
        if (existing) existing.style.display = 'none';
        return;
    }

    // 2. Immediate check
    const controlsLeft = document.querySelector('.ytp-right-controls-left');
    if (controlsLeft && controlsLeft.querySelector('.my-video-dl-btn')) {
        controlsLeft.querySelector('.my-video-dl-btn').style.display = '';
        return;
    }

    // 3. Polling check (YouTube player controls are injected dynamically)
    let attempts = 0;
    videoPlayerInterval = setInterval(() => {
        attempts++;
        if (attempts > 20) { 
            clearInterval(videoPlayerInterval); 
            videoPlayerInterval = null;
            return; 
        }

        const controls = document.querySelector('.ytp-right-controls-left');
        if (controls) {
            if (!controls.querySelector('.my-video-dl-btn')) {
                addVideoDownloadButton();
            } else {
                controls.querySelector('.my-video-dl-btn').style.display = '';
            }
            clearInterval(videoPlayerInterval);
            videoPlayerInterval = null;
        }
    }, 500);
}

// ─────────────────────────────────────────────────────────────────────────────
//  NAVIGATION & CLEANUP: Close modal on scroll or navigation
// ─────────────────────────────────────────────────────────────────────────────

window.addEventListener('yt-navigate-finish', () => {
    if (activeModal) closeModal();
});

window.addEventListener('popstate', () => {
    if (activeModal) closeModal();
});
