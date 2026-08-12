// ─────────────────────────────────────────────────────────────────────────────
// notifications.js – YouTube-styled stacked toast notification helper
// Depends on: utils.js
// ─────────────────────────────────────────────────────────────────────────────

const NOTIFICATION_STACK_ID = 'my-yt-notification-stack';
const DOWNLOAD_NOTIFICATION_PANEL_ID = 'my-yt-download-notification-panel';
const DOWNLOAD_NOTIFICATION_STATES = new Set([
    'preparing', 'downloading', 'cancelling', 'success', 'error', 'cancelled'
]);
const activeDownloadNotifications = new Map();

function notificationText(key, fallback) {
    try {
        if (typeof i18n !== 'undefined' && i18n && typeof i18n.t === 'function') {
            return i18n.t(key) || fallback;
        }
    } catch (_) { }
    return fallback;
}

function createDownloadNotificationId() {
    return `download-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isDownloadNotificationActive(state) {
    return state === 'preparing' || state === 'downloading' || state === 'cancelling';
}

function isDownloadNotificationFinished(state) {
    return state === 'success' || state === 'error' || state === 'cancelled';
}

function createNotificationElement(tagName, className) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    return element;
}

function updateDownloadNotificationPanel() {
    const panel = document.getElementById(DOWNLOAD_NOTIFICATION_PANEL_ID);
    if (!panel) return;

    const count = panel.querySelector('[data-download-count]');
    if (count) {
        count.textContent = String(activeDownloadNotifications.size);
        count.setAttribute(
            'aria-label',
            `${activeDownloadNotifications.size} ${notificationText('downloadNotificationDownloads', 'downloads')}`
        );
    }

    const clearButton = panel.querySelector('[data-download-clear-finished]');
    const hasFinished = [...activeDownloadNotifications.values()]
        .some(notification => isDownloadNotificationFinished(notification.getState()));
    if (clearButton) clearButton.hidden = !hasFinished;
}

function announceDownloadNotification(message) {
    const panel = document.getElementById(DOWNLOAD_NOTIFICATION_PANEL_ID);
    const live = panel?.querySelector('[data-download-live]');
    if (!live || !message) return;
    live.textContent = String(message);
}

function ensureDownloadNotificationPanel() {
    let panel = document.getElementById(DOWNLOAD_NOTIFICATION_PANEL_ID);
    if (panel) return panel;

    panel = createNotificationElement('section', 'yt-download-notification-panel');
    panel.id = DOWNLOAD_NOTIFICATION_PANEL_ID;
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', notificationText('downloadJobsTitle', 'Downloads'));

    const header = createNotificationElement('header', 'yt-download-notification-panel__header');
    const heading = createNotificationElement('div', 'yt-download-notification-panel__heading');
    const headingCopy = createNotificationElement('div', 'yt-download-notification-panel__heading-copy');
    const title = createNotificationElement('strong', 'yt-download-notification-panel__title');
    title.textContent = notificationText('downloadJobsTitle', 'Downloads');
    const count = createNotificationElement('span', 'yt-download-notification-panel__count');
    count.dataset.downloadCount = 'true';
    headingCopy.append(title);
    heading.append(headingCopy, count);

    const clearButton = createNotificationElement('button', 'yt-download-notification-panel__clear');
    clearButton.type = 'button';
    clearButton.dataset.downloadClearFinished = 'true';
    clearButton.textContent = notificationText('downloadNotificationClearFinished', 'Clear finished');
    clearButton.setAttribute('aria-label', clearButton.textContent);
    clearButton.hidden = true;
    clearButton.addEventListener('click', () => {
        [...activeDownloadNotifications.values()]
            .filter(notification => isDownloadNotificationFinished(notification.getState()))
            .forEach(notification => notification.remove());
    });

    header.append(heading, clearButton);

    const live = createNotificationElement('div', 'yt-download-notification-panel__live');
    live.dataset.downloadLive = 'true';
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');

    const list = createNotificationElement('div', 'yt-download-notification-panel__list');
    list.dataset.downloadList = 'true';

    panel.append(header, live, list);
    getNotificationStack().appendChild(panel);
    return panel;
}

function updateDownloadProgressDom(parts, progress = {}) {
    const percent = Number.isFinite(Number(progress.percent))
        ? Math.max(0, Math.min(100, Number(progress.percent)))
        : null;
    const speed = progress.speed ? String(progress.speed) : '—';
    const eta = progress.eta ? String(progress.eta) : '—';

    parts.speed.textContent = speed;
    parts.eta.textContent = eta;
    parts.speed.setAttribute('aria-label', `${notificationText('downloadNotificationSpeed', 'Speed')}: ${speed}`);
    parts.eta.setAttribute('aria-label', `${notificationText('downloadNotificationEta', 'ETA')}: ${eta}`);

    if (percent === null) {
        parts.progressBar.classList.add('is-indeterminate');
        parts.progressBar.style.width = '';
        parts.progressBar.removeAttribute('aria-valuenow');
        parts.percent.textContent = '—';
        return;
    }

    parts.progressBar.classList.remove('is-indeterminate');
    parts.progressBar.style.width = `${percent}%`;
    parts.progressBar.setAttribute('aria-valuenow', String(Math.round(percent)));
    parts.percent.textContent = `${Math.round(percent)}%`;
}

function showDownloadNotification(title, message, videoId, state = 'preparing', options = {}) {
    const downloadId = String(options.downloadId || createDownloadNotificationId());
    if (activeDownloadNotifications.has(downloadId)) return activeDownloadNotifications.get(downloadId);

    const panel = ensureDownloadNotificationPanel();
    const list = panel.querySelector('[data-download-list]');
    const card = createNotificationElement('article', 'yt-download-notification');
    const initialState = DOWNLOAD_NOTIFICATION_STATES.has(state) ? state : 'preparing';
    let currentState = initialState;
    let removed = false;
    let actionVisible = false;

    card.dataset.downloadId = downloadId;
    card.dataset.state = currentState;
    card.setAttribute('role', 'group');
    card.setAttribute('aria-busy', isDownloadNotificationActive(currentState) ? 'true' : 'false');

    const media = createNotificationElement('div', 'yt-download-notification__media');
    const fallbackIcon = createNotificationElement('span', 'yt-download-notification__fallback-icon');
    fallbackIcon.setAttribute('aria-hidden', 'true');
    fallbackIcon.textContent = '↓';
    media.appendChild(fallbackIcon);

    const safeVideoId = videoId && /^[A-Za-z0-9_-]{6,}$/.test(String(videoId))
        ? String(videoId)
        : null;
    if (safeVideoId) {
        const thumbnail = createNotificationElement('img', 'yt-download-notification__thumbnail');
        thumbnail.src = `https://i.ytimg.com/vi/${safeVideoId}/hqdefault.jpg`;
        thumbnail.alt = '';
        thumbnail.loading = 'lazy';
        thumbnail.addEventListener('error', () => {
            thumbnail.hidden = true;
            fallbackIcon.hidden = false;
        });
        fallbackIcon.hidden = true;
        media.appendChild(thumbnail);
    }

    const content = createNotificationElement('div', 'yt-download-notification__content');
    const topRow = createNotificationElement('div', 'yt-download-notification__top-row');
    const format = createNotificationElement('span', 'yt-download-notification__format');
    format.textContent = String(options.formatLabel || notificationText('downloadFormat', 'Download'));
    const dismissButton = createNotificationElement('button', 'yt-download-notification__dismiss');
    dismissButton.type = 'button';
    dismissButton.setAttribute('aria-label', notificationText('downloadNotificationDismiss', 'Dismiss download notification'));
    dismissButton.textContent = '×';
    topRow.append(format, dismissButton);

    const titleElement = createNotificationElement('strong', 'yt-download-notification__title');
    titleElement.textContent = String(title || notificationText('downloadDownload', 'Download'));
    titleElement.title = titleElement.textContent;

    const status = createNotificationElement('div', 'yt-download-notification__status');
    const statusDot = createNotificationElement('span', 'yt-download-notification__status-dot');
    statusDot.setAttribute('aria-hidden', 'true');
    const statusText = createNotificationElement('span', 'yt-download-notification__status-text');
    statusText.textContent = String(message || '');
    status.append(statusDot, statusText);

    const progressTrack = createNotificationElement('div', 'yt-download-notification__progress');
    const progressBar = createNotificationElement('span', 'yt-download-notification__progress-bar');
    progressBar.setAttribute('role', 'progressbar');
    progressBar.setAttribute('aria-valuemin', '0');
    progressBar.setAttribute('aria-valuemax', '100');
    progressTrack.appendChild(progressBar);

    const meta = createNotificationElement('div', 'yt-download-notification__meta');
    const percent = createNotificationElement('span', 'yt-download-notification__percent');
    const speed = createNotificationElement('span', 'yt-download-notification__speed');
    const eta = createNotificationElement('span', 'yt-download-notification__eta');
    speed.dataset.label = notificationText('downloadNotificationSpeed', 'Speed');
    eta.dataset.label = notificationText('downloadNotificationEta', 'ETA');
    meta.append(percent, speed, eta);

    const actions = createNotificationElement('div', 'yt-download-notification__actions');
    const cancelButton = createNotificationElement('button', 'yt-download-notification__action yt-download-notification__action--cancel');
    cancelButton.type = 'button';
    cancelButton.textContent = notificationText('downloadCancel', 'Cancel');
    const folderButton = createNotificationElement('button', 'yt-download-notification__action yt-download-notification__action--folder');
    folderButton.type = 'button';
    folderButton.textContent = String(options.actionLabel || notificationText('downloadOpenFolder', 'Open folder'));
    const retryButton = createNotificationElement('button', 'yt-download-notification__action yt-download-notification__action--retry');
    retryButton.type = 'button';
    retryButton.textContent = notificationText('downloadRetry', 'Retry');
    actions.append(cancelButton, folderButton, retryButton);

    content.append(topRow, titleElement, status, progressTrack, meta, actions);
    card.append(media, content);
    list.prepend(card);

    const parts = { card, statusText, statusDot, progressBar, percent, speed, eta, cancelButton, folderButton, retryButton };
    const initialProgress = options.progress || {};

    const api = {
        id: downloadId,
        getState: () => currentState,
        update(nextMessage, progress = {}) {
            if (removed) return;
            if (nextMessage !== undefined && nextMessage !== null) statusText.textContent = String(nextMessage);
            updateDownloadProgressDom(parts, progress);
        },
        setState(nextState, nextMessage, progress = {}) {
            if (removed) return;
            const normalizedState = DOWNLOAD_NOTIFICATION_STATES.has(nextState) ? nextState : 'downloading';
            const previousState = currentState;
            currentState = normalizedState;
            card.dataset.state = normalizedState;
            statusDot.dataset.state = normalizedState;
            card.setAttribute('aria-busy', isDownloadNotificationActive(normalizedState) ? 'true' : 'false');
            if (nextMessage !== undefined && nextMessage !== null) statusText.textContent = String(nextMessage);
            updateDownloadProgressDom(parts, progress);

            cancelButton.hidden = !options.onCancel || !isDownloadNotificationActive(normalizedState);
            cancelButton.disabled = normalizedState === 'cancelling';
            folderButton.hidden = !options.onAction || !actionVisible || normalizedState !== 'success';
            retryButton.hidden = !options.onRetry || !['error', 'cancelled'].includes(normalizedState);
            if (previousState !== normalizedState) {
                announceDownloadNotification(`${titleElement.textContent}: ${statusText.textContent}`);
            }
            updateDownloadNotificationPanel();
        },
        success(nextMessage, progress = {}) {
            actionVisible = true;
            api.setState('success', nextMessage || notificationText('downloadComplete', 'Download complete'), progress);
            if (options.onAction) folderButton.hidden = false;
        },
        showAction() {
            actionVisible = true;
            folderButton.hidden = !options.onAction || currentState !== 'success';
        },
        showRetry() {
            retryButton.hidden = !options.onRetry || !['error', 'cancelled'].includes(currentState);
        },
        remove() {
            if (removed) return;
            removed = true;
            activeDownloadNotifications.delete(downloadId);
            card.remove();
            updateDownloadNotificationPanel();
            if (activeDownloadNotifications.size === 0) {
                panel.remove();
            }
        },
        isVisible: () => !removed && card.isConnected !== false
    };

    cancelButton.hidden = !options.onCancel || !isDownloadNotificationActive(currentState);
    folderButton.hidden = true;
    retryButton.hidden = !options.onRetry || !['error', 'cancelled'].includes(currentState);
    cancelButton.addEventListener('click', () => {
        if (cancelButton.disabled || removed) return;
        cancelButton.disabled = true;
        api.setState('cancelling', notificationText('downloadCancelling', 'Cancelling…'), initialProgress);
        options.onCancel?.(downloadId, api);
    });
    folderButton.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        options.onAction?.(folderButton, card, downloadId);
    });
    retryButton.addEventListener('click', event => {
        event.preventDefault();
        options.onRetry?.(downloadId, api);
    });
    dismissButton.addEventListener('click', event => {
        event.preventDefault();
        api.remove();
    });

    activeDownloadNotifications.set(downloadId, api);
    api.setState(initialState, message, initialProgress);
    updateDownloadNotificationPanel();
    requestAnimationFrame(() => card.classList.add('is-visible'));
    return api;
}

function getNotificationStack() {
    let stack = document.getElementById(NOTIFICATION_STACK_ID);
    if (stack) return stack;

    stack = document.createElement('div');
    stack.id = NOTIFICATION_STACK_ID;
    stack.style.cssText = `
        position: fixed; top: 65px; right: 24px; z-index: 2200000000;
        display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
        pointer-events: none;
    `;
    document.body.appendChild(stack);
    return stack;
}

function showYouTubeNotification(title, message, videoId, state = 'success', options = {}) {
    if (options && options.kind === 'download') {
        return showDownloadNotification(title, message, videoId, state, options);
    }

    let bgColor = '#212121';
    let iconHTML = '';
    let duration = state === 'preparing' ? 30000 :
        (typeof options.onAction === 'function' ? 7000 : 4000);

    if (state === 'error') {
        bgColor = '#cc0000'; duration = 6000;
        iconHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="#fff" style="flex-shrink:0;">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
        </svg>`;
    } else if (state === 'success') {
        bgColor = '#2e7d32';
        iconHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="#fff" style="flex-shrink:0;">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
        </svg>`;
    } else {
        iconHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="#3ea6ff" style="flex-shrink:0;">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
        </svg>`;
    }

    const safeVideoId = videoId && /^[A-Za-z0-9_-]{6,}$/.test(String(videoId))
        ? String(videoId)
        : null;
    const thumbHtml = safeVideoId
        ? `<div style="flex-shrink:0;width:40px;height:40px;border-radius:4px;overflow:hidden;background:#000;">
            <img src="https://i.ytimg.com/vi/${safeVideoId}/default.jpg" alt="" style="width:100%;height:100%;object-fit:cover;" />
        </div>`
        : iconHTML;

    const toast = document.createElement('div');
    toast.style.cssText = `
        position: relative; pointer-events: auto;
        background-color: ${bgColor}; color: #fff;
        font-family: 'Roboto', 'Arial', sans-serif; font-size: 14px;
        padding: 12px 16px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        display: flex; align-items: center; gap: 12px; max-width: 360px;
        opacity: 0; transform: translateY(-20px);
        transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
    `;

    const actionLabel = typeof options.actionLabel === 'string'
        ? options.actionLabel
        : 'Open folder';
    toast.innerHTML = `
        ${thumbHtml}
        <div data-toast-content style="display:flex;flex-direction:column;min-width:0;overflow:hidden;">
            <span data-toast-message style="font-weight:500;margin-bottom:2px;">${escapeHtml(message)}</span>
            ${title ? `<span style="font-size:12px;opacity:0.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(title)}</span>` : ''}
            ${typeof options.onAction === 'function'
                ? `<button type="button" data-toast-action hidden style="align-self:flex-start;margin-top:8px;padding:6px 10px;border:1px solid rgba(255,255,255,.34);border-radius:5px;color:#fff;background:rgba(255,255,255,.1);cursor:pointer;font:inherit;font-size:12px;font-weight:500;">${escapeHtml(actionLabel)}</button>`
                : ''}
        </div>
    `;

    const actionButton = toast.querySelector('[data-toast-action]');
    if (actionButton) {
        actionButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            options.onAction(actionButton, toast);
        });
    }

    const stack = getNotificationStack();
    stack.appendChild(toast);
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    });

    let removed = false;
    const hide = () => {
        if (removed) return;
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-20px)';
        setTimeout(() => {
            if (removed) return;
            removed = true;
            toast.remove();
            if (stack.childElementCount === 0) stack.remove();
        }, 300);
    };
    if (duration > 0) setTimeout(hide, duration);

    return {
        isVisible: () => !removed && toast.isConnected,
        remove: hide,
        update: (nextMessage) => {
            const messageEl = toast.querySelector('[data-toast-message]');
            if (messageEl) messageEl.textContent = String(nextMessage ?? '');
        },
        showAction: () => {
            if (actionButton) actionButton.hidden = false;
        },
        success: (nextMessage) => {
            const messageEl = toast.querySelector('[data-toast-message]');
            if (messageEl) messageEl.textContent = String(nextMessage ?? '');
            toast.style.backgroundColor = '#2e7d32';
            const svg = toast.querySelector('svg');
            if (svg) {
                svg.style.fill = '#ffffff';
                svg.innerHTML = `<path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>`;
            }
        }
    };
}
