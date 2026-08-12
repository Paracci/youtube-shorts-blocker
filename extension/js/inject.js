(function () {
    const script = document.currentScript;
    let nonce = '';
    try {
        nonce = new URL(script?.src || '', window.location.href).searchParams.get('nonce') || '';
    } catch (_) { }
    if (!nonce) return;

    // A newer navigation invalidates all older injected scripts. Old timers
    // still wake up, but they stop before reading or posting stale results.
    window.__ytPremiumDetectorNonce = nonce;

    function isCurrent() {
        return window.__ytPremiumDetectorNonce === nonce;
    }

    function post(isPremium) {
        if (isCurrent()) window.postMessage({
            type: 'YT_PREMIUM_STATUS',
            nonce,
            isPremium
        }, window.location.origin);
    }

    function detect() {
        if (!isCurrent()) return;

        try {
            let result = null;
            const ytcfg = window.ytcfg;
            const get = ytcfg && typeof ytcfg.get === 'function' ? ytcfg.get.bind(ytcfg) : null;

            if (get) {
                const explicitPremium = get('IS_YT_PREMIUM');
                if (explicitPremium === true || explicitPremium === 1) result = true;
                else if (explicitPremium === false || explicitPremium === 0) result = false;

                const flags = get('EXPERIMENT_FLAGS') || {};
                const premiumFlag = flags.PremiumClientSharedConfig__enable_att_for_get_download_action_on_web_client;
                if (premiumFlag === true) result = true;

                // A logged-out account cannot have a Premium entitlement.
                if (result === null && get('LOGGED_IN') === false) result = false;

                // Positive-only fallbacks may confirm Premium, but never claim
                // that a missing/ambiguous badge means a free account.
                if (result !== true && window.ytInitialData) {
                    const headerText = JSON.stringify(window.ytInitialData.header || '');
                    if (/premium.{0,80}(account|member|subscription)|member.{0,80}premium/i.test(headerText)) {
                        result = true;
                    }
                }
            }

            if (result !== true) {
                const badge = document.querySelector(
                    '#avatar-btn [aria-label*="Premium" i], ' +
                    'ytd-topbar-menu-button-renderer [aria-label*="Premium" i], ' +
                    '.ytd-premium-membership-banner-renderer'
                );
                if (badge && !badge.closest('[hidden]')) result = true;
            }

            // null means unknown. The content script will remain fail-closed.
            post(result);
        } catch (_) {
            post(null);
        }
    }

    detect();
    setTimeout(detect, 1500);
    setTimeout(detect, 4000);
})();
