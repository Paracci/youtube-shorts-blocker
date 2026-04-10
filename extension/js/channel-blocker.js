// ─────────────────────────────────────────────────────────────────────────────
// channel-blocker.js – Block button UI, channel extractors, Shorts feed loop,
//                      quality-lock helper, and IntersectionObserver
// Depends on: utils.js, state.js, ad-blocker.js, notifications.js
// ─────────────────────────────────────────────────────────────────────────────

// ─── Quality lock ─────────────────────────────────────────────────────────────
function forceHighestQuality() {
    if (!QUALITY_LOCK_ENABLED || !EXTENSION_ENABLED) return;
    const player = document.getElementById('movie_player') ||
        document.querySelector('.html5-video-player');
    if (player && typeof player.setPlaybackQualityRange === 'function') {
        player.setPlaybackQualityRange('hd2160');
    }
}

// ─── Intersection Observer (lazy-check visible Shorts) ───────────────────────
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

// ─── Video fingerprint (detects renderer reuse) ───────────────────────────────
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

// ─── Shorts feed loop ────────────────────────────────────────────────────────
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

// ─── Channel name & ID extractors ────────────────────────────────────────────
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
        const channelId   = extractChannelId(videoContext);

        const menuBtn = videoContext.querySelector('ytd-menu-renderer button') ||
            Array.from(videoContext.querySelectorAll('button')).find(b => {
                const l = b.getAttribute('aria-label');
                return l && (l.includes('More actions') || l.includes('Diğer') || l.includes('işlemler'));
            });

        if (!menuBtn) { resetButtonToDefault(btn); return; }

        // Hide the native popup visually so the user never sees it flash
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
