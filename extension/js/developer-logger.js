// Shared client-side developer logger.
// This file never reads chrome.storage.session and never stores diagnostics.
// It only sends bounded, opt-in records to the background service worker.
(function (root) {
    'use strict';

    const LEVELS = new Set(['debug', 'info', 'warn', 'error']);
    const MAX_EVENT_LENGTH = 80;
    const MAX_MESSAGE_LENGTH = 2000;
    const MAX_DETAILS_LENGTH = 6000;

    let enabled = false;
    let initialized = false;
    const modeListeners = new Set();

    function toText(value) {
        if (value === undefined || value === null) return '';
        if (typeof value === 'string') return value;
        try {
            return JSON.stringify(value);
        } catch (_) {
            return String(value);
        }
    }

    function safeEvent(value) {
        return toText(value)
            .replace(/[^A-Za-z0-9_.:-]/g, '_')
            .slice(0, MAX_EVENT_LENGTH) || 'event';
    }

    function safeDetails(value) {
        const text = toText(value).replace(/\r/g, '').trim();
        return text ? text.slice(0, MAX_DETAILS_LENGTH) : '';
    }

    function notifyModeListeners(next) {
        modeListeners.forEach(listener => {
            try { listener(next); } catch (_) { }
        });
    }

    function readMode() {
        try {
            if (!root.chrome?.storage?.local?.get) return Promise.resolve(false);
            return new Promise(resolve => {
                root.chrome.storage.local.get('developerMode', result => {
                    const next = result?.developerMode === true;
                    enabled = next;
                    resolve(next);
                });
            });
        } catch (_) {
            enabled = false;
            return Promise.resolve(false);
        }
    }

    function init() {
        if (initialized) return readMode();
        initialized = true;

        try {
            root.chrome?.storage?.onChanged?.addListener((changes, areaName) => {
                if (areaName !== 'local' || !changes?.developerMode) return;
                enabled = changes.developerMode.newValue === true;
                notifyModeListeners(enabled);
            });
        } catch (_) { }

        return readMode();
    }

    function setEnabled(value) {
        const next = value === true;
        enabled = next;
        notifyModeListeners(next);
        try {
            root.chrome?.storage?.local?.set?.({ developerMode: next });
        } catch (_) { }
        return next;
    }

    function isEnabled() {
        return enabled === true;
    }

    function onModeChange(listener) {
        if (typeof listener !== 'function') return () => { };
        modeListeners.add(listener);
        return () => modeListeners.delete(listener);
    }

    function send(record) {
        if (!isEnabled()) return false;
        try {
            if (!root.chrome?.runtime?.sendMessage) return false;
            root.chrome.runtime.sendMessage({ action: 'developer_log', entry: record }, () => {
                void root.chrome.runtime.lastError;
            });
            return true;
        } catch (_) {
            return false;
        }
    }

    function log(level, scope, module, event, message, details, context) {
        if (!isEnabled() || !LEVELS.has(level)) return false;

        const record = {
            level,
            scope: String(scope || 'content').slice(0, 40),
            module: String(module || scope || 'extension').slice(0, 60),
            event: safeEvent(event),
            message: toText(message).replace(/\r/g, '').slice(0, MAX_MESSAGE_LENGTH)
        };
        const detailText = safeDetails(details);
        if (detailText) record.details = detailText;
        if (context && typeof context === 'object') record.context = context;
        return send(record);
    }

    function create(scope, module) {
        return {
            log: (level, event, message, details, context) =>
                log(level, scope, module, event, message, details, context),
            debug: (event, message, details, context) =>
                log('debug', scope, module, event, message, details, context),
            info: (event, message, details, context) =>
                log('info', scope, module, event, message, details, context),
            warn: (event, message, details, context) =>
                log('warn', scope, module, event, message, details, context),
            error: (event, message, details, context) =>
                log('error', scope, module, event, message, details, context)
        };
    }

    const api = {
        init,
        setEnabled,
        isEnabled,
        onModeChange,
        log,
        create,
        debug: (scope, module, event, message, details, context) =>
            log('debug', scope, module, event, message, details, context),
        info: (scope, module, event, message, details, context) =>
            log('info', scope, module, event, message, details, context),
        warn: (scope, module, event, message, details, context) =>
            log('warn', scope, module, event, message, details, context),
        error: (scope, module, event, message, details, context) =>
            log('error', scope, module, event, message, details, context)
    };

    root.DeveloperLogger = api;
    api.init();

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
