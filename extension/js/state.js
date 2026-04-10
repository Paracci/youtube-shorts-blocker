// ─────────────────────────────────────────────────────────────────────────────
// state.js – Global settings flags + storage init + toggle message listener
// Depends on: utils.js (loaded before this file)
// ─────────────────────────────────────────────────────────────────────────────

// ─── Settings State ───────────────────────────────────────────────────────────
let EXTENSION_ENABLED    = true;
let HIDE_SHORTS_HOMEPAGE = true;
let BLOCKING_ENABLED     = true;
let DOWNLOADER_ENABLED   = true;
let AD_BLOCKER_ENABLED   = true;
let QUALITY_LOCK_ENABLED = true;
let AUTO_SKIP_SHORTS_ADS = true;
let IS_PREMIUM           = false;

// Initialise i18n engine (translations.js is loaded before this file)
i18n.init();

// ─── Load persisted settings on startup ──────────────────────────────────────
safeStorageGet(
    ['extensionEnabled', 'hideHomepageShorts', 'blockingEnabled',
     'downloaderEnabled', 'adBlockerEnabled', 'qualityLockEnabled', 'isPremium', 'autoSkipShortsAds'],
    (res) => {
        if (res.extensionEnabled  !== undefined) EXTENSION_ENABLED    = res.extensionEnabled;
        if (res.hideHomepageShorts !== undefined) HIDE_SHORTS_HOMEPAGE = res.hideHomepageShorts;
        if (res.blockingEnabled   !== undefined) BLOCKING_ENABLED     = res.blockingEnabled;
        if (res.downloaderEnabled !== undefined) DOWNLOADER_ENABLED   = res.downloaderEnabled;
        if (res.adBlockerEnabled  !== undefined) AD_BLOCKER_ENABLED   = res.adBlockerEnabled;
        if (res.qualityLockEnabled !== undefined) QUALITY_LOCK_ENABLED = res.qualityLockEnabled;
        if (res.autoSkipShortsAds  !== undefined) AUTO_SKIP_SHORTS_ADS = res.autoSkipShortsAds;
        if (res.isPremium         !== undefined) IS_PREMIUM           = res.isPremium;

        // Force ad-blocker off if Premium is active
        if (IS_PREMIUM) AD_BLOCKER_ENABLED = false;

        // Apply initial state (functions defined in other modules)
        applyHomepageVisibility();
        applyAdBlocker();
        if (typeof applyQualityLock === 'function') applyQualityLock();
    }
);

// ─── Runtime toggle messages from popup ──────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {

    if (msg.action === 'toggle_extension') {
        EXTENSION_ENABLED = msg.enabled;
        // Clean up UI if disabled
        if (!msg.enabled) {
            document.querySelectorAll('.my-block-button, .my-video-dl-btn, .my-dl-btn-shorts').forEach(b => {
                b.style.display = 'none';
            });
        }
        applyAdBlocker();
        applyHomepageVisibility();
        if (typeof applyQualityLock === 'function') applyQualityLock();
        // Re-run optimization check if enabled to re-add buttons
        if (msg.enabled) {
            if (typeof runOptimizationCheck === 'function') runOptimizationCheck();
            if (typeof initVideoDownloadButton === 'function') initVideoDownloadButton();
        }
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
        if (msg.enabled && typeof runOptimizationCheck === 'function') runOptimizationCheck();
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
            if (typeof initVideoDownloadButton === 'function') initVideoDownloadButton();
        }
    }

    if (msg.action === 'toggle_adblocker') {
        AD_BLOCKER_ENABLED = msg.enabled;
        applyAdBlocker();
    }

    if (msg.action === 'toggle_quality_lock') {
        QUALITY_LOCK_ENABLED = msg.enabled;
        if (typeof applyQualityLock === 'function') applyQualityLock();
    }

    if (msg.action === 'toggle_auto_skip_ads') {
        AUTO_SKIP_SHORTS_ADS = msg.enabled;
    }
});

/**
 * Global function called by premium-detector.js
 */
function setPremiumStatus(val) {
    if (IS_PREMIUM === val) return;
    IS_PREMIUM = val;
    if (IS_PREMIUM) {
        AD_BLOCKER_ENABLED = false;
        applyAdBlocker();
    }
}
