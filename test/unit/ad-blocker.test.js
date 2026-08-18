'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'extension', 'js', 'ad-blocker.js'), 'utf8');

class ClassList {
    constructor() {
        this.values = new Set();
    }

    add(...names) { names.forEach(name => this.values.add(name)); }
    remove(...names) { names.forEach(name => this.values.delete(name)); }
    contains(name) { return this.values.has(name); }
}

class Element {
    constructor(tagName = 'div', rect = { top: 0, bottom: 900, width: 500, height: 900 }) {
        this.tagName = String(tagName).toUpperCase();
        this.attributes = new Map();
        this.children = [];
        this.parentElement = null;
        this.classList = new ClassList();
        this.rect = rect;
        this.connected = true;
    }

    setAttribute(name, value) { this.attributes.set(String(name), String(value)); }
    getAttribute(name) { return this.attributes.get(String(name)) ?? null; }
    removeAttribute(name) { this.attributes.delete(String(name)); }
    hasAttribute(name) { return this.attributes.has(String(name)); }

    append(...children) {
        children.forEach(child => {
            child.parentElement = this;
            this.children.push(child);
        });
    }

    matches(selector) {
        return String(selector).split(',').some(part => {
            const value = part.trim();
            const tagMatch = value.match(/^([\w-]+)/);
            if (tagMatch && tagMatch[1].toUpperCase() !== this.tagName) return false;
            const classMatches = [...value.matchAll(/\.([\w-]+)/g)];
            if (classMatches.some(match => !this.classList.contains(match[1]))) return false;
            const attributeMatches = [...value.matchAll(/\[([^\]=]+)(?:=["']?([^\]"']+)["']?)?\]/g)];
            return attributeMatches.every(match => {
                const actual = this.getAttribute(match[1]);
                return actual !== null && (!match[2] || actual === match[2]);
            });
        });
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

    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    getBoundingClientRect() { return this.rect; }
    get isConnected() { return this.connected; }
}

class Document extends Element {
    constructor() {
        super('#document');
        this.renderers = [];
        this.listeners = new Map();
    }

    addEventListener(type, listener) { this.listeners.set(type, listener); }
    contains(element) { return !!element?.connected; }
    querySelectorAll(selector) {
        if (String(selector).includes('ytd-reel-video-renderer')) return this.renderers.filter(renderer => renderer.matches(selector));
        return [];
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function makeHarness(renderers) {
    const document = new Document();
    document.renderers = renderers;
    const context = {
        console,
        document,
        window: { location: { pathname: '/shorts/video-1', origin: 'https://www.youtube.com' }, innerHeight: 1000 },
        getComputedStyle(element) {
            if (element.classList.contains('my-shorts-excluded--active') ||
                element.classList.contains('my-channel-filtered--active')) {
                return { display: 'block', visibility: 'hidden', opacity: '0' };
            }
            return { display: 'block', visibility: 'visible', opacity: '1' };
        },
        setTimeout,
        clearTimeout,
        MutationObserver: class { observe() {} disconnect() {} },
        IntersectionObserver: class { observe() {} disconnect() {} },
        KeyboardEvent: class {},
        AD_BLOCKER_ENABLED: false,
        EXTENSION_ENABLED: true,
        AUTO_SKIP_SHORTS_ADS: false,
        IS_PREMIUM: null
    };
    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'ad-blocker.js' });
    return { context, document };
}

test('hidden active renderer remains the Shorts transition target without is-active', () => {
    const renderer = new Element('ytd-reel-video-renderer');
    renderer.classList.add('my-shorts-excluded--active');
    const harness = makeHarness([renderer]);
    harness.context.renderer = renderer;

    assert.equal(vm.runInContext('_getActiveShortRenderer()', harness.context), renderer);
    assert.equal(vm.runInContext('_isActiveShortRenderer(renderer)', harness.context), true);
});

test('a visible replacement wins over an old hidden transition renderer', () => {
    const oldRenderer = new Element('ytd-reel-video-renderer', { top: 1200, bottom: 2100, width: 500, height: 900 });
    oldRenderer.classList.add('my-shorts-excluded--active');
    const newRenderer = new Element('ytd-reel-video-renderer', { top: 0, bottom: 900, width: 500, height: 900 });
    const harness = makeHarness([oldRenderer, newRenderer]);

    assert.equal(vm.runInContext('_getActiveShortRenderer()', harness.context), newRenderer);
});

test('a feed ad slot alone is not treated as an active Shorts player ad', () => {
    const renderer = new Element('ytd-reel-video-renderer');
    const adSlot = new Element('ytd-ad-slot-renderer');
    adSlot.setAttribute('style', 'display: none');
    renderer.append(adSlot);
    const harness = makeHarness([renderer]);
    harness.context.renderer = renderer;

    assert.equal(vm.runInContext('_hasShortsAdMarker(renderer)', harness.context), false);
});

test('Shorts ad handling seeks the player instead of pausing the recycled renderer', () => {
    const renderer = new Element('ytd-reel-video-renderer');
    renderer.setAttribute('data-video-id', 'ad-video');
    const player = new Element('div');
    player.classList.add('html5-video-player', 'ad-showing');
    const video = new Element('video');
    video.muted = false;
    video.paused = false;
    video.currentTime = 2;
    video.duration = 12;
    video.play = () => {
        video.paused = false;
        return Promise.resolve();
    };
    player.append(video);
    renderer.append(player);

    const harness = makeHarness([renderer]);
    harness.context.renderer = renderer;
    vm.runInContext("_prepareShortsAdMedia(renderer, 'id:ad-video'); _attemptShortsAdSkip(renderer, 'id:ad-video')", harness.context);

    assert.equal(video.currentTime, video.duration);
    assert.equal(video.paused, false);
    assert.equal(video.muted, true);

    vm.runInContext("_clearShortsAdRenderer(renderer)", harness.context);
});

test('a recycled ad renderer resumes the next Short after the ad is skipped', () => {
    const renderer = new Element('ytd-reel-video-renderer');
    renderer.setAttribute('data-video-id', 'ad-video');
    const player = new Element('div');
    player.classList.add('html5-video-player', 'ad-showing');
    const video = new Element('video');
    video.muted = false;
    video.paused = false;
    video.currentTime = 2;
    video.duration = 12;
    let playCalls = 0;
    video.play = () => {
        playCalls += 1;
        video.paused = false;
        return Promise.resolve();
    };
    player.append(video);
    renderer.append(player);

    const harness = makeHarness([renderer]);
    harness.context.AD_BLOCKER_ENABLED = true;
    harness.context.AUTO_SKIP_SHORTS_ADS = true;
    harness.context.IS_PREMIUM = false;
    harness.context.renderer = renderer;

    vm.runInContext("checkForAdAndSkip(renderer)", harness.context);
    assert.equal(playCalls, 0);

    renderer.setAttribute('data-video-id', 'next-video');
    renderer.removeAttribute('my-ad-detected');
    player.classList.remove('ad-showing');
    video.paused = true;

    assert.equal(vm.runInContext('checkForAdAndSkip(renderer)', harness.context), false);
    assert.equal(playCalls, 1);
    assert.equal(video.paused, false);
});

test('ad skip recovery resumes a new renderer when YouTube replaces the video element', async () => {
    const adRenderer = new Element('ytd-reel-video-renderer', { top: -1200, bottom: -300, width: 500, height: 900 });
    adRenderer.setAttribute('data-video-id', 'ad-video');
    const adPlayer = new Element('div');
    adPlayer.classList.add('html5-video-player', 'ad-showing');
    const adVideo = new Element('video');
    adVideo.muted = false;
    adVideo.paused = false;
    adVideo.duration = 12;
    adVideo.currentTime = 2;
    adVideo.play = () => {
        adVideo.paused = false;
        return Promise.resolve();
    };
    adPlayer.append(adVideo);
    adRenderer.append(adPlayer);

    const nextRenderer = new Element('ytd-reel-video-renderer');
    nextRenderer.setAttribute('data-video-id', 'next-video');
    const nextPlayer = new Element('div');
    nextPlayer.classList.add('html5-video-player');
    const nextVideo = new Element('video');
    nextVideo.paused = true;
    let playCalls = 0;
    nextVideo.play = () => {
        playCalls += 1;
        nextVideo.paused = false;
        return Promise.resolve();
    };
    nextPlayer.append(nextVideo);
    nextRenderer.append(nextPlayer);

    const harness = makeHarness([adRenderer]);
    harness.context.AD_BLOCKER_ENABLED = true;
    harness.context.AUTO_SKIP_SHORTS_ADS = true;
    harness.context.IS_PREMIUM = false;
    harness.context.renderer = adRenderer;

    vm.runInContext('checkForAdAndSkip(renderer)', harness.context);
    harness.document.renderers = [adRenderer, nextRenderer];
    harness.context.AD_BLOCKER_ENABLED = false;
    harness.context.AUTO_SKIP_SHORTS_ADS = false;
    vm.runInContext('_clearShortsAdState({ preservePlaybackRecovery: true })', harness.context);
    await new Promise(resolve => setTimeout(resolve, 30));

    assert.equal(playCalls, 1);
    assert.equal(nextVideo.paused, false);
    vm.runInContext('_clearShortsAdState()', harness.context);
});

test('a recycled renderer releases stale ad state before the next Short is processed', () => {
    const renderer = new Element('ytd-reel-video-renderer');
    renderer.setAttribute('data-video-id', 'next-video');
    renderer.setAttribute('data-my-short-excluded-fingerprint', 'id:previous-ad');
    renderer.setAttribute('my-ad-detected', 'true');
    renderer.setAttribute('data-my-short-excluded', 'ad');
    renderer.classList.add('my-shorts-excluded', 'my-shorts-excluded--active');

    const harness = makeHarness([renderer]);
    harness.context.AD_BLOCKER_ENABLED = true;
    harness.context.AUTO_SKIP_SHORTS_ADS = true;
    harness.context.IS_PREMIUM = false;
    harness.context.renderer = renderer;

    assert.equal(vm.runInContext('checkForAdAndSkip(renderer)', harness.context), false);
    assert.equal(renderer.hasAttribute('my-ad-detected'), false);
    assert.equal(renderer.hasAttribute('data-my-short-excluded'), false);
    assert.equal(renderer.hasAttribute('data-my-short-excluded-fingerprint'), false);
    assert.equal(renderer.classList.contains('my-shorts-excluded'), false);
    assert.equal(renderer.classList.contains('my-shorts-excluded--active'), false);
});
