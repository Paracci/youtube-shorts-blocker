'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'extension', 'js', 'channel-filter.js'), 'utf8');

class ClassList {
    constructor() {
        this.values = new Set();
    }

    add(...names) {
        names.forEach(name => this.values.add(name));
    }

    remove(...names) {
        names.forEach(name => this.values.delete(name));
    }

    contains(name) {
        return this.values.has(name);
    }
}

class Element {
    constructor(tagName = 'div') {
        this.tagName = String(tagName).toUpperCase();
        this.attributes = new Map();
        this.children = [];
        this.parentElement = null;
        this.parentNode = null;
        this.classList = new ClassList();
        this.textContent = '';
        this.connected = true;
    }

    setAttribute(name, value) {
        this.attributes.set(String(name), String(value));
    }

    getAttribute(name) {
        return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null;
    }

    removeAttribute(name) {
        this.attributes.delete(String(name));
    }

    hasAttribute(name) {
        return this.attributes.has(String(name));
    }

    append(...children) {
        children.forEach(child => {
            child.parentElement = this;
            child.parentNode = this;
            this.children.push(child);
        });
    }

    matches(selector) {
        return String(selector).split(',').some(part => {
            const value = part.trim();
            if (!value) return false;
            if (value.startsWith('#')) return this.getAttribute('id') === value.slice(1);
            if (value.startsWith('.')) return this.classList.contains(value.slice(1));
            const attrMatch = value.match(/^\[([^\]=]+)(?:=["']?([^\]"']+)["']?)?\]$/);
            if (attrMatch) {
                const attrValue = this.getAttribute(attrMatch[1]);
                return attrValue !== null && (!attrMatch[2] || attrValue === attrMatch[2]);
            }
            return value.toUpperCase() === this.tagName;
        });
    }

    closest(selector) {
        let current = this;
        while (current) {
            if (current.matches(selector)) return current;
            current = current.parentElement;
        }
        return null;
    }

    querySelectorAll(selector) {
        const matches = [];
        const visit = node => {
            node.children.forEach(child => {
                if (child.matches(selector)) matches.push(child);
                visit(child);
            });
        };
        visit(this);
        return matches;
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }

    get isConnected() {
        return this.connected;
    }
}

class Document extends Element {
    constructor() {
        super('#document');
        this.renderers = [];
        this.body = new Element('body');
        this.head = new Element('head');
        this.listeners = new Map();
        this.append(this.head, this.body);
    }

    addEventListener(type, listener) {
        this.listeners.set(type, listener);
    }

    contains(element) {
        return !!element?.connected;
    }

    querySelectorAll(selector) {
        if (String(selector).includes('my-channel-filtered')) {
            return this.renderers.filter(renderer => renderer.classList.contains('my-channel-filtered'));
        }
        return this.renderers;
    }
}

function makeRenderer({
    tagName = 'ytd-rich-item-renderer',
    channelId = null,
    handle = null,
    videoId = 'video-123',
    active = false,
    parent = null
} = {}) {
    const renderer = new Element(tagName);
    if (channelId) renderer.setAttribute('data-channel-id', channelId);
    if (active) renderer.setAttribute('is-active', '');

    const link = new Element('a');
    link.setAttribute('href', handle ? `/@${handle}` : `/watch?v=${videoId}`);
    renderer.append(link);
    if (parent) parent.append(renderer);
    return renderer;
}

function makeHarness({ pathname = '/', blockedChannels = [] } = {}) {
    const document = new Document();
    const storage = { blockedChannels: [...blockedChannels] };
    const storageListeners = [];
    const window = {
        location: { pathname, origin: 'https://www.youtube.com' }
    };
    let nextShortCalls = 0;

    const schedule = (callback, delay = 0) => {
        const timer = setTimeout(callback, delay);
        timer.unref?.();
        return timer;
    };

    const context = {
        console,
        document,
        window,
        URL,
        setTimeout: schedule,
        clearTimeout,
        EXTENSION_ENABLED: true,
        BLOCKING_ENABLED: true,
        navigateToNextShort() {
            nextShortCalls += 1;
        },
        safeStorageGet(_keys, callback) {
            callback({ blockedChannels: storage.blockedChannels });
        },
        chrome: {
            runtime: { lastError: null },
            storage: {
                local: {
                    set(data, callback) {
                        const oldValue = { blockedChannels: storage.blockedChannels };
                        Object.assign(storage, data);
                        callback?.();
                        if (data.blockedChannels !== undefined) {
                            storageListeners.forEach(listener => listener({
                                blockedChannels: {
                                    oldValue: oldValue.blockedChannels,
                                    newValue: storage.blockedChannels
                                }
                            }, 'local'));
                        }
                    }
                },
                onChanged: {
                    addListener(listener) {
                        storageListeners.push(listener);
                    }
                }
            }
        }
    };

    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'channel-filter.js' });
    return {
        context,
        document,
        storage,
        window,
        get nextShortCalls() {
            return nextShortCalls;
        }
    };
}

function run(harness, expression) {
    return vm.runInContext(expression, harness.context);
}

test('channel identity prefers UC IDs, normalizes handles, and never uses names', () => {
    const harness = makeHarness();
    assert.equal(run(harness, "normalizeChannelId('/channel/UC1234567890/videos')"), 'UC1234567890');
    assert.equal(run(harness, "normalizeChannelHandle('https://www.youtube.com/@Creator_Name/videos?tab=shorts')"), '@creator_name');

    const identity = run(harness, `normalizeChannelIdentityValues(
        ['/@Creator_Name', '/channel/UC1234567890'], 'Creator Name'
    )`);
    assert.equal(identity.id, 'UC1234567890');
    assert.deepEqual([...identity.keys], ['UC1234567890', '@creator_name']);
    assert.equal(run(harness, "normalizeChannelIdentityValues(['Creator Name'])"), null);
});

test('legacy entries, aliases, duplicates, and malformed records are normalized safely', () => {
    const harness = makeHarness();
    const entries = run(harness, `rebuildChannelFilterIndex([
        { id: 'UC1234567890', name: 'Creator', blockedAt: 1 },
        { id: '/@Creator', aliases: ['/channel/UC1234567890'], name: 'Duplicate', blockedAt: 2 },
        { name: 'Name only', blockedAt: 3 },
        null,
        { id: 'not-a-channel', name: 'Invalid', blockedAt: 4 }
    ])`);

    assert.equal(entries.length, 1);
    assert.equal(entries[0].id, 'UC1234567890');
    assert.deepEqual([...entries[0].aliases], ['@creator']);
    assert.equal(run(harness, "CHANNEL_FILTER_STATE.keys.has('@creator')"), true);
});

test('adding a channel is local-first and idempotent', async () => {
    const harness = makeHarness();
    const first = await run(harness, `addBlockedChannelLocally({
        id: 'UC1234567890', aliases: ['@Creator'], name: 'Creator'
    })`);
    const second = await run(harness, `addBlockedChannelLocally({
        id: 'UC1234567890', aliases: ['@Creator'], name: 'Creator'
    })`);

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.alreadyBlocked, true);
    assert.equal(harness.storage.blockedChannels.length, 1);
    const invalid = await run(harness, "addBlockedChannelLocally({ name: 'Name only' })");
    assert.equal(invalid.ok, false);
    assert.equal(invalid.reason, 'identity_unavailable');
});

test('a legacy handle record is upgraded when a stable channel ID becomes available', async () => {
    const harness = makeHarness({
        blockedChannels: [{ id: '@Creator', name: 'Creator', blockedAt: 1 }]
    });
    const result = await run(harness, `addBlockedChannelLocally({
        id: 'UC1234567890', aliases: ['@Creator'], name: 'Creator'
    })`);

    assert.equal(result.ok, true);
    assert.equal(result.upgraded, true);
    assert.equal(harness.storage.blockedChannels[0].id, 'UC1234567890');
    assert.deepEqual([...harness.storage.blockedChannels[0].aliases], ['@creator']);
});

test('recommendation surfaces are scoped by route and renderer container', () => {
    const harness = makeHarness({ pathname: '/', blockedChannels: [{ id: 'UC1234567890', name: 'Creator' }] });
    const homeRenderer = makeRenderer({ channelId: 'UC1234567890' });
    harness.document.renderers = [homeRenderer];
    run(harness, "rebuildChannelFilterIndex([{id:'UC1234567890',name:'Creator'}]); applyChannelFilter()");
    assert.equal(homeRenderer.classList.contains('my-channel-filtered'), true);

    harness.window.location.pathname = '/results';
    run(harness, 'applyChannelFilter()');
    assert.equal(homeRenderer.classList.contains('my-channel-filtered'), false);

    const mainWatch = makeRenderer({ channelId: 'UC1234567890', videoId: 'main' });
    const relatedContainer = new Element('div');
    relatedContainer.setAttribute('id', 'related');
    const relatedWatch = makeRenderer({ channelId: 'UC1234567890', videoId: 'related', parent: relatedContainer });
    harness.window.location.pathname = '/watch';
    harness.document.renderers = [mainWatch, relatedWatch];
    harness.document.body.append(relatedContainer);
    run(harness, 'applyChannelFilter()');
    assert.equal(mainWatch.classList.contains('my-channel-filtered'), false);
    assert.equal(relatedWatch.classList.contains('my-channel-filtered'), true);

    harness.window.location.pathname = '/channel/UC1234567890';
    run(harness, 'applyChannelFilter()');
    assert.equal(relatedWatch.classList.contains('my-channel-filtered'), false);
});

test('removing the list or disabling blocking restores cards live', () => {
    const harness = makeHarness({ blockedChannels: [{ id: 'UC1234567890', name: 'Creator' }] });
    const renderer = makeRenderer({ channelId: 'UC1234567890' });
    harness.document.renderers = [renderer];
    run(harness, "rebuildChannelFilterIndex([{id:'UC1234567890',name:'Creator'}]); applyChannelFilter()");
    assert.equal(renderer.classList.contains('my-channel-filtered'), true);

    run(harness, "rebuildChannelFilterIndex([]); applyChannelFilter()");
    assert.equal(renderer.classList.contains('my-channel-filtered'), false);

    run(harness, "rebuildChannelFilterIndex([{id:'UC1234567890',name:'Creator'}]); applyChannelFilter(); BLOCKING_ENABLED = false; applyChannelFilter()");
    assert.equal(renderer.classList.contains('my-channel-filtered'), false);
});

test('an active blocked Short navigates only once and remains hidden during transition', async () => {
    const harness = makeHarness({
        pathname: '/shorts/video-123',
        blockedChannels: [{ id: 'UC1234567890', name: 'Creator' }]
    });
    const renderer = makeRenderer({
        tagName: 'ytd-reel-video-renderer',
        channelId: 'UC1234567890',
        videoId: 'video-123',
        active: true
    });
    harness.document.renderers = [renderer];
    run(harness, "rebuildChannelFilterIndex([{id:'UC1234567890',name:'Creator'}]); applyChannelFilter(); applyChannelFilter()");
    assert.equal(renderer.classList.contains('my-channel-filtered'), true);
    assert.equal(renderer.classList.contains('my-channel-filtered--active'), true);

    await new Promise(resolve => setTimeout(resolve, 120));
    assert.equal(harness.nextShortCalls, 1);
});

test('manual movement away from a blocked Short releases its navigation retry lock', async () => {
    const harness = makeHarness({
        pathname: '/shorts/video-123',
        blockedChannels: [{ id: 'UC1234567890', name: 'Creator' }]
    });
    harness.window.innerHeight = 1000;
    const renderer = makeRenderer({
        tagName: 'ytd-reel-video-renderer',
        channelId: 'UC1234567890',
        videoId: 'video-123',
        active: true
    });
    let top = 0;
    renderer.getBoundingClientRect = () => ({ top, bottom: top + 900 });
    harness.document.renderers = [renderer];

    run(harness, "rebuildChannelFilterIndex([{id:'UC1234567890',name:'Creator'}]); applyChannelFilter()");
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.equal(harness.nextShortCalls, 1);

    top = 1200;
    run(harness, 'applyChannelFilter()');
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(harness.nextShortCalls, 1);
});
