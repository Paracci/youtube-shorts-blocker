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
