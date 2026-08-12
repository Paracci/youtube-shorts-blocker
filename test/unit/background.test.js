'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'extension', 'js', 'background.js'), 'utf8');

function makeBackgroundHarness({ connectThrows = false } = {}) {
    const runtime = { onMessage: [], onConnect: [], onInstalled: [] };
    const nativeMessages = [];
    const tabMessages = [];
    const messageListeners = [];
    const disconnectListeners = [];
    const schedule = (callback, delay) => {
        const timer = setTimeout(callback, delay);
        timer.unref?.();
        return timer;
    };
    const nativePort = {
        onMessage: {
            addListener(listener) { messageListeners.push(listener); },
            removeListener(listener) {
                const index = messageListeners.indexOf(listener);
                if (index >= 0) messageListeners.splice(index, 1);
            }
        },
        onDisconnect: {
            addListener(listener) { disconnectListeners.push(listener); }
        },
        postMessage(message) { nativeMessages.push(message); },
        disconnect() { disconnectListeners.forEach(listener => listener()); },
        emit(message) { [...messageListeners].forEach(listener => listener(message)); }
    };
    const storage = {
        get(_key, callback) { callback({ downloadPath: 'C:\\Users\\Test\\Downloads' }); },
        set(_value, callback) { callback?.(); }
    };
    const chrome = {
        runtime: {
            onMessage: { addListener(listener) { runtime.onMessage.push(listener); } },
            onConnect: { addListener(listener) { runtime.onConnect.push(listener); } },
            onInstalled: { addListener(listener) { runtime.onInstalled.push(listener); } },
            connectNative() {
                if (connectThrows) throw new Error('native host unavailable');
                return nativePort;
            },
            sendMessage() { return Promise.resolve(); },
            lastError: null
        },
        storage: { local: storage },
        tabs: {
            sendMessage(tabId, message, callback) {
                tabMessages.push({ tabId, message });
                callback?.();
            }
        }
    };
    const context = { chrome, console, URL, setTimeout: schedule, clearTimeout, Map, Set, Promise };
    context.importScripts = (...scripts) => {
        scripts.forEach(script => {
            const policySource = fs.readFileSync(
                path.join(repoRoot, 'extension', 'js', script),
                'utf8'
            );
            vm.runInNewContext(policySource, context, { filename: script });
        });
    };
    vm.runInNewContext(source, context, { filename: 'background.js' });

    return {
        listener: runtime.onMessage[0],
        nativeMessages,
        tabMessages,
        nativePort,
        connectPage(name) {
            const pageMessages = [];
            const pageListeners = [];
            const pageDisconnectListeners = [];
            const pagePort = {
                name,
                onMessage: {
                    addListener(listener) { pageListeners.push(listener); },
                    removeListener(listener) {
                        const index = pageListeners.indexOf(listener);
                        if (index >= 0) pageListeners.splice(index, 1);
                    }
                },
                onDisconnect: {
                    addListener(listener) { pageDisconnectListeners.push(listener); }
                },
                postMessage(message) { pageMessages.push(message); },
                emit(message) { [...pageListeners].forEach(listener => listener(message)); },
                disconnect() { [...pageDisconnectListeners].forEach(listener => listener()); }
            };
            runtime.onConnect.forEach(listener => listener(pagePort));
            pagePort.messages = pageMessages;
            return pagePort;
        }
    };
}

function callMessage(harness, message) {
    return new Promise(resolve => {
        harness.listener(message, { tab: { id: 7 } }, resolve);
    });
}

test('background routes open-folder requests through storage and native messaging', async () => {
    const harness = makeBackgroundHarness();
    const responsePromise = callMessage(harness, { action: 'open_download_folder' });
    assert.equal(harness.nativeMessages.length, 1);
    const request = harness.nativeMessages[0];
    assert.equal(request.action, 'open_download_folder');
    assert.equal(request.path, 'C:\\Users\\Test\\Downloads');
    assert.match(request.requestId, /^folder-/);

    harness.nativePort.emit({ action: 'open_download_folder_result', requestId: 'folder-wrong', status: 'success' });
    let settled = false;
    responsePromise.then(() => { settled = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false);

    harness.nativePort.emit({ action: 'open_download_folder_result', requestId: request.requestId, status: 'success', path: request.path });
    assert.deepEqual({ ...await responsePromise }, { status: 'ok', path: request.path });
});

test('background keeps concurrent folder requests isolated by requestId', async () => {
    const harness = makeBackgroundHarness();
    const first = callMessage(harness, { action: 'open_download_folder' });
    const second = callMessage(harness, { action: 'open_download_folder' });
    const requests = harness.nativeMessages.slice(-2);
    assert.notEqual(requests[0].requestId, requests[1].requestId);

    harness.nativePort.emit({ action: 'open_download_folder_result', requestId: requests[1].requestId, status: 'success', path: requests[1].path });
    harness.nativePort.emit({ action: 'open_download_folder_result', requestId: requests[0].requestId, status: 'success', path: requests[0].path });
    assert.deepEqual({ ...await first }, { status: 'ok', path: requests[0].path });
    assert.deepEqual({ ...await second }, { status: 'ok', path: requests[1].path });
});

test('background fails closed when the native host cannot connect', async () => {
    const harness = makeBackgroundHarness({ connectThrows: true });
    assert.deepEqual({ ...await callMessage(harness, { action: 'open_download_folder' }) }, {
        status: 'error',
        error: 'native_not_connected'
    });
});

test('background isolates standalone page formats, jobs, progress, results, and cancellation', () => {
    const harness = makeBackgroundHarness();
    const firstPage = harness.connectPage('download-page');
    const secondPage = harness.connectPage('download-page');
    const firstRequestId = 'request-A01';
    const secondRequestId = 'request-B01';
    const firstJobId = 'job-A-0001';
    const secondJobId = 'job-B-0001';
    const url = 'https://www.youtube.com/watch?v=abc12345678';

    firstPage.emit({ action: 'resolve_formats', requestId: firstRequestId, url });
    secondPage.emit({ action: 'resolve_formats', requestId: secondRequestId, url });

    const resolveMessages = harness.nativeMessages.filter(message => message.action === 'resolve_formats');
    assert.equal(resolveMessages.length, 2);
    assert.deepEqual(resolveMessages.map(message => message.requestId), [firstRequestId, secondRequestId]);
    assert.equal(firstPage.messages.length, 0);
    assert.equal(secondPage.messages.length, 0);

    harness.nativePort.emit({
        action: 'download_page_formats',
        requestId: firstRequestId,
        status: 'success',
        formats: [{ id: '18', hasVideo: true, hasAudio: true }]
    });
    assert.equal(firstPage.messages.at(-1).requestId, firstRequestId);
    assert.equal(secondPage.messages.length, 0);

    harness.nativePort.emit({
        action: 'download_page_formats',
        requestId: 'request-wrong',
        status: 'success',
        formats: []
    });
    assert.equal(secondPage.messages.length, 0);

    firstPage.emit({
        action: 'start_download',
        requestId: firstRequestId,
        jobId: firstJobId,
        url,
        formatId: '18',
        outputFormat: 'mp4',
        title: 'First video'
    });
    secondPage.emit({
        action: 'start_download',
        requestId: secondRequestId,
        jobId: secondJobId,
        url,
        profileId: 'audio_mp3',
        outputFormat: 'mp3',
        title: 'Second video'
    });

    const downloadMessages = harness.nativeMessages.filter(message => message.action === 'download_video');
    assert.equal(downloadMessages.length, 2);
    assert.equal(downloadMessages[0].jobId, firstJobId);
    assert.equal(downloadMessages[1].jobId, secondJobId);
    assert.equal(downloadMessages[0].formatId, '18');
    assert.equal(downloadMessages[1].profileId, 'audio_mp3');
    assert.equal(firstPage.messages.at(-1).action, 'download_page_dispatch_result');
    assert.equal(secondPage.messages.at(-1).jobId, secondJobId);

    harness.nativePort.emit({ action: 'download_page_progress', jobId: firstJobId, requestId: firstRequestId, percent: 42 });
    assert.equal(firstPage.messages.at(-1).jobId, firstJobId);
    assert.equal(firstPage.messages.at(-1).percent, 42);
    assert.equal(secondPage.messages.some(message => message.jobId === firstJobId), false);

    firstPage.emit({ action: 'cancel_download', requestId: firstRequestId, jobId: firstJobId });
    const cancelMessage = harness.nativeMessages.at(-1);
    assert.deepEqual({ action: cancelMessage.action, requestId: cancelMessage.requestId, jobId: cancelMessage.jobId }, {
        action: 'cancel_download',
        requestId: firstRequestId,
        jobId: firstJobId
    });

    harness.nativePort.emit({
        action: 'download_page_result',
        requestId: firstRequestId,
        jobId: firstJobId,
        status: 'success'
    });
    assert.equal(firstPage.messages.at(-1).jobId, firstJobId);
    assert.equal(secondPage.messages.some(message => message.jobId === firstJobId), false);

    harness.nativePort.emit({
        action: 'download_page_result',
        requestId: secondRequestId,
        jobId: secondJobId,
        status: 'error',
        errorCode: 'ffmpeg_required'
    });
    assert.equal(secondPage.messages.at(-1).jobId, secondJobId);
    assert.equal(firstPage.messages.at(-1).jobId, firstJobId);
});

test('background rejects standalone selections that do not match the resolved request', () => {
    const harness = makeBackgroundHarness();
    const page = harness.connectPage('download-page');
    page.emit({
        action: 'start_download',
        requestId: 'request-C01',
        jobId: 'job-C-0001',
        url: 'https://www.youtube.com/watch?v=abc12345678',
        profileId: 'audio_mp3',
        outputFormat: 'mp4'
    });

    const response = page.messages.at(-1);
    assert.equal(response.action, 'download_page_dispatch_result');
    assert.equal(response.status, 'error');
    assert.equal(response.errorCode, 'invalid_download_request');
    assert.equal(harness.nativeMessages.some(message => message.action === 'download_video'), false);
});

test('background isolates normal YouTube download progress and cancellation by downloadId', async () => {
    const harness = makeBackgroundHarness();
    const videoId = 'abc12345678';
    const downloadId = 'download-normal-A01';
    const dispatch = await callMessage(harness, {
        action: 'download_video_native',
        downloadId,
        videoId,
        title: 'Example video',
        videoQuality: '1080p',
        qualityHeight: 1080,
        isAudioOnly: false,
        isVideoAudio: false
    });

    assert.deepEqual({ ...dispatch }, { status: 'sent_to_native' });
    const nativeRequest = harness.nativeMessages.at(-1);
    assert.equal(nativeRequest.action, 'download_video');
    assert.equal(nativeRequest.downloadId, downloadId);

    harness.nativePort.emit({
        action: 'download_video_progress',
        downloadId,
        videoId,
        status: 'progress',
        percent: 42,
        speed: '2MiB/s',
        eta: '00:08'
    });
    assert.deepEqual(harness.tabMessages.at(-1), {
        tabId: 7,
        message: {
            action: 'download_video_progress',
            downloadId,
            videoId,
            status: 'progress',
            percent: 42,
            speed: '2MiB/s',
            eta: '00:08'
        }
    });

    const wrongCount = harness.tabMessages.length;
    harness.nativePort.emit({
        action: 'download_video_progress',
        downloadId: 'download-other-B02',
        videoId,
        status: 'progress',
        percent: 90
    });
    assert.equal(harness.tabMessages.length, wrongCount);

    const cancel = await callMessage(harness, {
        action: 'cancel_video_download',
        downloadId,
        videoId
    });
    assert.deepEqual({ ...cancel }, { status: 'cancel_requested' });
    assert.equal(harness.nativeMessages.at(-1).action, 'cancel_video_download');
    assert.equal(harness.nativeMessages.at(-1).downloadId, downloadId);
    assert.equal(harness.nativeMessages.at(-1).videoId, videoId);

    harness.nativePort.emit({
        action: 'download_video_result',
        downloadId,
        videoId,
        status: 'cancelled',
        title: 'Example video'
    });
    assert.equal(harness.tabMessages.at(-1).message.status, 'cancelled');

    const afterFinish = await callMessage(harness, {
        action: 'cancel_video_download',
        downloadId,
        videoId
    });
    assert.deepEqual({ ...afterFinish }, { status: 'download_not_found' });
});
