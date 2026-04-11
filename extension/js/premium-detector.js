// ─────────────────────────────────────────────────────────────────────────────
// js/premium-detector.js – Detects YouTube Premium status
// ─────────────────────────────────────────────────────────────────────────────

(function () {
    const SCRIPT_ID = 'yt-premium-detector-injection';

    /**
     * Injects (or RE-injects) inject.js into the page context.
     * Content scripts cannot access the page's 'window' directly, so we use
     * a script tag. On SPA navigation we REMOVE the old tag first so the
     * IIFE always executes fresh — previously this was skipped because the
     * element still existed, meaning premium was never re-checked after nav.
     */
    function runDetection() {
        if (!window.location.host.includes('youtube.com')) return;

        // ── Remove stale tag so the script actually re-executes ───────────────
        const existing = document.getElementById(SCRIPT_ID);
        if (existing) existing.remove();

        const script = document.createElement('script');
        script.id = SCRIPT_ID;
        script.src = chrome.runtime.getURL('js/inject.js');
        (document.head || document.documentElement).appendChild(script);
    }

    // ── Listen for results from the injected page-context script ─────────────
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (event.data?.type !== 'YT_PREMIUM_STATUS') return;

        const isPremium = event.data.isPremium;

        // inject.js sends null on error — keep whatever is in storage/state.
        if (isPremium === null || isPremium === undefined) return;

        // Persist so popup + future page loads see the latest value.
        chrome.storage.local.set({ isPremium });

        // Update live state (state.js exposes this).
        if (typeof setPremiumStatus === 'function') {
            setPremiumStatus(isPremium);
        }
    });

    // ── Boot ──────────────────────────────────────────────────────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runDetection);
    } else {
        runDetection();
    }

    // Re-run on every YouTube SPA navigation (was broken before — old script
    // element was never removed so inject.js never re-executed).
    document.addEventListener('yt-navigate-finish', runDetection);
})();