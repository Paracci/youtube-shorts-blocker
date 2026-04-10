// ─────────────────────────────────────────────────────────────────────────────
// ad-blocker.js – CSS ad hiding + video ad skipper + Shorts feed ad navigation
// Depends on: utils.js, state.js
// ─────────────────────────────────────────────────────────────────────────────

const AD_BLOCK_STYLE_ID = 'my-yt-ad-blocker-css';
let _adSkipInterval = null;
let _adClassObserver = null;   // MutationObserver: watches #movie_player class changes
let _adMutedByUs = false;  // track whether WE muted the video
let _adNavPending = false;  // debounce: prevent double-skip in Shorts feed
let _lastAdState = false;  // track ad presence for counter
let _originalPlaybackRate = 1; // backup to restore after 16x ad speedup

// ─── CSS that hides YouTube's ad elements ────────────────────────────────────
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

/* ── Main Ad Module – use opacity instead of display:none to prevent buffering lag ── */
.video-ads.ytp-ad-module { 
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

// ─── Instant ad handler (called by MutationObserver, ~0ms delay) ─────────────
function _onAdStarted() {
    if (!AD_BLOCKER_ENABLED || !EXTENSION_ENABLED) return;

    // Strict Check: Only proceed if an ad class is actually present right now
    const adActive = document.querySelector('.ad-showing, .ytp-ad-player-overlay, .ytp-ad-simple-ad-badge');
    if (!adActive) return;

    const player = document.querySelector('.html5-main-video, video.html5-main-video');
    if (!player) return;

    // 1. Instant speed boost + counter
    if (!_lastAdState) {
        _lastAdState = true;
        _originalPlaybackRate = player.playbackRate || 1;
        safeStorageGet('adsBlockedCount', (res) => {
            safeStorageSet({ adsBlockedCount: (res.adsBlockedCount || 0) + 1 });
        });
    }

    // Force 16x speed and mute immediately
    if (player.playbackRate !== 16) player.playbackRate = 16;
    if (!player.muted) { player.muted = true; _adMutedByUs = true; }

    // 2. Click skip button if already visible
    const skipBtn = document.querySelector(
        '.ytp-skip-ad-button:not([style*="display: none"]), ' +
        '.ytp-ad-skip-button:not([style*="display: none"]), ' +
        '.ytp-skip-ad-button-modern:not([style*="display: none"]), ' +
        '.ytp-ad-skip-button-modern:not([style*="display: none"])'
    );
    if (skipBtn) { skipBtn.click(); }

    // 3. Aggressive seeking to force finish
    const seekToEnd = () => {
        // Final verification: don't seek if we transitioned to main video
        const stillAd = document.querySelector('.ad-showing, .ytp-ad-player-overlay');
        if (!stillAd) return;

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
            // Verify we are still in ad mode when metadata arrived
            const stillAdAtMeta = document.querySelector('.ad-showing, .ytp-ad-player-overlay');
            if (stillAdAtMeta) seekToEnd();
        }, { once: true });
    }
}

function _onAdEnded() {
    _lastAdState = false;
    const player = document.querySelector('.html5-main-video, video.html5-main-video');
    if (player) {
        // Restore speed
        if (player.playbackRate === 16) {
            player.playbackRate = _originalPlaybackRate;
        }
        // Restore audio
        if (_adMutedByUs) {
            player.muted = false;
            _adMutedByUs = false;
            if (player.paused) player.play().catch(() => { });
        }
    }
}

// ─── MutationObserver: attaches to #movie_player and watches class changes ───
// Fires in <1ms when YouTube adds/removes the "ad-showing" class, replacing
// the old 700ms setInterval approach that caused the visible black-screen delay.
function _attachAdClassObserver() {
    const playerEl = document.querySelector('#movie_player, .html5-video-player');
    if (!playerEl) {
        // Player not in DOM yet (SPA navigation in progress) – retry shortly
        setTimeout(_attachAdClassObserver, 400);
        return;
    }

    // Already observing the same element — nothing to do
    if (_adClassObserver && _adClassObserver._el === playerEl) return;

    if (_adClassObserver) { _adClassObserver.disconnect(); }

    let _wasAdShowing = playerEl.classList.contains('ad-showing');

    _adClassObserver = new MutationObserver(() => {
        if (!AD_BLOCKER_ENABLED || !EXTENSION_ENABLED) return;
        const isAdShowing = playerEl.classList.contains('ad-showing');
        if (isAdShowing && !_wasAdShowing) {
            _wasAdShowing = true;
            _onAdStarted();
        } else if (!isAdShowing && _wasAdShowing) {
            _wasAdShowing = false;
            _onAdEnded();
        } else if (isAdShowing) {
            // Ad still active (e.g. skip button just appeared) — keep trying
            _onAdStarted();
        }
    });

    _adClassObserver._el = playerEl; // tag so we can detect player element changes
    _adClassObserver.observe(playerEl, {
        attributes: true,
        attributeFilter: ['class']
    });
}

// ─── Fallback interval (safety net for edge cases & skip-button polling) ─────
// Kept at a faster 250ms (was 700ms) purely as a safety net.
// The MutationObserver above handles the real work instantly.
function startAdSkipper() {
    // Always (re-)attach the class observer — important after SPA navigations
    _attachAdClassObserver();

    if (_adSkipInterval) return;
    _adSkipInterval = setInterval(_fallbackSkipCheck, 250);
}

function stopAdSkipper() {
    if (_adSkipInterval) { clearInterval(_adSkipInterval); _adSkipInterval = null; }
    if (_adClassObserver) { _adClassObserver.disconnect(); _adClassObserver = null; }
}

function _fallbackSkipCheck() {
    if (!AD_BLOCKER_ENABLED || !EXTENSION_ENABLED) return;

    // Re-attach observer if player element changed after SPA navigation
    const playerEl = document.querySelector('#movie_player, .html5-video-player');
    if (playerEl && _adClassObserver && _adClassObserver._el !== playerEl) {
        _attachAdClassObserver();
    }

    const adActive = document.querySelector(
        '.ad-showing, .ytp-ad-player-overlay, .ytp-ad-simple-ad-badge'
    );

    if (adActive) {
        _onAdStarted();
    } else if (_lastAdState) {
        _onAdEnded();
    }
}

// ─── Master toggle ────────────────────────────────────────────────────────────
function applyAdBlocker() {
    if (AD_BLOCKER_ENABLED && EXTENSION_ENABLED) {
        injectAdBlockCSS();
        startAdSkipper();
    } else {
        removeAdBlockCSS();
        stopAdSkipper();
        if (_adMutedByUs) {
            const video = document.querySelector('.html5-main-video, video.html5-main-video');
            if (video && video.muted) video.muted = false;
            _adMutedByUs = false;
        }
    }
}

// ─── Shorts feed ad navigation ────────────────────────────────────────────────
function navigateToNextShort() {
    const nextBtn = document.querySelector(
        'ytd-reel-video-renderer[is-active] .navigation-button.next-button button, ' +
        '#navigation-button-down button, ' +
        'ytd-shorts [aria-label*="ext"] button, ' +
        '.ytd-shorts-player-controls button[aria-label*="ext"]'
    );
    if (nextBtn) { nextBtn.click(); return; }

    document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowDown', code: 'ArrowDown', keyCode: 40,
        bubbles: true, cancelable: true
    }));
}

function checkForAdAndSkip(renderer) {
    if (!AD_BLOCKER_ENABLED || !EXTENSION_ENABLED || !AUTO_SKIP_SHORTS_ADS) return false;

    const isAd = renderer.querySelector('ytd-ad-slot-renderer') ||
        renderer.tagName.toLowerCase().includes('ad-slot');
    if (!isAd) return false;

    const video = renderer.querySelector('video');
    if (video && !video.muted) { video.muted = true; _adMutedByUs = true; }

    if (!_adNavPending) {
        _adNavPending = true;
        setTimeout(() => {
            _adMutedByUs = false;
            navigateToNextShort();
            safeStorageGet('adsBlockedCount', (res) => {
                safeStorageSet({ adsBlockedCount: (res.adsBlockedCount || 0) + 1 });
            });
            setTimeout(() => { _adNavPending = false; }, 1500);
        }, 80);
    }

    return true;
}