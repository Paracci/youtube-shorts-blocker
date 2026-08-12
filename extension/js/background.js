// background.js – v1.9.0

try {
    importScripts('download-policy.js');
} catch (_) {
    // Keep legacy features alive if the shared policy is unavailable.
}

let nativePort = null;

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

function connectToNativeHost() {
    if (nativePort) return true;
    try {
        nativePort = chrome.runtime.connectNative('com.paracci.youtubedownloader');
    } catch (error) {
        nativePort = null;
        console.warn('[BG] Native host connection failed:', error.message);
        return false;
    }

    nativePort.onMessage.addListener((msg) => {
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
    if (message.action === 'resolve_formats') {
        const requestId = String(message.requestId || '');
        if (!isPageId(requestId)) {
            sendDownloadPageError(port, 'download_page_formats', requestId, 'invalid_request', 'Invalid request id.');
            return;
        }

        const parsed = typeof DownloadPolicy !== 'undefined'
            ? DownloadPolicy.parse(message.url)
            : { ok: false, reason: 'policy_unavailable' };
        if (!parsed.ok) {
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
        setTimeout(() => {
            if (downloadPageRequests.get(requestId) === entry) {
                downloadPageRequests.delete(requestId);
            }
        }, 10 * 60 * 1000);

        try {
            nativePort.postMessage({
                action: 'resolve_formats',
                requestId,
                url: parsed.canonicalUrl
            });
        } catch (_) {
            downloadPageRequests.delete(requestId);
            sendDownloadPageError(
                port,
                'download_page_formats',
                requestId,
                'native_required',
                'Could not contact native host.'
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

        chrome.storage.local.get(['downloadPath'], (result) => {
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
            nativePort.postMessage({ action: 'cancel_download', requestId, jobId });
        } catch (_) {
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
            sendResponse({ status: 'disconnected', error: error.message });
            return false;
        }

        testPort.onDisconnect.addListener(() => {
            if (responded) return;
            responded = true;
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
                sendResponse({ status: 'disconnected', error: 'postMessage failed' });
            }
        }

        // Hard timeout: if the host is alive but somehow doesn't reply in 2 s
        setTimeout(() => {
            if (responded) return;
            responded = true;
            try { testPort.disconnect(); } catch (_) {}
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
            try {
                updatePort.postMessage({ action: 'update_ytdlp' });
                sendResponse({ status: 'sent_to_native' });
            } catch (error) {
                updatePort.onMessage.removeListener(updateListener);
                sendResponse({ status: 'failed_native_dispatch', error: error.message });
            }
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
    if (message.action === 'open_download_folder') {
        chrome.storage.local.get(['downloadPath'], (result) => {
            if (!nativePort) connectToNativeHost();
            const port = nativePort;
            if (!port) {
                sendResponse({ status: 'error', error: 'native_not_connected' });
                return;
            }

            const requestId = 'folder-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            let responded = false;
            let timeoutId = null;
            const finish = (response) => {
                if (responded) return;
                responded = true;
                if (timeoutId) clearTimeout(timeoutId);
                try { port.onMessage.removeListener(folderListener); } catch (_) { }
                sendResponse(response);
            };
            const folderListener = (msg) => {
                if (msg?.action !== 'open_download_folder_result' || msg.requestId !== requestId) return;
                finish(msg.status === 'success'
                    ? { status: 'ok', path: msg.path || '' }
                    : { status: 'error', error: 'open_failed' });
            };

            port.onMessage.addListener(folderListener);
            timeoutId = setTimeout(() => finish({ status: 'error', error: 'timeout' }), 8000);

            try {
                port.postMessage({
                    action: 'open_download_folder',
                    requestId,
                    path: typeof result.downloadPath === 'string' ? result.downloadPath : ''
                });
            } catch (_) {
                finish({ status: 'error', error: 'postMessage failed' });
            }
        });
        return true;
    }

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
            chrome.storage.local.get(['downloadPath'], (res) => {
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
                        savePath:      res.downloadPath || ''
                    });
                } catch (error) {
                    activeDownloads.delete(dlKey);
                    console.warn('[BG] Native download dispatch failed:', error.message);
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
        chrome.storage.local.get(['downloadPath'], (res) => {
            const videoId = String(message.videoId || '');
            if (!/^[A-Za-z0-9_-]{6,}$/.test(videoId) || !isAllowedGoogleVideoUrl(message.url)) {
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
                        savePath:     customPath
                    });
                    sendResponse({ status: 'sent_to_native' });
                } catch (error) {
                    activeDownloads.delete(dlKey);
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
                        sendResponse({ status: 'error', error: chrome.runtime.lastError?.message });
                    } else {
                        sendResponse({ status: 'ok', downloadId });
                    }
                });
            }
        });
        return true;   // async response
    }

    return false;
});
