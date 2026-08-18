// Background-only developer log validation, redaction, retention, and fan-out.
(function (root) {
    'use strict';

    const LEVELS = new Set(['debug', 'info', 'warn', 'error']);
    const SCOPES = new Set(['popup', 'content', 'download-page', 'setup', 'background', 'native-host']);
    const CONTEXT_KEYS = new Set(['tabId', 'videoId', 'requestId', 'jobId', 'downloadId', 'operationId']);
    const MAX_ENTRIES = 1000;
    const MAX_MESSAGE_LENGTH = 2000;
    const MAX_DETAILS_LENGTH = 6000;
    const MAX_EVENT_LENGTH = 80;
    const MAX_MODULE_LENGTH = 60;
    const MAX_BUFFER_BYTES = 512 * 1024;
    const STORAGE_KEY = 'developerLogBuffer';

    function text(value) {
        if (value === undefined || value === null) return '';
        if (typeof value === 'string') return value;
        try { return JSON.stringify(value); } catch (_) { return String(value); }
    }

    function redact(value) {
        return text(value)
            .replace(/https?:\/\/[^\s"'<>]*googlevideo\.com[^\s"'<>]*/gi, '[stream URL hidden]')
            .replace(/\b(authorization|proxy-authorization|cookie|set-cookie)\s*[:=]\s*[^\r\n;]+/gi, '$1: [redacted]')
            .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]')
            .replace(/([?&](?:sig|signature|token|auth|key|poToken|visitorData|expire)=)[^&#\s]*/gi, '$1[redacted]')
            .replace(/\b(?:token|secret|password|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$&'.replace(/[^:=]+$/, '[redacted]'))
            .replace(/(?:[A-Za-z]:\\Users\\[^\r\n]+|[A-Za-z]:\\[^\r\n]+\\Downloads\\[^\r\n]*)/gi, '[local path hidden]')
            .replace(/\/Users\/[^\r\n]+/gi, '[local path hidden]');
    }

    function safeId(value, max = 100) {
        const result = text(value).trim();
        return result ? result.slice(0, max) : '';
    }

    function safeContext(context, sender) {
        const source = context && typeof context === 'object' ? context : {};
        const result = {};
        CONTEXT_KEYS.forEach(key => {
            if (key === 'tabId') {
                const value = Number(source[key]);
                if (Number.isInteger(value) && value >= 0) result[key] = value;
                return;
            }
            const value = safeId(source[key]);
            if (value) result[key] = value;
        });
        const senderTabId = Number(sender?.tab?.id);
        if (result.tabId === undefined && Number.isInteger(senderTabId) && senderTabId >= 0) {
            result.tabId = senderTabId;
        }
        return result;
    }

    function sanitizeEntry(raw, sender) {
        const source = raw && typeof raw === 'object' ? raw : {};
        const scope = SCOPES.has(source.scope) ? source.scope :
            (Number.isInteger(sender?.tab?.id) ? 'content' : 'background');
        const event = text(source.event)
            .replace(/[^A-Za-z0-9_.:-]/g, '_')
            .slice(0, MAX_EVENT_LENGTH) || 'event';
        const module = text(source.module || scope)
            .replace(/[^A-Za-z0-9_.:-]/g, '_')
            .slice(0, MAX_MODULE_LENGTH) || scope;
        const message = redact(source.message || source.data || '')
            .replace(/\r/g, '')
            .slice(0, MAX_MESSAGE_LENGTH);
        const details = redact(source.details || '')
            .replace(/\r/g, '')
            .slice(0, MAX_DETAILS_LENGTH);
        if (!message && !details) return null;

        const entry = {
            id: '',
            timestamp: 0,
            level: LEVELS.has(source.level) ? source.level : 'info',
            scope,
            module,
            event,
            message
        };
        if (details) entry.details = details;
        const context = safeContext(source.context, sender);
        if (Object.keys(context).length) entry.context = context;
        return entry;
    }

    function byteLength(value) {
        const serialized = JSON.stringify(value);
        try {
            if (typeof Buffer !== 'undefined') return Buffer.byteLength(serialized, 'utf8');
        } catch (_) { }
        try { return new TextEncoder().encode(serialized).length; } catch (_) { return serialized.length; }
    }

    function appendToBuffer(entries, entry) {
        let next = Array.isArray(entries) ? entries.concat(entry) : [entry];
        while (next.length > MAX_ENTRIES || byteLength(next) > MAX_BUFFER_BYTES) {
            next.shift();
            if (!next.length) break;
        }
        return next;
    }

    function filterEntries(entries, options = {}) {
        const query = text(options.query).trim().toLowerCase();
        const levels = Array.isArray(options.levels) ? new Set(options.levels) : null;
        const scopes = Array.isArray(options.scopes) ? new Set(options.scopes) : null;
        return (Array.isArray(entries) ? entries : []).filter(entry => {
            if (levels && levels.size && !levels.has(entry.level)) return false;
            if (scopes && scopes.size && !scopes.has(entry.scope)) return false;
            if (!query) return true;
            return [entry.scope, entry.module, entry.event, entry.message, entry.details]
                .filter(Boolean)
                .join(' ')
                .toLowerCase()
                .includes(query);
        });
    }

    function storageCall(area, method, value) {
        return new Promise(resolve => {
            if (!area || typeof area[method] !== 'function') {
                resolve(null);
                return;
            }
            let settled = false;
            const finish = result => {
                if (settled) return;
                settled = true;
                resolve(result);
            };
            try {
                const result = method === 'remove'
                    ? area[method](value, () => finish(true))
                    : area[method](value, output => finish(output || {}));
                if (result && typeof result.then === 'function') result.then(finish).catch(() => finish(null));
            } catch (_) {
                finish(null);
            }
        });
    }

    function create(chromeApi = root.chrome) {
        const session = chromeApi?.storage?.session;
        const listeners = new Set();
        const storageReady = Boolean(session);
        let entries = [];
        let enabled = false;
        let hydrated = false;
        let queue = Promise.resolve();

        const hydrate = async () => {
            if (hydrated) return entries;
            hydrated = true;
            if (!storageReady) return entries;
            const result = await storageCall(session, 'get', STORAGE_KEY);
            const stored = result?.[STORAGE_KEY];
            entries = Array.isArray(stored) ? stored.slice(-MAX_ENTRIES) : [];
            return entries;
        };

        const persist = () => storageReady
            ? storageCall(session, 'set', { [STORAGE_KEY]: entries })
            : Promise.resolve(null);

        const enqueue = work => {
            queue = queue.then(work).catch(() => null);
            return queue;
        };

        const append = (raw, sender) => {
            if (!enabled) return Promise.resolve(null);
            const sanitized = sanitizeEntry(raw, sender);
            if (!sanitized) return Promise.resolve(null);
            return enqueue(async () => {
                await hydrate();
                sanitized.id = `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
                sanitized.timestamp = Date.now();
                entries = appendToBuffer(entries, sanitized);
                await persist();
                listeners.forEach(listener => {
                    try { listener(sanitized); } catch (_) { }
                });
                return sanitized;
            });
        };

        const clear = () => enqueue(async () => {
            await hydrate();
            entries = [];
            if (storageReady) await storageCall(session, 'remove', STORAGE_KEY);
            return true;
        });

        return {
            ready: hydrate,
            append,
            clear,
            getEntries: () => entries.slice(),
            filter: options => filterEntries(entries, options),
            onEntry(listener) {
                if (typeof listener !== 'function') return () => { };
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
            setEnabled(value) { enabled = value === true; },
            isEnabled: () => enabled,
            hasSessionStorage: storageReady,
            limits: { maxEntries: MAX_ENTRIES, maxMessageLength: MAX_MESSAGE_LENGTH, maxDetailsLength: MAX_DETAILS_LENGTH }
        };
    }

    const api = {
        LEVELS: Array.from(LEVELS),
        SCOPES: Array.from(SCOPES),
        MAX_ENTRIES,
        MAX_MESSAGE_LENGTH,
        MAX_DETAILS_LENGTH,
        MAX_BUFFER_BYTES,
        STORAGE_KEY,
        redact,
        sanitizeEntry,
        appendToBuffer,
        filterEntries,
        create
    };

    root.DeveloperLogStore = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
