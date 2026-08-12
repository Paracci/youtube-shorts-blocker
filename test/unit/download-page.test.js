'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { FakeDocument, addElement } = require('../helpers/fake-dom.js');

const repoRoot = path.resolve(__dirname, '..', '..');
const pageSource = fs.readFileSync(path.join(repoRoot, 'extension', 'js', 'download-page.js'), 'utf8');
const policySource = fs.readFileSync(path.join(repoRoot, 'extension', 'js', 'download-policy.js'), 'utf8');

function loadPolicy() {
    const context = { URL, URLSearchParams, globalThis: {} };
    vm.runInNewContext(policySource, context, { filename: 'download-policy.js' });
    return context.globalThis.DownloadPolicy;
}

function makeDownloadHarness() {
    const document = new FakeDocument();
    const root = document.body;
    const ids = [
        ['url-form', 'form'], ['video-url', 'input'], ['url-status', 'div'], ['fetch-formats', 'button'],
        ['paste-url', 'button'], ['clear-url', 'button'], ['use-current-url', 'button'], ['open-setup', 'button'],
        ['change-path', 'button'], ['path-display', 'div'], ['path-status', 'div'], ['host-status-dot', 'span'],
        ['host-status-text', 'div'], ['media-card', 'section'], ['media-title', 'h2'], ['media-meta', 'p'],
        ['format-count', 'span'], ['presets-section', 'section'], ['preset-grid', 'div'],
        ['advanced-section', 'section'], ['advanced-toggle', 'button'], ['advanced-panel', 'div'],
        ['format-table-body', 'tbody'], ['advanced-empty', 'p'], ['jobs-section', 'aside'], ['jobs-panel', 'section'],
        ['jobs-panel-toggle', 'button'], ['jobs-open-folder', 'button'], ['jobs-panel-body', 'div'],
        ['jobs-list', 'div'], ['jobs-indicator', 'button'], ['jobs-indicator-format', 'span'],
        ['jobs-indicator-status', 'span'], ['jobs-indicator-count', 'span'], ['jobs-count', 'span'],
        ['jobs-live-status', 'div']
    ];
    const elements = {};
    ids.forEach(([id, tagName]) => {
        elements[id] = addElement(document, root, id, tagName, id === 'jobs-section' ? 'hidden' : '');
    });
    elements['jobs-panel-toggle'].setAttribute('data-i18n-title', 'downloadJobsCollapse');
    const folderLabel = addElement(document, elements['jobs-open-folder'], 'jobs-open-folder-label', 'span');
    folderLabel.setAttribute('data-i18n', 'downloadOpenFolder');
    folderLabel.textContent = 'Open folder';
    elements['video-url'].value = 'https://www.youtube.com/watch?v=abc12345678';
    elements['media-card'].className = 'hidden';
    elements['presets-section'].className = 'hidden';
    elements['advanced-section'].className = 'hidden';
    elements['advanced-panel'].hidden = true;
    elements['jobs-panel'].hidden = false;
    elements['jobs-indicator'].hidden = true;

    const portListeners = [];
    const sent = [];
    const port = {
        onMessage: { addListener(listener) { portListeners.push(listener); } },
        onDisconnect: { addListener() {} },
        postMessage(message) {
            sent.push(message);
        },
        emit(message) {
            portListeners.forEach(listener => listener(message));
        }
    };
    const timeouts = [];
    const storage = {
        get(key, callback) {
            if (key === 'userLang') callback({ userLang: 'en' });
            else callback({ downloadPath: 'C:\\Users\\Test\\Downloads' });
        },
        set(_value, callback) { callback?.(); }
    };
    const chrome = {
        runtime: {
            connect() { return port; },
            sendMessage(message, callback) {
                if (message.action === 'check_native_host_status') callback({ status: 'connected', ffmpegReady: true });
                else if (message.action === 'open_download_folder') callback({ status: 'ok', path: 'C:\\Users\\Test\\Downloads' });
                else callback({ status: 'ok' });
            },
            getURL(value) { return value; },
            lastError: null
        },
        storage: { local: storage, onChanged: { addListener() {} } },
        tabs: { query(_query, callback) { callback([]); }, create() {} }
    };
    const labels = {
        downloadOpenFolder: 'Open folder', downloadFolderOpened: 'Folder opened', downloadOpenFolderError: 'Could not open folder',
        downloadJobsTitle: 'Downloads', downloadJobsActive: 'Active downloads', downloadJobsCollapse: 'Minimize downloads',
        downloadJobsExpand: 'Show download activity', downloadFormat: 'Format', downloadDownload: 'Download',
        downloadPreparing: 'Preparing…', downloadInProgress: 'Downloading…', downloadComplete: 'Download complete',
        downloadCancelled: 'Download cancelled', downloadFailed: 'Download failed', downloadCancel: 'Cancel',
        downloadRetry: 'Retry', downloadReady: 'Formats ready', downloadLoading: 'Loading…', downloadMergedVideo: 'Video + audio',
        downloadBestAvailable: 'Highest available quality', downloadHeightLimit: 'Up to this resolution', downloadQualityBest: 'Best MP4',
        downloadAudioMp3: 'Audio MP3', downloadAudioM4a: 'Audio M4A', downloadExtractedAudio: 'Extracted audio',
        downloadResolution: 'Resolution', downloadCodec: 'Codec', downloadType: 'Type', downloadSize: 'Size',
        downloadOutputLabel: 'Output', downloadAction: 'Action', downloadNoFormats: 'No formats', downloadAudioOnly: 'Audio only',
        downloadVideoOnly: 'Video only', downloadMuxed: 'Video + audio', downloadCollapse: 'Hide formats', downloadExpand: 'Show formats',
        downloadBridgeDisconnected: 'Native host disconnected', downloadNativeRequired: 'Native host required', downloadHostChecking: 'Checking',
        downloadHostConnected: 'Native host ready', downloadFfmpegRequired: 'ffmpeg required', downloadHostDisconnected: 'Disconnected',
        downloadPathDefault: 'Default Downloads', downloadPathError: 'Folder error', downloadPathSaved: 'Folder saved', downloadPathCancelled: 'Cancelled',
        downloadPasteUnavailable: 'Paste unavailable', downloadCurrentTabInvalid: 'Invalid current tab', downloadPlaylistRejected: 'Playlist rejected',
        downloadYouTubeOnly: 'YouTube only', downloadHttpsRequired: 'HTTPS required', downloadInvalidUrl: 'Invalid URL', downloadCancelling: 'Cancelling…',
        downloadResolveFailed: 'Resolve failed', downloadFormatsFound: 'formats'
    };
    const i18n = { async init() {}, applyToDOM() {}, t(key) { return labels[key] || key; } };
    const window = {
        location: { search: '' },
        setTimeout(fn, delay) { const timer = { fn, delay }; timeouts.push(timer); return timer; },
        clearTimeout(timer) { if (timer) timer.cancelled = true; }
    };
    const documentHandlers = new Map();
    document.addEventListener = (type, handler) => {
        const list = documentHandlers.get(type) || [];
        list.push(handler);
        documentHandlers.set(type, list);
    };
    document.dispatchDOMContentLoaded = () => documentHandlers.get('DOMContentLoaded')?.forEach(handler => handler());

    const context = {
        document,
        window,
        chrome,
        i18n,
        DownloadPolicy: loadPolicy(),
        URL,
        URLSearchParams,
        crypto: { randomUUID: (() => { let id = 0; return () => 'test-id-' + (++id); })() }
    };
    vm.runInNewContext(pageSource, context, { filename: 'download-page.js' });
    document.dispatchDOMContentLoaded();

    return { document, elements, port, sent, timeouts };
}

function emitFormats(harness) {
    const request = harness.sent.find(message => message.action === 'resolve_formats');
    assert.ok(request, 'resolve_formats was not sent');
    harness.port.emit({
        action: 'download_page_formats',
        requestId: request.requestId,
        status: 'success',
        url: request.url,
        videoId: 'abc12345678',
        title: 'Test video',
        duration: 90,
        formats: [
            { id: '137', type: 'video', ext: 'mp4', height: 1080, fps: 30, vcodec: 'avc1', hasVideo: true, hasAudio: false, filesize: 1000 },
            { id: '140', type: 'audio', ext: 'm4a', acodec: 'mp4a', hasVideo: false, hasAudio: true, filesize: 500 }
        ]
    });
}

test('download page resolves formats and renders the fixed activity panel', async () => {
    const harness = makeDownloadHarness();
    await new Promise(resolve => setImmediate(resolve));
    harness.elements['url-form'].dispatchEvent({ type: 'submit', preventDefault() {} });
    emitFormats(harness);

    assert.equal(harness.elements['media-card'].classList.contains('hidden'), false);
    assert.ok(harness.elements['preset-grid'].children.length >= 3);
    const preset = harness.elements['preset-grid'].children[0];
    preset.click();

    assert.equal(harness.elements['jobs-section'].classList.contains('hidden'), false);
    assert.equal(harness.elements['jobs-list'].children.length, 1);
    assert.equal(harness.elements['jobs-list'].querySelector('.job-format').textContent, 'MP4');
    assert.equal(harness.elements['jobs-list'].querySelector('.job-status').textContent, 'Preparing…');

    harness.elements['jobs-open-folder'].click();
    assert.equal(harness.elements['jobs-open-folder'].classList.contains('is-success'), true);
    assert.equal(harness.elements['jobs-live-status'].textContent, 'Folder opened');
});

test('download page keeps job states independent and supports collapse/expand', async () => {
    const harness = makeDownloadHarness();
    await new Promise(resolve => setImmediate(resolve));
    harness.elements['url-form'].dispatchEvent({ type: 'submit', preventDefault() {} });
    emitFormats(harness);

    const firstPreset = harness.elements['preset-grid'].children[0];
    firstPreset.click();
    const firstJob = harness.sent.filter(message => message.action === 'start_download')[0];
    harness.port.emit({ action: 'download_page_progress', jobId: firstJob.jobId, percent: 44, message: 'Downloading…' });

    const secondPreset = harness.elements['preset-grid'].children[1];
    secondPreset.click();
    const jobs = harness.sent.filter(message => message.action === 'start_download');
    const secondJob = jobs[1];
    harness.port.emit({ action: 'download_page_result', jobId: firstJob.jobId, status: 'success', message: 'Done' });
    harness.port.emit({ action: 'download_page_progress', jobId: secondJob.jobId, percent: 62, message: 'Downloading…' });

    assert.equal(harness.elements['jobs-list'].children.length, 2);
    assert.equal(harness.elements['jobs-list'].children[0].dataset.jobId, secondJob.jobId);
    assert.equal(harness.elements['jobs-list'].children[1].dataset.jobId, firstJob.jobId);
    assert.equal(harness.elements['jobs-list'].children[0].classList.contains('is-active'), true);
    assert.equal(harness.elements['jobs-list'].children[1].classList.contains('is-success'), true);

    harness.elements['jobs-panel-toggle'].click();
    assert.equal(harness.elements['jobs-panel'].hidden, true);
    assert.equal(harness.elements['jobs-indicator'].hidden, false);
    harness.elements['jobs-indicator'].click();
    assert.equal(harness.elements['jobs-panel'].hidden, false);
    assert.equal(harness.elements['jobs-indicator'].hidden, true);
});

test('download page keeps Cancel and Retry actions scoped to the selected job', async () => {
    const harness = makeDownloadHarness();
    await new Promise(resolve => setImmediate(resolve));
    harness.elements['url-form'].dispatchEvent({ type: 'submit', preventDefault() {} });
    emitFormats(harness);

    harness.elements['preset-grid'].children[0].click();
    const firstJob = harness.sent.filter(message => message.action === 'start_download')[0];
    const activeRow = harness.elements['jobs-list'].children[0];
    activeRow.querySelector('.job-action').click();
    assert.equal(harness.sent.at(-1).action, 'cancel_download');
    assert.equal(harness.sent.at(-1).jobId, firstJob.jobId);

    harness.port.emit({
        action: 'download_page_result',
        jobId: firstJob.jobId,
        requestId: firstJob.requestId,
        status: 'cancelled',
        message: 'Cancelled'
    });
    const cancelledRow = harness.elements['jobs-list'].children[0];
    assert.equal(cancelledRow.classList.contains('is-cancelled'), true);
    assert.equal(cancelledRow.querySelector('.job-action').textContent, 'Retry');

    cancelledRow.querySelector('.job-action').click();
    const starts = harness.sent.filter(message => message.action === 'start_download');
    assert.equal(starts.length, 2);
    assert.notEqual(starts[0].jobId, starts[1].jobId);
    assert.equal(harness.elements['jobs-list'].children.length, 2);
    assert.equal(harness.elements['jobs-list'].children[1].dataset.jobId, firstJob.jobId);
});
