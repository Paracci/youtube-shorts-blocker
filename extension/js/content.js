// ─────────────────────────────────────────────────────────────────────────────
// YouTube Shorts Channel Blocker + Video Downloader – content.js  v1.3
// ─────────────────────────────────────────────────────────────────────────────

// ─── Extension context guard ──────────────────────────────────────────────────
// After an extension reload the old content script loses its context.
// Wrap every chrome.* call so errors are caught gracefully.
function safeMsg(msg) {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage(msg, (res) => {
                if (chrome.runtime.lastError) { resolve(null); }
                else { resolve(res); }
            });
        } catch (_) { resolve(null); }
    });
}

function safeStorageGet(keys, callback) {
    try {
        if (!chrome?.storage?.local) { callback({}); return; }
        chrome.storage.local.get(keys, (res) => {
            if (chrome.runtime?.lastError) { callback({}); return; }
            callback(res || {});
        });
    } catch (_) { callback({}); }
}

function safeStorageSet(data) {
    try {
        if (!chrome?.storage?.local) return;
        chrome.storage.local.set(data);
    } catch (_) { /* extension context invalidated */ }
}

// ─── Settings State ──────────────────────────────────────────────────────────
let EXTENSION_ENABLED = true;
let HIDE_SHORTS_HOMEPAGE = true;
let BLOCKING_ENABLED = true;   // popup "Block channels automatically"
let DOWNLOADER_ENABLED = true;   // popup "Show download button"

// Initialise i18n engine (translations.js is loaded before this file)
i18n.init();

safeStorageGet(
    ['extensionEnabled', 'hideHomepageShorts', 'blockingEnabled', 'downloaderEnabled'],
    (res) => {
        if (res.extensionEnabled !== undefined) EXTENSION_ENABLED = res.extensionEnabled;
        if (res.hideHomepageShorts !== undefined) HIDE_SHORTS_HOMEPAGE = res.hideHomepageShorts;
        if (res.blockingEnabled !== undefined) BLOCKING_ENABLED = res.blockingEnabled;
        if (res.downloaderEnabled !== undefined) DOWNLOADER_ENABLED = res.downloaderEnabled;
        applyHomepageVisibility();
    }
);

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'toggle_extension') {
        EXTENSION_ENABLED = msg.enabled;
        if (!msg.enabled) {
            // Hide all injected buttons immediately
            document.querySelectorAll('.my-block-button, .my-video-dl-btn').forEach(b => {
                b.style.display = 'none';
            });
        } else {
            // Restore visible buttons
            if (BLOCKING_ENABLED) {
                document.querySelectorAll('.my-block-button').forEach(b => {
                    b.style.display = '';
                });
            }
            if (DOWNLOADER_ENABLED) {
                document.querySelectorAll('.my-dl-btn-shorts, .my-video-dl-btn').forEach(b => {
                    b.style.display = '';
                });
            }
        }
    }

    if (msg.action === 'toggle_hide_shorts') {
        HIDE_SHORTS_HOMEPAGE = msg.enabled;
        applyHomepageVisibility();
    }

    if (msg.action === 'toggle_blocking') {
        BLOCKING_ENABLED = msg.enabled;
        document.querySelectorAll('.my-block-button').forEach(b => {
            // dl-btn-shorts shares the class — skip download-only buttons
            if (!b.classList.contains('my-dl-btn-shorts')) {
                b.style.display = msg.enabled && EXTENSION_ENABLED ? '' : 'none';
            }
        });
    }

    if (msg.action === 'toggle_downloader') {
        DOWNLOADER_ENABLED = msg.enabled;
        // Toggle Shorts download buttons
        document.querySelectorAll('.my-dl-btn-shorts').forEach(b => {
            b.style.display = msg.enabled && EXTENSION_ENABLED ? '' : 'none';
        });
        // Toggle video player download button
        const videoDlBtn = document.querySelector('.my-video-dl-btn');
        if (videoDlBtn) {
            videoDlBtn.style.display = msg.enabled && EXTENSION_ENABLED ? '' : 'none';
        }
        // If re-enabled, trigger injection in case buttons were never created
        if (msg.enabled && EXTENSION_ENABLED) {
            runOptimizationCheck();
            initVideoDownloadButton();
        }
    }
});

function applyHomepageVisibility() {
    if (window.location.pathname === '/' || window.location.pathname === '') {
        if (HIDE_SHORTS_HOMEPAGE) {
            document.body.classList.add('my-hide-shorts-home');
            // Count and persist how many Shorts shelf items are being hidden
            const hiddenCount = document.querySelectorAll(
                'ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]), ' +
                'ytd-rich-section-renderer:has(a[href^="/shorts/"])'
            ).length;
            if (hiddenCount > 0) {
                safeStorageGet('hiddenCount', (res) => {
                    safeStorageSet({ hiddenCount: (res.hiddenCount || 0) + hiddenCount });
                });
            }
        } else {
            document.body.classList.remove('my-hide-shorts-home');
        }
    }
}

// Re-apply on SPA navigation
const homeNavObserver = new MutationObserver(() => applyHomepageVisibility());
homeNavObserver.observe(document.body, { childList: true, subtree: true });

// ─── Debounce / MutationObserver ─────────────────────────────────────────────
let debounceTimer = null;
const observer = new MutationObserver(() => {
    if (!EXTENSION_ENABLED) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runOptimizationCheck, 100);
});
observer.observe(document.body, { childList: true, subtree: true });

// ─── Intersection Observer ────────────────────────────────────────────────────
const scrollObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const renderer = entry.target;
        if (checkForAdAndSkip(renderer)) return;
        forceHighestQuality();
        const btn = renderer.querySelector('.my-block-button');
        if (btn) checkAndResetButton(btn, renderer);
    });
}, { threshold: 0.5 });

// ─── Force quality ────────────────────────────────────────────────────────────
function forceHighestQuality() {
    const player = document.getElementById('movie_player') ||
        document.querySelector('.html5-video-player');
    if (player && typeof player.setPlaybackQualityRange === 'function') {
        player.setPlaybackQualityRange('hd2160');
    }
}

// ─── Ad skip ──────────────────────────────────────────────────────────────────
function checkForAdAndSkip(renderer) {
    const isAd = renderer.querySelector('ytd-ad-slot-renderer') ||
        renderer.tagName.toLowerCase().includes('ad-slot');
    if (isAd) {
        const video = renderer.querySelector('video');
        if (video) { video.muted = true; video.currentTime = video.duration || 1000; }
        renderer.style.display = 'none';
        return true;
    }
    return false;
}

// ─── Video fingerprint ────────────────────────────────────────────────────────
function getVideoFingerprint(renderer) {
    const link = renderer.querySelector('a[href^="/shorts/"]');
    if (link) return link.getAttribute('href');
    const ch = renderer.querySelector('ytd-channel-name');
    const ti = renderer.querySelector('h2.title');
    if (ch && ti) return ch.textContent + ti.textContent;
    const vid = renderer.querySelector('video');
    if (vid && vid.src) return vid.src;
    return null;
}

// ─── Shorts loop ──────────────────────────────────────────────────────────────
function runOptimizationCheck() {
    document.querySelectorAll('ytd-reel-video-renderer').forEach(renderer => {
        if (checkForAdAndSkip(renderer)) return;
        const bar = renderer.querySelector('#button-bar');
        if (!bar) return;

        // Block button
        let btn = bar.querySelector('.my-block-button:not(.my-dl-btn-shorts)');
        if (!btn && BLOCKING_ENABLED && EXTENSION_ENABLED) {
            btn = createBlockButton(bar, renderer);
            scrollObserver.observe(renderer);
        }
        if (btn) {
            btn.style.display = BLOCKING_ENABLED && EXTENSION_ENABLED ? '' : 'none';
            checkAndResetButton(btn, renderer);
        }

        // Download button
        if (!bar.querySelector('.my-dl-btn-shorts') && DOWNLOADER_ENABLED && EXTENSION_ENABLED) {
            createShortsDownloadButton(bar);
        }
        const dlBtn = bar.querySelector('.my-dl-btn-shorts');
        if (dlBtn) dlBtn.style.display = DOWNLOADER_ENABLED && EXTENSION_ENABLED ? '' : 'none';
    });
}

function checkAndResetButton(btn, ctx) {
    const fp = getVideoFingerprint(ctx);
    if (!fp) return;
    if (fp !== btn.dataset.videoFingerprint) {
        resetButtonToDefault(btn);
        btn.dataset.videoFingerprint = fp;
    }
}

function resetButtonToDefault(btn) {
    btn.classList.remove('blocked-state');
    btn.style.opacity = '1';
    btn.style.pointerEvents = 'auto';
    const t = btn.querySelector('.my-btn-text');
    if (t) t.textContent = i18n.t('btnBlock');
    const s = btn.querySelector('svg');
    if (s) s.style.fill = 'white';
}

// ─── Channel name + ID extractors ────────────────────────────────────────────
function extractChannelName(videoContext) {
    const SELECTORS = [
        'ytd-reel-player-header-renderer ytd-channel-name yt-formatted-string',
        'ytd-reel-player-header-renderer #channel-name yt-formatted-string',
        'ytd-reel-player-header-renderer #channel-name',
        'ytd-channel-name yt-formatted-string',
        '#channel-name yt-formatted-string',
        '#channel-name',
        'ytd-channel-name',
        'yt-dynamic-text-view-model',
    ];
    const contexts = [videoContext];
    const active = document.querySelector('ytd-reel-video-renderer[is-active]');
    if (active && active !== videoContext) contexts.push(active);

    for (const ctx of contexts) {
        for (const sel of SELECTORS) {
            const el = ctx.querySelector(sel);
            const txt = el && el.textContent.trim();
            if (txt) return txt;
        }
    }
    return null;
}

// Extract a stable channel identifier.
// Prefers /channel/UCxxxxxx; falls back to @handle.
function extractChannelId(videoContext) {
    const contexts = [videoContext];
    const active = document.querySelector('ytd-reel-video-renderer[is-active]');
    if (active && active !== videoContext) contexts.push(active);

    for (const ctx of contexts) {
        const idLink = ctx.querySelector('a[href*="/channel/"]');
        if (idLink) {
            const m = idLink.getAttribute('href').match(/\/channel\/(UC[^/?#]+)/);
            if (m) return m[1];
        }
        const handleLink = ctx.querySelector('a[href*="/@"]');
        if (handleLink) {
            const m = handleLink.getAttribute('href').match(/\/@([^/?#]+)/);
            if (m) return '@' + m[1];
        }
    }
    return null;
}

// ─── Block button ─────────────────────────────────────────────────────────────
function createBlockButton(container, videoContext) {
    const btn = document.createElement('button');
    btn.className = 'my-block-button';
    btn.title = i18n.t('btnDontRecommend');
    btn.innerHTML = `
        <div class="my-btn-circle">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="white">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8 0-1.85.63-3.55 1.69-4.9L16.9 18.31C15.55 19.37 13.85 20 12 20zm6.31-3.1L7.1 5.69C8.45 4.63 10.15 4 12 4c4.41 0 8 3.59 8 8 0 1.85-.63 3.55-1.69 4.9z"></path>
            </svg>
        </div>
        <span class="my-btn-text">${i18n.t('btnBlock')}</span>`;

    btn.addEventListener('click', async (e) => {
        e.stopPropagation(); e.preventDefault();
        btn.style.opacity = '0.5';
        btn.querySelector('.my-btn-text').textContent = i18n.t('btnBlocking');

        const channelName = extractChannelName(videoContext);
        const channelId = extractChannelId(videoContext);

        const menuBtn = videoContext.querySelector('ytd-menu-renderer button') ||
            Array.from(videoContext.querySelectorAll('button')).find(b => {
                const l = b.getAttribute('aria-label');
                return l && (l.includes('More actions') || l.includes('Diğer') || l.includes('işlemler'));
            });

        if (!menuBtn) { resetButtonToDefault(btn); return; }

        // Hide the menu popup while we click through it
        const hideStyle = document.createElement('style');
        hideStyle.textContent = `
            ytd-menu-popup-renderer, tp-yt-paper-dialog, ytd-popup-container > * {
                visibility: hidden !important; pointer-events: none !important;
            }`;
        document.head.appendChild(hideStyle);
        menuBtn.click();
        await new Promise(r => setTimeout(r, 80));

        let found = false;
        for (const item of document.querySelectorAll('ytd-menu-service-item-renderer')) {
            const txt = item.textContent;
            if (txt.includes('Bu kanalı önerme') || txt.includes('Kanalı önerme') ||
                txt.includes("Don't recommend channel") || txt.includes('recommend this channel')) {
                item.click();
                found = true;
                break;
            }
        }
        hideStyle.remove();

        if (found) {
            btn.querySelector('.my-btn-text').textContent = i18n.t('btnBlocked');
            btn.querySelector('svg').style.fill = '#ff4444';
            btn.style.opacity = '1';
            btn.style.pointerEvents = 'none';
            btn.classList.add('blocked-state');

            // ── Persistent blocklist + dedup stats ────────────────────────
            // Read current blocklist (array of {id, name, blockedAt} objects)
            safeStorageGet(['blockedChannels', 'blockedCount'], (res) => {
                const list = res.blockedChannels || [];
                const alreadyInList = channelId
                    ? list.some(c => c.id === channelId)
                    : false;

                // Add to permanent list if we have an ID and it's not there yet
                if (channelId && !alreadyInList) {
                    list.push({
                        id: channelId,
                        name: channelName || channelId,
                        blockedAt: Date.now()
                    });
                }

                // Only increment the counter for truly new channels
                const newCount = alreadyInList
                    ? (res.blockedCount || 0)          // already counted — don't double
                    : (res.blockedCount || 0) + 1;

                safeStorageSet({ blockedChannels: list, blockedCount: newCount });
            });

            const label = channelName ? `"${channelName}"` : 'Channel';
            showYouTubeNotification(
                `${label} ${i18n.t('notifWillNotRecommend')}`,
                i18n.t('notifChannelBlocked'),
                null,
                'success'
            );
        } else {
            document.body.click();
            resetButtonToDefault(btn);
        }
    });

    container.appendChild(btn);
    return btn;
}

// ═════════════════════════════════════════════════════════════════════════════
//  DOWNLOAD FEATURE
// ═════════════════════════════════════════════════════════════════════════════

function isShortPage() {
    return window.location.pathname.startsWith('/shorts/');
}

function getCurrentVideoId() {
    const m = window.location.pathname.match(/\/shorts\/([^/?#]+)/);
    if (m) return m[1];
    return new URLSearchParams(window.location.search).get('v');
}

// ── Parse streaming data ─────────────────────────────────────────────────────
const QUALITY_ORDER = {
    '2160p60': 0, '2160p': 1, '1440p60': 2, '1440p': 3, '1080p60': 4, '1080p': 5,
    '720p60': 6, '720p': 7, '480p': 8, '360p': 9, '240p': 10, '144p': 11
};

function parseStreamingData(data) {
    if (!data || !data.streamingData) return [];

    // Regular multiplexed formats (Video + Audio)
    let formats = (data.streamingData.formats || []).filter(f => f.url).map(f => ({
        url: f.url,
        quality: f.qualityLabel || f.quality || '?',
        mime: f.mimeType || 'video/mp4',
        itag: f.itag || 0,
        size: f.contentLength || null,
        type: 'video_audio'
    }));

    // Adaptive formats (Video-only or Audio-only)
    const adaptive = (data.streamingData.adaptiveFormats || []).filter(f => f.url).map(f => {
        const isAudio = f.mimeType && f.mimeType.includes('audio');
        let q = f.qualityLabel || f.quality || (isAudio ? 'Audio' : '?');

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
            type: type
        };
    });

    return [...formats, ...adaptive];
}

// ── n-parameter descrambling ──────────────────────────────────────────────────
// YouTube embeds an obfuscated function in the player JS that transforms the
// `n` query param. Without this, direct fetch of WEB-client URLs returns 403.
let _nDescrambler = null;

async function getNDescrambler() {
    if (_nDescrambler) return _nDescrambler;
    try {
        // Find player JS URL from inline script
        let playerUrl = null;
        for (const s of document.querySelectorAll('script:not([src])')) {
            const m = s.textContent.match(/"jsUrl"\s*:\s*"([^"]+\.js)"/);
            if (m) { playerUrl = m[1]; break; }
        }
        if (!playerUrl) return null;

        const res = await fetch(playerUrl);
        const code = await res.text();

        // Regex derived from yt-dlp / elephant-main to find n-descrambling array func
        // New players structure the extraction in various ways; we test a few known patterns
        const patterns = [
            /\.get\("n"\)\)&&\(b=([a-zA-Z0-9$]{2,4})\[(\d+)\]\(b\)/,
            /([a-zA-Z0-9$]+)\[(\d+)\]\s*\(b\)/ // fallback loose pattern
        ];

        let arrName = null, arrIndex = null;

        for (const p of patterns) {
            const m = code.match(p);
            if (m) {
                arrName = m[1];
                arrIndex = m[2];
                // Check if the match is realistic before breaking
                if (code.includes(`var ${arrName.replace('$', '\\$')} = [`)) {
                    break;
                }
            }
        }

        if (!arrName) return null;

        // Extract the array that holds the function
        const arrMatch = code.match(
            new RegExp('var ' + arrName.replace('$', '\\$') + '\\s*=\\s*\\[(.+?)\\]\\s*[,;]')
        );
        if (!arrMatch) return null;

        const fnNames = arrMatch[1].split(',').map(s => s.trim());
        const fnName = fnNames[parseInt(arrIndex)];
        if (!fnName) return null;

        // Extract the function body
        const fnBodyMatch = code.match(
            new RegExp('(?:function ' + fnName + '|' + fnName + '\\s*=\\s*function)\\s*\\(([^)]+)\\)\\s*\\{([\\s\\S]+?)\\}\\s*[;,]')
        );
        if (!fnBodyMatch) return null;

        // Build a callable function from the extracted code
        // eslint-disable-next-line no-new-func
        _nDescrambler = new Function(fnBodyMatch[1], fnBodyMatch[2]);
        console.log('[YT-DL] n-descrambler loaded successfully');
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

        const newN = fn(n);
        u.searchParams.set('n', newN);
        return u.toString();
    } catch (_) {
        return url;
    }
}

// ── Alternative Client Helper ────────────────────────────────────────────────
async function fetchViaInnerTubeClient(videoId, clientName, clientVersion, osName, osVersion, extraHeaders = {}) {
    try {
        const payload = {
            videoId,
            context: {
                client: {
                    clientName,
                    clientVersion,
                    hl: document.documentElement.lang || 'tr',
                    gl: 'US'
                }
            }
        };

        if (osName) payload.context.client.osName = osName;
        if (osVersion) payload.context.client.osVersion = osVersion;

        const res = await fetch('/youtubei/v1/player?prettyPrint=false', {
            method: 'POST',
            credentials: 'omit', // typically don't send cookies to avoid 403 cookie mismatches if missing POT
            headers: {
                'Content-Type': 'application/json',
                ...extraHeaders
            },
            body: JSON.stringify(payload)
        });
        if (!res.ok) return { formats: [], title: null };
        const json = await res.json();
        // videoDetails.title is the authoritative title for this videoId
        const clientTitle = json?.videoDetails?.title || null;
        return { formats: parseStreamingData(json), title: clientTitle };
    } catch (_) { return { formats: [], title: null }; }
}

// ── TVHTML5_SIMPLY_EMBEDDED_PLAYER ───────────────────────────────────────────
async function fetchViaEmbeddedPlayer(videoId) {
    return fetchViaInnerTubeClient(videoId, 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', '2.0', null, null, {
        'X-YouTube-Client-Name': '85',
        'X-YouTube-Client-Version': '2.0',
    });
}

// ── ANDROID ──────────────────────────────────────────────────────────────────
// Based on yt-dlp configurations
async function fetchViaAndroid(videoId) {
    return fetchViaInnerTubeClient(videoId, 'ANDROID', '21.02.35', 'Android', '11', {
        'X-YouTube-Client-Name': '3',
        'X-YouTube-Client-Version': '21.02.35',
        'User-Agent': 'com.google.android.youtube/21.02.35 (Linux; U; Android 11) gzip'
    });
}

// ── IOS ──────────────────────────────────────────────────────────────────────
async function fetchViaIOS(videoId) {
    return fetchViaInnerTubeClient(videoId, 'IOS', '21.02.3', 'iPhone', '18.3.2.22D82', {
        'X-YouTube-Client-Name': '5',
        'X-YouTube-Client-Version': '21.02.3',
        'User-Agent': 'com.google.ios.youtube/21.02.3 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)'
    });
}


// ── Main: waterfall fetch ──────────────────────────────────────────────────────
// Old approach: 4 clients in parallel every time — wastes bandwidth and is more
// likely to trigger YouTube's rate limiting.
//
// New approach: try WEB (page-embedded data, zero extra requests) first.
// Only fall back to InnerTube clients if WEB returns no usable formats.
// Client priority: IOS > ANDROID > TVHTML5 (IOS tends to return the most
// reliable direct URLs without bot detection).
async function fetchVideoFormats() {
    const videoId = getCurrentVideoId();
    if (!videoId) return { formats: [], title: 'video' };

    let title = 'video';
    // titleVerified = true means title came from a source that is tied to this specific
    // videoId (ytInitialPlayerResponse with matching id, or an InnerTube API call).
    // Unverified titles (DOM text, meta tags, document.title) are used as best-effort
    // fallbacks but must not block a later verified source from overwriting them.
    let titleVerified = false;

    // ── Step 1: try WEB (ytInitialPlayerResponse already on the page) ─────────
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
                const data = JSON.parse(m[1]);

                // ── SPA-navigation guard ───────────────────────────────────────
                // On Shorts, YouTube navigates via SPA without reloading the page,
                // so the inline ytInitialPlayerResponse script keeps the PREVIOUS
                // video's data. If the embedded videoId doesn't match the current
                // URL, skip this block entirely — both the title AND the stream
                // URLs would be for the wrong video.
                const embeddedId = data.videoDetails?.videoId;
                if (embeddedId && embeddedId !== videoId) continue;

                if (data.videoDetails?.title) {
                    title = data.videoDetails.title;
                    titleVerified = true;
                }
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

    // WEB had usable muxed (video+audio) formats — use them directly, no extra requests
    const webMuxed = webResult.formats.filter(f => f.type === 'video_audio');
    if (webMuxed.length > 0) {
        // Only adopt the webResult title if it hasn't already been verified above;
        // otherwise we'd risk overwriting a good title with a stale one.
        if (!titleVerified && webResult.title) title = webResult.title;
        return _deduplicateAndSort(webResult.formats, title);
    }

    // ── Step 2: waterfall through InnerTube clients until we get formats ───────
    // IOS is first because its streams are the most reliable (no n-param issues).
    const clients = [
        { fetcher: fetchViaIOS, name: 'IOS' },
        { fetcher: fetchViaAndroid, name: 'ANDROID' },
        { fetcher: fetchViaEmbeddedPlayer, name: 'TVHTML5' },
    ];

    let allFormats = [...webResult.formats]; // carry over any web adaptive streams
    // Carry over any title the WEB step already set (unverified best-effort)
    if (webResult.title && title === 'video') title = webResult.title;

    for (const { fetcher, name } of clients) {
        try {
            const result = await fetcher(videoId);
            const formats = (result.formats || []).map(f => ({ ...f, source: name }));

            // InnerTube titles are fetched for the explicit videoId → always reliable.
            // Override any unverified title we may have picked up from DOM / meta.
            if (result.title && !titleVerified) {
                title = result.title;
                titleVerified = true;
            }

            allFormats.push(...formats);

            // Stop as soon as we have muxed formats from this client
            const hasMuxed = formats.some(f => f.type === 'video_audio');
            if (hasMuxed) break;
        } catch (_) { }
    }

    if (allFormats.length === 0) return { formats: [], title };
    return _deduplicateAndSort(allFormats, title);
}

// ── Shared dedup + sort logic (extracted so waterfall stays readable) ─────────
const CODEC_PRIORITY = { 'av01': 4, 'vp9': 3, 'vp09': 3, 'avc1': 2, 'mp4v': 1 };
const SOURCE_PRIORITY = { 'IOS': 4, 'ANDROID': 3, 'TVHTML5': 2, 'WEB': 1 };

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

function _deduplicateAndSort(allFormats, title) {
    // Key: height+type only — one entry per resolution per type
    const uniqueFormatsMap = new Map();

    for (const f of allFormats) {
        const heightMatch = f.quality.match(/(\d+)p/);
        const height = heightMatch ? heightMatch[1] : f.quality;
        const key = height + '|' + f.type;

        if (uniqueFormatsMap.has(key)) {
            const existing = uniqueFormatsMap.get(key);
            const existingCodec = _getCodecPriority(existing.mime);
            const newCodec = _getCodecPriority(f.mime);
            const existingSource = SOURCE_PRIORITY[existing.source] || 0;
            const newSource = SOURCE_PRIORITY[f.source] || 0;
            // Prefer higher codec first, then higher source priority
            if (newCodec > existingCodec || (newCodec === existingCodec && newSource > existingSource)) {
                uniqueFormatsMap.set(key, f);
            }
        } else {
            uniqueFormatsMap.set(key, f);
        }
    }

    let finalList = Array.from(uniqueFormatsMap.values());

    // Remove video-only adaptive entries where muxed exists at same height
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

    // Attach codec label; clear misleading size from adaptive streams
    finalList = finalList.map(f => ({
        ...f,
        codec: getCodecLabel(f.mime),
        size: f.type === 'video_audio' ? f.size : null
    }));

    // Sort: muxed first, then video-only (high→low), then audio-only
    finalList.sort((a, b) => {
        const typeOrder = { 'video_audio': 0, 'video': 1, 'audio': 2 };
        if (typeOrder[a.type] !== typeOrder[b.type]) {
            return typeOrder[a.type] - typeOrder[b.type];
        }

        let cleanA = a.quality.replace(' (High Quality)', '').replace(/Audio Only.*/, 'Audio Only').trim();
        let cleanB = b.quality.replace(' (High Quality)', '').replace(/Audio Only.*/, 'Audio Only').trim();

        // Extract base resolution (e.g. "1080p60 HDR" -> "1080p60" or "1080p")
        const matchA = cleanA.match(/^(\d+px?|Audio Only)/);
        const matchB = cleanB.match(/^(\d+px?|Audio Only)/);

        // If both have valid matching bases in QUALITY_ORDER
        if (matchA && matchB) {
            let baseA = matchA[1];
            let baseB = matchB[1];

            // Check if QUALITY_ORDER has these exact bases (e.g. 1080p60 vs 1080p)
            // Use full match like 1080p60 HDR if it specifically exists in QUALITY_ORDER
            const orderA = QUALITY_ORDER[cleanA] !== undefined ? QUALITY_ORDER[cleanA] : (QUALITY_ORDER[baseA] ?? 99);
            const orderB = QUALITY_ORDER[cleanB] !== undefined ? QUALITY_ORDER[cleanB] : (QUALITY_ORDER[baseB] ?? 99);

            if (orderA !== orderB) {
                return orderA - orderB;
            }
        }

        return (QUALITY_ORDER[cleanA] ?? 99) - (QUALITY_ORDER[cleanB] ?? 99);
    });

    console.log(`[YT-DL] Fetched ${finalList.length} unique streams.`);
    return { formats: finalList, title };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getMimeLabel(mime) {
    if (!mime) return 'MP4';
    if (mime.includes('mp4')) return 'MP4';
    if (mime.includes('webm')) return 'WebM';
    if (mime.includes('3gpp')) return '3GP';
    return 'Video';
}

function formatSize(bytes) {
    if (!bytes) return '';
    const mb = parseInt(bytes) / (1024 * 1024);
    return mb >= 1 ? '~' + mb.toFixed(0) + ' MB' : '';
}

// ── Trigger download ──────────────────────────────────────────────────────────
// Strategy: fetch inside content script (has page cookies/session) → blob URL
// → anchor click.  Service worker fetch fails with 403 because the streaming URL
// is session-bound and rejects requests that don't carry YouTube's cookies.
async function triggerDownload(fmt, rawFilename, allFormats = []) {
    const videoId = getCurrentVideoId();

    // ── iOS / codec compatibility: for browser-side blob downloads ────────────
    // YouTube's muxed streams can be WebM (VP9) even at ≤720p. Saving WebM data
    // with a .mp4 extension causes Apple devices (and some Android players) to
    // open the file successfully but play only the audio track because the VP9
    // video codec is unsupported in that context.
    //
    // Strategy:
    //   1. If the chosen format is a muxed WebM and an H.264 mp4 alternative
    //      exists at the same resolution → silently prefer the mp4 version.
    //   2. Otherwise, use the correct extension (.webm vs .mp4) so the OS and
    //      media players can identify the container without guessing.
    //
    // This block runs only for direct browser downloads (blob path).
    // Native yt-dlp downloads are not affected here.
    let actualFmt = fmt;
    const isMuxedWebm = fmt.type === 'video_audio' && fmt.mime && fmt.mime.includes('webm');
    if (isMuxedWebm && allFormats.length > 0) {
        const heightMatch = fmt.quality.match(/(\d+)p/);
        if (heightMatch) {
            const h = heightMatch[1];
            const h264 = allFormats.find(f =>
                f.type === 'video_audio' &&
                f.url &&
                f.mime && !f.mime.includes('webm') &&     // must be mp4 container
                f.quality.startsWith(h + 'p')             // same resolution
            );
            if (h264) actualFmt = h264;
        }
    }

    // Derive the correct container extension from the (possibly swapped) format
    const isWebmContainer = actualFmt.mime && actualFmt.mime.includes('webm');
    const containerExt = isWebmContainer ? '.webm' : '.mp4';

    const safeFilename = rawFilename
        .replace(/[/\\<>:"|?*\x00-\x1f]/g, '_')
        .replace(/\.(mp4|webm|mkv|m4v|3gp)$/i, '')   // strip any existing extension
        .trim()
        .substring(0, 180) + containerExt;

    // Route adaptive/heavy formats through the native messaging app.
    // We send the YouTube video ID + quality height so yt-dlp can do its own
    // format selection and audio+video merge — much more reliable than passing
    // raw stream URLs which may lack audio or expire mid-download.
    if (fmt.type === 'video' || fmt.type === 'audio' || fmt.quality.includes('Quality') || fmt.quality.includes('Audio') || parseInt(fmt.quality) >= 1080 || fmt.quality.includes('1080p') || fmt.quality.includes('1440p')) {
        const toast = showYouTubeNotification(rawFilename, i18n.t('notifPreparing'), videoId, 'preparing');
        console.log('[YT-DL] Sending to native messaging host', fmt);

        // Extract numeric height from quality label (e.g. "1080p (High Quality)" → 1080)
        const heightMatch = fmt.quality.match(/(\d+)p/);
        const qualityHeight = heightMatch ? parseInt(heightMatch[1]) : null;

        chrome.runtime.sendMessage({
            action: 'download_video_native',
            videoId: videoId,
            title: rawFilename,
            videoQuality: fmt.quality,
            qualityHeight: qualityHeight,
            isAudioOnly: fmt.type === 'audio',
            isVideoAudio: fmt.type === 'video_audio'
        }, (response) => {
            if (response && response.status === 'sent_to_native') {
                toast.success(i18n.t('notifDownloadingBg'));
            } else {
                console.error('[YT-DL] Native messaging failed:', response);
                toast.remove();
                alert(i18n.t('alertNativeNotFound'));
            }
        });
        return;
    }

    const url = actualFmt.url;
    // Show progress indicator
    const toast = showYouTubeNotification(rawFilename, i18n.t('notifDownloading'), videoId, 'preparing');

    try {
        // Fetch from content-script context – same session as the YouTube page,
        // so the googlevideo.com URL accepts the request.
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) throw new Error('HTTP ' + response.status);

        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);

        // Anchor-click download: works for blob: URLs regardless of origin
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = safeFilename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { a.remove(); URL.revokeObjectURL(blobUrl); }, 5000);

        toast.success(i18n.t('notifDownloadComplete'));
        console.log('[YT-DL] Blob download triggered:', safeFilename);
    } catch (err) {
        console.error('[YT-DL] Blob fetch failed:', err);
        toast.remove();
        if (confirm(i18n.t('confirmOpenInTab').replace('%s', err.message))) {
            window.open(url, '_blank');
        }
    }
}

// ── Custom YouTube-style notification ─────────────────────────────────────────
function showYouTubeNotification(title, message, videoId, state = 'success') {
    // state can be: 'preparing', 'success', 'error'

    // Determine background and icon color based on state
    let bgColor = '#212121'; // Default dark
    let iconHTML = '';
    let duration = 4000;

    if (state === 'error') {
        bgColor = '#cc0000'; // Red
        duration = 6000;
        iconHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="#fff" style="flex-shrink:0;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`;
    } else if (state === 'success') {
        bgColor = '#2e7d32'; // Green
        iconHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="#fff" style="flex-shrink:0;"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;
    } else {
        // 'preparing'
        iconHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="#3ea6ff" style="flex-shrink:0;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`; // Info icon blue
    }

    // Basic YouTube toast container structure mimicking native yt-notification-action-renderer
    const container = document.createElement('div');
    container.style.cssText = `
        position: fixed;
        top: 65px;
        right: 24px;
        z-index: 2200000000;
        background-color: ${bgColor};
        color: #fff;
        font-family: 'Roboto', 'Arial', sans-serif;
        font-size: 14px;
        padding: 12px 16px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        gap: 12px;
        max-width: 360px;
        opacity: 0;
        transform: translateY(-20px);
        transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
    `;

    // Thumbnail (if videoId is given)
    let thumbHtml = '';
    if (videoId) {
        thumbHtml = `
            <div style="flex-shrink: 0; width: 40px; height: 40px; border-radius: 4px; overflow: hidden; background: #000;">
                <img src="https://i.ytimg.com/vi/${videoId}/default.jpg" style="width: 100%; height: 100%; object-fit: cover;" />
            </div>
        `;
    }

    container.innerHTML = `
        ${thumbHtml || iconHTML}
        <div style="display: flex; flex-direction: column; overflow: hidden;">
            <span style="font-weight: 500; margin-bottom: 2px;">${message}</span>
            ${title ? `<span style="font-size: 12px; opacity: 0.7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${title}</span>` : ''}
        </div>
    `;

    document.body.appendChild(container);

    // Animate in
    requestAnimationFrame(() => {
        container.style.opacity = '1';
        container.style.transform = 'translateY(0)';
    });

    // Animate out and remove
    setTimeout(() => {
        container.style.opacity = '0';
        container.style.transform = 'translateY(-20px)';
        setTimeout(() => {
            if (container.parentNode) container.parentNode.removeChild(container);
        }, 300);
    }, duration);

    // Return a rough equivalent wrapper if existing code depends on .success/.remove
    return {
        remove: () => {
            container.style.opacity = '0';
            container.style.transform = 'translateY(-20px)';
            setTimeout(() => { if (container.parentNode) container.parentNode.removeChild(container); }, 300);
        },
        success: (msg) => {
            // Update the existing toast to show success state
            container.querySelector('span').textContent = msg;
            container.style.backgroundColor = '#2e7d32'; // Change to green on success

            // If it had a pure SVG icon (no thumbnail), change it to white checkmark
            const svgContainer = container.querySelector('svg');
            if (svgContainer) {
                svgContainer.style.fill = '#ffffff';
                svgContainer.innerHTML = `<path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>`;
            }
        }
    };
}

// Global listener for native-host download results broadcasted by background.js
chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.action === 'download_video_result') {
        if (msg.status === 'success') {
            showYouTubeNotification(msg.title, i18n.t('notifDownloadComplete'), msg.videoId, 'success');
        } else {
            showYouTubeNotification(msg.title, i18n.t('notifDownloadFailed'), msg.videoId, 'error');
        }
    }
});

// ═════════════════════════════════════════════════════════════════════════════
//  DOWNLOAD MODAL
// ═════════════════════════════════════════════════════════════════════════════

// Helper to toggle visibility of youtube's right-side overlay (e.g. like/dislike buttons, branding)
function toggleFullscreenOverlay(hide) {
    // Selects both the quick action buttons and custom branding overlays
    const overlays = document.querySelectorAll('.ytp-overlay-bottom-right, .ytp-fullscreen-quick-actions');
    overlays.forEach(overlay => {
        overlay.style.opacity = hide ? '0' : '';
        overlay.style.pointerEvents = hide ? 'none' : '';
    });
}

let activeModal = null;
let activeOutsideClickHandler = null;
let autohideObserver = null;

function closeModal() {
    if (activeModal) {
        activeModal.remove();
        activeModal = null;
        toggleFullscreenOverlay(false); // Restore native visibility
    }
    if (activeOutsideClickHandler) {
        document.removeEventListener('click', activeOutsideClickHandler, true);
        activeOutsideClickHandler = null;
    }
    if (autohideObserver) {
        autohideObserver.disconnect();
        autohideObserver = null;
    }
}

function showDownloadModal(anchor, data, isShorts) {
    closeModal();
    const { formats, title } = data;

    // For Shorts, keep the original simple modal style to avoid breaking shorts
    if (isShorts) {
        const modal = document.createElement('div');
        modal.className = `yt-dl-modal yt-dl-modal--shorts`;
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
                (vid
                    ? `<a class="yt-dl-fallback-link" href="https://y2mate.com/youtube/${vid}" target="_blank" rel="noopener">${i18n.t('dlModalWebService')}</a>`
                    : '');
            modal.appendChild(empty);
        } else {
            formats.forEach(fmt => {
                const opt = document.createElement('button');
                opt.className = 'yt-dl-option';
                opt.type = 'button';
                const sizeLabel = formatSize(fmt.size);
                const codecBadge = fmt.type === 'audio' ? 'MP3' : (fmt.codec || getMimeLabel(fmt.mime));
                opt.innerHTML =
                    `<span class="yt-dl-quality">${fmt.quality}</span>` +
                    `<span class="yt-dl-badges">` +
                    `<span class="yt-dl-badge-mime">${codecBadge}</span>` +
                    (sizeLabel ? `<span class="yt-dl-badge-size">${sizeLabel}</span>` : '') +
                    `</span>` +
                    `<svg class="yt-dl-arrow" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                    </svg>`;

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

        // Positioning for shorts
        requestAnimationFrame(() => {
            const rect = anchor.getBoundingClientRect();
            const mh = modal.offsetHeight || 160;
            const vw = window.innerWidth;
            const vh = window.innerHeight;

            // Anchor left edge of modal to the right edge of the button
            const left = rect.right + 10;
            let top = rect.top + rect.height / 2 - mh / 2;
            top = Math.max(8, Math.min(top, vh - mh - 8));

            // Clean up any right property if set, use left
            modal.style.right = 'auto';
            modal.style.left = left + 'px';
            modal.style.top = top + 'px';
        });

    } else {
        // Native YouTube Settings-style modal for the Video page
        const modal = document.createElement('div');
        modal.className = `ytp-popup ytp-settings-menu yt-dl-video-popup`;
        activeModal = modal;

        // Base matching YouTube's element nesting precisely:
        // ytp-popup > ytp-panel > ytp-panel-menu
        const panel = document.createElement('div');
        panel.className = 'ytp-panel';
        const menu = document.createElement('div');
        menu.className = 'ytp-panel-menu';
        menu.setAttribute('role', 'menu');

        // Optional title/header mimicking native YouTube
        const headerOption = document.createElement('div');
        headerOption.className = 'ytp-menuitem ytp-panel-header';
        headerOption.innerHTML = `
            <div class="ytp-menuitem-label" style="font-weight: 500; font-size: 14px; color: #fff; padding-left: 2px;">${i18n.t('dlModalSelectQuality')}</div>
        `;
        menu.appendChild(headerOption);

        if (formats.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'ytp-menuitem';
            const vid = getCurrentVideoId();
            empty.innerHTML = `
                <div class="ytp-menuitem-label" style="white-space: normal; line-height: 1.5;">
                    ${i18n.t('dlModalNoStreams')}
                    ${vid ? `<a href="https://y2mate.com/youtube/${vid}" target="_blank" style="color: #3ea6ff; display: block; margin-top: 4px;">${i18n.t('dlModalWebService')}</a>` : ''}
                </div>
            `;
            menu.appendChild(empty);
        } else {
            formats.forEach(fmt => {
                const opt = document.createElement('div');
                opt.className = 'ytp-menuitem';
                opt.setAttribute('role', 'menuitem');
                opt.tabIndex = 0;

                const sizeLabel = formatSize(fmt.size);
                const codecBadge = fmt.type === 'audio' ? 'MP3' : (fmt.codec || getMimeLabel(fmt.mime));

                // Using YouTube's inner layout matching video quality settings.html
                // We don't actually need the left checkmark space because our text needs all width
                opt.innerHTML = `
                    <div class="ytp-menuitem-label">${fmt.quality}</div>
                    <div class="ytp-menuitem-content">
                        <span class="yt-dl-badge-mime" style="margin-right: 8px;">${codecBadge}</span>
                        ${sizeLabel ? `<span class="yt-dl-badge-size" style="margin-right: 8px;">${sizeLabel}</span>` : ''}
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="white" style="opacity: 0.6; vertical-align: middle;">
                            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                        </svg>
                    </div>
                `;

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

        // Append directly to the same container YouTube uses for its native settings menu
        // typically the player container itself (like html5-video-player)
        let playerContainer = document.querySelector('.html5-video-player') || document.body;
        playerContainer.appendChild(modal);

        // Prevent YouTube from auto-hiding the controls while our modal is open
        if (playerContainer.classList) {
            playerContainer.classList.remove('ytp-autohide');
            autohideObserver = new MutationObserver(() => {
                if (playerContainer.classList.contains('ytp-autohide')) {
                    playerContainer.classList.remove('ytp-autohide');
                }
            });
            autohideObserver.observe(playerContainer, { attributes: true, attributeFilter: ['class'] });
        }

        // Align the menu perfectly with the right edge of the settings button control cluster
        // The modal is a child of the `html5-video-player`. By setting `bottom` and `right`,
        // it positions itself relative to the bottom-right corner of the *player viewport*, 
        // which works transparently across Normal, Theater, and Fullscreen modes.
        requestAnimationFrame(() => {
            // Because our quality labels contain extra info like "HDR (High Quality)", 
            // 261px is too narrow and wraps them. 300px fits everything cleanly.
            const mw = 300;
            modal.style.width = `${mw}px`;
            panel.style.width = `${mw}px`;

            if (menu.scrollHeight > 0) {
                const maxHeight = Math.min(menu.scrollHeight + 10, window.innerHeight * 0.7);
                modal.style.height = `${maxHeight}px`;
                panel.style.height = `${maxHeight}px`;
                menu.style.height = `${maxHeight}px`;
            }

            // Native YouTube uses right: 12px for the settings menu
            modal.style.right = '12px';

            // Controls bar is dynamically sized, usually 48px or 54px when controls are visible
            const chromeBtm = document.querySelector('.ytp-chrome-bottom');
            const controlsHeight = chromeBtm ? chromeBtm.offsetHeight : 48;

            // User requested exactly 62px bottom when controls are 48px: 48 + 3 = 62
            modal.style.bottom = `${controlsHeight + 3}px`;

            // Note: Our CSS must NOT have `position: fixed` if we are relying on player-relative
            // right/bottom properties. Need absolute.
            modal.style.position = 'absolute';

            // Hide the distracting overlay elements on the right when our menu is active
            toggleFullscreenOverlay(true);
        });
    }

    const outsideClick = (e) => {
        if (!activeModal) return;

        // If clicking outside the modal AND not on the button that opened it
        if (!activeModal.contains(e.target) && !anchor.contains(e.target)) {

            // Check if user clicked on the bottom control bar
            const controlsItem = e.target.closest('.ytp-chrome-bottom');

            // If they clicked the video player area itself (not a control), 
            // swallow it so the video doesn't un-intentionally play/pause.
            // But if they clicked a control bar item, let it propagate!
            if (!controlsItem) {
                e.stopPropagation();
                e.preventDefault();
            }

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

        if (activeModal) {
            closeModal();
            return;
        }

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

    // Use the narrower selector – this is the direct parent of the settings button
    const controlsLeft = document.querySelector('.ytp-right-controls-left');
    if (!controlsLeft) return;
    if (controlsLeft.querySelector('.my-video-dl-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'ytp-button my-video-dl-btn';
    btn.setAttribute('data-title', i18n.t('dlBtnTitle'));
    btn.setAttribute('aria-label', i18n.t('dlBtnAriaLabel'));
    btn.innerHTML = `
        <svg height="24" viewBox="0 0 24 24" width="24">
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" fill="white"/>
        </svg>`;

    btn.addEventListener('click', async (e) => {
        e.stopPropagation(); e.preventDefault();

        if (activeModal) {
            closeModal();
            return;
        }

        // If native settings menu is open, explicitly close it by clicking settings button
        const settingsBtn = document.querySelector('.ytp-settings-button');
        if (settingsBtn && settingsBtn.getAttribute('aria-expanded') === 'true') {
            settingsBtn.click();
        }

        btn.classList.add('my-video-dl-btn--loading');
        const data = await fetchVideoFormats();
        btn.classList.remove('my-video-dl-btn--loading');
        showDownloadModal(btn, data, false);
    });

    // ── Fix: use the element's own parentNode for insertBefore ───────────────
    const settingsBtn = controlsLeft.querySelector('.ytp-settings-button');
    if (settingsBtn) {
        // insertBefore on the actual parent of settingsBtn (may differ from controlsLeft)
        settingsBtn.parentNode.insertBefore(btn, settingsBtn);
    } else {
        controlsLeft.appendChild(btn);
    }
}

// ─── Video page bootstrap ─────────────────────────────────────────────────────
let videoPlayerInterval = null;

function initVideoDownloadButton() {
    if (!EXTENSION_ENABLED || !DOWNLOADER_ENABLED || isShortPage()) return;
    clearInterval(videoPlayerInterval);
    let attempts = 0;
    videoPlayerInterval = setInterval(() => {
        attempts++;
        if (attempts > 30) { clearInterval(videoPlayerInterval); return; } // 15 s max

        const controlsLeft = document.querySelector('.ytp-right-controls-left');
        if (!controlsLeft) return;
        if (controlsLeft.querySelector('.my-video-dl-btn')) {
            clearInterval(videoPlayerInterval);
            return;
        }
        addVideoDownloadButton();
    }, 500);
}

initVideoDownloadButton();

// SPA navigation listener
let lastHref = location.href;
const navObserver = new MutationObserver(() => {
    if (location.href !== lastHref) {
        lastHref = location.href;
        closeModal();
        initVideoDownloadButton();
    }
});
navObserver.observe(document, { subtree: true, childList: true });