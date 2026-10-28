// background.js – v1.9.0

try {
    importScripts('download-policy.js');
} catch (_) {
    // Keep legacy features alive if the shared policy is unavailable.
}

try {
    importScripts('developer-log-store.js');
} catch (_) {
    // Diagnostics are optional and must never prevent the service worker booting.
}

let nativePort = null;
importScripts('app-updates.js');
const applicationUpdates = AppUpdates.create({
    chrome,
    getPort: () => { if (!nativePort) connectToNativeHost(); return nativePort; },
    isBusy: () => activeDownloads.size > 0 || downloadPageJobs.size > 0 || downloadPageRequests.size > 0
});
applicationUpdates.initialize();
let developerModeEnabled = false;
const developerConsolePorts = new Set();
const developerLogStore = typeof DeveloperLogStore !== 'undefined'
    ? DeveloperLogStore.create()
    : null;

function broadcastDeveloperMessage(message) {
    developerConsolePorts.forEach(port => {
        try { port.postMessage(message); } catch (_) { }
    });
}

function setDeveloperModeState(value) {
    developerModeEnabled = value === true;
    developerLogStore?.setEnabled(developerModeEnabled);
    broadcastDeveloperMessage({
        action: 'developer_mode_changed',
        enabled: developerModeEnabled
    });
}

function writeDeveloperMode(value) {
    const next = value === true;
    setDeveloperModeState(next);
    try {
        chrome.storage.local.set({ developerMode: next });
    } catch (_) { }
    if (next) {
        appendBackgroundLog('info', 'developer.mode_enabled', 'Developer mode enabled.');
    }
    return next;
}

function appendBackgroundLog(level, event, message, details = '', context = {}) {
    if (!developerLogStore || !developerModeEnabled) return Promise.resolve(null);
    return developerLogStore.append({
        level,
        scope: 'background',
        module: 'background',
        event,
        message,
        details,
        context
    });
}

function appendIncomingDeveloperLog(entry, sender) {
    if (!developerLogStore || !developerModeEnabled) return Promise.resolve(null);
    return developerLogStore.append(entry, sender);
}

function sendDeveloperSnapshot(port) {
    if (!developerLogStore || !port) return;
    Promise.resolve(developerLogStore.ready()).then(() => {
        try {
            port.postMessage({
                action: 'developer_snapshot',
                enabled: developerModeEnabled,
                entries: developerLogStore.getEntries(),
                hasSessionStorage: developerLogStore.hasSessionStorage,
                limits: developerLogStore.limits
            });
        } catch (_) { }
    });
}

if (developerLogStore) {
    developerLogStore.onEntry(entry => broadcastDeveloperMessage({
        action: 'developer_log_entry',
        entry
    }));
}

try {
    chrome.storage.local.get(['developerMode'], result => {
        setDeveloperModeState(result?.developerMode === true);
    });
    chrome.storage.onChanged?.addListener((changes, areaName) => {
        if (areaName === 'local' && changes?.developerMode) {
            setDeveloperModeState(changes.developerMode.newValue === true);
        }
    });
} catch (_) {
    setDeveloperModeState(false);
}

// ── Active download tracking (rate-limit / dedup) ─────────────────────────────
// Maps "videoId|quality" → { tabId, videoId }. Prevents the same video+quality
// from being queued multiple times and routes native events to the origin tab.
const activeDownloads = new Map();
const downloadPageRequests = new Map();
const downloadPageJobs = new Map();
const downloadPageJobReservations = new Set();

const PAGE_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const FORMAT_ID_PATTERN = /^[A-Za-z0-9_.-]{1,40}$/;
const DOWNLOAD_ID_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;
const PROFILE_ID_PATTERN = /^(best_mp4|height_(2160|1440|1080|720)|audio_(mp3|m4a))$/;
const OUTPUT_FORMATS = new Set(['mp4', 'webm', 'mkv', 'mp3', 'm4a', 'opus']);

function sendNativeMessageToTab(tabId, message) {
    if (!Number.isInteger(tabId) || tabId < 0) return;
    try {
        chrome.tabs.sendMessage(tabId, message, () => { void chrome.runtime.lastError; });
    } catch (_) { }
}

function sendToDownloadPage(port, message) {
    if (!port) return false;
    try {
        port.postMessage(message);
        return true;
    } catch (_) {
        return false;
    }
}

function isPageId(value) {
    return typeof value === 'string' && PAGE_ID_PATTERN.test(value);
}

function isAllowedFormatId(value) {
    return typeof value === 'string' && FORMAT_ID_PATTERN.test(value);
}

function isDownloadId(value) {
    return typeof value === 'string' && DOWNLOAD_ID_PATTERN.test(value);
}

function isAllowedProfileId(value) {
    return typeof value === 'string' && PROFILE_ID_PATTERN.test(value);
}

function isAllowedOutputFormat(value) {
    return typeof value === 'string' && OUTPUT_FORMATS.has(value);
}

function isProfileOutputPairValid(profileId, outputFormat) {
    if (!profileId) return true;
    if (profileId === 'audio_mp3') return outputFormat === 'mp3';
    if (profileId === 'audio_m4a') return outputFormat === 'm4a';
    return outputFormat === 'mp4';
}

function sendDownloadPageError(port, action, requestId, errorCode, message, jobId) {
    sendToDownloadPage(port, {
        action,
        status: 'error',
        requestId,
        jobId,
        errorCode,
        message
    });
}

function getNativeDownloadTargets(videoId, downloadId = '') {
    const targets = new Set();
    const normalizedId = String(videoId || '');
    const normalizedDownloadId = String(downloadId || '');
    for (const entry of activeDownloads.values()) {
        if (normalizedDownloadId && entry.downloadId !== normalizedDownloadId) continue;
        if (entry.videoId === normalizedId && Number.isInteger(entry.tabId)) {
            targets.add(entry.tabId);
        }
    }
    return targets;
}

function isAllowedGoogleVideoUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' &&
            (url.hostname === 'googlevideo.com' || url.hostname.endsWith('.googlevideo.com'));
    } catch (_) {
        return false;
    }
}

function nativeLogContext(message) {
    const context = {};
    ['requestId', 'jobId', 'downloadId', 'videoId', 'operationId'].forEach(key => {
        if (message?.[key] !== undefined && message?.[key] !== null) {
            context[key] = String(message[key]).slice(0, 100);
        }
    });
    return context;
}

function handleNativeDeveloperMessage(message) {
    if (!message) return false;

    if (message.action === 'developer_log' || message.action === 'download_page_log') {
        const context = nativeLogContext(message);
        const entry = {
            level: message.level,
            scope: 'native-host',
            module: message.module || message.phase || 'native-host',
            event: message.event || `native.${message.phase || message.stream || 'output'}`,
            message: message.message || message.data || '',
            details: message.details,
            context
        };
        if (developerModeEnabled) void appendIncomingDeveloperLog(entry);

        if (isPageId(message.requestId)) {
            const jobEntry = isPageId(message.jobId) ? downloadPageJobs.get(message.jobId) : null;
            const requestEntry = downloadPageRequests.get(message.requestId);
            const pageEntry = jobEntry || requestEntry;
            if (pageEntry) {
                sendToDownloadPage(pageEntry.port, {
                    ...message,
                    action: 'download_page_log',
                    timestamp: message.timestamp || Date.now()
                });
            }
        }
        return true;
    }

    const statusLevels = {
        info: 'info',
        progress: 'debug',
        error_log: 'warn',
        update_success: 'info',
        media_tools_ready: 'info',
        error: 'error'
    };
    if (statusLevels[message.status]) {
        void appendIncomingDeveloperLog({
            level: statusLevels[message.status],
            scope: 'native-host',
            module: message.module || message.operation || 'native-host',
            event: `native.${message.status}`,
            message: message.message || message.data || '',
            details: message.details,
            context: nativeLogContext(message)
        });
    }
    return false;
}

function connectToNativeHost() {
    if (nativePort) return true;
    try {
        nativePort = chrome.runtime.connectNative('com.paracci.youtubedownloader');
    } catch (error) {
        nativePort = null;
        console.warn('[BG] Native host connection failed:', error.message);
        void appendBackgroundLog('error', 'native.connect_failed', 'Native host connection failed.', error.message);
        return false;
    }

    void appendBackgroundLog('info', 'native.connected', 'Native host connected.');

    nativePort.onMessage.addListener((msg) => {
        if (handleNativeDeveloperMessage(msg)) return;

        if (msg && msg.action === 'download_page_formats' && isPageId(msg.requestId)) {
            const entry = downloadPageRequests.get(msg.requestId);
            if (entry) {
                sendToDownloadPage(entry.port, msg);
            }
            return;
        }

        if (msg && (msg.action === 'download_page_progress' || msg.action === 'download_page_result') &&
            isPageId(msg.jobId)) {
            const entry = downloadPageJobs.get(msg.jobId);
            if (entry) {
                sendToDownloadPage(entry.port, msg);
                if (msg.action === 'download_page_result') downloadPageJobs.delete(msg.jobId);
            }
            return;
        }

        // Forward native download progress/results only to the tab that started
        // the download. Broadcasting to every YouTube tab caused duplicate
        // toasts and exposed one tab's download state to unrelated tabs.
        if (msg && (msg.action === 'download_video_result' || msg.action === 'download_video_progress')) {
            getNativeDownloadTargets(msg.videoId, msg.downloadId)
                .forEach(tabId => sendNativeMessageToTab(tabId, msg));
        }

        // When a download finishes (success or error), free the slot.
        if (msg && msg.action === 'download_video_result') {
            for (const [key, entry] of activeDownloads.entries()) {
                if (msg.downloadId && entry.downloadId === msg.downloadId) {
                    activeDownloads.delete(key);
                } else if (!msg.downloadId && key.startsWith(msg.videoId + '|')) {
                    activeDownloads.delete(key);
                }
            }

        }
    });

    nativePort.onDisconnect.addListener(() => {
        const err = chrome.runtime.lastError;
        console.warn('[BG] Native host disconnected:', err?.message);
        void appendBackgroundLog('warn', 'native.disconnected', 'Native host disconnected.', err?.message || '');
        nativePort = null;
        const interruptedDownloads = [...activeDownloads.values()];
        activeDownloads.clear();
        if (interruptedDownloads.length > 0) {
            interruptedDownloads.forEach(entry => sendNativeMessageToTab(entry.tabId, {
                action: 'download_video_result',
                status: 'error',
                message: 'Native host disconnected.',
                videoId: entry.videoId,
                downloadId: entry.downloadId,
                title: entry.videoId
            }));
        }

        for (const [requestId, entry] of downloadPageRequests.entries()) {
            sendDownloadPageError(
                entry.port,
                'download_page_formats',
                requestId,
                'native_required',
                'Native host disconnected.'
            );
        }
        downloadPageRequests.clear();

        for (const [jobId, entry] of downloadPageJobs.entries()) {
            sendDownloadPageError(
                entry.port,
                'download_page_result',
                entry.requestId,
                'native_required',
                'Native host disconnected.',
                jobId
            );
        }
        downloadPageJobs.clear();
        downloadPageJobReservations.clear();
    });
    return true;
}

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        chrome.tabs.create({ url: 'views/setup.html' });
    }
});

chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'developer-console') {
        developerConsolePorts.add(port);
        sendDeveloperSnapshot(port);
        port.onMessage.addListener((message) => {
            if (!message || typeof message !== 'object') return;
            if (message.action === 'developer_snapshot') {
                sendDeveloperSnapshot(port);
            } else if (message.action === 'developer_clear') {
                Promise.resolve(developerLogStore?.clear()).then(() => {
                    broadcastDeveloperMessage({ action: 'developer_logs_cleared' });
                    sendDeveloperSnapshot(port);
                });
            } else if (message.action === 'developer_set_mode') {
                writeDeveloperMode(message.enabled === true);
            }
        });
        port.onDisconnect.addListener(() => developerConsolePorts.delete(port));
        return;
    }

    if (port.name !== 'download-page') return;

    port.onMessage.addListener((message) => {
        handleDownloadPageMessage(port, message || {});
    });

    port.onDisconnect.addListener(() => {
        for (const [requestId, entry] of downloadPageRequests.entries()) {
            if (entry.port === port) downloadPageRequests.delete(requestId);
        }

        // Native downloads intentionally continue after the page closes.
        for (const entry of downloadPageJobs.values()) {
            if (entry.port === port) entry.port = null;
        }
    });
});

function handleDownloadPageMessage(port, message) {
    if (applicationUpdates.isInstalling() && ['resolve_formats', 'start_download'].includes(message.action)) {
        sendDownloadPageError(port, message.action === 'resolve_formats' ? 'download_page_formats' : 'download_page_result',
            message.requestId || message.jobId, 'update_busy', 'An application update is in progress.');
        return;
    }
    if (message.action === 'resolve_formats') {
        const requestId = String(message.requestId || '');
        if (!isPageId(requestId)) {
            void appendBackgroundLog('warn', 'download.invalid_request', 'Invalid format request id.', '', { requestId });
            sendDownloadPageError(port, 'download_page_formats', requestId, 'invalid_request', 'Invalid request id.');
            return;
        }

        const parsed = typeof DownloadPolicy !== 'undefined'
            ? DownloadPolicy.parse(message.url)
            : { ok: false, reason: 'policy_unavailable' };
        if (!parsed.ok) {
            void appendBackgroundLog('warn', 'download.policy_rejected', 'Download URL rejected by policy.', parsed.reason || '', { requestId });
            sendDownloadPageError(
                port,
                'download_page_formats',
                requestId,
                parsed.reason || 'invalid_url',
                'Only a valid public YouTube video URL is allowed.'
            );
            return;
        }

        if (!connectToNativeHost()) {
            void appendBackgroundLog('error', 'download.native_required', 'Native host is not connected.', '', { requestId });
            sendDownloadPageError(
                port,
                'download_page_formats',
                requestId,
                'native_required',
                'Native host is not connected.'
            );
            return;
        }

        const entry = {
            port,
            url: parsed.canonicalUrl,
            videoId: parsed.videoId,
            createdAt: Date.now()
        };
        downloadPageRequests.set(requestId, entry);
        void appendBackgroundLog('info', 'download.resolve_started', 'Resolving available formats.', '', {
            requestId,
            videoId: parsed.videoId
        });
        setTimeout(() => {
            if (downloadPageRequests.get(requestId) === entry) {
                downloadPageRequests.delete(requestId);
            }
        }, 10 * 60 * 1000);

        try {
            chrome.storage.local.get(['developerMode'], result => {
                try {
                    nativePort.postMessage({
                        action: 'resolve_formats',
                        requestId,
                        url: parsed.canonicalUrl,
                        developerMode: result?.developerMode === true
                    });
                } catch (_) {
                    void appendBackgroundLog('error', 'download.resolve_dispatch_failed', 'Could not contact native host.', '', { requestId });
                    downloadPageRequests.delete(requestId);
                    sendDownloadPageError(
                        port,
                        'download_page_formats',
                        requestId,
                        'native_required',
                        'Could not contact native host.'
                    );
                }
            });
        } catch (_) {
            downloadPageRequests.delete(requestId);
            sendDownloadPageError(
                port,
                'download_page_formats',
                requestId,
                'native_required',
                'Could not read developer mode.'
            );
        }
        return;
    }

    if (message.action === 'start_download') {
        const requestId = String(message.requestId || '');
        const jobId = String(message.jobId || '');
        const requestEntry = downloadPageRequests.get(requestId);
        const parsed = typeof DownloadPolicy !== 'undefined'
            ? DownloadPolicy.parse(message.url)
            : { ok: false };
        const formatId = String(message.formatId || '');
        const profileId = String(message.profileId || '');
        const outputFormat = String(message.outputFormat || 'mp4').toLowerCase();

        const selectionValid =
            (formatId && !profileId && isAllowedFormatId(formatId)) ||
            (!formatId && profileId && isAllowedProfileId(profileId));

        if (!isPageId(requestId) || !isPageId(jobId) ||
            !requestEntry || requestEntry.port !== port ||
            !parsed.ok || parsed.canonicalUrl !== requestEntry.url ||
            !selectionValid || !isAllowedOutputFormat(outputFormat) ||
            !isProfileOutputPairValid(profileId, outputFormat)) {
            void appendBackgroundLog('warn', 'download.invalid_selection', 'Invalid download selection.', '', { requestId, jobId });
            sendDownloadPageError(
                port,
                'download_page_dispatch_result',
                requestId,
                'invalid_download_request',
                'Invalid download selection.',
                jobId
            );
            return;
        }

        if (downloadPageJobs.has(jobId) || downloadPageJobReservations.has(jobId)) {
            void appendBackgroundLog('warn', 'download.duplicate_job', 'Download job is already active.', '', { requestId, jobId });
            sendDownloadPageError(
                port,
                'download_page_dispatch_result',
                requestId,
                'already_downloading',
                'This download is already active.',
                jobId
            );
            return;
        }

        if (!connectToNativeHost()) {
            void appendBackgroundLog('error', 'download.native_required', 'Native host is not connected.', '', { requestId, jobId });
            sendDownloadPageError(
                port,
                'download_page_dispatch_result',
                requestId,
                'native_required',
                'Native host is not connected.',
                jobId
            );
            return;
        }

        downloadPageJobReservations.add(jobId);

        chrome.storage.local.get(['downloadPath', 'developerMode'], (result) => {
            if (!nativePort) {
                downloadPageJobReservations.delete(jobId);
                sendDownloadPageError(
                    port,
                    'download_page_dispatch_result',
                    requestId,
                    'native_required',
                    'Native host disconnected.',
                    jobId
                );
                return;
            }

            const title = typeof message.title === 'string'
                ? message.title.slice(0, 200)
                : 'video';
            const entry = { port, requestId, createdAt: Date.now() };
            downloadPageJobs.set(jobId, entry);
            downloadPageJobReservations.delete(jobId);
            void appendBackgroundLog('info', 'download.dispatch_started', 'Dispatching download to native host.', '', { requestId, jobId });

            try {
                nativePort.postMessage({
                    action: 'download_video',
                    mode: 'page',
                    requestId,
                    jobId,
                    url: requestEntry.url,
                    formatId,
                    profileId,
                    outputFormat,
                    title,
                    developerMode: result?.developerMode === true,
                    savePath: typeof result.downloadPath === 'string'
                        ? result.downloadPath
                        : ''
                });
                sendToDownloadPage(port, {
                    action: 'download_page_dispatch_result',
                    status: 'accepted',
                    requestId,
                    jobId
                });
            } catch (_) {
                void appendBackgroundLog('error', 'download.dispatch_failed', 'Could not start native download.', '', { requestId, jobId });
                downloadPageJobs.delete(jobId);
                downloadPageJobReservations.delete(jobId);
                sendDownloadPageError(
                    port,
                    'download_page_dispatch_result',
                    requestId,
                    'native_required',
                    'Could not start native download.',
                    jobId
                );
            }
        });
        return;
    }

    if (message.action === 'cancel_download') {
        const requestId = String(message.requestId || '');
        const jobId = String(message.jobId || '');
        const entry = downloadPageJobs.get(jobId);
        if (!entry || entry.port !== port || !isPageId(requestId) ||
            !isPageId(jobId) || entry.requestId !== requestId) {
            void appendBackgroundLog('warn', 'download.cancel_invalid', 'Download cancellation was rejected.', '', { requestId, jobId });
            sendDownloadPageError(
                port,
                'download_page_result',
                entry?.requestId || '',
                'invalid_download_request',
                'Download was not found.',
                jobId
            );
            return;
        }
        if (!nativePort) {
            void appendBackgroundLog('error', 'download.cancel_native_missing', 'Native host is not connected for cancellation.', '', { requestId, jobId });
            sendDownloadPageError(
                port,
                'download_page_result',
                entry.requestId,
                'native_required',
                'Native host is not connected.',
                jobId
            );
            return;
        }
        try {
            void appendBackgroundLog('info', 'download.cancel_requested', 'Download cancellation requested.', '', { requestId, jobId });
            nativePort.postMessage({ action: 'cancel_download', requestId, jobId });
        } catch (_) {
            void appendBackgroundLog('error', 'download.cancel_dispatch_failed', 'Could not cancel native download.', '', { requestId, jobId });
            sendDownloadPageError(
                port,
                'download_page_result',
                entry.requestId,
                'native_required',
                'Could not cancel native download.',
                jobId
            );
        }
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (applicationUpdates.isInstalling() && ['download_video_native', 'update_downloader_native', 'download_video_browser'].includes(message.action)) {
        sendResponse({ status: 'update_busy' });
        return false;
    }
    if (message.action === 'check_app_update' || message.action === 'install_app_update') {
        // YouTube content scripts must never be able to start code updates.
        if (typeof sender.url !== 'string' || sender.id !== chrome.runtime.id ||
            String(sender.url || '').split(/[?#]/)[0] !== chrome.runtime.getURL('views/setup.html')) {
            sendResponse({ status: 'error', message: 'Open Setup / Monitor to manage application updates.' });
            return false;
        }
        const operation = message.action === 'check_app_update'
            ? applicationUpdates.check() : applicationUpdates.apply(message.version);
        operation.then(sendResponse, () => sendResponse({ status: 'error', message: 'Update operation failed.' }));
        return true;
    }

    if (message?.action === 'developer_log') {
        void appendIncomingDeveloperLog(message.entry || message, sender);
        sendResponse?.({ ok: true });
        return false;
    }

    if (message?.action === 'developer_mode_get') {
        sendResponse({ enabled: developerModeEnabled });
        return false;
    }

    if (message?.action === 'developer_mode_set') {
        sendResponse({ enabled: writeDeveloperMode(message.enabled === true) });
        return false;
    }

    if (message?.action === 'developer_logs_get') {
        Promise.resolve(developerLogStore?.ready()).then(() => {
            sendResponse({
                ok: true,
                enabled: developerModeEnabled,
                entries: developerLogStore?.getEntries?.() || [],
                hasSessionStorage: developerLogStore?.hasSessionStorage === true,
                limits: developerLogStore?.limits || {}
            });
        });
        return true;
    }

    if (message?.action === 'developer_logs_clear') {
        Promise.resolve(developerLogStore?.clear()).then(() => {
            broadcastDeveloperMessage({ action: 'developer_logs_cleared' });
            sendResponse({ ok: true });
        });
        return true;
    }

    // ── Ping ──────────────────────────────────────────────────────────────────
    if (message.action === 'ping') {
        sendResponse({ ok: true });
        return false;
    }

    // ── Check native host status ───────────────────────────────────────────────
    // Old approach used a 500 ms timeout + onDisconnect listener — both could fire
    // and call sendResponse twice (a Chrome error). New approach: open a test port,
    // send a ping, and wait for pong. onDisconnect fires only if it's not installed.
    if (message.action === 'check_native_host_status') {
        let responded = false;
        let testPort;
        try {
            testPort = chrome.runtime.connectNative('com.paracci.youtubedownloader');
        } catch (error) {
            void appendBackgroundLog('error', 'native.health_check_failed', 'Native host health check failed.', error.message);
            sendResponse({ status: 'disconnected', error: error.message });
            return false;
        }

        testPort.onDisconnect.addListener(() => {
            if (responded) return;
            responded = true;
            void appendBackgroundLog('warn', 'native.health_check_disconnected', 'Native host health check disconnected.', chrome.runtime.lastError?.message || '');
            sendResponse({ status: 'disconnected', error: chrome.runtime.lastError?.message });
        });

        testPort.onMessage.addListener((msg) => {
            if (responded) return;
            if (msg?.status === 'pong' || msg?.status === 'ready') {
                responded = true;
                sendResponse({
                    status: 'connected',
                    ytdlpReady: msg.ytdlpReady !== false,
                    ffmpegReady: msg.ffmpegReady !== false
                });
                testPort.disconnect();
            }
        });

        try {
            testPort.postMessage({ action: 'ping' });
        } catch (_) {
            if (!responded) {
                responded = true;
                void appendBackgroundLog('error', 'native.health_check_dispatch_failed', 'Native host health check dispatch failed.', 'postMessage failed');
                sendResponse({ status: 'disconnected', error: 'postMessage failed' });
            }
        }

        // Hard timeout: if the host is alive but somehow doesn't reply in 2 s
        setTimeout(() => {
            if (responded) return;
            responded = true;
            try { testPort.disconnect(); } catch (_) {}
            void appendBackgroundLog('warn', 'native.health_check_timeout', 'Native host health check timed out.');
            sendResponse({ status: 'disconnected', error: 'timeout' });
        }, 2000);

        return true;
    }

    // ── Update yt-dlp ─────────────────────────────────────────────────────────
    if (message.action === 'update_downloader_native') {
        if (!nativePort) connectToNativeHost();

        if (nativePort) {
            const updatePort = nativePort;
            const updateListener = (msg) => {
                if (['info', 'progress', 'error_log', 'update_success', 'error'].includes(msg?.status)) {
                    chrome.runtime.sendMessage({ action: 'ytdlp_update_progress', data: msg })
                        .catch(() => {});
                }
                if (msg?.status === 'update_success' || msg?.status === 'error') {
                    updatePort.onMessage.removeListener(updateListener);
                }
            };
            updatePort.onMessage.addListener(updateListener);
            chrome.storage.local.get(['developerMode'], result => {
                try {
                    updatePort.postMessage({
                        action: 'update_ytdlp',
                        developerMode: result?.developerMode === true
                    });
                    void appendBackgroundLog('info', 'native.update_started', 'yt-dlp update started.');
                    sendResponse({ status: 'sent_to_native' });
                } catch (error) {
                    updatePort.onMessage.removeListener(updateListener);
                    void appendBackgroundLog('error', 'native.update_dispatch_failed', 'Could not dispatch yt-dlp update.', error.message);
                    sendResponse({ status: 'failed_native_dispatch', error: error.message });
                }
            });
        } else {
            sendResponse({ status: 'failed_native_connect' });
        }
        return true;
    }

    // ── Pick folder (native Windows folder browser dialog) ────────────────────
    if (message.action === 'pick_folder') {
        if (!nativePort) connectToNativeHost();
        if (!nativePort) {
            sendResponse({ status: 'error', error: 'native_not_connected' });
            return true;
        }

        let responded = false;

        const folderListener = (msg) => {
            if (msg?.action !== 'pick_folder_result') return;
            nativePort.onMessage.removeListener(folderListener);
            if (responded) return;
            responded = true;
            sendResponse({ status: 'ok', path: msg.path || '' });
        };
        nativePort.onMessage.addListener(folderListener);

        // 60 s timeout — user might take a while navigating the dialog
        setTimeout(() => {
            if (responded) return;
            responded = true;
            try { nativePort?.onMessage.removeListener(folderListener); } catch (_) {}
            sendResponse({ status: 'timeout' });
        }, 60000);

        try {
            nativePort.postMessage({ action: 'pick_folder', currentPath: message.currentPath || '' });
        } catch (_) {
            if (!responded) {
                responded = true;
                sendResponse({ status: 'error', error: 'postMessage failed' });
            }
        }
        return true;
    }

    // ── Open the configured download folder in Windows Explorer ──────────────
    // ── Download video (native host — yt-dlp) ─────────────────────────────────
    if (message.action === 'download_video_native') {
        const videoId = String(message.videoId || '');
        if (!/^[A-Za-z0-9_-]{6,}$/.test(videoId)) {
            sendResponse({ status: 'invalid_video_id' });
            return false;
        }
        const downloadId = isDownloadId(message.downloadId)
            ? message.downloadId
            : `legacy-${videoId}-${Date.now()}`;
        const dlKey = `${videoId}|${String(message.videoQuality || 'best')}`;

        // Reject if the exact same video+quality is already downloading
        if (activeDownloads.has(dlKey)) {
            sendResponse({ status: 'already_downloading' });
            return false;
        }

        if (!nativePort) connectToNativeHost();

        if (nativePort) {
            const downloadEntry = { tabId: sender.tab?.id, videoId, downloadId };
            // Reserve the exact request before the asynchronous storage read so
            // an immediate Cancel click cannot race the save-path lookup.
            activeDownloads.set(dlKey, downloadEntry);

            // Read the user-configured save path and forward it to native host
            chrome.storage.local.get(['downloadPath', 'developerMode'], (res) => {
                if (!nativePort) {
                    activeDownloads.delete(dlKey);
                    sendNativeMessageToTab(sender.tab?.id, {
                        action: 'download_video_result',
                        status: 'error',
                        message: 'Native host disconnected before dispatch.',
                        videoId,
                        downloadId,
                        title: message.title || videoId
                    });
                    return;
                }
                try {
                    nativePort.postMessage({
                        action:        'download_video',
                        downloadId,
                        videoId,
                        title:         message.title,
                        videoQuality:  message.videoQuality,
                        qualityHeight: message.qualityHeight,
                        isAudioOnly:   message.isAudioOnly,
                        isVideoAudio:  message.isVideoAudio,
                        savePath:      res.downloadPath || '',
                        developerMode: res?.developerMode === true
                    });
                    void appendBackgroundLog('info', 'download.native_started', 'Native player download dispatched.', '', {
                        videoId,
                        downloadId,
                        tabId: sender.tab?.id
                    });
                } catch (error) {
                    activeDownloads.delete(dlKey);
                    console.warn('[BG] Native download dispatch failed:', error.message);
                    void appendBackgroundLog('error', 'download.native_dispatch_failed', 'Native download dispatch failed.', error.message, {
                        videoId,
                        downloadId,
                        tabId: sender.tab?.id
                    });
                    sendNativeMessageToTab(sender.tab?.id, {
                        action: 'download_video_result',
                        status: 'error',
                        message: 'Native host dispatch failed.',
                        videoId,
                        downloadId,
                        title: message.title || videoId
                    });
                }
            });
            sendResponse({ status: 'sent_to_native' });
        } else {
            sendResponse({ status: 'failed_native_connect' });
        }
        return false;
    }

    // ── Download video (browser — direct MP4 stream URL) ──────────────────────
    // NOTE: This message is currently not sent by any content script.
    // downloader.js handles low-quality streams directly via fetch + blob URL.
    // Kept here as a ready fallback if a browser-routed download is ever needed.
    // If a custom savePath is set AND native host is connected, route through
    // native host so the file lands in the configured folder without any dialog.
    // Otherwise fall back to chrome.downloads (saves to default Downloads folder,
    // optionally inside a "YouTube" subfolder — never opens a Save As dialog).
    if (message.action === 'cancel_video_download') {
        const downloadId = String(message.downloadId || '');
        const videoId = String(message.videoId || '');
        const tabId = sender.tab?.id;
        if (!isDownloadId(downloadId) || !/^[A-Za-z0-9_-]{6,}$/.test(videoId)) {
            sendResponse({ status: 'invalid_download_request' });
            return false;
        }

        const entry = [...activeDownloads.values()].find(candidate =>
            candidate.downloadId === downloadId && candidate.videoId === videoId && candidate.tabId === tabId
        );
        if (!entry) {
            sendResponse({ status: 'download_not_found' });
            return false;
        }
        if (!nativePort) {
            sendResponse({ status: 'failed_native_connect' });
            return false;
        }

        try {
            nativePort.postMessage({ action: 'cancel_video_download', downloadId, videoId });
            sendResponse({ status: 'cancel_requested' });
        } catch (_) {
            sendResponse({ status: 'failed_native_dispatch' });
        }
        return false;
    }

    if (message.action === 'download_video_browser') {
        chrome.storage.local.get(['downloadPath', 'developerMode'], (res) => {
            const videoId = String(message.videoId || '');
            if (!/^[A-Za-z0-9_-]{6,}$/.test(videoId) || !isAllowedGoogleVideoUrl(message.url)) {
                void appendBackgroundLog('warn', 'download.browser_invalid_request', 'Browser download request was rejected.', '', { videoId });
                sendResponse({ status: 'invalid_download_request' });
                return;
            }
            const customPath = typeof res.downloadPath === 'string' ? res.downloadPath.trim() : '';

            if (customPath && nativePort) {
                // ── Route to native host for custom-folder support ────────────
                const dlKey = `${videoId}|browser`;
                if (activeDownloads.has(dlKey)) {
                    sendResponse({ status: 'already_downloading' });
                    return;
                }
                activeDownloads.set(dlKey, { tabId: sender.tab?.id, videoId });
                try {
                    nativePort.postMessage({
                        action:       'download_video',
                        videoId,
                        title:        message.title,
                        url:          message.url,          // direct stream URL
                        isDirectUrl:  true,                 // tells host to wget/fetch the URL
                        isAudioOnly:  message.isAudioOnly || false,
                        savePath:     customPath,
                        developerMode: res?.developerMode === true
                    });
                    void appendBackgroundLog('info', 'download.browser_native_started', 'Direct stream download dispatched to native host.', '', { videoId });
                    sendResponse({ status: 'sent_to_native' });
                } catch (error) {
                    activeDownloads.delete(dlKey);
                    void appendBackgroundLog('error', 'download.browser_native_dispatch_failed', 'Direct stream native dispatch failed.', error.message, { videoId });
                    sendResponse({ status: 'failed_native_dispatch', error: error.message });
                }
            } else {
                // ── Standard chrome.downloads (no dialog, no 3rd-party intercept) ─
                const safeTitle = (typeof message.title === 'string' ? message.title : 'video')
                    .replace(/[\\/:*?"<>|]/g, '_')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .slice(0, 200);

                // Relative sub-folder keeps files organised inside Downloads
                const filename = `YouTube/${safeTitle}.mp4`;

                chrome.downloads.download({
                    url:      message.url,
                    filename: filename,
                    saveAs:   false          // ← never opens Save As / no 3rd-party intercept
                }, (downloadId) => {
                    if (chrome.runtime.lastError || !downloadId) {
                        void appendBackgroundLog('error', 'download.browser_failed', 'Browser download failed.', chrome.runtime.lastError?.message || '', { videoId });
                        sendResponse({ status: 'error', error: chrome.runtime.lastError?.message });
                    } else {
                        void appendBackgroundLog('info', 'download.browser_started', 'Browser download started.', '', { videoId, downloadId });
                        sendResponse({ status: 'ok', downloadId });
                    }
                });
            }
        });
        return true;   // async response
    }

    return false;
});
