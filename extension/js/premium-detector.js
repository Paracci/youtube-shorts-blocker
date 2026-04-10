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
        script.textContent = `
            (function() {
                function check() {
                    try {
                        // Method 1: ytcfg (Most reliable internal flag)
                        let isPremium = !!(window.ytcfg?.get('EXPERIMENT_FLAGS')?.is_premium);

                        // Method 2: ytInitialData (Fallback)
                        if (!isPremium && window.ytInitialData) {
                            const header = window.ytInitialData.topbar?.desktopTopbarRenderer?.accountButtons?.[0]
                                ?.topbarMenuButtonRenderer?.menu?.multiPageMenuRenderer?.header
                                ?.activeAccountHeaderRenderer;
                            if (header && header.isPremium) isPremium = true;
                        }

                        // Method 3: Logo check (Visual fallback)
                        if (!isPremium) {
                            const logo = document.querySelector('ytd-topbar-logo-renderer');
                            if (logo && (logo.getAttribute('icon-type') === 'PREMIUM_LOGO' || logo.iconType === 'PREMIUM_LOGO')) {
                                isPremium = true;
                            }
                        }

                        window.postMessage({ type: 'YT_PREMIUM_STATUS', isPremium }, '*');
                    } catch (e) {}
                }
                
                // Check multiple times as YT loads data dynamically
                check();
                setTimeout(check, 2000);
                setTimeout(check, 5000);
            })();
        `;
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
