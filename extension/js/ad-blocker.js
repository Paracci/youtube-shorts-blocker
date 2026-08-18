// ─────────────────────────────────────────────────────────────────────────────
// ad-blocker.js – CSS ad hiding + video ad skipper + Shorts ad navigation
// Depends on: utils.js, state.js, shorts-transition.js
// ─────────────────────────────────────────────────────────────────────────────

const adBlockerDeveloperLogger = typeof DeveloperLogger !== 'undefined'
    ? DeveloperLogger.create('content', 'ad-blocker')
    : null;

const AD_BLOCK_STYLE_ID = 'my-yt-ad-blocker-css';
let _adSkipInterval = null;
let _adAttachTimer = null;
let _adClassObserver = null;
let _adMutedByUs = false;
let _adMutedVideo = null;
let _adPlaybackVideo = null;
let _lastAdState = false;
let _originalPlaybackRate = 1;
let _shortsAdMediaState = null;
let _shortsAdObserver = null;
let _shortsAdObserverRoot = null;
let _shortsAdScanTimer = null;
let _shortsAdNavigationListenerAttached = false;
let _shortsAdPlaybackRecovery = null;
const _shortsAdActionStates = new WeakMap();
const SHORTS_AD_PLAYBACK_RECOVERY_DELAYS = Object.freeze([0, 80, 180, 360, 720, 1400]);

// ─── CSS that hides YouTube's ad elements ────────────────────────────────────
// Do not hide the entire Shorts player. YouTube recycles that renderer; hiding
// #player-container can leave the next normal Short frozen inside a hidden node.
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

/* ── Ad sidebar (engagement panel on right side) ───────────── */
ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"],
ytd-engagement-panel-section-list-renderer[target-id*="ads"],
ytd-ad-slot-renderer[is-desktop-sticky-video],
#related ytd-ad-slot-renderer { display: none !important; }

/* ── Main Ad Module – opacity avoids player layout churn ───── */
.video-ads.ytp-ad-module {
    opacity: 0 !important;
    pointer-events: none !important;
}

/* ── Confirmed Shorts ad overlays only ─────────────────────── */
ytd-reel-video-renderer[is-ads-overlay] .ytp-ad-player-overlay,
ytd-reel-video-renderer[my-ad-detected="true"] .ytp-ad-player-overlay {
    visibility: hidden !important;
    pointer-events: none !important;
}

/* Keep the renderer in the DOM while YouTube recycles the player. */
ytd-reel-video-renderer.my-shorts-excluded--active {
    display: block !important;
}

/* Hide media only while the confirmed ad renderer is the active player. Once
 * YouTube recycles it or the user scrolls back, the video must be visible
 * again; a stale renderer-wide rule can freeze the next Short permanently. */
ytd-reel-video-renderer.my-shorts-excluded--active[my-ad-detected="true"] video,
ytd-reel-video-renderer.my-shorts-excluded--active[my-ad-detected="true"] .ytp-ad-player-overlay,
ytd-reel-video-renderer.my-shorts-excluded--active[my-ad-detected="true"] .ytp-ad-overlay-container,
ytd-reel-video-renderer.my-shorts-excluded--active[my-ad-detected="true"] .ytp-ad-image-overlay,
ytd-reel-video-renderer.my-shorts-excluded--active[my-ad-detected="true"] .ytp-ad-text-overlay {
    visibility: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
}
`;

// ─── CSS injection ────────────────────────────────────────────────────────────
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

function _isShortsPage() {
    return window.location.pathname.startsWith('/shorts/');
}

function _isShortsAdAutomationEnabled() {
    return AD_BLOCKER_ENABLED && EXTENSION_ENABLED &&
        AUTO_SKIP_SHORTS_ADS && !IS_PREMIUM && _isShortsPage();
}

function _isHiddenElement(el) {
    if (!el) return true;
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return true;

    const inlineStyle = el.getAttribute('style') || '';
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(inlineStyle)) return true;

    try {
        const style = getComputedStyle(el);
        return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
    } catch (_) {
        return false;
    }
}

function _isShortsTransitionRenderer(renderer) {
    return !!renderer?.classList?.contains('my-shorts-excluded--active') ||
        !!renderer?.classList?.contains('my-channel-filtered--active');
}

function _getActiveShortRenderer() {
    const explicit = document.querySelector('ytd-reel-video-renderer[is-active]');
    if (explicit) return explicit;

    const renderers = Array.from(document.querySelectorAll('ytd-reel-video-renderer'));
    const transitionRenderer = renderers.find(_isShortsTransitionRenderer) || null;
    if (renderers.length === 1 &&
        (!_isHiddenElement(renderers[0]) || _isShortsTransitionRenderer(renderers[0]))) {
        return renderers[0];
    }

    // Some Shorts versions omit is-active entirely. Pick the visible renderer
    // whose center is closest to the viewport center; this also works while
    // YouTube is recycling the surrounding off-screen renderers.
    const viewportCenter = window.innerHeight / 2;
    let best = null;
    let bestDistance = Infinity;
    for (const renderer of renderers) {
        if (_isHiddenElement(renderer) && !_isShortsTransitionRenderer(renderer)) continue;
        try {
            const rect = renderer.getBoundingClientRect();
            if (rect.width <= 0 || rect.height < Math.max(300, window.innerHeight * 0.4)) continue;
            const distance = Math.abs((rect.top + rect.bottom) / 2 - viewportCenter);
            if (distance < bestDistance) {
                best = renderer;
                bestDistance = distance;
            }
        } catch (_) { }
    }
    return best || transitionRenderer;
}

function _isActiveShortRenderer(renderer) {
    if (!renderer) return false;
    if (_isShortsTransitionRenderer(renderer)) {
        if (renderer.hasAttribute('is-active')) return true;
        const active = _getActiveShortRenderer();
        return !active || active === renderer;
    }
    if (renderer.hasAttribute('is-active')) return true;

    const active = _getActiveShortRenderer();
    if (active) return active === renderer;

    // Some YouTube layouts temporarily omit is-active while the player is
    // visible. Use geometry only as a fallback; never use renderer id parsing.
    try {
        const rect = renderer.getBoundingClientRect();
        return rect.height > Math.max(400, window.innerHeight * 0.5) &&
            rect.width > 0 && !_isHiddenElement(renderer);
    } catch (_) {
        return false;
    }
}

// Only use explicit YouTube ad markers. Generic CTA/product labels are not
// sufficient: normal Shorts can contain sponsored-looking UI elements too.
function _hasShortsAdMarker(renderer) {
    if (!renderer) return false;
    if (renderer.hasAttribute('is-ads-overlay')) return true;
    if (renderer.matches && renderer.matches('.ad-showing')) return true;

    const player = renderer.querySelector('.html5-video-player, #shorts-player');
    if (player && player.classList.contains('ad-showing')) return true;

    const explicitMarker = renderer.querySelector(
        '.ytp-ad-player-overlay, .ytp-ad-simple-ad-badge, ' +
        '.ytp-ad-skip-button, .ytp-ad-skip-button-modern'
    );
    return !!explicitMarker && !_isHiddenElement(explicitMarker);
}

function _getShortsRendererFingerprint(renderer) {
    if (!renderer) return '';

    // Prefer the channel filter's normalized key so an ad and a local channel
    // exclusion on the same renderer share exactly one transition state.
    if (typeof getChannelFilterVideoKey === 'function') {
        try {
            const filterKey = getChannelFilterVideoKey(renderer);
            if (filterKey) return String(filterKey);
        } catch (_) { }
    }

    if (typeof getVideoFingerprint === 'function') {
        try {
            const fingerprint = getVideoFingerprint(renderer);
            if (fingerprint) {
                const value = String(fingerprint);
                if (value.startsWith('/shorts/')) {
                    const id = value.split('/')[2];
                    if (id) return `id:${id}`;
                }
                return value;
            }
        } catch (_) { }
    }

    const dataVideoId = renderer.getAttribute?.('data-video-id');
    if (dataVideoId) return `id:${dataVideoId}`;

    const link = renderer.querySelector?.('a[href*="/shorts/"], a[href*="/watch"]');
    const href = link?.getAttribute?.('href') || '';
    if (href) {
        try {
            const url = new URL(href, window.location.origin);
            const id = url.pathname.startsWith('/shorts/')
                ? url.pathname.split('/')[2]
                : url.searchParams.get('v');
            if (id) return `id:${id}`;
        } catch (_) { }
    }

    return '';
}

function _muteVideoForAd(video) {
    if (!video || video.muted) return;
    video.muted = true;
    _adMutedByUs = true;
    _adMutedVideo = video;
}

function _restoreAdMedia() {
    if (_adPlaybackVideo && _adPlaybackVideo.playbackRate === 16) {
        _adPlaybackVideo.playbackRate = _originalPlaybackRate;
    }

    if (_adMutedByUs && _adMutedVideo && _adMutedVideo.muted) {
        _adMutedVideo.muted = false;
    }

    _adMutedByUs = false;
    _adMutedVideo = null;
    _adPlaybackVideo = null;
    _originalPlaybackRate = 1;
}

function _restoreShortsAdMedia(state = _shortsAdMediaState) {
    if (!state) return;

    const video = state.video;
    // YouTube recycles the same video element for the next Short. If the ad
    // was playing before the skip, that recycled element can arrive paused;
    // resume it even though the extension itself never called pause().
    if (state.resumeAfterAd && video && video.paused && video.isConnected !== false) {
        try {
            const playResult = video.play?.();
            playResult?.catch?.(() => {});
        } catch (_) { }
    }

    if (state.mutedByUs && video && video.muted) video.muted = false;
    if (_shortsAdMediaState === state) _shortsAdMediaState = null;
}

function _finishShortsPlaybackRecovery(recovery) {
    if (!recovery || _shortsAdPlaybackRecovery !== recovery) return;
    if (recovery.timer !== null) clearTimeout(recovery.timer);
    recovery.timer = null;
    _shortsAdPlaybackRecovery = null;

    if (recovery.mediaState && _shortsAdMediaState === recovery.mediaState) {
        _restoreShortsAdMedia(recovery.mediaState);
    }
}

function _cancelShortsPlaybackRecovery() {
    const recovery = _shortsAdPlaybackRecovery;
    if (!recovery) return;
    if (recovery.timer !== null) clearTimeout(recovery.timer);
    recovery.timer = null;
    _shortsAdPlaybackRecovery = null;

    if (recovery.mediaState && _shortsAdMediaState === recovery.mediaState) {
        recovery.mediaState.resumeAfterAd = false;
        _restoreShortsAdMedia(recovery.mediaState);
    }
}

function _getShortsPlaybackRecoveryRenderer(recovery) {
    const isCandidate = renderer => {
        if (!renderer || _hasShortsAdMarker(renderer)) return false;
        if (renderer === recovery.renderer) {
            const fingerprint = _getShortsRendererFingerprint(renderer);
            if (fingerprint && fingerprint === recovery.fingerprint) return false;
        }
        return true;
    };

    const active = _getActiveShortRenderer();
    if (isCandidate(active)) return active;

    return Array.from(document.querySelectorAll('ytd-reel-video-renderer'))
        .find(renderer => isCandidate(renderer) && !_isHiddenElement(renderer)) || null;
}

function _runShortsPlaybackRecovery(recovery) {
    if (!recovery || _shortsAdPlaybackRecovery !== recovery || recovery.timer !== null) return;
    if (!_isShortsAdAutomationEnabled() && !recovery.allowWhileAutomationDisabled) {
        _cancelShortsPlaybackRecovery();
        return;
    }

    const renderer = _getShortsPlaybackRecoveryRenderer(recovery);
    const video = renderer?.querySelector?.('video.html5-main-video, video');
    if (video && video.isConnected !== false) {
        if (!video.paused) {
            _finishShortsPlaybackRecovery(recovery);
            return;
        }
        try {
            const playResult = video.play?.();
            playResult?.catch?.(() => {});
        } catch (_) { }
        if (!video.paused) {
            _finishShortsPlaybackRecovery(recovery);
            return;
        }
    }

    const delay = SHORTS_AD_PLAYBACK_RECOVERY_DELAYS[recovery.attempt++];
    if (delay === undefined) {
        _finishShortsPlaybackRecovery(recovery);
        return;
    }
    recovery.timer = setTimeout(() => {
        recovery.timer = null;
        _runShortsPlaybackRecovery(recovery);
    }, delay);
}

function _scheduleShortsPlaybackRecovery(renderer, fingerprint, mediaState) {
    if (!_isShortsAdAutomationEnabled()) return;
    _cancelShortsPlaybackRecovery();
    const recovery = {
        renderer,
        fingerprint,
        mediaState,
        attempt: 0,
        timer: null,
        allowWhileAutomationDisabled: false
    };
    _shortsAdPlaybackRecovery = recovery;
    _runShortsPlaybackRecovery(recovery);
}

function _prepareShortsAdMedia(renderer, fingerprint) {
    const current = _shortsAdMediaState;
    if (current && (current.renderer !== renderer || current.fingerprint !== fingerprint)) {
        _restoreShortsAdMedia(current);
    }

    const video = renderer?.querySelector?.('video.html5-main-video, video');
    if (!video) return;
    if (_shortsAdMediaState && _shortsAdMediaState.renderer === renderer &&
        _shortsAdMediaState.fingerprint === fingerprint &&
        _shortsAdMediaState.video === video) return;

    const state = {
        renderer,
        fingerprint,
        video,
        mutedByUs: false,
        resumeAfterAd: video.paused === false
    };
    if (!video.muted) {
        video.muted = true;
        state.mutedByUs = true;
    }
    // Do not pause the recycled Shorts player. Proven YouTube ad skippers let
    // the ad player continue while they click/seek it to its end; pausing the
    // active renderer is what leaves a blank Short permanently stuck.
    _shortsAdMediaState = state;
}

function _markShortsAdRenderer(renderer, fingerprint, active) {
    renderer.classList?.add('my-shorts-excluded');
    renderer.setAttribute('my-ad-detected', 'true');
    renderer.setAttribute('data-my-short-excluded', 'ad');
    renderer.setAttribute('data-my-short-excluded-fingerprint', fingerprint);
    if (active) renderer.classList?.add('my-shorts-excluded--active');
    else renderer.classList?.remove('my-shorts-excluded--active');
}

function _getShortsAdPlayer(renderer) {
    if (!renderer) return null;
    const players = [
        ...renderer.querySelectorAll?.('.html5-video-player, #shorts-player') || [],
        renderer
    ];
    return players.find(player =>
        player?.classList?.contains('ad-showing') ||
        player?.querySelector?.('.ad-showing, .ytp-ad-player-overlay, .ytp-ad-skip-button, .ytp-ad-skip-button-modern')
    ) || players.find(player => player?.classList?.contains('html5-video-player')) || null;
}

function _getShortsAdVideo(renderer, player = _getShortsAdPlayer(renderer)) {
    return player?.querySelector?.('video.html5-main-video, video') ||
        renderer?.querySelector?.('video.html5-main-video, video') || null;
}

function _getShortsAdSkipButton(renderer, player = _getShortsAdPlayer(renderer)) {
    const selectors = [
        '.ytp-ad-skip-button:not([hidden])',
        '.ytp-skip-ad-button:not([hidden])',
        '.ytp-ad-skip-button-modern:not([hidden])',
        '.ytp-skip-ad-button-modern:not([hidden])'
    ];

    for (const selector of selectors) {
        const button = player?.querySelector?.(selector) || renderer?.querySelector?.(selector);
        if (button && !button.disabled && !_isHiddenElement(button)) return button;
    }
    return null;
}

function _getShortsAdActionState(renderer, fingerprint) {
    let state = _shortsAdActionStates.get(renderer);
    if (state && state.fingerprint === fingerprint) return state;

    if (state?.fallbackTimer) clearTimeout(state.fallbackTimer);
    state = {
        fingerprint,
        actionAttempted: false,
        counted: false,
        fallbackTimer: null,
        releaseTimer: null,
        fallbackNavigated: false
    };
    _shortsAdActionStates.set(renderer, state);
    return state;
}

function _scheduleShortsAdFallback(renderer, fingerprint, state) {
    if (!state || state.fallbackTimer !== null) return;

    state.fallbackTimer = setTimeout(() => {
        state.fallbackTimer = null;
        if (!_isShortsAdAutomationEnabled() ||
            _getShortsRendererFingerprint(renderer) !== fingerprint ||
            !_isActiveShortRenderer(renderer) ||
            !_hasShortsAdMarker(renderer) ||
            state.fallbackNavigated) return;

        state.fallbackNavigated = true;
        try {
            const navigated = navigateToNextShort();
            if (navigated && !state.counted && typeof safeStorageGet === 'function' &&
                typeof safeStorageSet === 'function') {
                state.counted = true;
                safeStorageGet('adsBlockedCount', (res) => {
                    safeStorageSet({ adsBlockedCount: (res.adsBlockedCount || 0) + 1 });
                });
            }
            if (navigated) {
                const mediaState = _shortsAdMediaState?.renderer === renderer &&
                    _shortsAdMediaState.fingerprint === fingerprint
                    ? _shortsAdMediaState
                    : null;
                _scheduleShortsPlaybackRecovery(renderer, fingerprint, mediaState);
                state.releaseTimer = setTimeout(() => {
                    state.releaseTimer = null;
                    if (_shortsAdActionStates.get(renderer) !== state) return;
                    if (_getShortsRendererFingerprint(renderer) === fingerprint) {
                        _clearShortsAdRenderer(renderer);
                    }
                }, 1200);
            }
        } catch (_) { }
    }, 800);
}

function _attemptShortsAdSkip(renderer, fingerprint) {
    const state = _getShortsAdActionState(renderer, fingerprint);
    if (state.actionAttempted) return state;
    state.actionAttempted = true;

    const player = _getShortsAdPlayer(renderer);
    const video = _getShortsAdVideo(renderer, player);
    const skipButton = _getShortsAdSkipButton(renderer, player);
    const playerHasAdMarker = renderer.hasAttribute?.('is-ads-overlay') ||
        player?.classList?.contains('ad-showing') ||
        !!player?.querySelector?.(
            '.ad-showing, .ytp-ad-player-overlay, .ytp-ad-skip-button, .ytp-ad-skip-button-modern'
        );
    let actionSucceeded = false;

    if (video && !video.muted) {
        video.muted = true;
        if (_shortsAdMediaState?.renderer === renderer) _shortsAdMediaState.mutedByUs = true;
    }

    if (skipButton) {
        try {
            skipButton.click();
            actionSucceeded = true;
        } catch (_) { }
    } else if (video && playerHasAdMarker) {
        try {
            if (Number.isFinite(video.duration) && video.duration > 0) {
                video.currentTime = video.duration;
            } else {
                // Some ad players expose no duration until metadata settles.
                // A finite sentinel is the same fallback used by established
                // YouTube userscripts and avoids pausing the player.
                video.currentTime = 9999;
            }
            if (video.paused) {
                if (_shortsAdMediaState?.renderer === renderer) {
                    _shortsAdMediaState.resumeAfterAd = true;
                }
                video.play?.()?.catch?.(() => {});
            }
            actionSucceeded = true;
        } catch (_) { }
    }

    if (actionSucceeded && typeof safeStorageGet === 'function' &&
        typeof safeStorageSet === 'function') {
        state.counted = true;
        safeStorageGet('adsBlockedCount', (res) => {
            safeStorageSet({ adsBlockedCount: (res.adsBlockedCount || 0) + 1 });
        });
    }

    if (actionSucceeded) {
        const mediaState = _shortsAdMediaState?.renderer === renderer &&
            _shortsAdMediaState.fingerprint === fingerprint
            ? _shortsAdMediaState
            : null;
        _scheduleShortsPlaybackRecovery(renderer, fingerprint, mediaState);
    }

    // If YouTube does not honor the skip/seek operation, use one bounded
    // Shorts next action as a last resort. The observer will release the
    // renderer as soon as the ad marker disappears or the fingerprint changes.
    _scheduleShortsAdFallback(renderer, fingerprint, state);
    return state;
}

function _clearShortsAdRenderer(renderer) {
    if (!renderer) return;
    const fingerprint = renderer.getAttribute?.('data-my-short-excluded-fingerprint') ||
        _getShortsRendererFingerprint(renderer);
    const actionState = _shortsAdActionStates.get(renderer);
    if (actionState?.fallbackTimer) clearTimeout(actionState.fallbackTimer);
    if (actionState?.releaseTimer) clearTimeout(actionState.releaseTimer);
    _shortsAdActionStates.delete(renderer);
    if (typeof releaseShortsInvisibleTransitionReason === 'function') {
        releaseShortsInvisibleTransitionReason(renderer, fingerprint, 'ad');
    }

    if (renderer.getAttribute?.('data-my-short-excluded') === 'ad' ||
        renderer.hasAttribute?.('my-ad-detected')) {
        renderer.classList?.remove('my-shorts-excluded', 'my-shorts-excluded--active');
        renderer.removeAttribute('my-ad-detected');
        renderer.removeAttribute('data-my-short-excluded');
        renderer.removeAttribute('data-my-short-excluded-fingerprint');
    }

    if (_shortsAdMediaState && _shortsAdMediaState.renderer === renderer) {
        // A recycled renderer may have already received a new fingerprint by
        // the time its old ad marker is removed. Restore only the media state
        // that belongs to the state being cleared.
        if (_shortsAdMediaState.fingerprint === fingerprint ||
            _shortsAdMediaState.fingerprint !== _getShortsRendererFingerprint(renderer)) {
            _restoreShortsAdMedia();
        }
    }
}

function _clearShortsAdState(options = {}) {
    const preservePlaybackRecovery = options.preservePlaybackRecovery === true;
    if (preservePlaybackRecovery && _shortsAdPlaybackRecovery) {
        _shortsAdPlaybackRecovery.allowWhileAutomationDisabled = true;
    }
    if (!_isShortsAdAutomationEnabled()) _disconnectShortsAdObserver();
    if (typeof document.querySelectorAll === 'function') {
        document.querySelectorAll(
            'ytd-reel-video-renderer[my-ad-detected="true"], ' +
            'ytd-reel-video-renderer[data-my-short-excluded="ad"]'
        ).forEach(_clearShortsAdRenderer);
    }
    if (_shortsAdMediaState) _restoreShortsAdMedia();
    if (!preservePlaybackRecovery) _cancelShortsPlaybackRecovery();
    if (typeof reevaluateShortsInvisibleTransitions === 'function') {
        reevaluateShortsInvisibleTransitions();
    }
}

function _disconnectShortsAdObserver() {
    if (_shortsAdScanTimer) {
        clearTimeout(_shortsAdScanTimer);
        _shortsAdScanTimer = null;
    }
    if (_shortsAdObserver) _shortsAdObserver.disconnect();
    _shortsAdObserver = null;
    _shortsAdObserverRoot = null;
}

function _scanShortsAdRenderers() {
    _shortsAdScanTimer = null;
    if (!_isShortsAdAutomationEnabled()) return;

    document.querySelectorAll('ytd-reel-video-renderer').forEach(renderer => {
        const hasMarker = _hasShortsAdMarker(renderer);
        const isMarked = renderer.hasAttribute?.('my-ad-detected') ||
            renderer.getAttribute?.('data-my-short-excluded') === 'ad';
        if (hasMarker || isMarked) checkForAdAndSkip(renderer);
    });
}

function _scheduleShortsAdScan() {
    if (!_isShortsAdAutomationEnabled() || _shortsAdScanTimer) return;
    _shortsAdScanTimer = setTimeout(_scanShortsAdRenderers, 40);
}

function _attachShortsAdObserver() {
    if (!_isShortsAdAutomationEnabled() || typeof MutationObserver !== 'function') return;

    const root = document.body || document.documentElement;
    if (!root) return;
    if (_shortsAdObserver && _shortsAdObserverRoot === root) {
        _scheduleShortsAdScan();
        return;
    }

    _disconnectShortsAdObserver();
    _shortsAdObserverRoot = root;
    _shortsAdObserver = new MutationObserver(() => {
        _scheduleShortsAdScan();
    });
    _shortsAdObserver.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
            'class', 'is-ads-overlay', 'data-video-id', 'href', 'hidden', 'aria-hidden'
        ]
    });
    _scheduleShortsAdScan();
}

function _syncShortsAdObserverForNavigation() {
    if (!_isShortsPage()) {
        _disconnectShortsAdObserver();
        _clearShortsAdState();
        if (AD_BLOCKER_ENABLED && EXTENSION_ENABLED) {
            _attachAdClassObserver();
            if (!_adSkipInterval) _adSkipInterval = setInterval(_fallbackSkipCheck, 250);
        }
        return;
    }
    if (_adSkipInterval) {
        clearInterval(_adSkipInterval);
        _adSkipInterval = null;
    }
    if (AD_BLOCKER_ENABLED && EXTENSION_ENABLED) _attachShortsAdObserver();
}

function _installShortsAdNavigationListener() {
    if (_shortsAdNavigationListenerAttached || typeof document === 'undefined') return;
    _shortsAdNavigationListenerAttached = true;
    document.addEventListener('yt-navigate-finish', () => {
        _syncShortsAdObserverForNavigation();
        if (_shortsAdPlaybackRecovery) _runShortsPlaybackRecovery(_shortsAdPlaybackRecovery);
    });
}

// Called by state.js when Shorts automation is disabled or Premium is detected.
function resetShortsAdHandling() {
    const options = arguments[0] || {};
    _clearShortsAdState(options);
}

// ─── Instant regular-video ad handler ────────────────────────────────────────
function _onAdStarted() {
    adBlockerDeveloperLogger?.info('ads.started', 'Ad playback marker detected.');
    if (!AD_BLOCKER_ENABLED || !EXTENSION_ENABLED || _isShortsPage()) return;

    const playerEl = document.querySelector('#movie_player, .html5-video-player');
    const adActive = playerEl && playerEl.classList.contains('ad-showing');
    if (!adActive) return;

    const player = document.querySelector('.html5-main-video, video.html5-main-video');
    if (!player) return;

    if (!_lastAdState) {
        _lastAdState = true;
        _originalPlaybackRate = player.playbackRate || 1;
        safeStorageGet('adsBlockedCount', (res) => {
            safeStorageSet({ adsBlockedCount: (res.adsBlockedCount || 0) + 1 });
        });
    }

    _adPlaybackVideo = player;
    if (player.playbackRate !== 16) player.playbackRate = 16;
    _muteVideoForAd(player);

    const skipBtn = playerEl.querySelector(
        '.ytp-skip-ad-button:not([hidden]), ' +
        '.ytp-ad-skip-button:not([hidden]), ' +
        '.ytp-skip-ad-button-modern:not([hidden]), ' +
        '.ytp-ad-skip-button-modern:not([hidden])'
    );
    if (skipBtn && !_isHiddenElement(skipBtn)) skipBtn.click();

    const seekToEnd = () => {
        if (!playerEl.classList.contains('ad-showing')) return;
        if (isFinite(player.duration) && player.duration > 0 &&
            player.currentTime < player.duration - 0.1) {
            player.currentTime = player.duration;
        }
    };

    if (isFinite(player.duration) && player.duration > 0) {
        seekToEnd();
    } else {
        player.addEventListener('loadedmetadata', function onMeta() {
            player.removeEventListener('loadedmetadata', onMeta);
            seekToEnd();
        }, { once: true });
    }
}

function _onAdEnded() {
    adBlockerDeveloperLogger?.info('ads.ended', 'Ad playback marker cleared.');
    _lastAdState = false;
    _restoreAdMedia();
}

// ─── MutationObserver: watches regular player class changes ──────────────────
function _attachAdClassObserver() {
    if (!AD_BLOCKER_ENABLED || !EXTENSION_ENABLED || _isShortsPage()) return;

    const playerEl = document.querySelector('#movie_player, .html5-video-player');
    if (!playerEl) {
        if (!_adAttachTimer) {
            _adAttachTimer = setTimeout(() => {
                _adAttachTimer = null;
                _attachAdClassObserver();
            }, 400);
        }
        return;
    }

    if (_adClassObserver && _adClassObserver._el === playerEl) return;
    if (_adClassObserver) _adClassObserver.disconnect();

    let wasAdShowing = playerEl.classList.contains('ad-showing');
    _adClassObserver = new MutationObserver(() => {
        if (!AD_BLOCKER_ENABLED || !EXTENSION_ENABLED) return;
        const isAdShowing = playerEl.classList.contains('ad-showing');
        if (isAdShowing && !wasAdShowing) {
            wasAdShowing = true;
            _onAdStarted();
        } else if (!isAdShowing && wasAdShowing) {
            wasAdShowing = false;
            _onAdEnded();
        } else if (isAdShowing) {
            _onAdStarted();
        }
    });

    _adClassObserver._el = playerEl;
    _adClassObserver.observe(playerEl, { attributes: true, attributeFilter: ['class'] });
    if (wasAdShowing) _onAdStarted();
}

// ─── Fallback interval ───────────────────────────────────────────────────────
function startAdSkipper() {
    if (!AD_BLOCKER_ENABLED || !EXTENSION_ENABLED) return;
    _installShortsAdNavigationListener();
    if (_isShortsPage()) {
        if (_adSkipInterval) {
            clearInterval(_adSkipInterval);
            _adSkipInterval = null;
        }
        _attachShortsAdObserver();
        return;
    }
    _attachAdClassObserver();
    if (_adSkipInterval) return;
    _adSkipInterval = setInterval(_fallbackSkipCheck, 250);
}

function stopAdSkipper() {
    if (_adSkipInterval) { clearInterval(_adSkipInterval); _adSkipInterval = null; }
    if (_adAttachTimer) { clearTimeout(_adAttachTimer); _adAttachTimer = null; }
    if (_adClassObserver) { _adClassObserver.disconnect(); _adClassObserver = null; }
    _disconnectShortsAdObserver();
    _lastAdState = false;
    _restoreAdMedia();
}

function _fallbackSkipCheck() {
    if (!AD_BLOCKER_ENABLED || !EXTENSION_ENABLED) return;

    if (_isShortsPage()) {
        _attachShortsAdObserver();
        _scheduleShortsAdScan();
        return;
    }

    const playerEl = document.querySelector('#movie_player, .html5-video-player');
    if (playerEl && (!_adClassObserver || _adClassObserver._el !== playerEl)) {
        _attachAdClassObserver();
    }

    const adActive = playerEl && playerEl.classList.contains('ad-showing');
    if (adActive) _onAdStarted();
    else if (_lastAdState) _onAdEnded();
}

// ─── Master toggle ────────────────────────────────────────────────────────────
function applyAdBlocker() {
    const options = arguments[0] || {};
    const preservePlaybackRecovery = options.preservePlaybackRecovery === true;
    if (AD_BLOCKER_ENABLED && EXTENSION_ENABLED) {
        injectAdBlockCSS();
        startAdSkipper();
    } else {
        removeAdBlockCSS();
        stopAdSkipper();
        _clearShortsAdState({ preservePlaybackRecovery });
    }
}

// ─── Shorts feed navigation ──────────────────────────────────────────────────
function navigateToNextShort() {
    const selectors = [
        'ytd-reel-video-renderer[is-active] .navigation-button.next-button button',
        '#navigation-button-down button',
        'ytd-shorts button[aria-label*="Next" i]',
        'ytd-shorts button[aria-label*="Sonraki" i]',
        'ytd-shorts button[aria-label*="İleri" i]',
        '.ytd-shorts-player-controls button[aria-label*="Next" i]'
    ];

    for (const selector of selectors) {
        const button = document.querySelector(selector);
        if (button && !button.disabled && !_isHiddenElement(button)) {
            button.click();
            return true;
        }
    }

    const target = _getActiveShortRenderer() || document;
    target.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowDown', code: 'ArrowDown', keyCode: 40,
        bubbles: true, cancelable: true
    }));
    return true;
}

function checkForAdAndSkip(renderer) {
    if (!renderer) return false;

    const enabled = _isShortsAdAutomationEnabled();
    const fingerprint = _getShortsRendererFingerprint(renderer);
    if (!enabled) {
        _clearShortsAdRenderer(renderer);
        return false;
    }

    const previousFingerprint = renderer.getAttribute?.('data-my-short-excluded-fingerprint');
    if (previousFingerprint && fingerprint && previousFingerprint !== fingerprint) {
        // YouTube recycles the same renderer for the next Short. Release all
        // ad classes/media state before inspecting the new video; otherwise a
        // stale overlay can make the new Short look like the old ad and freeze
        // the player below it.
        _clearShortsAdRenderer(renderer);
        return false;
    }

    const isAd = _hasShortsAdMarker(renderer);
    if (!isAd || !fingerprint) {
        _clearShortsAdRenderer(renderer);
        return false;
    }

    const active = _isActiveShortRenderer(renderer);
    _markShortsAdRenderer(renderer, fingerprint, active);
    if (!active) return true;

    _prepareShortsAdMedia(renderer, fingerprint);
    _attemptShortsAdSkip(renderer, fingerprint);

    return true;
}
