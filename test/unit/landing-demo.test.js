'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { FakeDocument, addElement } = require('../helpers/fake-dom.js');

const repoRoot = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'landing-demo.js'), 'utf8');

function makeLandingHarness() {
    const document = new FakeDocument();
    const root = document.createElement('div');
    root.setAttribute('data-landing-download-demo', '');
    root.dataset.demoState = 'idle';
    document.body.appendChild(root);

    const ids = [
        'landing-download-form',
        'landing-demo-url',
        'landing-demo-status',
        'landing-demo-results',
        'landing-demo-clear',
        'landing-demo-sample',
        'landing-demo-advanced-toggle',
        'landing-demo-advanced-panel',
        'landing-demo-job-status',
        'landing-demo-job-title',
        'landing-demo-retry',
        'landing-demo-cancel',
        'landing-demo-progress-bar',
        'landing-demo-progress-value',
        'landing-demo-speed',
        'landing-demo-eta',
        'landing-demo-success'
    ];
    const elements = Object.fromEntries(ids.map(id => [id, addElement(document, root, id, id.endsWith('form') ? 'form' : 'div')]));
    elements['landing-demo-url'].value = 'https://www.youtube.com/watch?v=sample12345';
    elements['landing-demo-results'].hidden = true;
    elements['landing-demo-advanced-panel'].hidden = true;

    ['best-mp4', '2160p', '1080p', 'mp3', 'm4a'].forEach(format => {
        const button = addElement(document, root, 'format-' + format, 'button');
        button.setAttribute('data-demo-format', format);
    });

    const timers = new Set();
    const window = {
        clearInterval(timer) {
            if (timer) timer.active = false;
        },
        setInterval(fn) {
            const timer = { fn, active: true };
            timers.add(timer);
            return timer;
        },
        clearTimeout() {},
        setTimeout(fn) {
            fn();
            return 1;
        }
    };
    const context = { document, window, URL, console };
    vm.runInNewContext(source, context, { filename: 'landing-demo.js' });

    return {
        root,
        elements,
        runTimers(steps) {
            for (let index = 0; index < steps; index++) {
                [...timers].forEach(timer => {
                    if (timer.active) timer.fn();
                });
            }
        }
    };
}

test('landing demo accepts supported single-video URL forms and resolves formats locally', () => {
    const harness = makeLandingHarness();
    harness.elements['landing-download-form'].dispatchEvent({ type: 'submit', preventDefault() {} });
    assert.equal(harness.root.dataset.demoState, 'formats-ready');
    assert.equal(harness.elements['landing-demo-results'].hidden, false);
    assert.equal(harness.elements['landing-demo-status'].classList.contains('is-success'), true);

    harness.elements['landing-demo-url'].value = 'https://youtu.be/sample12345';
    harness.elements['landing-download-form'].dispatchEvent({ type: 'submit', preventDefault() {} });
    assert.equal(harness.root.dataset.demoState, 'formats-ready');
});

test('landing demo safely rejects insecure, external, playlist, and malformed URLs', () => {
    const cases = [
        'http://www.youtube.com/watch?v=sample12345',
        'https://vimeo.com/12345678901',
        'https://www.youtube.com/watch?v=sample12345&list=PL123',
        'https://www.youtube.com/watch?v=short'
    ];

    cases.forEach(value => {
        const harness = makeLandingHarness();
        harness.elements['landing-demo-url'].value = value;
        harness.elements['landing-download-form'].dispatchEvent({ type: 'submit', preventDefault() {} });
        assert.equal(harness.root.dataset.demoState, 'error', value);
        assert.equal(harness.elements['landing-demo-results'].hidden, true, value);
        assert.equal(harness.elements['landing-demo-status'].classList.contains('is-error'), true, value);
    });
});

test('landing demo supports advanced toggle, cancel, retry, and completion states', () => {
    const harness = makeLandingHarness();
    const { elements, root } = harness;
    elements['landing-download-form'].dispatchEvent({ type: 'submit', preventDefault() {} });

    elements['landing-demo-advanced-toggle'].click();
    assert.equal(elements['landing-demo-advanced-panel'].hidden, false);
    assert.equal(elements['landing-demo-advanced-toggle'].getAttribute('aria-expanded'), 'true');

    root.querySelector('[data-demo-format]').click();
    assert.equal(root.dataset.demoState, 'downloading');
    assert.equal(elements['landing-demo-cancel'].hidden, false);
    harness.runTimers(2);
    elements['landing-demo-cancel'].click();
    assert.equal(root.dataset.demoState, 'cancelled');
    assert.equal(elements['landing-demo-retry'].hidden, false);

    elements['landing-demo-retry'].click();
    assert.equal(root.dataset.demoState, 'downloading');
    harness.runTimers(8);
    assert.equal(root.dataset.demoState, 'completed');
    assert.equal(elements['landing-demo-progress-value'].textContent, '100%');
    assert.equal(elements['landing-demo-success'].hidden, false);
    assert.equal(elements['landing-demo-cancel'].hidden, true);
    assert.equal(elements['landing-demo-retry'].hidden, false);
});
