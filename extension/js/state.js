// ─────────────────────────────────────────────────────────────────────────────
// state.js – Global settings flags + storage init + toggle message listener
// Depends on: utils.js (loaded before this file)
// ─────────────────────────────────────────────────────────────────────────────

let EXTENSION_ENABLED = true;
let HIDE_SHORTS_HOMEPAGE = true;
let BLOCKING_ENABLED = true;
let DOWNLOADER_ENABLED = true;
let AD_BLOCKER_ENABLED = true;
let QUALITY_LOCK_ENABLED = true;
let AUTO_SKIP_SHORTS_ADS = true;
let IS_PREMIUM = false;

// ── Race-condition guard ──────────────────────────────────────────────────────
// When 'isPremium' has never been stored (first install) we cannot trust the
// default false value. We hold off activating the ad-blocker until the live
// detection result arrives (or a 6 s safety timeout expires).
// On subsequent loads the cached value is available immediately, so
// _awaitingPremiumCheck stays false and behaviour is unchanged.
let _awaitingPremiumCheck = false;

i18n.init();

safeStorageGet(
    ['extensionEnabled', 'hideHomepageShorts', 'blockingEnabled',
        'downloaderEnabled', 'adBlockerEnabled', 'qualityLockEnabled',
        'isPremium', 'autoSkipShortsAds'],
    (res) => {
        if (res.extensionEnabled !== undefined) EXTENSION_ENABLED = res.extensionEnabled;
        if (res.hideHomepageShorts !== undefined) HIDE_SHORTS_HOMEPAGE = res.hideHomepageShorts;
        if (res.blockingEnabled !== undefined) BLOCKING_ENABLED = res.blockingEnabled;
        if (res.downloaderEnabled !== undefined) DOWNLOADER_ENABLED = res.downloaderEnabled;
        if (res.adBlockerEnabled !== undefined) AD_BLOCKER_ENABLED = res.adBlockerEnabled;
        if (res.qualityLockEnabled !== undefined) QUALITY_LOCK_ENABLED = res.qualityLockEnabled;
        if (res.autoSkipShortsAds !== undefined) AUTO_SKIP_SHORTS_ADS = res.autoSkipShortsAds;

        if (res.isPremium !== undefined) {
            // Cached value exists — use it immediately (fast path).
            IS_PREMIUM = res.isPremium;
        } else {
            // First install: isPremium was never stored.
            // Hold the ad-blocker until inject.js reports back (≤ 4 s).
            // We default IS_PREMIUM = false but we do NOT call applyAdBlocker
            // yet — the safety timeout below will unblock it if detection
            // never fires (e.g. user is on a non-video page at install time).
            _awaitingPremiumCheck = true;
        }

        // Premium users: force ad-related features off regardless of saved settings.
        if (IS_PREMIUM) {
            AD_BLOCKER_ENABLED = false;
            AUTO_SKIP_SHORTS_ADS = false;
        }

        applyHomepageVisibility();

        if (!_awaitingPremiumCheck) {
            // Normal path — cached premium status available, safe to start.
            applyAdBlocker();
        }
        // else: applyAdBlocker() will be called inside setPremiumStatus() or
        // the safety timeout below, whichever comes first.

        if (typeof applyQualityLock === 'function') applyQualityLock();
    }
);

// Safety timeout: if inject.js hasn't reported back within 6 s (e.g. slow
// connection, non-YouTube page at install time), unblock the ad-blocker
// assuming non-premium so legitimate free users are not penalised.
setTimeout(() => {
    if (!_awaitingPremiumCheck) return;   // already resolved — nothing to do
    _awaitingPremiumCheck = false;
    applyAdBlocker();
}, 6000);

// ─────────────────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {

    if (msg.action === 'toggle_extension') {
        EXTENSION_ENABLED = msg.enabled;
        if (!msg.enabled) {
            document.querySelectorAll('.my-block-button, .my-video-dl-btn, .my-dl-btn-shorts')
                .forEach(b => { b.style.display = 'none'; });
        }
        applyAdBlocker();
        applyHomepageVisibility();
        if (typeof applyQualityLock === 'function') applyQualityLock();
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
        // Guard: never re-enable ad-blocking for a confirmed Premium subscriber.
        if (IS_PREMIUM && msg.enabled) return;
        AD_BLOCKER_ENABLED = msg.enabled;
        applyAdBlocker();
    }

    if (msg.action === 'toggle_quality_lock') {
        QUALITY_LOCK_ENABLED = msg.enabled;
        if (typeof applyQualityLock === 'function') applyQualityLock();
    }

    // Fixed message name: popup sends 'toggle_auto_skip_shorts' (not 'toggle_auto_skip_ads').
    if (msg.action === 'toggle_auto_skip_shorts') {
        if (IS_PREMIUM && msg.enabled) return;
        AUTO_SKIP_SHORTS_ADS = msg.enabled;
    }
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Called by premium-detector.js whenever the live detection result arrives.
 * Safe to call multiple times — bails early if status hasn't changed.
 */
function setPremiumStatus(val) {
    // Resolve the first-install hold regardless of value.
    const wasAwaiting = _awaitingPremiumCheck;
    _awaitingPremiumCheck = false;

    if (IS_PREMIUM === val && !wasAwaiting) return; // no change, nothing to do

    IS_PREMIUM = val;

    if (IS_PREMIUM) {
        AD_BLOCKER_ENABLED = false;
        AUTO_SKIP_SHORTS_ADS = false;
    }

    // Always call applyAdBlocker here:
    // • wasAwaiting=true  → first time we have a confirmed answer, start now.
    // • IS_PREMIUM changed → need to enable/disable immediately.
    applyAdBlocker();
}