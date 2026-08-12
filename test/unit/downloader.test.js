'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'extension', 'js', 'downloader.js'), 'utf8');

function makePlayerResponse({ formats = [], adaptiveFormats = [], title = 'Fixture video' } = {}) {
    return {
        videoDetails: { title },
        streamingData: { formats, adaptiveFormats }
    };
}

function makeMuxedFormat({ itag = 18, qualityLabel = '360p', height = 360, url = 'https://r1---sn.googlevideo.com/videoplayback' } = {}) {
    return {
        itag,
        qualityLabel,
        height,
        fps: 30,
        mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
        contentLength: '123456',
        url
    };
}

function makeAdaptiveVideo({ itag, qualityLabel, height, mimeType }) {
    return {
        itag,
        qualityLabel,
        height,
        fps: 60,
        mimeType,
        contentLength: '123456789'
    };
}

function loadDownloader({ fetchImpl, documentOverride } = {}) {
    const defaultDocument = {
        documentElement: { lang: 'en' },
        title: 'YouTube',
        querySelector() { return null; },
        querySelectorAll() { return []; },
        body: {
            appendChild() {}
        },
        createElement() {
            return {
                style: {},
                click() {},
                remove() {}
            };
        }
    };
    const document = documentOverride || defaultDocument;
    const runtimeListeners = [];
    const nativeMessages = [];
    const notifications = [];
    const intervals = [];
    const window = {
        location: { pathname: '/watch', search: '?v=MzS1v115Wa4' },
        addEventListener() {}
    };
    const chrome = {
        runtime: {
            id: 'test-extension',
            onMessage: { addListener(listener) { runtimeListeners.push(listener); } },
            sendMessage() {}
        }
    };
    const context = {
        console,
        document,
        window,
        chrome,
        URL,
        URLSearchParams,
        AbortController,
        Blob,
        Map,
        Set,
        Promise,
        Number,
        String,
        Boolean,
        Math,
        JSON,
        parseInt,
        setTimeout(fn) { fn(); return 0; },
        clearTimeout() {},
        setInterval(fn, delay) {
            const timer = { fn, delay, cleared: false };
            intervals.push(timer);
            return timer;
        },
        clearInterval(timer) {
            if (timer) timer.cleared = true;
        },
        MutationObserver: class {
            constructor(callback) { this.callback = callback; this.disconnected = false; }
            observe() {}
            disconnect() { this.disconnected = true; }
        },
        fetch: fetchImpl || (async () => ({ ok: false })),
        alert() {},
        confirm() { return false; },
        i18n: { t(key) { return key; } },
        showYouTubeNotification(title, message, videoId, state, options = {}) {
            const notification = {
                title,
                message,
                videoId,
                state,
                options,
                success(nextMessage) {
                    notification.state = 'success';
                    notification.message = nextMessage;
                },
                update(nextMessage, progress) {
                    notification.message = nextMessage;
                    notification.progress = progress;
                },
                setState(nextState, nextMessage, progress) {
                    notification.state = nextState;
                    notification.message = nextMessage;
                    notification.progress = progress;
                },
                remove() {},
                showAction() { notification.actionVisible = true; },
                showRetry() { notification.retryVisible = true; },
                isVisible() { return true; }
            };
            notifications.push(notification);
            return notification;
        },
        safeMsg(message) {
            nativeMessages.push(message);
            return Promise.resolve({ status: 'sent_to_native' });
        },
        EXTENSION_ENABLED: true,
        DOWNLOADER_ENABLED: true,
        appendShortsControl() {}
    };

    const exportSource = `
        globalThis.__downloaderExports = {
            parseStreamingData,
            deduplicateAndSort: _deduplicateAndSort,
            mergeFormatResults,
            fetchVideoFormats,
            triggerDownload,
            initVideoDownloadButton,
            addVideoDownloadButton
        };
    `;
    vm.runInNewContext(source + exportSource, context, { filename: 'downloader.js' });

    return {
        exports: context.__downloaderExports,
        context,
        nativeMessages,
        notifications,
        runtimeListeners,
        intervals
    };
}

test('parser keeps URL-less 4K and 1440p adaptive metadata without stream URLs', () => {
    const harness = loadDownloader();
    const formats = harness.exports.parseStreamingData(makePlayerResponse({
        formats: [makeMuxedFormat()],
        adaptiveFormats: [
            makeAdaptiveVideo({ itag: 315, qualityLabel: '2160p60', height: 2160, mimeType: 'video/webm; codecs="vp9"' }),
            makeAdaptiveVideo({ itag: 401, qualityLabel: '2160p60', height: 2160, mimeType: 'video/mp4; codecs="av01.0.13M.08"' }),
            makeAdaptiveVideo({ itag: 308, qualityLabel: '1440p60', height: 1440, mimeType: 'video/webm; codecs="vp9"' }),
            makeAdaptiveVideo({ itag: 400, qualityLabel: '1440p60', height: 1440, mimeType: 'video/mp4; codecs="av01.0.12M.08"' })
        ]
    }));

    const fourK = formats.find(format => format.itag === 315);
    const fourKAv1 = formats.find(format => format.itag === 401);
    const q1440 = formats.find(format => format.itag === 308);
    assert.equal(fourK.type, 'video');
    assert.equal(fourK.height, 2160);
    assert.equal(fourK.fps, 60);
    assert.equal(fourK.hasDirectUrl, false);
    assert.equal('url' in fourK, false);
    assert.equal(fourKAv1.hasDirectUrl, false);
    assert.equal(q1440.height, 1440);
    assert.equal(JSON.stringify(fourK).includes('cipher'), false);
});

test('deduplication prefers a direct stream URL over metadata-only entries', () => {
    const harness = loadDownloader();
    const result = harness.exports.deduplicateAndSort([
        {
            quality: '720p', height: 720, fps: 30, type: 'video_audio',
            mime: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
            itag: 18, hasDirectUrl: false, source: 'ANDROID'
        },
        {
            quality: '720p', height: 720, fps: 30, type: 'video_audio',
            mime: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
            itag: 18, hasDirectUrl: true,
            url: 'https://r1---sn.googlevideo.com/videoplayback', source: 'WEB'
        }
    ], 'Fixture video');

    assert.equal(result.formats.length, 1);
    assert.equal(result.formats[0].hasDirectUrl, true);
    assert.match(result.formats[0].url, /^https:\/\/.*googlevideo\.com/);
});

test('format fetch combines IOS muxed results with Android 4K metadata', async () => {
    const calls = [];
    const harness = loadDownloader({
        fetchImpl: async (_url, options) => {
            const payload = JSON.parse(options.body);
            const clientName = payload.context.client.clientName;
            calls.push(clientName);
            if (clientName === 'IOS') {
                return { ok: true, async json() {
                    return makePlayerResponse({ formats: [makeMuxedFormat()] });
                } };
            }
            if (clientName === 'ANDROID') {
                return { ok: true, async json() {
                    return makePlayerResponse({
                        formats: [makeMuxedFormat()],
                        adaptiveFormats: [
                            makeAdaptiveVideo({ itag: 315, qualityLabel: '2160p60', height: 2160, mimeType: 'video/webm; codecs="vp9"' }),
                            makeAdaptiveVideo({ itag: 401, qualityLabel: '2160p60', height: 2160, mimeType: 'video/mp4; codecs="av01.0.13M.08"' }),
                            makeAdaptiveVideo({ itag: 308, qualityLabel: '1440p60', height: 1440, mimeType: 'video/webm; codecs="vp9"' })
                        ]
                    });
                } };
            }
            return { ok: false };
        }
    });

    const result = await harness.exports.fetchVideoFormats();
    assert.deepEqual(calls, ['IOS', 'ANDROID', 'TVHTML5_SIMPLY_EMBEDDED_PLAYER']);
    assert.ok(result.formats.some(format => format.height === 2160));
    assert.ok(result.formats.some(format => format.height === 1440));
    assert.ok(result.formats.some(format => format.height === 360 && format.type === 'video_audio'));
});

test('URL-less 2160p selection is sent to native host with its quality height', async () => {
    const harness = loadDownloader();
    await harness.exports.triggerDownload({
        quality: '2160p60 (High Quality)',
        height: 2160,
        fps: 60,
        mime: 'video/webm; codecs="vp9"',
        type: 'video',
        hasDirectUrl: false
    }, 'Fixture video');

    assert.equal(harness.nativeMessages.length, 1);
    const message = harness.nativeMessages[0];
    assert.equal(message.action, 'download_video_native');
    assert.match(message.downloadId, /^download-/);
    assert.equal(message.videoId, 'MzS1v115Wa4');
    assert.equal(message.title, 'Fixture video');
    assert.equal(message.videoQuality, '2160p60 (High Quality)');
    assert.equal(message.qualityHeight, 2160);
    assert.equal(message.isAudioOnly, false);
    assert.equal(message.isVideoAudio, false);
    assert.equal('url' in harness.nativeMessages[0], false);
});

test('direct stream notification cancels the fetch through AbortController', async () => {
    let fetchSignal = null;
    let resolveFetch;
    const fetchPromise = new Promise(resolve => { resolveFetch = resolve; });
    const harness = loadDownloader({
        fetchImpl: async (_url, options) => {
            fetchSignal = options.signal;
            return fetchPromise;
        }
    });

    const downloadTask = harness.exports.triggerDownload({
        quality: '360p',
        height: 360,
        fps: 30,
        mime: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
        type: 'video_audio',
        hasDirectUrl: true,
        url: 'https://r1---sn.googlevideo.com/videoplayback'
    }, 'Fixture video');

    await Promise.resolve();
    assert.equal(harness.notifications.length, 1);
    assert.ok(fetchSignal);
    harness.notifications[0].options.onCancel();
    assert.equal(fetchSignal.aborted, true);

    resolveFetch({
        ok: true,
        headers: { get() { return '4'; } },
        body: {
            getReader() {
                return {
                    async read() {
                        const error = new Error('The operation was aborted.');
                        error.name = 'AbortError';
                        throw error;
                    }
                };
            }
        }
    });
    await downloadTask;
    assert.equal(harness.notifications[0].state, 'cancelled');
});

test('normal video button retries quickly while the player controls are being created', () => {
    let controlsAvailable = false;
    const controls = {
        children: [],
        querySelector(selector) {
            if (selector === '.my-video-dl-btn') {
                return this.children.find(child => String(child.className || '').includes('my-video-dl-btn')) || null;
            }
            return null;
        },
        appendChild(child) {
            this.children.push(child);
            child.parentNode = this;
        }
    };
    const document = {
        documentElement: { lang: 'en' },
        title: 'YouTube',
        body: {},
        querySelector(selector) {
            if (selector === '.ytp-right-controls-left' && controlsAvailable) return controls;
            return null;
        },
        querySelectorAll() { return []; },
        createElement() {
            return {
                classList: { add() {}, remove() {} },
                style: {},
                setAttribute() {},
                addEventListener() {},
                querySelector() { return { textContent: '' }; }
            };
        }
    };
    const harness = loadDownloader({ documentOverride: document });

    harness.exports.initVideoDownloadButton();
    assert.equal(harness.intervals.length, 1);
    assert.equal(harness.intervals[0].delay, 100);
    assert.equal(controls.children.length, 0);

    controlsAvailable = true;
    harness.intervals[0].fn();
    assert.equal(controls.children.length, 1);
    assert.equal(controls.children[0].className.includes('my-video-dl-btn'), true);
    assert.equal(harness.intervals[0].cleared, true);
});

test('normal video button exposes a YouTube-style tooltip on hover and focus', () => {
    const makeElement = (tagName = 'div') => {
        const attributes = new Map();
        const listeners = new Map();
        const classNames = new Set();
        const element = {
            tagName,
            className: '',
            children: [],
            parentNode: null,
            style: {},
            hidden: false,
            offsetHeight: 32,
            classList: {
                add(name) { classNames.add(name); },
                remove(name) { classNames.delete(name); },
                contains(name) { return classNames.has(name); }
            },
            setAttribute(name, value) {
                attributes.set(name, String(value));
                if (name === 'id') element.id = String(value);
            },
            getAttribute(name) { return attributes.get(name) || null; },
            removeAttribute(name) { attributes.delete(name); },
            addEventListener(name, handler) { listeners.set(name, handler); },
            dispatch(name) { listeners.get(name)?.({ type: name, target: element }); },
            appendChild(child) {
                element.children.push(child);
                child.parentNode = element;
                return child;
            },
            querySelector(selector) {
                if (selector === '.my-video-dl-btn') {
                    return element.children.find(child => String(child.className || '').includes('my-video-dl-btn')) || null;
                }
                return null;
            },
            getBoundingClientRect() {
                return { left: 100, top: 700, right: 148, bottom: 724, width: 48, height: 24 };
            }
        };
        return element;
    };

    const body = makeElement('body');
    const controls = makeElement('div');
    const document = {
        documentElement: { lang: 'en', clientWidth: 1280 },
        title: 'YouTube',
        body,
        querySelector(selector) {
            if (selector === '.ytp-right-controls-left') return controls;
            return null;
        },
        querySelectorAll() { return []; },
        getElementById(id) {
            return body.children.find(child => child.id === id) || null;
        },
        createElement(tagName) { return makeElement(tagName); }
    };
    const harness = loadDownloader({ documentOverride: document });

    harness.exports.addVideoDownloadButton();
    const button = controls.children[0];
    assert.equal(button.getAttribute('data-title'), 'dlBtnTitle');
    assert.equal(button.getAttribute('data-tooltip-text'), 'dlBtnTitle');
    assert.equal(button.getAttribute('aria-label'), 'dlBtnAriaLabel');

    button.dispatch('mouseenter');
    const tooltip = document.getElementById('my-video-dl-tooltip');
    assert.ok(tooltip);
    assert.equal(tooltip.textContent, 'dlBtnTitle');
    assert.equal(tooltip.hidden, false);
    assert.equal(tooltip.classList.contains('is-visible'), true);
    assert.equal(button.getAttribute('aria-describedby'), 'my-video-dl-tooltip');

    button.dispatch('mouseleave');
    assert.equal(tooltip.hidden, true);
    assert.equal(tooltip.classList.contains('is-visible'), false);
    assert.equal(button.getAttribute('aria-describedby'), null);

    button.dispatch('focus');
    assert.equal(tooltip.hidden, false);
    button.dispatch('blur');
    assert.equal(tooltip.hidden, true);
});
