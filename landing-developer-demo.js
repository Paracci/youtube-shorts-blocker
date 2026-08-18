/* Local-only Developer Console preview for the static landing page. */
(() => {
  'use strict';

  const root = document.querySelector('[data-landing-developer-demo]');
  if (!root) return;

  const $ = (selector) => root.querySelector(selector);
  const windowTimers = typeof window !== 'undefined' ? window : globalThis;

  const sampleEntries = [
    {
      time: '10:42:11', level: 'info', scope: 'content', module: 'shorts',
      event: 'renderer.ready', message: 'Shorts renderer is ready', details: 'active fingerprint accepted'
    },
    {
      time: '10:42:12', level: 'debug', scope: 'content', module: 'ad-blocker',
      event: 'marker.scan', message: 'Active player markers scanned'
    },
    {
      time: '10:42:13', level: 'info', scope: 'background', module: 'developer-store',
      event: 'session.ready', message: 'Session buffer ready', details: 'local retention is bounded'
    },
    {
      time: '10:42:14', level: 'warn', scope: 'downloader', module: 'native-host',
      event: 'host.check', message: 'Native host is not connected', details: 'preview state only'
    },
    {
      time: '10:42:15', level: 'info', scope: 'setup', module: 'health-check',
      event: 'dependencies.ready', message: 'yt-dlp and ffmpeg checks completed'
    },
    {
      time: '10:42:16', level: 'error', scope: 'downloader', module: 'download-page',
      event: 'format.resolve', message: 'Waiting for a local native response', details: 'no media request was sent'
    },
    {
      time: '10:42:17', level: 'info', scope: 'content', module: 'channel-filter',
      event: 'filter.applied', message: 'Local channel filter applied'
    },
    {
      time: '10:42:18', level: 'debug', scope: 'background', module: 'developer-store',
      event: 'entry.accepted', message: 'Diagnostic entry accepted', details: 'sensitive fields redacted'
    }
  ];

  const state = {
    entries: sampleEntries.map((entry) => ({ ...entry })),
    enabled: true
  };

  const status = $('#landing-developer-status');
  const modeToggle = $('#landing-developer-mode-toggle');
  const search = $('#landing-developer-search');
  const scopeFilter = $('#landing-developer-scope-filter');
  const moduleFilter = $('#landing-developer-module-filter');
  const levelFilter = $('#landing-developer-level-filter');
  const logList = $('#landing-developer-log-list');
  const logEmpty = $('#landing-developer-log-empty');
  const visibleCount = $('#landing-developer-visible-count');
  const totalCount = $('#landing-developer-total-count');

  const setStatus = (message, tone = '') => {
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('is-enabled', tone === 'enabled');
    status.classList.toggle('is-disabled', tone === 'disabled');
  };

  const updateStatus = () => {
    if (!status) return;
    status.className = 'console-status ' + (state.enabled ? 'is-enabled' : 'is-disabled');
    setStatus(
      state.enabled ? 'Developer mode on · Sample session' : 'Developer mode off · Sample session',
      state.enabled ? 'enabled' : 'disabled'
    );
  };

  const replaceOptions = (select, allLabel, values, selected) => {
    if (!select) return;
    select.replaceChildren();

    const all = document.createElement('option');
    all.value = '';
    all.textContent = allLabel;
    select.appendChild(all);

    values.forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });

    select.value = values.includes(selected) ? selected : '';
  };

  const rebuildFilters = () => {
    const currentScope = scopeFilter?.value || '';
    const currentModule = moduleFilter?.value || '';
    const scopes = [...new Set(state.entries.map((entry) => entry.scope).filter(Boolean))].sort();
    const modules = [...new Set(state.entries.map((entry) => entry.module).filter(Boolean))].sort();
    replaceOptions(scopeFilter, 'All scopes', scopes, currentScope);
    replaceOptions(moduleFilter, 'All modules', modules, currentModule);
  };

  const filteredEntries = () => {
    const query = String(search?.value || '').trim().toLowerCase();
    const scope = scopeFilter?.value || '';
    const module = moduleFilter?.value || '';
    const level = levelFilter?.value || '';

    return state.entries.filter((entry) => {
      if (scope && entry.scope !== scope) return false;
      if (module && entry.module !== module) return false;
      if (level && entry.level !== level) return false;
      if (!query) return true;
      return [entry.scope, entry.module, entry.event, entry.message, entry.details]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  };

  const renderEntry = (entry) => {
    const row = document.createElement('div');
    const level = ['debug', 'info', 'warn', 'error'].includes(entry.level) ? entry.level : 'info';
    row.className = 'log-entry is-' + level;

    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = entry.time || '--:--:--';

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

    if (entry.details) {
      const details = document.createElement('pre');
      details.className = 'log-details';
      details.textContent = entry.details;
      row.appendChild(details);
    }

    return row;
  };

  const render = () => {
    if (!logList || !logEmpty) return;
    const visible = filteredEntries();
    logList.replaceChildren(...visible.map(renderEntry));
    logEmpty.hidden = visible.length > 0;
    if (visibleCount) visibleCount.textContent = String(visible.length);
    if (totalCount) totalCount.textContent = String(state.entries.length);
  };

  const showActionStatus = (message) => {
    setStatus(message);
    windowTimers.setTimeout(updateStatus, 1800);
  };

  search?.addEventListener('input', render);
  scopeFilter?.addEventListener('change', render);
  moduleFilter?.addEventListener('change', render);
  levelFilter?.addEventListener('change', render);

  modeToggle?.addEventListener('change', (event) => {
    state.enabled = event.target.checked === true;
    updateStatus();
  });

  $('#landing-developer-copy')?.addEventListener('click', () => {
    const count = filteredEntries().length;
    showActionStatus(count ? `Copied ${count} visible logs in preview.` : 'No visible logs to copy.');
  });

  $('#landing-developer-clear')?.addEventListener('click', () => {
    state.entries = [];
    rebuildFilters();
    render();
    showActionStatus('Preview logs cleared.');
  });

  if (modeToggle) modeToggle.checked = state.enabled;
  rebuildFilters();
  updateStatus();
  render();
})();
