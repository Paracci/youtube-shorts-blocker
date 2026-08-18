'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(
    path.join(repoRoot, 'extension', 'js', 'shorts-transition.js'),
    'utf8'
);

function makeHarness() {
    const listeners = new Map();
    const document = {
        addEventListener(type, listener) {
            listeners.set(type, listener);
        },
        contains(renderer) {
            return renderer?.connected !== false;
        }
    };
    const context = {
        console,
        document,
        window: { addEventListener() {} },
        current: true,
        nextCalls: 0,
        navigateToNextShort() {
            context.nextCalls += 1;
            return true;
        },
        setTimeout(callback, delay) {
            const timer = setTimeout(callback, delay);
            timer.unref?.();
            return timer;
        },
        clearTimeout
    };
    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'shorts-transition.js' });
    return { context, listeners };
}

function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

test('shared Shorts transitions issue one navigation action per fingerprint', async () => {
    const harness = makeHarness();
    const renderer = { connected: true };
    harness.context.renderer = renderer;

    vm.runInContext(`scheduleShortsInvisibleTransition(renderer, {
        reason: 'ad', fingerprint: 'id:ad-1', isCurrent: () => current
    });
    scheduleShortsInvisibleTransition(renderer, {
        reason: 'ad', fingerprint: 'id:ad-1', isCurrent: () => current
    });`, harness.context);
    await sleep(120);
    assert.equal(harness.context.nextCalls, 1);

    vm.runInContext('current = false; reevaluateShortsInvisibleTransitions();', harness.context);
    vm.runInContext('resetShortsInvisibleTransitions();', harness.context);
});

test('a recycled renderer cancels the old fingerprint before scheduling the new one', async () => {
    const harness = makeHarness();
    const renderer = { connected: true };
    harness.context.renderer = renderer;

    vm.runInContext(`scheduleShortsInvisibleTransition(renderer, {
        reason: 'channel', fingerprint: 'id:old', isCurrent: () => current
    });
    scheduleShortsInvisibleTransition(renderer, {
        reason: 'channel', fingerprint: 'id:new', isCurrent: () => current
    });`, harness.context);

    await sleep(40);
    assert.equal(harness.context.nextCalls, 1);
    assert.equal(vm.runInContext("SHORTS_TRANSITION_STATE.byRenderer.get(renderer).fingerprint", harness.context), 'id:new');
    vm.runInContext('resetShortsInvisibleTransitions();', harness.context);
});

test('ad and channel reasons share one transition and release independently', async () => {
    const harness = makeHarness();
    const renderer = { connected: true };
    harness.context.renderer = renderer;

    vm.runInContext(`scheduleShortsInvisibleTransition(renderer, {
        reason: 'ad', fingerprint: 'id:shared', isCurrent: () => current
    });
    scheduleShortsInvisibleTransition(renderer, {
        reason: 'channel', fingerprint: 'id:shared', isCurrent: () => current
    });`, harness.context);
    await sleep(120);
    assert.equal(harness.context.nextCalls, 1);

    const released = vm.runInContext(
        "releaseShortsInvisibleTransitionReason(renderer, 'id:shared', 'ad')",
        harness.context
    );
    assert.equal(released, true);
    assert.equal(vm.runInContext(
        "isShortsTransitionCurrent(renderer, 'id:shared')",
        harness.context
    ), true);

    vm.runInContext('current = false; reevaluateShortsInvisibleTransitions();', harness.context);
    assert.equal(vm.runInContext(
        "isShortsTransitionCurrent(renderer, 'id:shared')",
        harness.context
    ), false);
    vm.runInContext('resetShortsInvisibleTransitions();', harness.context);
});
