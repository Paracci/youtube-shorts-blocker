document.addEventListener('DOMContentLoaded', async () => {

    // ── i18n — initialise FIRST ───────────────────────────────────────────────
    await i18n.init();
    i18n.applyToDOM();
    const setupLogger = typeof DeveloperLogger !== 'undefined'
        ? DeveloperLogger.create('setup', 'setup')
        : null;
    setupLogger?.info('setup.loaded', 'Setup page loaded.');

    // ── Element refs ──────────────────────────────────────────────────────────
    const statusIndicator = document.getElementById('status-indicator');
    const statusText = document.getElementById('status-text');
    const instructionsBlock = document.getElementById('instructions-block');
    const checkBtn = document.getElementById('check-btn');
    const doneContainer = document.getElementById('done-container');
    const extIdDisplay = document.getElementById('extension-id-display');
    const copyBtn = document.getElementById('copy-btn');
    const setupView = document.getElementById('setup-view');
    const mediaToolsStatus = document.getElementById('media-tools-status');

    const extensionId = chrome.runtime.id;
    extIdDisplay.textContent = extensionId;

    // ── Copy button ───────────────────────────────────────────────────────────
    copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(extensionId).then(() => {
            const originalIcon = copyBtn.innerHTML;
            copyBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="#2ba640"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>';
            setTimeout(() => { copyBtn.innerHTML = originalIcon; }, 2000);
        });
    });

    document.getElementById('close-btn').addEventListener('click', () => {
        window.close();
    });

    // ── Status helper ─────────────────────────────────────────────────────────
    function setStatus(state) {
        statusIndicator.className = 'status-dot';
        if (state === 'checking') {
            setupLogger?.debug('native.health_check_started', 'Checking Native Host connection.');
            statusIndicator.classList.add('checking');
            statusText.textContent = i18n.t('setupStatusChecking');
            instructionsBlock.style.display = 'none';
            checkBtn.style.display = 'none';

        } else if (state === 'connected') {
            setupLogger?.info('native.connected', 'Native Host connection is ready.');
            statusIndicator.classList.add('connected');
            statusText.textContent = i18n.t('setupStatusConnected');

            setTimeout(() => {
                setupView.style.display = 'none';
                doneContainer.style.display = 'flex';
            }, 600);

        } else if (state === 'disconnected') {
            setupLogger?.warn('native.disconnected', 'Native Host was not detected.');
            statusIndicator.classList.add('disconnected');
            statusText.textContent = i18n.t('setupStatusDisconnected');
            instructionsBlock.style.display = 'block';
            checkBtn.style.display = 'inline-block';
        }
    }

    function setMediaToolsStatus(response) {
        if (!mediaToolsStatus) return;
        const label = mediaToolsStatus.querySelector('[data-i18n]');
        mediaToolsStatus.className = 'tool-status';

        if (!response || response.status !== 'connected') {
            mediaToolsStatus.classList.add('error');
            if (label) label.textContent = i18n.t('setupMediaToolsUnavailable');
            return;
        }

        if (response.ffmpegReady === false) {
            mediaToolsStatus.classList.add('warn');
            if (label) label.textContent = i18n.t('setupFfmpegMissing');
            return;
        }

        mediaToolsStatus.classList.add('ready');
        if (label) label.textContent = i18n.t('setupMediaToolsReady');
    }

    // ── Connection check ──────────────────────────────────────────────────────
    function checkConnection() {
        setStatus('checking');

        chrome.runtime.sendMessage({ action: 'check_native_host_status' }, (response) => {
            if (chrome.runtime.lastError) {
                setupLogger?.error('native.health_check_failed', 'Native Host health check failed.', chrome.runtime.lastError.message);
                setMediaToolsStatus(null);
                setStatus('disconnected');
                return;
            }
            setMediaToolsStatus(response);
            if (response && response.status === 'connected') {
                setupLogger?.info('native.health_check_succeeded', 'Native Host health check succeeded.');
                setStatus('connected');
            } else {
                setupLogger?.warn('native.health_check_rejected', 'Native Host health check returned a disconnected state.', response?.error || '');
                setStatus('disconnected');
            }
        });
    }

    checkBtn.addEventListener('click', checkConnection);

    // Small delay for visual effect on initial load
    setTimeout(checkConnection, 800);

    // ── Updater logic ─────────────────────────────────────────────────────────
    const updateBtn = document.getElementById('update-ytdlp-btn');
    const updateLogContainer = document.getElementById('update-log-container');

    if (updateBtn) {
        updateBtn.addEventListener('click', () => {
            updateBtn.disabled = true;

            // Update the <span> inside the button, not the whole button
            const btnSpan = updateBtn.querySelector('[data-i18n]');
            if (btnSpan) btnSpan.textContent = i18n.t('setupUpdating');
            else updateBtn.childNodes.forEach(n => { if (n.nodeType === 3 && n.textContent.trim()) n.textContent = ' ' + i18n.t('setupUpdating'); });

            updateBtn.style.opacity = '0.5';

            updateLogContainer.classList.remove('hidden');
            updateLogContainer.textContent = i18n.t('setupUpdateStart') + '\n';
            setupLogger?.info('native.update_started', 'yt-dlp update requested.');

            chrome.runtime.sendMessage({ action: 'update_downloader_native' }, (res) => {
                if (chrome.runtime.lastError || res?.status === 'failed_native_connect') {
                    setupLogger?.error('native.update_dispatch_failed', 'Could not dispatch yt-dlp update.', chrome.runtime.lastError?.message || '');
                    updateLogContainer.textContent += '\n' + i18n.t('setupUpdateError');
                    resetUpdateBtn();
                }
            });
        });
    }

    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === 'ytdlp_update_progress' && message.data) {
            const data = message.data;

            if (data.status === 'info' || data.status === 'progress' || data.status === 'error_log') {
                updateLogContainer.textContent += (data.data || data.message || '') + '\n';
                updateLogContainer.scrollTop = updateLogContainer.scrollHeight;
            } else if (data.status === 'error') {
                setupLogger?.error('native.update_failed', data.message || i18n.t('setupUpdateError'));
                updateLogContainer.textContent += '\n' + (data.message || i18n.t('setupUpdateError')) + '\n';
                updateLogContainer.scrollTop = updateLogContainer.scrollHeight;
                resetUpdateBtn();
            } else if (data.status === 'update_success') {
                setupLogger?.info('native.update_completed', data.message || i18n.t('setupUpdateDone'));
                updateLogContainer.textContent += '\n' + i18n.t('setupUpdateDone') + '\n';
                updateLogContainer.scrollTop = updateLogContainer.scrollHeight;

                const btnSpan = updateBtn.querySelector('[data-i18n]');
                if (btnSpan) btnSpan.textContent = i18n.t('setupUpdateUpToDate');

                updateBtn.style.borderColor = 'var(--green)';
                updateBtn.style.color = 'var(--green)';
                setTimeout(resetUpdateBtn, 4000);
            }
        }
    });

    function resetUpdateBtn() {
        if (updateBtn) {
            updateBtn.disabled = false;
            updateBtn.style.opacity = '1';
            updateBtn.style.borderColor = '';
            updateBtn.style.color = '';

            // Restore translated label
            const btnSpan = updateBtn.querySelector('[data-i18n]');
            if (btnSpan) btnSpan.textContent = i18n.t('setupUpdateBtn');
        }
    }
});
