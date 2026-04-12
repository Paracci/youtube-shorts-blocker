// background.js – v1.9.0

let nativePort = null;

// ── Active download tracking (rate-limit / dedup) ─────────────────────────────
// Maps "videoId|quality" → true. Prevents the same video+quality from being
// queued multiple times if the user clicks the download button rapidly.
const activeDownloads = new Map();

function connectToNativeHost() {
    nativePort = chrome.runtime.connectNative('com.paracci.youtubedownloader');

    nativePort.onMessage.addListener((msg) => {
        console.log('[BG] Native host message:', msg);

        // When a download finishes (success or error), free the slot
        if (msg && msg.action === 'download_video_result') {
            // Remove any key that matches this videoId
            for (const key of activeDownloads.keys()) {
                if (key.startsWith(msg.videoId + '|')) activeDownloads.delete(key);
            }

            chrome.tabs.query({ url: '*://*.youtube.com/*' }, (tabs) => {
                tabs.forEach(tab => {
                    chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
                });
            });
        }
    });

    nativePort.onDisconnect.addListener(() => {
        const err = chrome.runtime.lastError;
        console.warn('[BG] Native host disconnected:', err?.message);
        nativePort = null;
        activeDownloads.clear();
    });
}

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        chrome.tabs.create({ url: 'views/setup.html' });
    }
});

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

        const testPort = chrome.runtime.connectNative('com.paracci.youtubedownloader');

        testPort.onDisconnect.addListener(() => {
            if (responded) return;
            responded = true;
            sendResponse({ status: 'disconnected', error: chrome.runtime.lastError?.message });
        });

        testPort.onMessage.addListener((msg) => {
            if (responded) return;
            if (msg?.status === 'pong' || msg?.status === 'ready') {
                responded = true;
                sendResponse({ status: 'connected' });
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
            nativePort.postMessage({ action: 'update_ytdlp' });
            sendResponse({ status: 'sent_to_native' });

            const updateListener = (msg) => {
                if (['info', 'progress', 'error_log', 'update_success'].includes(msg?.status)) {
                    chrome.runtime.sendMessage({ action: 'ytdlp_update_progress', data: msg })
                        .catch(() => {});
                }
                if (msg?.status === 'update_success' || msg?.status === 'error') {
                    nativePort?.onMessage.removeListener(updateListener);
                }
            };
            nativePort.onMessage.addListener(updateListener);
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

    // ── Download video (native host — yt-dlp) ─────────────────────────────────
    if (message.action === 'download_video_native') {
        const dlKey = `${message.videoId}|${message.videoQuality}`;

        // Reject if the exact same video+quality is already downloading
        if (activeDownloads.has(dlKey)) {
            sendResponse({ status: 'already_downloading' });
            return false;
        }

        if (!nativePort) connectToNativeHost();

        if (nativePort) {
            // Read the user-configured save path and forward it to native host
            chrome.storage.local.get(['downloadPath'], (res) => {
                activeDownloads.set(dlKey, true);
                nativePort.postMessage({
                    action:        'download_video',
                    videoId:       message.videoId,
                    title:         message.title,
                    videoQuality:  message.videoQuality,
                    qualityHeight: message.qualityHeight,
                    isAudioOnly:   message.isAudioOnly,
                    isVideoAudio:  message.isVideoAudio,
                    savePath:      res.downloadPath || ''   // ← custom folder or empty = default
                });
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
    if (message.action === 'download_video_browser') {
        chrome.storage.local.get(['downloadPath'], (res) => {
            const customPath = (res.downloadPath || '').trim();

            if (customPath && nativePort) {
                // ── Route to native host for custom-folder support ────────────
                const dlKey = `${message.videoId}|browser`;
                if (activeDownloads.has(dlKey)) {
                    sendResponse({ status: 'already_downloading' });
                    return;
                }
                activeDownloads.set(dlKey, true);
                nativePort.postMessage({
                    action:       'download_video',
                    videoId:      message.videoId,
                    title:        message.title,
                    url:          message.url,          // direct stream URL
                    isDirectUrl:  true,                 // tells host to wget/fetch the URL
                    isAudioOnly:  message.isAudioOnly || false,
                    savePath:     customPath
                });
                sendResponse({ status: 'sent_to_native' });
            } else {
                // ── Standard chrome.downloads (no dialog, no 3rd-party intercept) ─
                const safeTitle = (message.title || 'video')
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