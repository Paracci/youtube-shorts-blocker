// Developer Console page controller.
(function () {
    'use strict';

    const state = {
        entries: [],
        enabled: false,
        port: null,
        hasSessionStorage: false,
        limits: {}
    };

    const $ = id => document.getElementById(id);
    const t = key => (typeof i18n !== 'undefined' ? i18n.t(key) : key);

    document.addEventListener('DOMContentLoaded', async () => {
        if (typeof i18n !== 'undefined') {
            await i18n.init();
            i18n.applyToDOM();
        }
        bindEvents();
        if (typeof DeveloperLogger !== 'undefined') DeveloperLogger.init();
        connect();
    });

    function bindEvents() {
        $('developer-search')?.addEventListener('input', render);
        $('developer-scope-filter')?.addEventListener('change', render);
        $('developer-module-filter')?.addEventListener('change', render);
        $('developer-level-filter')?.addEventListener('change', render);
        $('copy-developer-logs')?.addEventListener('click', copyVisible);
        $('clear-developer-logs')?.addEventListener('click', clearLogs);
        $('developer-mode-toggle')?.addEventListener('change', event => {
            const enabled = event.target.checked;
            if (typeof DeveloperLogger !== 'undefined') DeveloperLogger.setEnabled(enabled);
            post({ action: 'developer_set_mode', enabled });
            updateStatus();
        });
    }

    function connect() {
        try {
            state.port = chrome.runtime.connect({ name: 'developer-console' });
            state.port.onMessage.addListener(handleMessage);
            state.port.onDisconnect.addListener(() => {
                state.port = null;
                const status = $('developer-status');
                if (status) {
                    status.textContent = t('developerDisconnected');
                    status.className = 'console-status is-disabled';
                }
            });
        } catch (_) {
            const status = $('developer-status');
            if (status) status.textContent = t('developerDisconnected');
        }
    }

    function post(message) {
        try { state.port?.postMessage(message); } catch (_) { }
    }

    function handleMessage(message) {
        if (!message || typeof message !== 'object') return;
        if (message.action === 'developer_snapshot') {
            state.entries = Array.isArray(message.entries) ? message.entries : [];
            state.enabled = message.enabled === true;
            state.hasSessionStorage = message.hasSessionStorage === true;
            state.limits = message.limits || {};
            if ($('developer-mode-toggle')) $('developer-mode-toggle').checked = state.enabled;
            rebuildFilters();
            updateStatus();
            render();
            return;
        }
        if (message.action === 'developer_log_entry' && message.entry) {
            state.entries.push(message.entry);
            const maxEntries = Number(state.limits.maxEntries) || 1000;
            if (state.entries.length > maxEntries) state.entries = state.entries.slice(-maxEntries);
            rebuildFilters();
            render();
            return;
        }
        if (message.action === 'developer_logs_cleared') {
            state.entries = [];
            rebuildFilters();
            render();
            return;
        }
        if (message.action === 'developer_mode_changed') {
            state.enabled = message.enabled === true;
            if ($('developer-mode-toggle')) $('developer-mode-toggle').checked = state.enabled;
            updateStatus();
        }
    }

    function rebuildFilters() {
        const scopeSelect = $('developer-scope-filter');
        const moduleSelect = $('developer-module-filter');
        if (!scopeSelect || !moduleSelect) return;

        const currentScope = scopeSelect.value;
        const currentModule = moduleSelect.value;
        const scopes = [...new Set(state.entries.map(entry => entry.scope).filter(Boolean))].sort();
        const modules = [...new Set(state.entries.map(entry => entry.module).filter(Boolean))].sort();

        replaceOptions(scopeSelect, 'developerAllScopes', scopes, currentScope);
        replaceOptions(moduleSelect, 'developerAllModules', modules, currentModule);
    }

    function replaceOptions(select, allKey, values, selected) {
        select.replaceChildren();
        const all = document.createElement('option');
        all.value = '';
        all.textContent = t(allKey);
        select.appendChild(all);
        values.forEach(value => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value;
            select.appendChild(option);
        });
        select.value = values.includes(selected) ? selected : '';
    }

    function filteredEntries() {
        const query = String($('developer-search')?.value || '').trim().toLowerCase();
        const scope = $('developer-scope-filter')?.value || '';
        const module = $('developer-module-filter')?.value || '';
        const level = $('developer-level-filter')?.value || '';
        return state.entries.filter(entry => {
            if (scope && entry.scope !== scope) return false;
            if (module && entry.module !== module) return false;
            if (level && entry.level !== level) return false;
            if (!query) return true;
            return [entry.scope, entry.module, entry.event, entry.message, entry.details]
                .filter(Boolean).join(' ').toLowerCase().includes(query);
        });
    }

    function render() {
        const list = $('developer-log-list');
        const empty = $('developer-log-empty');
        if (!list || !empty) return;
        const visible = filteredEntries();
        list.replaceChildren();
        visible.forEach(entry => list.appendChild(renderEntry(entry)));
        empty.hidden = visible.length > 0;
        if ($('developer-visible-count')) $('developer-visible-count').textContent = String(visible.length);
        if ($('developer-total-count')) $('developer-total-count').textContent = String(state.entries.length);
        const wrap = list.parentNode;
        if (wrap) wrap.scrollTop = wrap.scrollHeight;
    }

    function renderEntry(entry) {
        const row = document.createElement('div');
        const level = ['debug', 'info', 'warn', 'error'].includes(entry.level) ? entry.level : 'info';
        row.className = 'log-entry is-' + level;

        const time = document.createElement('span');
        time.className = 'log-time';
        time.textContent = formatTime(entry.timestamp);
        const levelNode = document.createElement('span');
        levelNode.className = 'log-level';
        levelNode.textContent = level.toUpperCase();
        const scope = document.createElement('span');
        scope.className = 'log-scope';
        scope.textContent = entry.scope || 'extension';
        const event = document.createElement('span');
        event.className = 'log-event';
        event.textContent = [entry.module, entry.event].filter(Boolean).join(' · ');
        const message = document.createElement('span');
        message.className = 'log-message';
        message.textContent = entry.message || '';
        row.append(time, levelNode, scope, event, message);

        if (entry.details || entry.context) {
            const details = document.createElement('pre');
            details.className = 'log-details';
            const context = entry.context ? `\ncontext: ${JSON.stringify(entry.context)}` : '';
            details.textContent = `${entry.details || ''}${context}`.trim();
            row.appendChild(details);
        }
        return row;
    }

    function formatTime(timestamp) {
        try {
            return new Date(Number(timestamp) || Date.now()).toLocaleTimeString([], {
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
        } catch (_) {
            return '--:--:--';
        }
    }

    function updateStatus() {
        const status = $('developer-status');
        if (!status) return;
        status.className = 'console-status ' + (state.enabled ? 'is-enabled' : 'is-disabled');
        const storageText = state.hasSessionStorage ? t('developerSessionReady') : t('developerMemoryFallback');
        status.textContent = state.enabled
            ? `${t('developerModeOnStatus')} · ${storageText}`
            : `${t('developerModeOffStatus')} · ${storageText}`;
    }

    async function copyVisible() {
        const lines = filteredEntries().map(entry => {
            const context = entry.context ? ` ${JSON.stringify(entry.context)}` : '';
            const details = entry.details ? `\n  ${entry.details}` : '';
            return `[${new Date(entry.timestamp || Date.now()).toISOString()}] ${String(entry.level || 'info').toUpperCase()} ${entry.scope}/${entry.module} ${entry.event}: ${entry.message}${context}${details}`;
        });
        try {
            await navigator.clipboard.writeText(lines.join('\n'));
            showActionStatus(t('developerCopied'));
        } catch (_) {
            showActionStatus(t('developerCopyFailed'));
        }
    }

    function clearLogs() {
        post({ action: 'developer_clear' });
    }

    function showActionStatus(message) {
        const status = $('developer-status');
        if (!status) return;
        const original = status.textContent;
        status.textContent = message;
        setTimeout(() => {
            if (status.textContent === message) updateStatus();
            else status.textContent = original;
        }, 1800);
    }
})();
