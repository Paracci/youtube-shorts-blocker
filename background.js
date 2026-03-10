// background.js – v1.8

let nativePort = null;

function connectToNativeHost() {
    nativePort = chrome.runtime.connectNative('com.paracci.youtubedownloader');

    nativePort.onMessage.addListener((msg) => {
        console.log("Received from native host:", msg);
        if (msg && msg.action === 'download_video_result') {
            chrome.tabs.query({ url: "*://*.youtube.com/*" }, (tabs) => {
                tabs.forEach(tab => chrome.tabs.sendMessage(tab.id, msg));
            });
        }
    });

    nativePort.onDisconnect.addListener(() => {
        console.warn("Disconnected from Native Host", chrome.runtime.lastError);
        nativePort = null;
    });
}

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        chrome.tabs.create({ url: 'setup.html' });
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'ping') {
        sendResponse({ ok: true });
    } else if (message.action === 'check_native_host_status') {
        const testPort = chrome.runtime.connectNative('com.paracci.youtubedownloader');
        
        testPort.onDisconnect.addListener(() => {
            if (chrome.runtime.lastError) {
                sendResponse({ status: 'disconnected', error: chrome.runtime.lastError.message });
            }
        });
        
        testPort.onMessage.addListener((msg) => {
            // Unlikely to receive message immediately but connection established successfully
        });

        // If it doesn't immediately disconnect, it's connected
        // Send a small timeout to verify
        setTimeout(() => {
            if (testPort) {
                // Connection successfully held
                sendResponse({ status: 'connected' });
                testPort.disconnect(); // clean up test port
            }
        }, 500);
        return true;

    } else if (message.action === 'update_downloader_native') {
        if (!nativePort) {
            connectToNativeHost();
        }
        if (nativePort) {
            // Because setup.js doesn't have a port, we temporarily assign a listener 
            // to send progress back, but `chrome.runtime.sendMessage` only allows one response.
            // Since `setup.js` can just listen to the background broadcasting updates:
            nativePort.postMessage({ action: 'update_ytdlp' });
            sendResponse({ status: 'sent_to_native' });
            
            // Temporary listener for this specific update flow
            const updateListener = (msg) => {
                if (msg.status === 'info' || msg.status === 'progress' || msg.status === 'error_log' || msg.status === 'update_success') {
                    // Broadcast to any open setup.html pages
                    chrome.runtime.sendMessage({ action: 'ytdlp_update_progress', data: msg });
                }
                if (msg.status === 'update_success' || msg.status === 'error') {
                    nativePort.onMessage.removeListener(updateListener);
                }
            };
            nativePort.onMessage.addListener(updateListener);
            
        } else {
            sendResponse({ status: 'failed_native_connect' });
        }
        return true;

    } else if (message.action === 'download_video_native') {
        if (!nativePort) {
            connectToNativeHost();
        }
        if (nativePort) {
            nativePort.postMessage({
                action: 'download_video',
                videoId: message.videoId,
                title: message.title,
                videoQuality: message.videoQuality,
                qualityHeight: message.qualityHeight,
                isAudioOnly: message.isAudioOnly,
                isVideoAudio: message.isVideoAudio
            });
            sendResponse({ status: 'sent_to_native' });
        } else {
            sendResponse({ status: 'failed_native_connect' });
        }
    }
    return true; // async response
});