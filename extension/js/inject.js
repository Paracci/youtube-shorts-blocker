(function () {
    // ── Re-entrant guard: if already injected, just re-run the check ──────────
    // premium-detector.js removes the old <script> tag before re-injecting on
    // SPA navigation, so this IIFE always runs fresh. The guard below prevents
    // the extremely rare case where the script fires twice on the same document.
    if (window.__ytPremiumDetectorRunning) return;
    window.__ytPremiumDetectorRunning = true;
    setTimeout(() => { window.__ytPremiumDetectorRunning = false; }, 6000);

    function check() {
        try {
            let isPremium = false;

            if (window.ytcfg && typeof window.ytcfg.get === 'function') {
                const flags = window.ytcfg.get('EXPERIMENT_FLAGS') || {};

                // ── Signal 1: Primary flag (confirmed on real Premium account) ─
                if (flags['PremiumClientSharedConfig__enable_att_for_get_download_action_on_web_client'] === true) {
                    isPremium = true;
                }

                // ── Signal 2: Count of PremiumClientSharedConfig__ keys ────────
                // Free accounts have zero; Premium accounts have several.
                if (!isPremium) {
                    const premiumKeyCount = Object.keys(flags).filter(k =>
                        k.startsWith('PremiumClientSharedConfig__')
                    ).length;
                    if (premiumKeyCount >= 2) isPremium = true;
                }

                // ── Signal 3: ytcfg top-level Premium fields ───────────────────
                if (!isPremium) {
                    const isYTPremium = window.ytcfg.get('IS_YT_PREMIUM');
                    if (isYTPremium === true || isYTPremium === 1) isPremium = true;
                }

                // ── Signal 4: LOGGED_IN + purchase data in ytInitialData ───────
                if (!isPremium && window.ytInitialData) {
                    try {
                        const header = window.ytInitialData?.header;
                        const badge = JSON.stringify(header || '');
                        if (badge.includes('premium') || badge.includes('Premium')) {
                            isPremium = true;
                        }
                    } catch (_) { }
                }

                // ── Signal 5: DOM badge (most visible signal, last resort) ──────
                if (!isPremium) {
                    const badgeEl = document.querySelector(
                        '#avatar-btn [aria-label*="Premium"], ' +
                        'ytd-topbar-menu-button-renderer [aria-label*="Premium"], ' +
                        '.ytd-premium-membership-banner-renderer'
                    );
                    if (badgeEl) isPremium = true;
                }
            }

            window.postMessage({ type: 'YT_PREMIUM_STATUS', isPremium }, '*');
        } catch (e) {
            // On error, do NOT assume non-premium — send null so state.js keeps
            // its cached value rather than overwriting it with false.
            window.postMessage({ type: 'YT_PREMIUM_STATUS', isPremium: null }, '*');
        }
    }

    // Run immediately, then after YouTube's JS settles
    check();
    setTimeout(check, 1500);
    setTimeout(check, 4000);
})();