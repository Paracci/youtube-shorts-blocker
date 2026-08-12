'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'extension', 'js', 'notifications.js'), 'utf8');

class Element {
    constructor(tagName, document) {
        this.tagName = tagName.toUpperCase();
        this.document = document;
        this.children = [];
        this.parentElement = null;
        this.parentNode = null;
        this.style = {};
        this.attributes = {};
        this.listeners = {};
        this.dataset = new Proxy({}, {
            set: (target, key, value) => {
                target[key] = String(value);
                const attribute = String(key).replace(/[A-Z]/g, character => `-${character.toLowerCase()}`);
                this.attributes[`data-${attribute}`] = String(value);
                return true;
            }
        });
        const classNames = new Set();
        this.classList = {
            add: (...names) => names.forEach(name => classNames.add(name)),
            remove: (...names) => names.forEach(name => classNames.delete(name)),
            contains: name => classNames.has(name)
        };
        this.hidden = false;
        this.isConnected = false;
        this.textContent = '';
        this._id = '';
    }

    set id(value) {
        this._id = String(value);
        this.attributes.id = this._id;
    }

    get id() {
        return this._id;
    }

    setAttribute(name, value) {
        this.attributes[name] = String(value);
        if (name === 'id') this.id = value;
        if (name.startsWith('data-')) {
            const key = name.slice(5).replace(/-([a-z])/g, (_, character) => character.toUpperCase());
            this.dataset[key] = String(value);
        }
    }

    getAttribute(name) {
        return this.attributes[name] ?? null;
    }

    removeAttribute(name) {
        delete this.attributes[name];
        if (name.startsWith('data-')) {
            const key = name.slice(5).replace(/-([a-z])/g, (_, character) => character.toUpperCase());
            delete this.dataset[key];
        }
    }

    appendChild(child) {
        child.parentElement = this;
        child.parentNode = this;
        const connected = this.isConnected || this.tagName === 'BODY';
        const markConnected = node => {
            node.isConnected = connected;
            node.children.forEach(markConnected);
        };
        markConnected(child);
        this.children.push(child);
        return child;
    }

    prepend(child) {
        child.parentElement = this;
        child.parentNode = this;
        const connected = this.isConnected || this.tagName === 'BODY';
        const markConnected = node => {
            node.isConnected = connected;
            node.children.forEach(markConnected);
        };
        markConnected(child);
        this.children.unshift(child);
        return child;
    }

    append(...children) {
        children.forEach(child => this.appendChild(child));
    }

    remove() {
        if (this.parentElement) {
            this.parentElement.children = this.parentElement.children.filter(child => child !== this);
        }
        this.parentElement = null;
        this.parentNode = null;
        this.isConnected = false;
    }

    addEventListener(type, listener) {
        (this.listeners[type] ||= []).push(listener);
    }

    click() {
        for (const listener of this.listeners.click || []) {
            listener({ preventDefault() {}, stopPropagation() {} });
        }
    }

    set innerHTML(value) {
        this._innerHTML = String(value);
        this.children = [];

        const messageMatch = this._innerHTML.match(/<span[^>]*data-toast-message[^>]*>([\s\S]*?)<\/span>/i);
        if (messageMatch) {
            const message = new Element('span', this.document);
            message.setAttribute('data-toast-message', '');
            message.textContent = messageMatch[1].replace(/<[^>]+>/g, '');
            this.appendChild(message);
        }

        if (this._innerHTML.includes('<svg')) this.appendChild(new Element('svg', this.document));

        const actionMatch = this._innerHTML.match(/<button[^>]*data-toast-action[^>]*>([\s\S]*?)<\/button>/i);
        if (actionMatch) {
            const button = new Element('button', this.document);
            button.setAttribute('data-toast-action', '');
            button.hidden = true;
            button.textContent = actionMatch[1].replace(/<[^>]+>/g, '');
            this.appendChild(button);
        }
    }

    get innerHTML() {
        return this._innerHTML || '';
    }

    querySelector(selector) {
        const dataMatch = selector.match(/^\[data-([a-z-]+)\]$/);
        const classMatch = selector.match(/^\.([a-z0-9_-]+)$/i);
        const matcher = selector === 'svg'
            ? element => element.tagName === 'SVG'
            : dataMatch
                ? element => element.getAttribute(`data-${dataMatch[1]}`) !== null
                : classMatch
                    ? element => String(element.className || '').split(/\s+/).includes(classMatch[1])
                    : () => false;
        const queue = [...this.children];
        while (queue.length) {
            const element = queue.shift();
            if (matcher(element)) return element;
            queue.push(...element.children);
        }
        return null;
    }

    get childElementCount() {
        return this.children.length;
    }
}

class Document {
    constructor() {
        this.body = new Element('body', this);
        this.body.isConnected = true;
    }

    createElement(tagName) {
        return new Element(tagName, this);
    }

    getElementById(id) {
        const queue = [...this.body.children];
        while (queue.length) {
            const element = queue.shift();
            if (element.id === id) return element;
            queue.push(...element.children);
        }
        return null;
    }
}

function makeHarness() {
    const document = new Document();
    const schedule = (callback, delay) => {
        const timer = setTimeout(callback, delay);
        timer.unref?.();
        return timer;
    };
    const context = {
        document,
        console,
        escapeHtml(value) {
            return String(value).replace(/[&<>"']/g, character => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            })[character]);
        },
        requestAnimationFrame(callback) { callback(); },
        setTimeout: schedule,
        clearTimeout,
        actionCalls: 0
    };
    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'notifications.js' });
    return { context, document };
}

test('YouTube notification action stays hidden until completion and invokes the folder callback', () => {
    const harness = makeHarness();
    const notification = vm.runInContext(`showYouTubeNotification(
        'Example video',
        'Preparing',
        'abc12345678',
        'preparing',
        { actionLabel: 'Open folder', onAction: () => { actionCalls += 1; } }
    )`, harness.context);

    const stack = harness.document.getElementById('my-yt-notification-stack');
    assert.ok(stack);
    assert.match(stack.style.cssText, /position:\s*fixed/);
    assert.equal(stack.childElementCount, 1);

    const toast = stack.children[0];
    const action = toast.querySelector('[data-toast-action]');
    assert.ok(action);
    assert.equal(action.hidden, true);

    notification.showAction();
    assert.equal(action.hidden, false);
    action.click();
    assert.equal(harness.context.actionCalls, 1);

    notification.success('Complete');
    assert.equal(toast.style.backgroundColor, '#2e7d32');
    assert.equal(toast.querySelector('[data-toast-message]').textContent, 'Complete');
});

test('notifications without an action do not render a misleading folder control', () => {
    const harness = makeHarness();
    vm.runInContext("showYouTubeNotification('', 'Downloading', null, 'preparing')", harness.context);
    const stack = harness.document.getElementById('my-yt-notification-stack');
    assert.equal(stack.childElementCount, 1);
    assert.equal(stack.children[0].querySelector('[data-toast-action]'), null);
});

test('download notification cards expose progress, cancel, folder, and retry states', () => {
    const harness = makeHarness();
    const notification = vm.runInContext(`showYouTubeNotification(
        'Example video',
        'Preparing',
        'abc12345678',
        'preparing',
        {
            kind: 'download',
            downloadId: 'download-test-01',
            formatLabel: '1080p MP4',
            onCancel: () => { actionCalls += 1; },
            onAction: () => { actionCalls += 10; },
            onRetry: () => { actionCalls += 100; }
        }
    )`, harness.context);

    const panel = harness.document.getElementById('my-yt-download-notification-panel');
    assert.ok(panel);
    const card = panel.querySelector('[data-download-id]');
    assert.ok(card);
    assert.equal(card.dataset.downloadId, 'download-test-01');
    assert.equal(card.querySelector('.yt-download-notification__format').textContent, '1080p MP4');
    assert.ok(panel.querySelector('.yt-download-notification-panel__heading-copy'));
    assert.equal(card.querySelector('.yt-download-notification__status-text').textContent, 'Preparing');
    assert.equal(card.querySelector('.yt-download-notification__status-dot').dataset.state, 'preparing');
    assert.equal(card.querySelector('.yt-download-notification__speed').dataset.label, 'Speed');
    assert.equal(card.querySelector('.yt-download-notification__eta').dataset.label, 'ETA');

    notification.setState('downloading', 'Downloading', {
        percent: 42,
        speed: '2MiB/s',
        eta: '00:08'
    });
    const progress = card.querySelector('.yt-download-notification__progress-bar');
    assert.equal(progress.getAttribute('aria-valuenow'), '42');
    assert.equal(progress.style.width, '42%');
    assert.equal(card.querySelector('.yt-download-notification__status-text').textContent, 'Downloading');
    assert.equal(card.querySelector('.yt-download-notification__status-dot').dataset.state, 'downloading');
    assert.equal(card.querySelector('.yt-download-notification__speed').textContent, '2MiB/s');
    assert.equal(card.querySelector('.yt-download-notification__eta').textContent, '00:08');

    const cancel = card.querySelector('.yt-download-notification__action--cancel');
    cancel.click();
    assert.equal(notification.getState(), 'cancelling');
    assert.equal(cancel.disabled, true);
    assert.equal(harness.context.actionCalls, 1);

    notification.success('Complete', { percent: 100 });
    notification.showAction();
    const folder = card.querySelector('.yt-download-notification__action--folder');
    assert.equal(folder.hidden, false);
    folder.click();
    assert.equal(harness.context.actionCalls, 11);

    notification.setState('error', 'Failed');
    notification.showRetry();
    const retry = card.querySelector('.yt-download-notification__action--retry');
    assert.equal(retry.hidden, false);
    retry.click();
    assert.equal(harness.context.actionCalls, 111);
    assert.equal(notification.isVisible(), true);
});

test('download notifications persist until dismissed and clear finished cards together', () => {
    const harness = makeHarness();
    const first = vm.runInContext(`showYouTubeNotification(
        'First', 'Complete', null, 'success',
        { kind: 'download', downloadId: 'download-finished-1' }
    )`, harness.context);
    const second = vm.runInContext(`showYouTubeNotification(
        'Second', 'Cancelled', null, 'cancelled',
        { kind: 'download', downloadId: 'download-finished-2' }
    )`, harness.context);
    const panel = harness.document.getElementById('my-yt-download-notification-panel');
    const clear = panel.querySelector('[data-download-clear-finished]');

    assert.equal(first.isVisible(), true);
    assert.equal(second.isVisible(), true);
    assert.equal(clear.hidden, false);
    clear.click();
    assert.equal(first.isVisible(), false);
    assert.equal(second.isVisible(), false);
    assert.equal(harness.document.getElementById('my-yt-download-notification-panel'), null);
});
