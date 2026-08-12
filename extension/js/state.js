// ─────────────────────────────────────────────────────────────────────────────
// state.js – Global settings flags + storage init + toggle message listener
// Depends on: utils.js (loaded before this file)
// ─────────────────────────────────────────────────────────────────────────────

let EXTENSION_ENABLED = true;
let HIDE_SHORTS_HOMEPAGE = true;
let BLOCKING_ENABLED = true;
let DOWNLOADER_ENABLED = true;

// Keep the user's preference separate from the effective runtime state. Ad
// features remain off until the live Premium detector confirms the account is
// not Premium; an old/missing cache must never enable them by itself.
let AD_BLOCKER_PREFERENCE = true;
let AUTO_SKIP_SHORTS_PREFERENCE = true;
let AD_BLOCKER_ENABLED = false;
let AUTO_SKIP_SHORTS_ADS = false;
let IS_PREMIUM = null;
let _awaitingPremiumCheck = true;

function hideInjectedControls() {
    document.querySelectorAll('.my-block-button, .my-video-dl-btn, .my-dl-btn-shorts')
        .forEach(button => { button.style.display = 'none'; });
}

i18n.init();

safeStorageGet(
    ['extensionEnabled', 'hideHomepageShorts', 'blockingEnabled',
        'downloaderEnabled', 'adBlockerEnabled', 'isPremium', 'autoSkipShortsAds'],
    (res) => {
        if (res.extensionEnabled !== undefined) EXTENSION_ENABLED = res.extensionEnabled;
        if (res.hideHomepageShorts !== undefined) HIDE_SHORTS_HOMEPAGE = res.hideHomepageShorts;
        if (res.blockingEnabled !== undefined) BLOCKING_ENABLED = res.blockingEnabled;
        if (res.downloaderEnabled !== undefined) DOWNLOADER_ENABLED = res.downloaderEnabled;

        AD_BLOCKER_PREFERENCE = res.adBlockerEnabled !== false;
        AUTO_SKIP_SHORTS_PREFERENCE = res.autoSkipShortsAds !== false;

        // Cached true is useful for immediate safety, but cached false is not
        // trusted as a live entitlement result. Both paths await fresh status.
        IS_PREMIUM = res.isPremium === true ? true : null;
        AD_BLOCKER_ENABLED = false;
        AUTO_SKIP_SHORTS_ADS = false;

        if (typeof applyHomepageVisibility === 'function') applyHomepageVisibility();
        if (typeof applyAdBlocker === 'function') applyAdBlocker();
        if (!EXTENSION_ENABLED) hideInjectedControls();
    }
);

// Safety timeout is deliberately fail-closed. If YouTube does not answer,
// ad-related automation stays disabled until a fresh boolean result arrives.
setTimeout(() => {
    if (!_awaitingPremiumCheck) return;
    console.warn('[ShortsBlocker] Premium status is unknown; ad features remain disabled.');
}, 6000);

// ─── Popup → content-script toggle messages ───────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'toggle_extension') {
        EXTENSION_ENABLED = !!msg.enabled;
        if (!EXTENSION_ENABLED) hideInjectedControls();
        if (typeof applyAdBlocker === 'function') applyAdBlocker();
        if (typeof applyHomepageVisibility === 'function') applyHomepageVisibility();
        if (msg.enabled) {
            if (typeof runOptimizationCheck === 'function') runOptimizationCheck();
            if (typeof initVideoDownloadButton === 'function') initVideoDownloadButton();
        }
    }

    if (msg.action === 'toggle_hide_shorts') {
        HIDE_SHORTS_HOMEPAGE = !!msg.enabled;
        if (typeof applyHomepageVisibility === 'function') applyHomepageVisibility();
    }

    if (msg.action === 'toggle_blocking') {
        BLOCKING_ENABLED = !!msg.enabled;
        document.querySelectorAll('.my-block-button').forEach(button => {
            if (!button.classList.contains('my-dl-btn-shorts')) {
                button.style.display = msg.enabled && EXTENSION_ENABLED ? '' : 'none';
            }
        });
        if (!msg.enabled && typeof clearShortRendererObservers === 'function') {
            clearShortRendererObservers();
        }
        if (msg.enabled && typeof runOptimizationCheck === 'function') runOptimizationCheck();
    }

    if (msg.action === 'toggle_downloader') {
        DOWNLOADER_ENABLED = !!msg.enabled;
        document.querySelectorAll('.my-dl-btn-shorts').forEach(button => {
            button.style.display = msg.enabled && EXTENSION_ENABLED ? '' : 'none';
        });
        const videoDlBtn = document.querySelector('.my-video-dl-btn');
        if (videoDlBtn) videoDlBtn.style.display = msg.enabled && EXTENSION_ENABLED ? '' : 'none';
        if (msg.enabled && EXTENSION_ENABLED && typeof runOptimizationCheck === 'function') {
            runOptimizationCheck();
        }
        if (msg.enabled && EXTENSION_ENABLED && typeof initVideoDownloadButton === 'function') {
            initVideoDownloadButton();
        }
    }

    if (msg.action === 'toggle_adblocker') {
        AD_BLOCKER_PREFERENCE = !!msg.enabled;
        safeStorageSet({ adBlockerEnabled: AD_BLOCKER_PREFERENCE });
        AD_BLOCKER_ENABLED = IS_PREMIUM === false ? AD_BLOCKER_PREFERENCE : false;
        if (typeof applyAdBlocker === 'function') applyAdBlocker();
    }

    if (msg.action === 'toggle_auto_skip_shorts') {
        AUTO_SKIP_SHORTS_PREFERENCE = !!msg.enabled;
        safeStorageSet({ autoSkipShortsAds: AUTO_SKIP_SHORTS_PREFERENCE });
        AUTO_SKIP_SHORTS_ADS = IS_PREMIUM === false ? AUTO_SKIP_SHORTS_PREFERENCE : false;
        if (!AUTO_SKIP_SHORTS_ADS && typeof resetShortsAdHandling === 'function') {
            resetShortsAdHandling();
        }
    }
});

// Called before each initial/SPA Premium detection. The previous page's free
// result is not valid for the new route, so ad automation is paused while the
// fresh page-context script evaluates the current account state.
function beginPremiumCheck() {
    IS_PREMIUM = null;
    _awaitingPremiumCheck = true;
    AD_BLOCKER_ENABLED = false;
    AUTO_SKIP_SHORTS_ADS = false;
    if (typeof resetShortsAdHandling === 'function') resetShortsAdHandling();
    if (typeof applyAdBlocker === 'function') applyAdBlocker();
}

// ─── Live Premium result from premium-detector.js ─────────────────────────────
function setPremiumStatus(val) {
    if (typeof val !== 'boolean') return;

    const changed = IS_PREMIUM !== val || _awaitingPremiumCheck;
    IS_PREMIUM = val;
    _awaitingPremiumCheck = false;

    AD_BLOCKER_ENABLED = val ? false : AD_BLOCKER_PREFERENCE;
    AUTO_SKIP_SHORTS_ADS = val ? false : AUTO_SKIP_SHORTS_PREFERENCE;

    if (val && typeof resetShortsAdHandling === 'function') resetShortsAdHandling();
    if (changed && typeof applyAdBlocker === 'function') applyAdBlocker();
}
