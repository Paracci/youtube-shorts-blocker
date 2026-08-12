// ─────────────────────────────────────────────────────────────────────────────
// ad-blocker.js – CSS ad hiding + video ad skipper + Shorts ad navigation
// Depends on: utils.js, state.js
// ─────────────────────────────────────────────────────────────────────────────

const AD_BLOCK_STYLE_ID = 'my-yt-ad-blocker-css';
let _adSkipInterval = null;
let _adAttachTimer = null;
let _adClassObserver = null;
let _adMutedByUs = false;
let _adMutedVideo = null;
let _adPlaybackVideo = null;
let _adNavPending = false;
let _adNavTimer = null;
let _adNavResetTimer = null;
let _adMediaRestoreTimer = null;
let _lastAdState = false;
let _originalPlaybackRate = 1;

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
ytd-reel-video-renderer[is-ads-overlay] ytd-reel-player-overlay-renderer,
ytd-reel-video-renderer[my-ad-detected="true"] ytd-reel-player-overlay-renderer,
ytd-reel-video-renderer[is-ads-overlay] .ytp-ad-player-overlay,
ytd-reel-video-renderer[my-ad-detected="true"] .ytp-ad-player-overlay {
    visibility: hidden !important;
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

function _getActiveShortRenderer() {
    const explicit = document.querySelector('ytd-reel-video-renderer[is-active]');
    if (explicit) return explicit;

    const renderers = Array.from(document.querySelectorAll('ytd-reel-video-renderer'));
    if (renderers.length === 1 && !_isHiddenElement(renderers[0])) return renderers[0];

    // Some Shorts versions omit is-active entirely. Pick the visible renderer
    // whose center is closest to the viewport center; this also works while
    // YouTube is recycling the surrounding off-screen renderers.
    const viewportCenter = window.innerHeight / 2;
    let best = null;
    let bestDistance = Infinity;
    for (const renderer of renderers) {
        if (_isHiddenElement(renderer)) continue;
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
    return best;
}

function _isActiveShortRenderer(renderer) {
    if (!renderer) return false;
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

    const adSlot = renderer.querySelector('ytd-ad-slot-renderer');
    if (adSlot && !_isHiddenElement(adSlot)) return true;

    const explicitMarker = renderer.querySelector(
        '.ytp-ad-player-overlay, .ytp-ad-simple-ad-badge, ' +
        '.ytp-ad-skip-button, .ytp-ad-skip-button-modern'
    );
    return !!explicitMarker && !_isHiddenElement(explicitMarker);
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

function _clearShortsAdState() {
    if (_adNavTimer) { clearTimeout(_adNavTimer); _adNavTimer = null; }
    if (_adNavResetTimer) { clearTimeout(_adNavResetTimer); _adNavResetTimer = null; }
    if (_adMediaRestoreTimer) { clearTimeout(_adMediaRestoreTimer); _adMediaRestoreTimer = null; }
    _adNavPending = false;

    document.querySelectorAll('ytd-reel-video-renderer[my-ad-detected="true"]')
        .forEach(renderer => renderer.removeAttribute('my-ad-detected'));
    _restoreAdMedia();
}

// Called by state.js when Shorts automation is disabled or Premium is detected.
function resetShortsAdHandling() {
    _clearShortsAdState();
}

// ─── Instant regular-video ad handler ────────────────────────────────────────
function _onAdStarted() {
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
    _attachAdClassObserver();
    if (_adSkipInterval) return;
    _adSkipInterval = setInterval(_fallbackSkipCheck, 250);
}

function stopAdSkipper() {
    if (_adSkipInterval) { clearInterval(_adSkipInterval); _adSkipInterval = null; }
    if (_adAttachTimer) { clearTimeout(_adAttachTimer); _adAttachTimer = null; }
    if (_adClassObserver) { _adClassObserver.disconnect(); _adClassObserver = null; }
    _lastAdState = false;
    _restoreAdMedia();
}

function _fallbackSkipCheck() {
    if (!AD_BLOCKER_ENABLED || !EXTENSION_ENABLED) return;

    if (_isShortsPage()) {
        const activeRenderer = _getActiveShortRenderer();
        if (activeRenderer) checkForAdAndSkip(activeRenderer);
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
    if (AD_BLOCKER_ENABLED && EXTENSION_ENABLED) {
        injectAdBlockCSS();
        startAdSkipper();
    } else {
        removeAdBlockCSS();
        stopAdSkipper();
        _clearShortsAdState();
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

function _scheduleShortsMediaRestore() {
    if (_adMediaRestoreTimer) clearTimeout(_adMediaRestoreTimer);
    _adMediaRestoreTimer = setTimeout(() => {
        _adMediaRestoreTimer = null;
        const active = _getActiveShortRenderer();
        if (!active || !_hasShortsAdMarker(active)) _restoreAdMedia();
    }, 650);
}

function checkForAdAndSkip(renderer) {
    if (!renderer) return false;

    const enabled = AD_BLOCKER_ENABLED && EXTENSION_ENABLED &&
        AUTO_SKIP_SHORTS_ADS && !IS_PREMIUM && _isShortsPage();
    if (!enabled) {
        renderer.removeAttribute('my-ad-detected');
        return false;
    }

    const isAd = _hasShortsAdMarker(renderer);
    if (!isAd) {
        renderer.removeAttribute('my-ad-detected');
        if (_adMutedByUs) _scheduleShortsMediaRestore();
        return false;
    }

    renderer.setAttribute('my-ad-detected', 'true');
    if (!_isActiveShortRenderer(renderer)) return true;

    const video = renderer.querySelector('video.html5-main-video, video');
    _muteVideoForAd(video);

    if (!_adNavPending) {
        _adNavPending = true;
        _adNavTimer = setTimeout(() => {
            _adNavTimer = null;
            const stillEnabled = AD_BLOCKER_ENABLED && EXTENSION_ENABLED &&
                AUTO_SKIP_SHORTS_ADS && !IS_PREMIUM && _isShortsPage();
            const active = _getActiveShortRenderer() || renderer;

            if (stillEnabled && _hasShortsAdMarker(active)) {
                const navigated = navigateToNextShort();
                if (navigated) {
                    safeStorageGet('adsBlockedCount', (res) => {
                        safeStorageSet({ adsBlockedCount: (res.adsBlockedCount || 0) + 1 });
                    });
                    _scheduleShortsMediaRestore();
                }
            }

            _adNavResetTimer = setTimeout(() => {
                _adNavPending = false;
                _adNavResetTimer = null;
            }, 1200);
        }, 100);
    }

    return true;
}
