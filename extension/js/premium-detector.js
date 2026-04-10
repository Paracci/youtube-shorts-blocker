// ─────────────────────────────────────────────────────────────────────────────
// js/premium-detector.js – Detects YouTube Premium status
// ─────────────────────────────────────────────────────────────────────────────

(function () {
    /**
     * Injects a script to read YouTube's internal configuration from the page context.
     * Content scripts cannot access the 'window' object of the page directly.
     */
    function runDetection() {
        // We only need to run this if we are on a YouTube page
        if (!window.location.host.includes('youtube.com')) return;

        const scriptId = 'yt-premium-detector-injection';
        if (document.getElementById(scriptId)) return;

        const script = document.createElement('script');
        script.id = scriptId;
        script.src = chrome.runtime.getURL('js/inject.js');
        (document.head || document.documentElement).appendChild(script);
    }

    // Listen for the result from the injected script
    window.addEventListener('message', (event) => {
        if (event.source !== window || event.data?.type !== 'YT_PREMIUM_STATUS') return;

        const isPremium = event.data.isPremium;
        
        // Save to storage so popup can see it
        chrome.storage.local.set({ isPremium: isPremium });

        // Update global state if state.js is loaded
        if (typeof setPremiumStatus === 'function') {
            setPremiumStatus(isPremium);
        }
    });

    // Initialize detection
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runDetection);
    } else {
        runDetection();
    }
    
    // Re-run on SPA navigation
    document.addEventListener('yt-navigate-finish', runDetection);
})();
