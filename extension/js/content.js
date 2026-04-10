// ─────────────────────────────────────────────────────────────────────────────
// content.js – Main entry point, MutationObserver orchestration, and SPA routing
// Depends on: i18n, state.js, all feature modules
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Orchestrates all DOM-dependent features.
 * Debounced to prevent excessive calls during rapid DOM changes.
 */
let debounceTimer = null;
function triggerGlobalOptimization() {
    if (!EXTENSION_ENABLED) return;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        // 1. Channel Blocking & Shorts Download Buttons
        if (typeof runOptimizationCheck === 'function') {
            runOptimizationCheck();
        }

        // 2. Homepage Shorts Hiding
        if (typeof applyHomepageVisibility === 'function') {
            applyHomepageVisibility();
        }

        // 3. Regular Video Download Button
        if (typeof initVideoDownloadButton === 'function') {
            initVideoDownloadButton();
        }
    }, 150);
}

// ─── Centralized MutationObserver ─────────────────────────────────────────────
const globalObserver = new MutationObserver((mutations) => {
    if (!EXTENSION_ENABLED) return;

    // We only trigger if relevant nodes are added or the URL might have changed
    let shouldTrigger = false;
    for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
            shouldTrigger = true;
            break;
        }
    }

    if (shouldTrigger) {
        triggerGlobalOptimization();
    }
});

/**
 * Starts the global orchestration.
 */
function initOrchestrator() {
    // Observe body for structural changes
    globalObserver.observe(document.body, { childList: true, subtree: true });

    // Handle SPA navigation start/end
    document.addEventListener('yt-navigate-finish', () => {
        triggerGlobalOptimization();
    });

    // Initial run
    triggerGlobalOptimization();
}

// Start
initOrchestrator();

// ─── Keyboard Shortcuts ───────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
    // Example: Alt+B to toggle blocking visibility
    if (e.altKey && e.code === 'KeyB') {
        // This is just a placeholder for future dev shortcuts
    }
});
