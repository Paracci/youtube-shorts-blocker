'use strict';
document.addEventListener('DOMContentLoaded', async () => {
    await i18n.init();
    i18n.applyToDOM();
    const check = document.getElementById('app-update-check');
    const install = document.getElementById('app-update-install');
    const status = document.getElementById('app-update-status');
    const details = document.getElementById('app-update-details');
    let version = '';
    function render(state) {
        version = state?.version || '';
        install.hidden = state?.status !== 'available';
        const keys = { available: 'appUpdateAvailable', current: 'appUpdateCurrent', unavailable: 'appUpdateUnavailable',
            error: 'appUpdateError', installed: 'appUpdateInstalled' };
        status.textContent = i18n.t(keys[state?.status] || 'appUpdateDescription') + (version ? ' (' + version + ')' : '');
        details.textContent = state?.message || state?.notes || '';
    }
    function send(action) {
        check.disabled = true;
        install.disabled = true;
        status.textContent = i18n.t(action === 'install_app_update' ? 'appUpdateInstalling' : 'appUpdateChecking');
        chrome.runtime.sendMessage({ action, version }, response => {
            check.disabled = false;
            install.disabled = false;
            render(chrome.runtime.lastError ? { status: 'error', message: chrome.runtime.lastError.message } : response);
        });
    }
    check.addEventListener('click', () => send('check_app_update'));
    install.addEventListener('click', () => send('install_app_update'));
    chrome.storage.local.get(['appUpdate'], value => render(value.appUpdate));
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.appUpdate) render(changes.appUpdate.newValue);
    });
});
