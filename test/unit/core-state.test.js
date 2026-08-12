'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..', '..');
const stateSource = fs.readFileSync(path.join(repoRoot, 'extension', 'js', 'state.js'), 'utf8');
const shortsHiderSource = fs.readFileSync(path.join(repoRoot, 'extension', 'js', 'shorts-hider.js'), 'utf8');

function makeStateHarness(storageResult = {}) {
    const messages = [];
    const storageWrites = [];
    const calls = [];
    const schedule = (callback, delay) => {
        const timer = setTimeout(callback, delay);
        timer.unref?.();
        return timer;
    };
    const document = {
        querySelectorAll() { return []; },
        body: { classList: { add() {}, remove() {} } }
    };
    const chrome = {
        runtime: {
            onMessage: { addListener(listener) { messages.push(listener); } }
        },
        storage: {
            local: {
                get(_keys, callback) { callback({ ...storageResult }); },
                set(value, callback) { storageWrites.push({ ...value }); callback?.(); }
            }
        }
    };
    const context = {
        chrome,
        console,
        document,
        i18n: { init() {} },
        safeStorageGet(_keys, callback) { callback({ ...storageResult }); },
        safeStorageSet(value) { storageWrites.push({ ...value }); },
        setTimeout: schedule,
        clearTimeout,
        setInterval,
        clearInterval,
        applyHomepageVisibility() { calls.push('homepage'); },
        applyAdBlocker() { calls.push('adblocker'); },
        resetShortsAdHandling() { calls.push('reset-ad'); },
        runOptimizationCheck() { calls.push('optimize'); },
        initVideoDownloadButton() { calls.push('video-download'); }
    };

    vm.createContext(context);
    vm.runInContext(stateSource, context, { filename: 'state.js' });

    return {
        context,
        messages,
        storageWrites,
        calls,
        snapshot() {
            return vm.runInContext(`({
                extensionEnabled: EXTENSION_ENABLED,
                hideHomepageShorts: HIDE_SHORTS_HOMEPAGE,
                blockingEnabled: BLOCKING_ENABLED,
                downloaderEnabled: DOWNLOADER_ENABLED,
                adPreference: AD_BLOCKER_PREFERENCE,
                autoSkipPreference: AUTO_SKIP_SHORTS_PREFERENCE,
                adEnabled: AD_BLOCKER_ENABLED,
                autoSkipEnabled: AUTO_SKIP_SHORTS_ADS,
                premium: IS_PREMIUM,
                awaitingPremium: _awaitingPremiumCheck
            })`, context);
        }
    };
}

test('state keeps ad automation disabled until a fresh non-Premium result', () => {
    const harness = makeStateHarness({
        adBlockerEnabled: true,
        autoSkipShortsAds: true,
        isPremium: false
    });

    let state = harness.snapshot();
    assert.equal(state.premium, null);
    assert.equal(state.adEnabled, false);
    assert.equal(state.autoSkipEnabled, false);
    assert.equal(state.awaitingPremium, true);

    harness.messages[0]({ action: 'toggle_adblocker', enabled: true });
    harness.messages[0]({ action: 'toggle_auto_skip_shorts', enabled: true });
    state = harness.snapshot();
    assert.equal(state.adEnabled, false);
    assert.equal(state.autoSkipEnabled, false);

    vm.runInContext('setPremiumStatus(false)', harness.context);
    state = harness.snapshot();
    assert.equal(state.premium, false);
    assert.equal(state.adEnabled, true);
    assert.equal(state.autoSkipEnabled, true);
    assert.equal(state.awaitingPremium, false);

    vm.runInContext('beginPremiumCheck()', harness.context);
    state = harness.snapshot();
    assert.equal(state.premium, null);
    assert.equal(state.adEnabled, false);
    assert.equal(state.autoSkipEnabled, false);

    vm.runInContext('setPremiumStatus(true)', harness.context);
    state = harness.snapshot();
    assert.equal(state.premium, true);
    assert.equal(state.adEnabled, false);
    assert.equal(state.autoSkipEnabled, false);
    assert.ok(harness.calls.includes('reset-ad'));
});

test('homepage Shorts visibility is scoped to the homepage and counts new shelves once', () => {
    const classes = new Set();
    const shelves = [{}, {}];
    let storedHiddenCount = 4;
    const writes = [];
    const context = {
        window: { location: { pathname: '/' } },
        document: {
            body: {
                classList: {
                    add(name) { classes.add(name); },
                    remove(name) { classes.delete(name); }
                }
            },
            querySelectorAll() { return shelves; }
        },
        EXTENSION_ENABLED: true,
        HIDE_SHORTS_HOMEPAGE: true,
        safeStorageGet(_key, callback) { callback({ hiddenCount: storedHiddenCount }); },
        safeStorageSet(value) { storedHiddenCount = value.hiddenCount; writes.push(value); }
    };
    vm.createContext(context);
    vm.runInContext(shortsHiderSource, context, { filename: 'shorts-hider.js' });

    vm.runInContext('applyHomepageVisibility()', context);
    assert.equal(classes.has('my-hide-shorts-home'), true);
    assert.equal(storedHiddenCount, 6);
    assert.equal(writes.length, 1);

    vm.runInContext('applyHomepageVisibility()', context);
    assert.equal(storedHiddenCount, 6);
    assert.equal(writes.length, 1);

    context.window.location.pathname = '/watch';
    vm.runInContext('applyHomepageVisibility()', context);
    assert.equal(classes.has('my-hide-shorts-home'), false);
});
