document.addEventListener('DOMContentLoaded', () => {
    
    // --- Navigation / Tab Switching Logic ---
    const navItems = document.querySelectorAll('.nav-item');
    const pages = document.querySelectorAll('.page');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            // 1. Remove active state from all buttons
            navItems.forEach(nav => nav.classList.remove('active'));
            // 2. Remove active state from all pages
            pages.forEach(page => page.classList.remove('active'));

            // 3. Add active state to clicked button
            item.classList.add('active');
            
            // 4. Show the corresponding page
            const targetId = item.getAttribute('data-target');
            const targetPage = document.getElementById(targetId);
            if (targetPage) {
                targetPage.classList.add('active');
            }
        });
    });

    // --- Real Logic Integration ---
    const mainToggle = document.getElementById('main-toggle');
    const hideHomepageToggle = document.getElementById('hide-homepage-toggle');
    const statsBlocked = document.getElementById('stats-blocked');
    const statusText = document.getElementById('status-text');
    const btnSetup = document.getElementById('btn-setup');
    const aboutVersion = document.getElementById('about-version');

    // Populate version from manifest
    if (aboutVersion) {
        const manifestData = chrome.runtime.getManifest();
        aboutVersion.textContent = `Version ${manifestData.version}`;
    }

    // Load existing settings and stats
    chrome.storage.local.get(['extensionEnabled', 'hideHomepageShorts', 'blockedCount'], (res) => {
        // Defaults: Enabled=true, hideHomepageShorts=true, count=0
        const isEnabled = res.extensionEnabled !== false; 
        const isHideEnabled = res.hideHomepageShorts !== false;
        const count = res.blockedCount || 0;

        mainToggle.checked = isEnabled;
        hideHomepageToggle.checked = isHideEnabled;

        updateStatusUI(isEnabled);
        
        // Animate counter
        animateValue(statsBlocked, 0, count, 800);
    });

    // Save main toggle
    mainToggle.addEventListener('change', (e) => {
        const isEnabled = e.target.checked;
        chrome.storage.local.set({ extensionEnabled: isEnabled });
        updateStatusUI(isEnabled);
        
        // Broadcast change so open YouTube tabs instantly update
        chrome.tabs.query({ url: "*://*.youtube.com/*" }, (tabs) => {
            tabs.forEach(tab => chrome.tabs.sendMessage(tab.id, { action: "toggle_extension", enabled: isEnabled }));
        });
    });

    // Listen for storage changes while popup is open (e.g. user blocks a channel)
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.blockedCount) {
            const oldVal = changes.blockedCount.oldValue || 0;
            const newVal = changes.blockedCount.newValue || 0;
            animateValue(statsBlocked, oldVal, newVal, 800);
        }
    });

    // Save hide homepage shorts toggle
    hideHomepageToggle.addEventListener('change', (e) => {
        const isHideEnabled = e.target.checked;
        chrome.storage.local.set({ hideHomepageShorts: isHideEnabled });

        // Broadcast change 
        chrome.tabs.query({ url: "*://*.youtube.com/*" }, (tabs) => {
            tabs.forEach(tab => chrome.tabs.sendMessage(tab.id, { action: "toggle_hide_shorts", enabled: isHideEnabled }));
        });
    });

    // Setup btn
    btnSetup.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') });
    });

    function updateStatusUI(isEnabled) {
        if (isEnabled) {
            statusText.textContent = 'Active';
            statusText.style.color = 'var(--accent)';
        } else {
            statusText.textContent = 'Paused';
            statusText.style.color = 'var(--text-muted)';
        }
    }

    // Nice easing animation for the blocked count
    function animateValue(obj, start, end, duration) {
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            // easeOutQuart
            const ease = 1 - Math.pow(1 - progress, 4);
            obj.innerHTML = Math.floor(ease * (end - start) + start);
            if (progress < 1) {
                window.requestAnimationFrame(step);
            } else {
                obj.innerHTML = end;
            }
        };
        window.requestAnimationFrame(step);
    }
});
