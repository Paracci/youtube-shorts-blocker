'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const root = path.resolve(__dirname, '../..');

function harness(initialPremium) {
    let premium = initialPremium;
    let counter = 0;
    const listeners = [];
    const timers = [];
    const navigations = {};
    const accepted = [];
    const sent = [];
    const window = {
        location: { hostname: 'www.youtube.com', origin: 'https://www.youtube.com' },
        ytcfg: { get: key => key === 'IS_YT_PREMIUM' ? premium : undefined },
        addEventListener: (_type, listener) => listeners.push(listener),
        postMessage(data) {
            sent.push(data);
            for (const listener of listeners) listener({ source: window, origin: window.location.origin, data });
        }
    };
    const context = vm.createContext({
        window,
        document: {
            readyState: 'complete', querySelector: () => null,
            addEventListener: (name, callback) => { navigations[name] = callback; },
            createElement() { throw new Error('External script loading is forbidden in this regression test'); }
        },
        chrome: { runtime: { id: 'fixture' }, storage: { local: { set() {} } } },
        crypto: { getRandomValues: bytes => bytes.fill(++counter) },
        beginPremiumCheck() { accepted.push(null); },
        setPremiumStatus(value) { accepted.push(value); },
        setTimeout: callback => timers.push(callback)
    });
    for (const file of ['inject.js', 'premium-detector.js']) {
        vm.runInContext(fs.readFileSync(path.join(root, 'extension/js', file), 'utf8'), context);
    }
    return { accepted, sent, timers, window, listeners,
        navigate(value) { premium = value; navigations['yt-navigate-finish'](); } };
}

test('Premium bridge runs without loading any chrome-extension script URL', () => {
    const h = harness(true);
    assert.deepEqual(h.accepted, [null, true]);
    h.navigate(false);
    assert.deepEqual(h.accepted, [null, true, null, false]);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json')));
    const bridge = manifest.content_scripts.find(script => script.world === 'MAIN');
    assert.deepEqual(bridge.js, ['js/inject.js']);
    assert.equal(bridge.run_at, 'document_start');
    assert.equal(manifest.web_accessible_resources, undefined);
});

test('unknown Premium state stays unknown, including delayed detection', () => {
    const h = harness(undefined);
    h.timers.forEach(callback => callback());
    assert.deepEqual(h.accepted, [null]);
});

test('old navigation timers and wrong-source/origin/nonce messages cannot update Premium state', () => {
    const h = harness(false);
    const oldTimers = [...h.timers];
    const oldNonce = h.sent[0].nonce;
    h.navigate(true);
    const before = [...h.accepted];
    oldTimers.forEach(callback => callback());
    const nonce = h.sent.findLast(message => message.type === 'YT_PREMIUM_CHECK').nonce;
    for (const overrides of [{ source: {} }, { origin: 'https://example.com' },
        { data: { type: 'YT_PREMIUM_STATUS', nonce: oldNonce, isPremium: false } }]) {
        const event = { source: h.window, origin: h.window.location.origin,
            data: { type: 'YT_PREMIUM_STATUS', nonce, isPremium: false }, ...overrides };
        h.listeners.forEach(listener => listener(event));
    }
    assert.deepEqual(h.accepted, before);
});
