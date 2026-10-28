/* global chrome */
'use strict';
var AppUpdates = (() => {
    function create({ chrome, getPort, isBusy }) {
        let pending = null;
        let sequence = 0;
        let installing = false;
        function save(result) {
            const state = { ...result, checkedAt: Date.now() };
            chrome.storage.local.set({ appUpdate: state });
            chrome.action?.setBadgeText({ text: state.status === 'available' ? 'NEW' : '' });
            return state;
        }
        function request(action, version) {
            if (pending) return Promise.resolve({ status: 'error', message: 'An update operation is already running.' });
            if (isBusy()) return Promise.resolve({ status: 'error', message: 'Wait for active downloads to finish.' });
            const port = getPort();
            if (!port) return Promise.resolve({ status: 'error', message: 'Native host is unavailable. Install the current companion first.' });
            const requestId = `app-update-${Date.now()}-${++sequence}`;
            pending = new Promise(resolve => {
                let settled = false;
                const finish = result => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    port.onMessage.removeListener(onMessage);
                    port.onDisconnect.removeListener(onDisconnect);
                    resolve(save(result));
                };
                const onMessage = message => {
                    if (message?.action === 'app_update_result' && message.requestId === requestId) finish(message);
                };
                const onDisconnect = () => finish({ status: 'error', message: 'Native host disconnected. Check the installation before retrying.' });
                const timer = setTimeout(() => finish({ status: 'error', message: 'Update operation timed out. An older host may need a manual upgrade.' }), 90000);
                port.onMessage.addListener(onMessage);
                port.onDisconnect.addListener(onDisconnect);
                try { port.postMessage({ action, requestId, version }); }
                catch (_) { finish({ status: 'error', message: 'Could not contact the native host.' }); }
            });
            const operation = pending;
            return operation.finally(() => { if (pending === operation) pending = null; });
        }
        function check() { return request('check_app_update'); }
        async function apply(version) {
            if (installing) return { status: 'error', message: 'An installation is already running.' };
            installing = true;
            const result = await request('install_app_update', version);
            if (result.status === 'installed') {
                // Keep the same unpacked folder and ID, preserving browser storage.
                setTimeout(() => chrome.runtime.reload(), 1200);
            } else installing = false;
            return result;
        }
        function scheduledCheck() {
            chrome.storage.local.get(['appUpdate'], result => {
                if (Date.now() - (result?.appUpdate?.checkedAt || 0) >= 24 * 60 * 60 * 1000) void check();
            });
        }
        function initialize() {
            const name = 'paracci-app-update';
            chrome.alarms?.get(name, alarm => {
                if (!alarm) chrome.alarms.create(name, { delayInMinutes: 1, periodInMinutes: 1440 });
            });
            chrome.alarms?.onAlarm.addListener(alarm => { if (alarm.name === name) scheduledCheck(); });
            chrome.runtime.onStartup?.addListener(scheduledCheck);
        }
        return { check, apply, initialize, isInstalling: () => installing };
    }
    return { create };
})();
