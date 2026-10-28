// ─────────────────────────────────────────────────────────────────────────────
// premium-detector.js – Live YouTube Premium status bridge
// ─────────────────────────────────────────────────────────────────────────────

(function () {
    const MESSAGE_TYPE = 'YT_PREMIUM_STATUS';
    const premiumDeveloperLogger = typeof DeveloperLogger !== 'undefined'
        ? DeveloperLogger.create('content', 'premium-detector')
        : null;
    let currentNonce = '';

    function createNonce() {
        try {
            const bytes = new Uint8Array(16);
            crypto.getRandomValues(bytes);
            return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
        } catch (_) {
            return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        }
    }

    function runDetection() {
        if (!chrome.runtime?.id) return;
        const hostname = window.location.hostname;
        if (hostname !== 'youtube.com' && !hostname.endsWith('.youtube.com')) return;

        if (typeof beginPremiumCheck === 'function') beginPremiumCheck();
        premiumDeveloperLogger?.debug('premium.bridge_started', 'Starting page-context Premium detection.');

        currentNonce = createNonce();
        try {
            window.postMessage({ type: 'YT_PREMIUM_CHECK', nonce: currentNonce }, window.location.origin);
        } catch (_) {
            premiumDeveloperLogger?.error('premium.bridge_injection_failed', 'Could not inject Premium detector script.');
            // An invalidated extension context leaves Premium status unknown;
            // state.js intentionally keeps ad automation disabled in that case.
        }
    }

    window.addEventListener('message', (event) => {
        if (event.source !== window || event.origin !== window.location.origin) return;
        const data = event.data;
        if (!data || data.type !== MESSAGE_TYPE || data.nonce !== currentNonce) return;
        if (typeof data.isPremium !== 'boolean') return;

        premiumDeveloperLogger?.info('premium.bridge_result', `Page-context Premium result: ${data.isPremium}.`);

        if (chrome.runtime?.id) chrome.storage.local.set({ isPremium: data.isPremium });
        if (typeof setPremiumStatus === 'function') setPremiumStatus(data.isPremium);
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runDetection, { once: true });
    } else {
        runDetection();
    }

    document.addEventListener('yt-navigate-finish', runDetection);
})();
