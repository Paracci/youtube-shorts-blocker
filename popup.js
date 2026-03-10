document.addEventListener('DOMContentLoaded', () => {

    // ── Navigation ────────────────────────────────────────────────────────
    const navItems = document.querySelectorAll('.nav-item');
    const pages = document.querySelectorAll('.page');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            navItems.forEach(n => n.classList.remove('active'));
            pages.forEach(p => p.classList.remove('active'));
            item.classList.add('active');
            const target = document.getElementById(item.getAttribute('data-target'));
            if (target) target.classList.add('active');
        });
    });

    // ── Element refs ──────────────────────────────────────────────────────
    const mainToggle = document.getElementById('main-toggle');
    const toggleBlocking = document.getElementById('toggle-blocking');
    const toggleHideHome = document.getElementById('hide-homepage-toggle');
    const toggleDownloader = document.getElementById('toggle-downloader');
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    const statBlocked = document.getElementById('stat-blocked');
    const statHidden = document.getElementById('stat-hidden');
    const nativeBadge = document.getElementById('native-badge');
    const btnSetup = document.getElementById('btn-setup');
    const btnReset = document.getElementById('btn-reset');
    const aboutVersion = document.getElementById('about-version');

    // ── Version ───────────────────────────────────────────────────────────
    if (aboutVersion) {
        aboutVersion.textContent = `Version ${chrome.runtime.getManifest().version}`;
    }

    // ── Load settings + stats ─────────────────────────────────────────────
    chrome.storage.local.get([
        'extensionEnabled',
        'blockingEnabled',
        'hideHomepageShorts',
        'downloaderEnabled',
        'blockedCount',
        'hiddenCount'
    ], (res) => {
        const isEnabled = res.extensionEnabled !== false;
        const blocking = res.blockingEnabled !== false;
        const hideHome = res.hideHomepageShorts !== false;
        const downloader = res.downloaderEnabled !== false;
        const blocked = res.blockedCount || 0;
        const hidden = res.hiddenCount || 0;

        mainToggle.checked = isEnabled;
        toggleBlocking.checked = blocking;
        toggleHideHome.checked = hideHome;
        toggleDownloader.checked = downloader;

        updateStatusUI(isEnabled);
        animateValue(statBlocked, 0, blocked, 900);
        animateValue(statHidden, 0, hidden, 900);
    });

    // ── Check native host status ──────────────────────────────────────────
    chrome.runtime.sendMessage({ action: 'check_native_host_status' }, (res) => {
        if (chrome.runtime.lastError || !res || res.status !== 'connected') {
            setNativeBadge(false);
        } else {
            setNativeBadge(true);
        }
    });

    // ── Master toggle ─────────────────────────────────────────────────────
    mainToggle.addEventListener('change', (e) => {
        const enabled = e.target.checked;
        chrome.storage.local.set({ extensionEnabled: enabled });
        updateStatusUI(enabled);
        broadcastToYT({ action: 'toggle_extension', enabled });
    });

    // ── Blocking toggle ───────────────────────────────────────────────────
    toggleBlocking.addEventListener('change', (e) => {
        chrome.storage.local.set({ blockingEnabled: e.target.checked });
        broadcastToYT({ action: 'toggle_blocking', enabled: e.target.checked });
    });

    // ── Hide homepage toggle ──────────────────────────────────────────────
    toggleHideHome.addEventListener('change', (e) => {
        chrome.storage.local.set({ hideHomepageShorts: e.target.checked });
        broadcastToYT({ action: 'toggle_hide_shorts', enabled: e.target.checked });
    });

    // ── Downloader toggle ─────────────────────────────────────────────────
    toggleDownloader.addEventListener('change', (e) => {
        chrome.storage.local.set({ downloaderEnabled: e.target.checked });
        broadcastToYT({ action: 'toggle_downloader', enabled: e.target.checked });
    });

    // ── Setup button ──────────────────────────────────────────────────────
    btnSetup.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') });
    });

    // ── Reset stats ───────────────────────────────────────────────────────
    btnReset.addEventListener('click', () => {
        chrome.storage.local.set({ blockedCount: 0, hiddenCount: 0 }, () => {
            statBlocked.textContent = '0';
            statHidden.textContent = '0';
        });
    });

    // ── Live stat updates ─────────────────────────────────────────────────
    chrome.storage.onChanged.addListener((changes, ns) => {
        if (ns !== 'local') return;
        if (changes.blockedCount) {
            animateValue(statBlocked,
                changes.blockedCount.oldValue || 0,
                changes.blockedCount.newValue || 0, 700);
        }
        if (changes.hiddenCount) {
            animateValue(statHidden,
                changes.hiddenCount.oldValue || 0,
                changes.hiddenCount.newValue || 0, 700);
        }
    });

    // ── Helpers ───────────────────────────────────────────────────────────
    function updateStatusUI(enabled) {
        if (enabled) {
            statusDot.classList.remove('inactive');
            statusText.classList.remove('inactive');
            statusText.textContent = 'Active';
        } else {
            statusDot.classList.add('inactive');
            statusText.classList.add('inactive');
            statusText.textContent = 'Paused';
        }
    }

    function setNativeBadge(connected) {
        if (!nativeBadge) return;
        if (connected) {
            nativeBadge.textContent = 'Connected';
            nativeBadge.classList.remove('inactive');
        } else {
            nativeBadge.textContent = 'Not installed';
            nativeBadge.classList.add('inactive');
        }
    }

    function broadcastToYT(message) {
        chrome.tabs.query({ url: '*://*.youtube.com/*' }, (tabs) => {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, message).catch(() => { });
            });
        });
    }

    function animateValue(el, start, end, duration) {
        if (!el) return;
        let startTs = null;
        const step = (ts) => {
            if (!startTs) startTs = ts;
            const p = Math.min((ts - startTs) / duration, 1);
            const ease = 1 - Math.pow(1 - p, 4);
            el.textContent = Math.floor(ease * (end - start) + start);
            if (p < 1) requestAnimationFrame(step);
            else el.textContent = end;
        };
        requestAnimationFrame(step);
    }
});