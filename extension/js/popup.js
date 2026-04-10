document.addEventListener('DOMContentLoaded', async () => {

    // ── i18n — initialise FIRST, before touching any DOM text ────────────────
    await i18n.init();
    i18n.applyToDOM();

    // ── Navigation ────────────────────────────────────────────────────────────
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

    // ── Element refs ──────────────────────────────────────────────────────────
    const mainToggle = document.getElementById('main-toggle');
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    const toggleBlocking = document.getElementById('toggle-blocking');
    const toggleHideHome = document.getElementById('hide-homepage-toggle');
    const toggleDownloader = document.getElementById('toggle-downloader');
    const premiumNotice = document.getElementById('premium-notice');
    const statBlocked = document.getElementById('stat-blocked');
    const statHidden = document.getElementById('stat-hidden');
    const statAds = document.getElementById('stat-ads');
    const toggleAdblocker = document.getElementById('toggle-adblocker');
    const toggleQualityLock = document.getElementById('toggle-quality-lock');
    const toggleAutoSkipShorts = document.getElementById('toggle-auto-skip-shorts');
    const langSelect = document.getElementById('lang-select');
    const nativeBadge = document.getElementById('native-badge');
    const btnSetup = document.getElementById('btn-setup');
    const btnReset = document.getElementById('btn-reset');
    const aboutVersion = document.getElementById('about-version');

    // ── Version ───────────────────────────────────────────────────────────────
    if (aboutVersion) {
        aboutVersion.textContent = `Version ${chrome.runtime.getManifest().version}`;
    }

    // ── Load settings + stats ─────────────────────────────────────────────────
    chrome.storage.local.get([
        'extensionEnabled',
        'blockingEnabled',
        'hideHomepageShorts',
        'downloaderEnabled',
        'userLang',
        'blockedCount',
        'hiddenCount',
        'adsBlockedCount',
        'blockedChannels',
        'downloadPath'
    ], (res) => {
        const isEnabled = res.extensionEnabled !== false;
        const blocking = res.blockingEnabled !== false;
        const hideHome = res.hideHomepageShorts !== false;
        const downloader = res.downloaderEnabled !== false;
        const adBlocker = res.adBlockerEnabled !== false;
        const qualityLock = res.qualityLockEnabled !== false;
        const autoSkipShorts = res.autoSkipShortsAds !== false;
        const isPremium = res.isPremium === true;
        const blocked = (res.blockedChannels || []).length || res.blockedCount || 0;
        const hidden = res.hiddenCount || 0;

        mainToggle.checked = isEnabled;
        toggleBlocking.checked = blocking;
        toggleHideHome.checked = hideHome;
        toggleDownloader.checked = downloader;

        if (toggleAdblocker) {
            if (isPremium) {
                toggleAdblocker.checked = false;
                toggleAdblocker.disabled = true;
                const container = toggleAdblocker.closest('.toggle-switch');
                if (container) container.classList.add('disabled');
                if (premiumNotice) premiumNotice.style.display = 'flex';
            } else {
                toggleAdblocker.checked = adBlocker;
                toggleAdblocker.disabled = false;
                const container = toggleAdblocker.closest('.toggle-switch');
                if (container) container.classList.remove('disabled');
                if (premiumNotice) premiumNotice.style.display = 'none';
            }
        }
        if (toggleQualityLock) toggleQualityLock.checked = qualityLock;
        if (toggleAutoSkipShorts) toggleAutoSkipShorts.checked = autoSkipShorts;

        // Set language selector to stored value (or 'auto')
        if (langSelect) langSelect.value = res.userLang || 'auto';

        // Set download path display
        const pathDisplay = document.getElementById('path-display');
        const pathDisplayTxt = document.getElementById('path-display-text');
        const btnClearPath = document.getElementById('btn-clear-path');
        if (res.downloadPath) {
            applyPath(res.downloadPath, false);
        }

        updateStatusUI(isEnabled);
        const ads = res.adsBlockedCount || 0;
        animateValue(statBlocked, 0, blocked, 900);
        animateValue(statHidden, 0, hidden, 900);
        animateValue(statAds, 0, ads, 900);

        renderBlocklist(res.blockedChannels || []);
    });

    // ── Check native host status ──────────────────────────────────────────────
    chrome.runtime.sendMessage({ action: 'check_native_host_status' }, (res) => {
        if (chrome.runtime.lastError || !res || res.status !== 'connected') {
            setNativeBadge(false);
        } else {
            setNativeBadge(true);
        }
    });

    // ── Language switcher ─────────────────────────────────────────────────────
    if (langSelect) {
        langSelect.addEventListener('change', async (e) => {
            await i18n.setLang(e.target.value);
            i18n.applyToDOM();

            // Re-render runtime-built parts
            updateStatusUI(mainToggle.checked);
            const isConnected = nativeBadge && !nativeBadge.classList.contains('inactive');
            setNativeBadge(isConnected);

            // Re-render blocklist so "Remove from list" button labels update
            chrome.storage.local.get('blockedChannels', (r) => {
                renderBlocklist(r.blockedChannels || []);
            });

            syncLangSelectLabels();
        });
    }

    // ── Master toggle ─────────────────────────────────────────────────────────
    mainToggle.addEventListener('change', (e) => {
        const enabled = e.target.checked;
        chrome.storage.local.set({ extensionEnabled: enabled });
        updateStatusUI(enabled);
        broadcastToYT({ action: 'toggle_extension', enabled });
    });

    // ── Blocking toggle ───────────────────────────────────────────────────────
    toggleBlocking.addEventListener('change', (e) => {
        chrome.storage.local.set({ blockingEnabled: e.target.checked });
        broadcastToYT({ action: 'toggle_blocking', enabled: e.target.checked });
    });

    // ── Hide homepage toggle ──────────────────────────────────────────────────
    toggleHideHome.addEventListener('change', (e) => {
        chrome.storage.local.set({ hideHomepageShorts: e.target.checked });
        broadcastToYT({ action: 'toggle_hide_shorts', enabled: e.target.checked });
    });

    // ── Downloader toggle ─────────────────────────────────────────────────────
    toggleDownloader.addEventListener('change', (e) => {
        chrome.storage.local.set({ downloaderEnabled: e.target.checked });
        broadcastToYT({ action: 'toggle_downloader', enabled: e.target.checked });
    });

    // ── Ad Blocker toggle ─────────────────────────────────────────────────────
    if (toggleAdblocker) {
        toggleAdblocker.addEventListener('change', (e) => {
            chrome.storage.local.set({ adBlockerEnabled: e.target.checked });
            broadcastToYT({ action: 'toggle_adblocker', enabled: e.target.checked });
        });
    }

    // ── Quality Lock toggle ───────────────────────────────────────────────────
    if (toggleQualityLock) {
        toggleQualityLock.addEventListener('change', () => {
            const enabled = toggleQualityLock.checked;
            chrome.storage.local.set({ qualityLockEnabled: enabled });
            broadcastToYT({ action: 'toggle_quality_lock', enabled });
        });
    }

    if (toggleAutoSkipShorts) {
        toggleAutoSkipShorts.addEventListener('change', () => {
            const enabled = toggleAutoSkipShorts.checked;
            chrome.storage.local.set({ autoSkipShortsAds: enabled });
            broadcastToYT({ action: 'toggle_auto_skip_shorts', enabled });
        });
    }

    // ── Download path picker ──────────────────────────────────────────────────
    const pathDisplay = document.getElementById('path-display');
    const pathDisplayTxt = document.getElementById('path-display-text');
    const pathStatus = document.getElementById('download-path-status');
    const btnBrowse = document.getElementById('btn-browse');
    const btnClearPath = document.getElementById('btn-clear-path');

    /** Applies a path to the UI and optionally saves it to storage */
    function applyPath(p, save = true) {
        const haspath = p && p.trim();
        if (pathDisplay) pathDisplay.classList.toggle('has-path', !!haspath);
        if (pathDisplayTxt) {
            if (haspath) {
                pathDisplayTxt.removeAttribute('data-i18n');
                pathDisplayTxt.textContent = p.trim();
            } else {
                pathDisplayTxt.setAttribute('data-i18n', 'pathDefault');
                pathDisplayTxt.textContent = i18n.t('pathDefault');
            }
        }
        if (btnClearPath) btnClearPath.classList.toggle('visible', !!haspath);
        setPathStatus(haspath ? 'ok' : '');
        if (save) chrome.storage.local.set({ downloadPath: haspath ? p.trim() : '' });
    }

    function setPathStatus(state, customText) {
        if (!pathStatus) return;
        pathStatus.className = 'path-status-line';
        if (!state) { pathStatus.textContent = ''; return; }
        if (state === 'ok') {
            pathStatus.classList.add('ok');
            pathStatus.textContent = '✓ ' + i18n.t('pathSaved');
        } else if (state === 'browsing') {
            pathStatus.classList.add('info');
            pathStatus.textContent = '⋯ ' + i18n.t('pathBrowsing');
        } else if (state === 'warn') {
            pathStatus.classList.add('warn');
            pathStatus.textContent = '⚠ ' + (customText || i18n.t('pathBrowseNotAvailable'));
        }
    }

    if (btnBrowse) {
        btnBrowse.addEventListener('click', () => {
            // Check native host is connected first
            const isConnected = nativeBadge && !nativeBadge.classList.contains('inactive');
            if (!isConnected) {
                setPathStatus('warn', i18n.t('pathBrowseNotAvailable'));
                return;
            }
            btnBrowse.disabled = true;
            setPathStatus('browsing');
            chrome.runtime.sendMessage({
                action: 'pick_folder',
                currentPath: (pathDisplayTxt && pathDisplay?.classList.contains('has-path'))
                    ? pathDisplayTxt.textContent.trim()
                    : ''
            }, (res) => {
                btnBrowse.disabled = false;
                if (chrome.runtime.lastError || !res || res.status !== 'ok' || !res.path) {
                    setPathStatus('warn', i18n.t('pathPickerCancelled'));
                    return;
                }
                applyPath(res.path, true);
            });
        });
    }

    if (btnClearPath) {
        btnClearPath.addEventListener('click', () => applyPath('', true));
    }

    // ── Setup button ──────────────────────────────────────────────────────────
    btnSetup.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('views/setup.html') });
    });

    // ── Reset stats ───────────────────────────────────────────────────────────
    btnReset.addEventListener('click', () => {
        if (!confirm(i18n.t('resetConfirm'))) return;
        chrome.storage.local.set({ blockedCount: 0, hiddenCount: 0, adsBlockedCount: 0, blockedChannels: [] }, () => {
            statBlocked.textContent = '0';
            statHidden.textContent = '0';
            if (statAds) statAds.textContent = '0';
            renderBlocklist([]);
        });
    });

    // ── Live stat updates ─────────────────────────────────────────────────────
    chrome.storage.onChanged.addListener((changes, ns) => {
        if (ns !== 'local') return;
        if (changes.blockedChannels) {
            const list = changes.blockedChannels.newValue || [];
            animateValue(statBlocked,
                (changes.blockedChannels.oldValue || []).length,
                list.length, 700);
            renderBlocklist(list);
        }
        if (changes.hiddenCount) {
            animateValue(statHidden,
                changes.hiddenCount.oldValue || 0,
                changes.hiddenCount.newValue || 0, 700);
        }
        if (changes.adsBlockedCount && statAds) {
            animateValue(statAds,
                changes.adsBlockedCount.oldValue || 0,
                changes.adsBlockedCount.newValue || 0, 700);
        }
    });

    // ── Render blocklist ──────────────────────────────────────────────────────
    function renderBlocklist(channels) {
        const container = document.getElementById('blocklist-container');
        const empty = document.getElementById('blocklist-empty');
        if (!container) return;

        container.innerHTML = '';

        if (!channels || channels.length === 0) {
            if (empty) {
                empty.style.display = 'block';
                empty.textContent = i18n.t('blocklistEmpty');
            }
            return;
        }
        if (empty) empty.style.display = 'none';

        const sorted = [...channels].sort((a, b) => (b.blockedAt || 0) - (a.blockedAt || 0));

        sorted.forEach(ch => {
            const row = document.createElement('div');
            row.className = 'card-row';
            row.style.cssText = 'padding:8px 0;';
            row.innerHTML = `
                <div style="overflow:hidden;min-width:0;flex:1;">
                    <div class="row-label" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(ch.name)}</div>
                    <div class="row-sublabel">${ch.blockedAt ? new Date(ch.blockedAt).toLocaleDateString() : ''}</div>
                </div>
                <button class="action-btn danger" data-id="${escHtml(ch.id)}"
                    style="height:28px;padding:0 10px;font-size:11px;flex-shrink:0;margin-left:8px;">
                    ${escHtml(i18n.t('removeFromList'))}
                </button>`;

            row.querySelector('button').addEventListener('click', () => {
                chrome.storage.local.get(['blockedChannels'], (res) => {
                    const newList = (res.blockedChannels || []).filter(c => c.id !== ch.id);
                    chrome.storage.local.set({ blockedChannels: newList, blockedCount: newList.length });
                });
            });

            container.appendChild(row);
        });
    }

    function escHtml(str) {
        return String(str || '').replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    function updateStatusUI(enabled) {
        if (enabled) {
            statusDot.classList.remove('inactive');
            statusText.classList.remove('inactive');
            statusText.textContent = i18n.t('statusActive');
        } else {
            statusDot.classList.add('inactive');
            statusText.classList.add('inactive');
            statusText.textContent = i18n.t('statusPaused');
        }
    }

    function setNativeBadge(connected) {
        if (!nativeBadge) return;
        if (connected) {
            nativeBadge.textContent = i18n.t('badgeConnected');
            nativeBadge.classList.remove('inactive');
        } else {
            nativeBadge.textContent = i18n.t('badgeNotInstalled');
            nativeBadge.classList.add('inactive');
        }
    }

    function syncLangSelectLabels() {
        if (!langSelect) return;
        const map = {
            auto: 'langAuto',
            en: 'langEn',
            tr: 'langTr',
            de: 'langDe',
            fr: 'langFr',
            es: 'langEs',
            pt: 'langPt',
            it: 'langIt',
            ru: 'langRu',
            ja: 'langJa',
            ko: 'langKo',
            zh: 'langZh',
        };
        for (const opt of langSelect.options) {
            const key = map[opt.value];
            if (key) opt.textContent = i18n.t(key);
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