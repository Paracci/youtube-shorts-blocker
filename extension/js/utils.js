// ─────────────────────────────────────────────────────────────────────────────
// utils.js – Chrome extension context guards & safe storage helpers
// ─────────────────────────────────────────────────────────────────────────────

function safeMsg(msg) {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage(msg, (res) => {
                if (chrome.runtime.lastError) { resolve(null); }
                else { resolve(res); }
            });
        } catch (_) { resolve(null); }
    });
}

function safeStorageGet(keys, callback) {
    try {
        if (!chrome?.storage?.local) { callback({}); return; }
        chrome.storage.local.get(keys, (res) => {
            if (chrome.runtime?.lastError) { callback({}); return; }
            callback(res || {});
        });
    } catch (_) { callback({}); }
}

function safeStorageSet(data) {
    try {
        if (!chrome?.storage?.local) return;
        chrome.storage.local.set(data);
    } catch (_) { /* extension context invalidated */ }
}
