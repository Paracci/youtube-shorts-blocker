// ─────────────────────────────────────────────────────────────────────────────
// YouTube Shorts Channel Blocker + Video Downloader – content.js  v1.3
// ─────────────────────────────────────────────────────────────────────────────

// ─── Extension context guard ──────────────────────────────────────────────────
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
let BLOCKING_ENABLED = true;
let DOWNLOADER_ENABLED = true;
let AD_BLOCKER_ENABLED = true;
let QUALITY_LOCK_ENABLED = true;   // ← new

// Initialise i18n engine (translations.js is loaded before this file)
i18n.init();

safeStorageGet(
    ['extensionEnabled', 'hideHomepageShorts', 'blockingEnabled', 'downloaderEnabled', 'adBlockerEnabled', 'qualityLockEnabled'],
    (res) => {
        if (res.extensionEnabled !== undefined) EXTENSION_ENABLED = res.extensionEnabled;
        if (res.hideHomepageShorts !== undefined) HIDE_SHORTS_HOMEPAGE = res.hideHomepageShorts;
        if (res.blockingEnabled !== undefined) BLOCKING_ENABLED = res.blockingEnabled;
        if (res.downloaderEnabled !== undefined) DOWNLOADER_ENABLED = res.downloaderEnabled;
        if (res.adBlockerEnabled !== undefined) AD_BLOCKER_ENABLED = res.adBlockerEnabled;
        if (res.qualityLockEnabled !== undefined) QUALITY_LOCK_ENABLED = res.qualityLockEnabled;
        applyHomepageVisibility();
        applyAdBlocker();
    }
);

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'toggle_extension') {
        EXTENSION_ENABLED = msg.enabled;
        if (!msg.enabled) {
            document.querySelectorAll('.my-block-button, .my-video-dl-btn').forEach(b => {
                b.style.display = 'none';
            });
        } else {
            if (BLOCKING_ENABLED) {
                document.querySelectorAll('.my-block-button').forEach(b => { b.style.display = ''; });
            }
            if (DOWNLOADER_ENABLED) {
                document.querySelectorAll('.my-dl-btn-shorts, .my-video-dl-btn').forEach(b => { b.style.display = ''; });
            }
        }
        // Ad blocker must also react to master toggle
        applyAdBlocker();
    }

    if (msg.action === 'toggle_hide_shorts') {
        HIDE_SHORTS_HOMEPAGE = msg.enabled;
        applyHomepageVisibility();
    }

    if (msg.action === 'toggle_blocking') {
        BLOCKING_ENABLED = msg.enabled;
        document.querySelectorAll('.my-block-button').forEach(b => {
            if (!b.classList.contains('my-dl-btn-shorts')) {
                b.style.display = msg.enabled && EXTENSION_ENABLED ? '' : 'none';
            }
        });
    }

    if (msg.action === 'toggle_downloader') {
        DOWNLOADER_ENABLED = msg.enabled;
        document.querySelectorAll('.my-dl-btn-shorts').forEach(b => {
            b.style.display = msg.enabled && EXTENSION_ENABLED ? '' : 'none';
        });
        const videoDlBtn = document.querySelector('.my-video-dl-btn');
        if (videoDlBtn) {
            videoDlBtn.style.display = msg.enabled && EXTENSION_ENABLED ? '' : 'none';
        }
        if (msg.enabled && EXTENSION_ENABLED) {
            runOptimizationCheck();
            initVideoDownloadButton();
        }
    }

    // ── Ad blocker toggle ────────────────────────────────────────────────────
    if (msg.action === 'toggle_adblocker') {
        AD_BLOCKER_ENABLED = msg.enabled;
        applyAdBlocker();
    }

    // ── Quality lock toggle ──────────────────────────────────────────────────
    if (msg.action === 'toggle_quality_lock') {
        QUALITY_LOCK_ENABLED = msg.enabled;
    }
});

// ═════════════════════════════════════════════════════════════════════════════
//  AD BLOCKER
// ═════════════════════════════════════════════════════════════════════════════

const AD_BLOCK_STYLE_ID = 'my-yt-ad-blocker-css';
let _adSkipInterval = null;
let _adMutedByUs = false;   // track whether WE muted the video

// CSS selectors that target YouTube's ad elements
const AD_BLOCK_CSS = `
/* ── Feed / banner ads ─────────────────────────────────────── */
ytd-ad-slot-renderer,
ytd-in-feed-ad-layout-renderer,
ytd-display-ad-renderer,
ytd-rich-item-renderer:has(ytd-ad-slot-renderer),
ytd-banner-promo-renderer,
ytd-statement-banner-renderer,
ytd-primetime-promo-renderer,
ytd-brand-video-shelf-renderer,
ytd-brand-video-singleton-renderer,
#masthead-ad,
#player-ads { display: none !important; }

/* ── In-player overlay ads ─────────────────────────────────── */
.ytp-ad-overlay-container,
.ytp-ad-image-overlay,
.ytp-ad-text-overlay,
.ytp-ad-progress,
.ytp-ad-progress-list,
.video-ads.ytp-ad-module { display: none !important; }
`;

function injectAdBlockCSS() {
    if (document.getElementById(AD_BLOCK_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = AD_BLOCK_STYLE_ID;
    style.textContent = AD_BLOCK_CSS;
    (document.head || document.documentElement).appendChild(style);
}

function removeAdBlockCSS() {
    const el = document.getElementById(AD_BLOCK_STYLE_ID);
    if (el) el.remove();
}

function startAdSkipper() {
    if (_adSkipInterval) return;
    _adSkipInterval = setInterval(skipCurrentAd, 700);
}

function stopAdSkipper() {
    if (_adSkipInterval) { clearInterval(_adSkipInterval); _adSkipInterval = null; }
}

function skipCurrentAd() {
    if (!AD_BLOCKER_ENABLED || !EXTENSION_ENABLED) return;

    // 1. Click any visible skip button first
    const skipBtn = document.querySelector(
        '.ytp-skip-ad-button:not([style*="display: none"]), ' +
        '.ytp-ad-skip-button:not([style*="display: none"]), ' +
        '.ytp-ad-skip-button-modern:not([style*="display: none"])'
    );
    if (skipBtn) {
        skipBtn.click();
        return;
    }

    // 2. If an unskippable ad is playing, mute it and fast-forward to end
    const player = document.querySelector('.html5-main-video, video.html5-main-video');
    const adActive = document.querySelector(
        '.ad-showing, .ytp-ad-player-overlay, .ytp-ad-simple-ad-badge'
    );
    if (player && adActive) {
        if (!player.muted) { player.muted = true; _adMutedByUs = true; }
        if (isFinite(player.duration) && player.duration > 0 && player.currentTime < player.duration - 0.1) {
            player.currentTime = player.duration;
        }
    }
}

function applyAdBlocker() {
    if (AD_BLOCKER_ENABLED && EXTENSION_ENABLED) {
        injectAdBlockCSS();
        startAdSkipper();
    } else {
        removeAdBlockCSS();
        stopAdSkipper();
        // Only un-mute if we were the ones who muted the video during an ad
        if (_adMutedByUs) {
            const video = document.querySelector('.html5-main-video, video.html5-main-video');
            if (video && video.muted) video.muted = false;
            _adMutedByUs = false;
        }
    }
}

// ─── Homepage visibility ──────────────────────────────────────────────────────
function applyHomepageVisibility() {
    if (window.location.pathname === '/' || window.location.pathname === '') {
        if (HIDE_SHORTS_HOMEPAGE) {
            document.body.classList.add('my-hide-shorts-home');
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
    if (!QUALITY_LOCK_ENABLED || !EXTENSION_ENABLED) return;
    const player = document.getElementById('movie_player') ||
        document.querySelector('.html5-video-player');
    if (player && typeof player.setPlaybackQualityRange === 'function') {
        player.setPlaybackQualityRange('hd2160');
    }
}

// ─── Ad skip (Shorts feed) ────────────────────────────────────────────────────
function checkForAdAndSkip(renderer) {
    if (!AD_BLOCKER_ENABLED || !EXTENSION_ENABLED) return false;
    const isAd = renderer.querySelector('ytd-ad-slot-renderer') ||
        renderer.tagName.toLowerCase().includes('ad-slot');
    if (isAd) {
        const video = renderer.querySelector('video');
        if (video && !video.muted) { video.muted = true; _adMutedByUs = true; }
        if (video) video.currentTime = video.duration || 1000;
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

        let btn = bar.querySelector('.my-block-button:not(.my-dl-btn-shorts)');
        if (!btn && BLOCKING_ENABLED && EXTENSION_ENABLED) {
            btn = createBlockButton(bar, renderer);
            scrollObserver.observe(renderer);
        }
        if (btn) {
            btn.style.display = BLOCKING_ENABLED && EXTENSION_ENABLED ? '' : 'none';
            checkAndResetButton(btn, renderer);
        }

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

            safeStorageGet(['blockedChannels', 'blockedCount'], (res) => {
                const list = res.blockedChannels || [];
                const alreadyInList = channelId ? list.some(c => c.id === channelId) : false;

                if (channelId && !alreadyInList) {
                    list.push({ id: channelId, name: channelName || channelId, blockedAt: Date.now() });
                }

                const newCount = alreadyInList
                    ? (res.blockedCount || 0)
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

const QUALITY_ORDER = {
    '2160p60': 0, '2160p': 1, '1440p60': 2, '1440p': 3, '1080p60': 4, '1080p': 5,
    '720p60': 6, '720p': 7, '480p': 8, '360p': 9, '240p': 10, '144p': 11
};

function parseStreamingData(data) {
    if (!data || !data.streamingData) return [];

    let formats = (data.streamingData.formats || []).filter(f => f.url).map(f => ({
        url: f.url,
        quality: f.qualityLabel || f.quality || '?',
        mime: f.mimeType || 'video/mp4',
        itag: f.itag || 0,
        size: f.contentLength || null,
        type: 'video_audio'
    }));

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

        const res = await fetch(playerUrl);
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
        const fnName = fnNames[parseInt(arrIndex)];
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
        const newN = fn(n);
        u.searchParams.set('n', newN);
        return u.toString();
    } catch (_) { return url; }
}

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
        if (osName) payload.context.client.osName = osName;
        if (osVersion) payload.context.client.osVersion = osVersion;

        const res = await fetch('/youtubei/v1/player?prettyPrint=false', {
            method: 'POST',
            credentials: 'omit',
            headers: { 'Content-Type': 'application/json', ...extraHeaders },
            body: JSON.stringify(payload)
        });
        if (!res.ok) return { formats: [], title: null };
        const json = await res.json();
        const clientTitle = json?.videoDetails?.title || null;
        return { formats: parseStreamingData(json), title: clientTitle };
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

async function fetchVideoFormats() {
    const videoId = getCurrentVideoId();
    if (!videoId) return { formats: [], title: 'video' };

    let title = 'video';
    let titleVerified = false;

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

    const clients = [
        { fetcher: fetchViaIOS, name: 'IOS' },
        { fetcher: fetchViaAndroid, name: 'ANDROID' },
        { fetcher: fetchViaEmbeddedPlayer, name: 'TVHTML5' },
    ];

    let allFormats = [...webResult.formats];
    if (webResult.title && title === 'video') title = webResult.title;

    for (const { fetcher, name } of clients) {
        try {
            const result = await fetcher(videoId);
            const formats = (result.formats || []).map(f => ({ ...f, source: name }));
            if (result.title && !titleVerified) { title = result.title; titleVerified = true; }
            allFormats.push(...formats);
            const hasMuxed = formats.some(f => f.type === 'video_audio');
            if (hasMuxed) break;
        } catch (_) { }
    }

    if (allFormats.length === 0) return { formats: [], title };
    return _deduplicateAndSort(allFormats, title);
}

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
            if (newCodec > existingCodec || (newCodec === existingCodec && newSource > existingSource)) {
                uniqueFormatsMap.set(key, f);
            }
        } else {
            uniqueFormatsMap.set(key, f);
        }
    }

    let finalList = Array.from(uniqueFormatsMap.values());

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
            let baseA = matchA[1]; let baseB = matchB[1];
            const orderA = QUALITY_ORDER[cleanA] !== undefined ? QUALITY_ORDER[cleanA] : (QUALITY_ORDER[baseA] ?? 99);
            const orderB = QUALITY_ORDER[cleanB] !== undefined ? QUALITY_ORDER[cleanB] : (QUALITY_ORDER[baseB] ?? 99);
            if (orderA !== orderB) return orderA - orderB;
        }
        return (QUALITY_ORDER[cleanA] ?? 99) - (QUALITY_ORDER[cleanB] ?? 99);
    });

    return { formats: finalList, title };
}

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

async function triggerDownload(fmt, rawFilename, allFormats = []) {
    const videoId = getCurrentVideoId();

    let actualFmt = fmt;
    const isMuxedWebm = fmt.type === 'video_audio' && fmt.mime && fmt.mime.includes('webm');
    if (isMuxedWebm && allFormats.length > 0) {
        const heightMatch = fmt.quality.match(/(\d+)p/);
        if (heightMatch) {
            const h = heightMatch[1];
            const h264 = allFormats.find(f =>
                f.type === 'video_audio' && f.url && f.mime && !f.mime.includes('webm') &&
                f.quality.startsWith(h + 'p')
            );
            if (h264) actualFmt = h264;
        }
    }

    const isWebmContainer = actualFmt.mime && actualFmt.mime.includes('webm');
    const containerExt = isWebmContainer ? '.webm' : '.mp4';

    const safeFilename = rawFilename
        .replace(/[/\\<>:"|?*\x00-\x1f]/g, '_')
        .replace(/\.(mp4|webm|mkv|m4v|3gp)$/i, '')
        .trim()
        .substring(0, 180) + containerExt;

    if (fmt.type === 'video' || fmt.type === 'audio' || fmt.quality.includes('Quality') ||
        fmt.quality.includes('Audio') || parseInt(fmt.quality) >= 1080 ||
        fmt.quality.includes('1080p') || fmt.quality.includes('1440p')) {
        const toast = showYouTubeNotification(rawFilename, i18n.t('notifPreparing'), videoId, 'preparing');

        const heightMatch = fmt.quality.match(/(\d+)p/);
        const qualityHeight = heightMatch ? parseInt(heightMatch[1]) : null;

        chrome.runtime.sendMessage({
            action: 'download_video_native',
            videoId, title: rawFilename, videoQuality: fmt.quality,
            qualityHeight, isAudioOnly: fmt.type === 'audio', isVideoAudio: fmt.type === 'video_audio'
        }, (response) => {
            if (response && response.status === 'sent_to_native') {
                toast.success(i18n.t('notifDownloadingBg'));
            } else {
                toast.remove();
                alert(i18n.t('alertNativeNotFound'));
            }
        });
        return;
    }

    const url = actualFmt.url;
    const toast = showYouTubeNotification(rawFilename, i18n.t('notifDownloading'), videoId, 'preparing');

    try {
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) throw new Error('HTTP ' + response.status);

        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);

        const a = document.createElement('a');
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

function showYouTubeNotification(title, message, videoId, state = 'success') {
    let bgColor = '#212121';
    let iconHTML = '';
    let duration = 4000;

    if (state === 'error') {
        bgColor = '#cc0000'; duration = 6000;
        iconHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="#fff" style="flex-shrink:0;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`;
    } else if (state === 'success') {
        bgColor = '#2e7d32';
        iconHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="#fff" style="flex-shrink:0;"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;
    } else {
        iconHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="#3ea6ff" style="flex-shrink:0;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`;
    }

    const container = document.createElement('div');
    container.style.cssText = `
        position: fixed; top: 65px; right: 24px; z-index: 2200000000;
        background-color: ${bgColor}; color: #fff;
        font-family: 'Roboto', 'Arial', sans-serif; font-size: 14px;
        padding: 12px 16px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        display: flex; align-items: center; gap: 12px; max-width: 360px;
        opacity: 0; transform: translateY(-20px);
        transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
    `;

    let thumbHtml = '';
    if (videoId) {
        thumbHtml = `<div style="flex-shrink:0;width:40px;height:40px;border-radius:4px;overflow:hidden;background:#000;">
            <img src="https://i.ytimg.com/vi/${videoId}/default.jpg" style="width:100%;height:100%;object-fit:cover;" />
        </div>`;
    }

    container.innerHTML = `
        ${thumbHtml || iconHTML}
        <div style="display:flex;flex-direction:column;overflow:hidden;">
            <span style="font-weight:500;margin-bottom:2px;">${message}</span>
            ${title ? `<span style="font-size:12px;opacity:0.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${title}</span>` : ''}
        </div>
    `;

    document.body.appendChild(container);
    requestAnimationFrame(() => {
        container.style.opacity = '1'; container.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
        container.style.opacity = '0'; container.style.transform = 'translateY(-20px)';
        setTimeout(() => { if (container.parentNode) container.parentNode.removeChild(container); }, 300);
    }, duration);

    return {
        remove: () => {
            container.style.opacity = '0'; container.style.transform = 'translateY(-20px)';
            setTimeout(() => { if (container.parentNode) container.parentNode.removeChild(container); }, 300);
        },
        success: (msg) => {
            container.querySelector('span').textContent = msg;
            container.style.backgroundColor = '#2e7d32';
            const svgContainer = container.querySelector('svg');
            if (svgContainer) {
                svgContainer.style.fill = '#ffffff';
                svgContainer.innerHTML = `<path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>`;
            }
        }
    };
}

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

function toggleFullscreenOverlay(hide) {
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
                (vid ? `<a class="yt-dl-fallback-link" href="https://y2mate.com/youtube/${vid}" target="_blank" rel="noopener">${i18n.t('dlModalWebService')}</a>` : '');
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
            const mh = modal.offsetHeight || 160;
            const vh = window.innerHeight;
            const left = rect.right + 10;
            let top = rect.top + rect.height / 2 - mh / 2;
            top = Math.max(8, Math.min(top, vh - mh - 8));
            modal.style.right = 'auto'; modal.style.left = left + 'px'; modal.style.top = top + 'px';
        });

    } else {
        const modal = document.createElement('div');
        modal.className = `ytp-popup ytp-settings-menu yt-dl-video-popup`;
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
                opt.className = 'ytp-menuitem'; opt.setAttribute('role', 'menuitem'); opt.tabIndex = 0;
                const sizeLabel = formatSize(fmt.size);
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

        panel.appendChild(menu); modal.appendChild(panel);

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
            modal.style.width = `${mw}px`; panel.style.width = `${mw}px`;
            if (menu.scrollHeight > 0) {
                const maxHeight = Math.min(menu.scrollHeight + 10, window.innerHeight * 0.7);
                modal.style.height = `${maxHeight}px`; panel.style.height = `${maxHeight}px`; menu.style.height = `${maxHeight}px`;
            }
            modal.style.right = '12px';
            const chromeBtm = document.querySelector('.ytp-chrome-bottom');
            const controlsHeight = chromeBtm ? chromeBtm.offsetHeight : 48;
            modal.style.bottom = `${controlsHeight + 3}px`;
            modal.style.position = 'absolute';
            toggleFullscreenOverlay(true);
        });
    }

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

function initVideoDownloadButton() {
    if (!EXTENSION_ENABLED || !DOWNLOADER_ENABLED || isShortPage()) return;
    clearInterval(videoPlayerInterval);
    let attempts = 0;
    videoPlayerInterval = setInterval(() => {
        attempts++;
        if (attempts > 30) { clearInterval(videoPlayerInterval); return; }
        const controlsLeft = document.querySelector('.ytp-right-controls-left');
        if (!controlsLeft) return;
        if (controlsLeft.querySelector('.my-video-dl-btn')) { clearInterval(videoPlayerInterval); return; }
        addVideoDownloadButton();
    }, 500);
}

initVideoDownloadButton();

let lastHref = location.href;
const navObserver = new MutationObserver(() => {
    if (location.href !== lastHref) {
        lastHref = location.href;
        closeModal();
        initVideoDownloadButton();
        // Always re-apply ad blocker after SPA navigation —
        // YouTube sometimes strips injected <style> tags on page transitions
        applyAdBlocker();
    }
});
navObserver.observe(document, { subtree: true, childList: true });