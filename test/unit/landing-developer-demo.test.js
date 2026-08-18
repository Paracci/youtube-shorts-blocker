'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { FakeDocument, addElement } = require('../helpers/fake-dom.js');

const repoRoot = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'landing-developer-demo.js'), 'utf8');

function makeDeveloperHarness() {
    const document = new FakeDocument();
    const root = document.createElement('div');
    root.setAttribute('data-landing-developer-demo', '');
    document.body.appendChild(root);

    const ids = [
        ['landing-developer-mode-toggle', 'input'],
        ['landing-developer-status', 'div'],
        ['landing-developer-search', 'input'],
        ['landing-developer-scope-filter', 'select'],
        ['landing-developer-module-filter', 'select'],
        ['landing-developer-level-filter', 'select'],
        ['landing-developer-copy', 'button'],
        ['landing-developer-clear', 'button'],
        ['landing-developer-visible-count', 'strong'],
        ['landing-developer-total-count', 'strong'],
        ['landing-developer-log-list', 'div'],
        ['landing-developer-log-empty', 'div']
    ];
    const elements = Object.fromEntries(ids.map(([id, tag]) => [id, addElement(document, root, id, tag)]));
    elements['landing-developer-mode-toggle'].checked = true;
    elements['landing-developer-log-empty'].hidden = true;

    const timers = [];
    const window = {
        setTimeout(fn) {
            timers.push(fn);
            return timers.length;
        }
    };
    vm.runInNewContext(source, { document, window, console }, { filename: 'landing-developer-demo.js' });

    return {
        root,
        elements,
        timers,
        runTimers() {
            while (timers.length) timers.shift()();
        }
    };
}

test('landing Developer Console renders a local sample session', () => {
    const harness = makeDeveloperHarness();
    const { elements } = harness;

    assert.equal(elements['landing-developer-total-count'].textContent, '8');
    assert.equal(elements['landing-developer-visible-count'].textContent, '8');
    assert.equal(elements['landing-developer-log-list'].querySelectorAll('.log-entry').length, 8);
    assert.equal(elements['landing-developer-log-empty'].hidden, true);
    assert.equal(elements['landing-developer-status'].classList.contains('is-enabled'), true);
    assert.ok(elements['landing-developer-scope-filter'].children.length > 1);
    assert.ok(elements['landing-developer-module-filter'].children.length > 1);
});

test('landing Developer Console filters logs and preserves total count', () => {
    const harness = makeDeveloperHarness();
    const { elements } = harness;

    elements['landing-developer-search'].value = 'native host';
    elements['landing-developer-search'].dispatchEvent({ type: 'input', target: elements['landing-developer-search'] });
    assert.equal(elements['landing-developer-visible-count'].textContent, '1');
    assert.equal(elements['landing-developer-total-count'].textContent, '8');

    elements['landing-developer-search'].value = '';
    elements['landing-developer-scope-filter'].value = 'content';
    elements['landing-developer-scope-filter'].dispatchEvent({ type: 'change', target: elements['landing-developer-scope-filter'] });
    assert.equal(elements['landing-developer-visible-count'].textContent, '3');

    elements['landing-developer-scope-filter'].value = '';
    elements['landing-developer-level-filter'].value = 'error';
    elements['landing-developer-level-filter'].dispatchEvent({ type: 'change', target: elements['landing-developer-level-filter'] });
    assert.equal(elements['landing-developer-visible-count'].textContent, '1');
});

test('landing Developer Console supports toggle, copy preview, and clear', () => {
    const harness = makeDeveloperHarness();
    const { elements } = harness;

    elements['landing-developer-mode-toggle'].checked = false;
    elements['landing-developer-mode-toggle'].dispatchEvent({
        type: 'change',
        target: elements['landing-developer-mode-toggle']
    });
    assert.equal(elements['landing-developer-status'].classList.contains('is-disabled'), true);

    elements['landing-developer-copy'].click();
    assert.match(elements['landing-developer-status'].textContent, /Copied 8 visible logs/);
    harness.runTimers();
    assert.match(elements['landing-developer-status'].textContent, /Developer mode off/);

    elements['landing-developer-clear'].click();
    assert.equal(elements['landing-developer-total-count'].textContent, '0');
    assert.equal(elements['landing-developer-visible-count'].textContent, '0');
    assert.equal(elements['landing-developer-log-list'].querySelectorAll('.log-entry').length, 0);
    assert.equal(elements['landing-developer-log-empty'].hidden, false);
});
