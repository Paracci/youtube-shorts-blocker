// ─────────────────────────────────────────────────────────────────────────────
// channel-blocker.js – Block button UI, channel extractors, Shorts feed loop,
//                      and IntersectionObserver
// Depends on: utils.js, state.js, shorts-transition.js, ad-blocker.js,
//             channel-filter.js, notifications.js
// ─────────────────────────────────────────────────────────────────────────────

const channelBlockerDeveloperLogger = typeof DeveloperLogger !== 'undefined'
    ? DeveloperLogger.create('content', 'channel-blocker')
    : null;

// ─── Intersection Observer (lazy-check visible Shorts) ───────────────────────
const observedShortRenderers = new Set();
let shortsViewportCheckTimer = null;

function scheduleShortsViewportCheck() {
    if (!EXTENSION_ENABLED || !document.querySelector('ytd-reel-video-renderer') ||
        shortsViewportCheckTimer !== null) return;

    shortsViewportCheckTimer = setTimeout(() => {
        shortsViewportCheckTimer = null;
        if (EXTENSION_ENABLED && typeof runOptimizationCheck === 'function') {
            runOptimizationCheck();
        }
    }, 80);
}

const scrollObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const renderer = entry.target;
        if (!document.contains(renderer)) {
            scrollObserver.unobserve(renderer);
            observedShortRenderers.delete(renderer);
            return;
        }
        if (checkForAdAndSkip(renderer)) return;
        // A newly visible renderer may not have an extension button yet.
        // Re-run discovery immediately instead of only resetting an existing
        // button; this is what makes wheel/trackpad navigation self-sufficient.
        scheduleShortsViewportCheck();
        const btn = renderer.querySelector('.my-block-button');
        if (btn) checkAndResetButton(btn, renderer);
    });
}, { threshold: 0.5 });

window.addEventListener('scroll', scheduleShortsViewportCheck, {
    capture: true,
    passive: true
});
document.addEventListener('scroll', scheduleShortsViewportCheck, {
    capture: true,
    passive: true
});
window.addEventListener('resize', scheduleShortsViewportCheck, { passive: true });
document.addEventListener('yt-navigate-finish', scheduleShortsViewportCheck);

function observeShortRenderer(renderer) {
    if (observedShortRenderers.has(renderer)) return;
    scrollObserver.observe(renderer);
    observedShortRenderers.add(renderer);
}

function cleanupDetachedShortRenderers() {
    for (const renderer of observedShortRenderers) {
        if (!document.contains(renderer)) {
            scrollObserver.unobserve(renderer);
            observedShortRenderers.delete(renderer);
        }
    }
}

function clearShortRendererObservers() {
    for (const renderer of observedShortRenderers) scrollObserver.unobserve(renderer);
    observedShortRenderers.clear();
}

// ─── Video fingerprint (detects renderer reuse) ───────────────────────────────
function getVideoFingerprint(renderer) {
    const link = renderer.querySelector('a[href*="/shorts/"]');
    if (link) {
        try {
            const url = new URL(link.getAttribute('href'), window.location.origin);
            if (url.pathname.startsWith('/shorts/')) return url.pathname;
        } catch (_) { }
    }

    const dataVideoId = renderer.getAttribute('data-video-id');
    if (dataVideoId) return dataVideoId;

    const ch = renderer.querySelector('ytd-channel-name');
    const ti = renderer.querySelector('h2.title');
    if (ch && ti) return ch.textContent + ti.textContent;

    const vid = renderer.querySelector('video');
    if (vid && vid.src) return vid.src;
    return null;
}

// ─── Shorts feed loop ────────────────────────────────────────────────────────
// Shorts action-container discovery. YouTube has changed this area repeatedly:
// #button-bar was replaced by <reel-action-bar-view-model>. Known names are
// high-confidence hints; semantic controls and a bounded fallback keep the
// injector alive when the host is renamed again.
const SHORTS_ACTION_CONTAINER_SELECTORS = [
    { selector: 'reel-action-bar-view-model', base: 1200, source: 'reel-action-bar' },
    { selector: '#button-bar', base: 1050, source: 'legacy-button-bar' },
    { selector: '[id*="button-bar" i]', base: 900, source: 'button-bar-id' },
    { selector: '[id*="action-bar" i]', base: 900, source: 'action-bar-id' },
    { selector: '[class*="reel-action-bar" i]', base: 850, source: 'reel-action-class' },
    { selector: '[class*="reelActionBar" i]', base: 850, source: 'reel-action-class' },
    { selector: '[class*="action-bar" i]', base: 700, source: 'action-bar-class' },
    { selector: '[class*="actionbar" i]', base: 700, source: 'action-bar-class' },
    { selector: '[class*="actions-container" i]', base: 620, source: 'actions-container-class' },
    { selector: '[class*="action-buttons" i]', base: 620, source: 'action-buttons-class' },
    { selector: '#actions', base: 560, source: 'actions-id' },
    { selector: '#action-buttons', base: 560, source: 'action-buttons-id' }
];

const SHORTS_ACTION_LABEL_PATTERN = /like|dislike|comment|share|remix|subscribe|music|audio|sound|save|more|not interested|beğen|yorum|paylaş|abone|müzik|ses|kaydet|daha|önerme/i;
const SHORTS_PLAYER_SELECTOR = '#shorts-player, #player-container, .html5-video-player, .html5-video-container, .ytp-chrome-bottom, ytd-player';
const SHORTS_ACTION_FALLBACK_CLASS = 'my-shorts-action-host--fallback';
const shortsActionContainerCache = new WeakMap();
const shortsActionRetryState = new WeakMap();
const fallbackShortsHosts = new Set();
const SHORTS_ACTION_RETRY_DELAYS = [120, 300, 700, 1500, 3000];
let fallbackPositionTimer = null;
let fallbackPositionListenersInstalled = false;

function isShortsExtensionControl(element) {
    return !!(element && element.closest &&
        element.closest('.my-shorts-action-host, .my-block-button, .my-dl-btn-shorts'));
}

function getShortsInteractiveControls(container) {
    return Array.from(container.querySelectorAll('button, [role="button"], a[role="button"]'))
        .filter(element => !isShortsExtensionControl(element));
}

function getShortsElementIdentity(element) {
    const className = typeof element.className === 'string' ? element.className : '';
    return element.tagName + ' ' + (element.id || '') + ' ' + className;
}

function getShortsActionLabel(element) {
    return [
        element.getAttribute('aria-label'),
        element.getAttribute('title'),
        element.getAttribute('data-tooltip-title'),
        element.textContent
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ');
}

function isShortsElementVisible(element, allowUnmeasured = false) {
    if (!element || !element.isConnected) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' ||
        style.opacity === '0') {
        return false;
    }
    const rect = element.getBoundingClientRect();
    return allowUnmeasured || (rect.width > 0 && rect.height > 0);
}

function isShortsActionIdentity(identity) {
    return /reel-action-bar|action[-_]?bar|action[-_]?buttons|actions[-_]?container|button-bar|(^|[\s_-])actions([\s_-]|$)/i.test(identity);
}

function isShortsPlayerContainer(element) {
    if (!element || !element.matches) return false;
    return element.matches(SHORTS_PLAYER_SELECTOR) ||
        !!element.closest(SHORTS_PLAYER_SELECTOR) ||
        !!element.querySelector(SHORTS_PLAYER_SELECTOR);
}

function isUsableShortsActionContainer(element, renderer, allowUnmeasured = false) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE || !renderer ||
        element === renderer || !renderer.contains(element) || !element.isConnected) {
        return false;
    }
    if (element.matches('button, label, button-view-model, like-button-view-model, toggle-button-view-model')) {
        return false;
    }
    if (element.classList.contains(SHORTS_ACTION_FALLBACK_CLASS)) {
        return isShortsElementVisible(element, true);
    }

    const identity = getShortsElementIdentity(element);
    if (isShortsPlayerContainer(element)) return false;
    if (!isShortsElementVisible(element, allowUnmeasured && isShortsActionIdentity(identity))) return false;

    const controls = getShortsInteractiveControls(element);
    if (!controls.length && !isShortsActionIdentity(identity)) return false;
    if (controls.length < 2 && !isShortsActionIdentity(identity)) return false;
    return true;
}

function getShortsCandidateDepth(element, renderer) {
    let depth = 0;
    let current = element;
    while (current && current !== renderer) {
        depth++;
        current = current.parentElement;
    }
    return depth;
}

function scoreShortsActionCandidate(element, entry, renderer) {
    const identity = getShortsElementIdentity(element);
    const identityLower = identity.toLocaleLowerCase();
    const controls = getShortsInteractiveControls(element);
    const visibleControls = controls.filter(control => isShortsElementVisible(control));
    const semanticControls = controls.filter(control => SHORTS_ACTION_LABEL_PATTERN.test(getShortsActionLabel(control)));
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    let score = entry.base;

    if (identityLower.includes('reel-action-bar')) score += 1100;
    else if (identityLower.includes('action-bar')) score += 650;
    else if (identityLower.includes('action-buttons')) score += 500;
    else if (identityLower.includes('button-bar')) score += 450;
    if (element.id === 'actions' || element.id === 'action-buttons') score += 300;
    if (element.children.length >= 2) score += 30;
    if (controls.length >= 2) score += 100;
    score += Math.min(visibleControls.length, 8) * 45;
    score += Math.min(semanticControls.length, 6) * 25;
    if (style.display === 'flex') score += 20;
    if (style.flexDirection === 'column') score += 20;
    if (rect.width > 0 && rect.width < 240) score += 25;

    // A player/overlay root can contain many buttons but is not an action bar.
    if (element.matches('ytd-reel-player-overlay-renderer, yt-reel-player-overlay-view-model')) {
        score -= 900;
    }
    if (element.querySelector(SHORTS_PLAYER_SELECTOR)) score -= 700;
    if (controls.length > 15) score -= Math.min((controls.length - 15) * 10, 120);
    score -= Math.min(getShortsCandidateDepth(element, renderer), 8) * 3;
    return score;
}

function discoverShortsActionContainer(renderer) {
    if (!renderer || !renderer.isConnected) return null;
    const candidates = new Map();
    const register = (element, base, source) => {
        if (!element || !renderer.contains(element) || element === renderer ||
            isShortsExtensionControl(element)) return;
        const previous = candidates.get(element);
        if (!previous || base > previous.base) candidates.set(element, { base, source });
    };

    for (const definition of SHORTS_ACTION_CONTAINER_SELECTORS) {
        let matches = [];
        try {
            matches = renderer.querySelectorAll(definition.selector);
        } catch (_) {
            continue;
        }
        matches.forEach(element => register(element, definition.base, definition.source));
    }

    // If the host is renamed, climb from visible, semantically-labelled
    // buttons and score their shared ancestors.
    const interactive = renderer.querySelectorAll('button, [role="button"], a[role="button"]');
    interactive.forEach(control => {
        if (isShortsExtensionControl(control) ||
            !SHORTS_ACTION_LABEL_PATTERN.test(getShortsActionLabel(control))) return;
        let ancestor = control.parentElement;
        for (let depth = 0; ancestor && ancestor !== renderer && depth < 7; depth++) {
            register(ancestor, Math.max(40, 140 - depth * 15), 'semantic-controls');
            ancestor = ancestor.parentElement;
        }
    });

    const ranked = Array.from(candidates, ([element, entry]) => ({
        element,
        entry,
        score: scoreShortsActionCandidate(element, entry, renderer)
    })).filter(candidate => {
        const strongIdentity = isShortsActionIdentity(getShortsElementIdentity(candidate.element));
        return candidate.score >= 240 &&
            isUsableShortsActionContainer(candidate.element, renderer, strongIdentity);
    }).sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        const leftControls = getShortsInteractiveControls(left.element).length;
        const rightControls = getShortsInteractiveControls(right.element).length;
        if (leftControls !== rightControls) return leftControls - rightControls;
        return getShortsCandidateDepth(left.element, renderer) - getShortsCandidateDepth(right.element, renderer);
    });

    return ranked.length ? ranked[0].element : null;
}

function findShortsFallbackAnchor(renderer) {
    const candidates = [
        renderer.querySelector('ytd-reel-player-overlay-renderer'),
        renderer.querySelector('yt-reel-player-overlay-view-model'),
        renderer.querySelector('.short-video-container'),
        renderer
    ].filter(Boolean);
    return candidates.find(element => isShortsElementVisible(element, true)) || renderer;
}

function getShortsFallbackMedia(renderer) {
    return renderer.querySelector('.player-wrapper, video, .html5-video-player');
}

function positionShortsFallbackHost(host) {
    if (!host || !host.isConnected || !host.__myShortsRenderer) return;
    const renderer = host.__myShortsRenderer;
    const anchor = host.__myShortsAnchor;
    if (!anchor || !anchor.isConnected) return;

    const anchorRect = anchor.getBoundingClientRect();
    const media = getShortsFallbackMedia(renderer);
    const mediaRect = media ? media.getBoundingClientRect() : null;
    const hostRect = host.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const hasStableMedia = !!mediaRect && mediaRect.width > 120 && mediaRect.height > 120;
    if (!hasStableMedia || hostRect.width <= 0 || hostRect.height <= 0 ||
        anchorRect.width <= 0 || anchorRect.height <= 0) {
        host.dataset.positionReady = 'false';
        return;
    }

    let desiredLeft = mediaRect.right + 12;
    let desiredTop = mediaRect
        ? mediaRect.top + mediaRect.height * 0.78
        : anchorRect.top + anchorRect.height * 0.60;

    if (desiredLeft + hostRect.width > viewportWidth - 12) {
        desiredLeft = mediaRect.left - hostRect.width - 12;
    }
    desiredLeft = Math.max(12, Math.min(desiredLeft, viewportWidth - hostRect.width - 12));
    desiredTop = Math.max(12, Math.min(desiredTop, viewportHeight - hostRect.height - 12));

    if (host.dataset.positionMode === 'fixed') {
        host.style.left = Math.round(desiredLeft) + 'px';
        host.style.top = Math.round(desiredTop) + 'px';
    } else {
        host.style.left = Math.round(desiredLeft - anchorRect.left) + 'px';
        host.style.top = Math.round(desiredTop - anchorRect.top) + 'px';
    }
    host.dataset.positionReady = 'true';
}

function scheduleShortsFallbackPosition() {
    if (fallbackPositionTimer !== null) return;
    fallbackPositionTimer = setTimeout(() => {
        fallbackPositionTimer = null;
        for (const host of fallbackShortsHosts) {
            if (!host.isConnected) {
                fallbackShortsHosts.delete(host);
                continue;
            }
            positionShortsFallbackHost(host);
        }
    }, 0);
}

function installShortsFallbackPositionListeners() {
    if (fallbackPositionListenersInstalled) return;
    fallbackPositionListenersInstalled = true;
    window.addEventListener('resize', scheduleShortsFallbackPosition, { passive: true });
    window.addEventListener('scroll', scheduleShortsFallbackPosition, { capture: true, passive: true });
}

function createShortsFallbackHost(renderer) {
    const anchor = findShortsFallbackAnchor(renderer);
    const host = document.createElement('div');
    const positionedAnchor = window.getComputedStyle(anchor).position !== 'static';
    host.className = 'my-shorts-action-host ' + SHORTS_ACTION_FALLBACK_CLASS;
    host.setAttribute('data-shorts-action-host', 'fallback');
    host.dataset.positionReady = 'false';
    host.dataset.positionMode = positionedAnchor ? 'absolute' : 'fixed';
    host.__myShortsRenderer = renderer;
    host.__myShortsAnchor = anchor;
    host.style.position = host.dataset.positionMode;
    anchor.appendChild(host);
    fallbackShortsHosts.add(host);
    installShortsFallbackPositionListeners();
    positionShortsFallbackHost(host);
    return host;
}

function removeShortsFallbackHost(host) {
    if (!host) return;
    fallbackShortsHosts.delete(host);
    host.remove();
}

function appendShortsControl(container, control) {
    if (!container || !control || control.parentElement === container) return control;
    const pivot = Array.from(container.children).find(child => {
        const identity = getShortsElementIdentity(child);
        return /pivot-button|music|audio|sound/i.test(identity);
    });
    if (pivot) container.insertBefore(control, pivot);
    else container.appendChild(control);
    if (container.classList.contains(SHORTS_ACTION_FALLBACK_CLASS)) {
        scheduleShortsFallbackPosition();
    }
    return control;
}

function migrateShortsControls(from, to) {
    if (!from || !to || from === to) return;
    Array.from(from.querySelectorAll('.my-block-button, .my-dl-btn-shorts')).forEach(control => {
        appendShortsControl(to, control);
    });
    if (from.classList.contains(SHORTS_ACTION_FALLBACK_CLASS)) removeShortsFallbackHost(from);
}

function cancelShortsActionRetry(renderer) {
    const state = shortsActionRetryState.get(renderer);
    if (state && state.timer) clearTimeout(state.timer);
    shortsActionRetryState.delete(renderer);
}

function scheduleShortsActionRetry(renderer, finger) {
    const previous = shortsActionRetryState.get(renderer);
    if (previous && previous.finger === finger && previous.timer) return;
    const attempt = previous && previous.finger === finger ? previous.attempt + 1 : 0;
    if (attempt >= SHORTS_ACTION_RETRY_DELAYS.length) return;

    const state = { finger, attempt, timer: null };
    state.timer = setTimeout(() => {
        state.timer = null;
        if (shortsActionRetryState.get(renderer) !== state || !document.contains(renderer)) {
            shortsActionRetryState.delete(renderer);
            return;
        }
        const currentFinger = getVideoFingerprint(renderer);
        if (finger && currentFinger && finger !== currentFinger) {
            shortsActionRetryState.delete(renderer);
            return;
        }
        runOptimizationCheck();
    }, SHORTS_ACTION_RETRY_DELAYS[attempt]);
    shortsActionRetryState.set(renderer, state);
}

function getShortsActionContainer(renderer, createFallback) {
    const cached = shortsActionContainerCache.get(renderer);
    const discovered = discoverShortsActionContainer(renderer);
    if (discovered) {
        if (cached && cached !== discovered && cached.classList.contains(SHORTS_ACTION_FALLBACK_CLASS)) {
            migrateShortsControls(cached, discovered);
        }
        shortsActionContainerCache.set(renderer, discovered);
        return discovered;
    }

    if (cached && cached.isConnected && renderer.contains(cached) &&
        isUsableShortsActionContainer(cached, renderer, true)) {
        if (cached.classList.contains(SHORTS_ACTION_FALLBACK_CLASS)) positionShortsFallbackHost(cached);
        return cached;
    }

    if (!createFallback) return null;
    const fallback = createShortsFallbackHost(renderer);
    shortsActionContainerCache.set(renderer, fallback);
    return fallback;
}

function runOptimizationCheck() {
    if (!EXTENSION_ENABLED) return;
    if (typeof applyChannelFilter === 'function') applyChannelFilter();
    cleanupDetachedShortRenderers();

    const renderers = document.querySelectorAll('ytd-reel-video-renderer');
    renderers.forEach(renderer => {
        observeShortRenderer(renderer);
        const isActive = typeof _isActiveShortRenderer === 'function'
            ? _isActiveShortRenderer(renderer)
            : renderer.hasAttribute('is-active');
        const finger = getVideoFingerprint(renderer);
        renderer.__my_last_finger = finger;

        if (checkForAdAndSkip(renderer)) return;
        if (renderer.classList.contains('my-channel-filtered')) {
            cancelShortsActionRetry(renderer);
            return;
        }

        const wantsControls = BLOCKING_ENABLED || DOWNLOADER_ENABLED;
        const isInViewport = (() => {
            const rect = renderer.getBoundingClientRect();
            return rect.bottom > 0 && rect.right > 0 &&
                rect.top < (window.innerHeight || document.documentElement.clientHeight) &&
                rect.left < (window.innerWidth || document.documentElement.clientWidth);
        })();
        const bar = getShortsActionContainer(renderer, wantsControls && (isActive || isInViewport));
        if (!bar) {
            scheduleShortsActionRetry(renderer, finger);
            return;
        }
        if (bar.classList.contains(SHORTS_ACTION_FALLBACK_CLASS)) {
            positionShortsFallbackHost(bar);
            scheduleShortsActionRetry(renderer, finger);
        } else {
            cancelShortsActionRetry(renderer);
        }

        let btn = bar.querySelector('.my-block-button:not(.my-dl-btn-shorts)');
        if (!btn && BLOCKING_ENABLED && EXTENSION_ENABLED) {
            btn = createBlockButton(bar, renderer);
        }
        if (btn) {
            btn.style.display = (BLOCKING_ENABLED && EXTENSION_ENABLED) ? '' : 'none';
            if (typeof isChannelLocallyBlocked === 'function' && isChannelLocallyBlocked(renderer)) {
                setButtonBlocked(btn);
            } else {
                checkAndResetButton(btn, renderer);
            }
        }

        if (!bar.querySelector('.my-dl-btn-shorts') && DOWNLOADER_ENABLED && EXTENSION_ENABLED) {
            createShortsDownloadButton(bar);
        }
        const dlBtn = bar.querySelector('.my-dl-btn-shorts');
        if (dlBtn) dlBtn.style.display = (DOWNLOADER_ENABLED && EXTENSION_ENABLED) ? '' : 'none';
    });
}

function checkAndResetButton(btn, ctx) {
    const fp = getVideoFingerprint(ctx);
    if (!fp) return;
    if (fp !== btn.dataset.videoFingerprint) {
        resetButtonToDefault(btn);
        btn.dataset.videoFingerprint = fp;
    }
}

function resetButtonToDefault(btn) {
    btn.classList.remove('blocked-state');
    btn.style.opacity = '1';
    btn.style.pointerEvents = 'auto';
    const t = btn.querySelector('.my-btn-text');
    if (t) t.textContent = i18n.t('btnBlock');
    const s = btn.querySelector('svg');
    if (s) s.style.fill = '#f1f1f1';
}

function setButtonBlocked(btn) {
    btn.classList.add('blocked-state');
    btn.style.opacity = '1';
    btn.style.pointerEvents = 'none';
    const text = btn.querySelector('.my-btn-text');
    if (text) text.textContent = i18n.t('btnBlocked');
    const icon = btn.querySelector('svg');
    if (icon) icon.style.fill = '#ff4444';
}

// ─── Channel name & ID extractors ────────────────────────────────────────────
function extractChannelName(videoContext) {
    if (typeof resolveChannelIdentity === 'function') {
        const identity = resolveChannelIdentity(videoContext);
        if (identity?.name) return identity.name;
    }

    const SELECTORS = [
        'ytd-reel-player-header-renderer ytd-channel-name yt-formatted-string',
        'ytd-reel-player-header-renderer #channel-name yt-formatted-string',
        'ytd-reel-player-header-renderer #channel-name',
        'ytd-channel-name yt-formatted-string',
        '#channel-name yt-formatted-string',
        '#channel-name',
        'ytd-channel-name',
        '.ytp-title-channel-name',
        'yt-dynamic-text-view-model'
    ];

    for (const sel of SELECTORS) {
        const el = videoContext.querySelector(sel);
        const txt = el && el.textContent.trim();
        if (txt) return txt;
    }
    return null;
}

function extractChannelId(videoContext) {
    if (typeof resolveChannelIdentity === 'function') {
        const identity = resolveChannelIdentity(videoContext);
        if (identity?.id) return identity.id;
    }

    const idLink = videoContext.querySelector('a[href*="/channel/"]');
    if (idLink) {
        const m = (idLink.getAttribute('href') || '').match(/\/channel\/(UC[^/?#]+)/);
        if (m) return m[1];
    }

    const handleLink = videoContext.querySelector('a[href*="/@"]');
    if (handleLink) {
        const m = (handleLink.getAttribute('href') || '').match(/\/@([^/?#]+)/);
        if (m) return '@' + m[1];
    }
    return null;
}

// ─── Block button ─────────────────────────────────────────────────────────────
function isDontRecommendItem(item, text, aria) {
    const tooltip = item.getAttribute('data-tooltip-text') || item.getAttribute('title') || '';
    const haystack = `${text} ${aria} ${tooltip}`.toLocaleLowerCase();
    const patterns = [
        "don't recommend", 'do not recommend', 'recommend this channel', 'recommend channel',
        'bu kanalı önerme', 'kanalı önerme', 'nicht empfehlen', 'ne pas recommander',
        'no recomendar', 'não recomendar', 'non consigliare', 'не рекомендовать',
        'おすすめしない', '추천하지', '不推荐'
    ];
    return patterns.some(pattern => haystack.includes(pattern));
}

function findYouTubeMenuButton(videoContext) {
    if (!videoContext || typeof videoContext.querySelectorAll !== 'function') return null;
    return videoContext.querySelector('ytd-menu-renderer button') ||
        Array.from(videoContext.querySelectorAll('button')).find(button => {
            const label = button.getAttribute('aria-label') || '';
            return /more actions|diğer|işlemler|menü/i.test(label);
        }) || null;
}

function isVisibleYouTubeElement(element) {
    if (!element || !element.isConnected) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

// Account-level recommendation feedback is not available while signed out.
// Fail closed when the account state is unknown so the local filter never
// opens a YouTube menu, injects temporary popup styles, or interferes with
// Shorts navigation in that state.
function isYouTubeSignedIn() {
    const signInSelectors = [
        'a[href*="ServiceLogin"]',
        'a[href*="accounts.google.com"]',
        'ytd-masthead #sign-in-button',
        'ytd-masthead ytd-button-renderer a[aria-label*="sign in" i]',
        'ytd-masthead ytd-button-renderer a[aria-label*="oturum aç" i]'
    ];
    try {
        const signedOut = document.querySelectorAll(signInSelectors.join(','));
        if (Array.from(signedOut).some(isVisibleYouTubeElement)) return false;

        const accountSelectors = [
            'ytd-topbar-menu-button-renderer #avatar-btn',
            'ytd-masthead #avatar-btn',
            '#avatar-btn',
            'button[aria-label*="account" i]',
            'button[aria-label*="hesap" i]'
        ];
        const accountControls = document.querySelectorAll(accountSelectors.join(','));
        return Array.from(accountControls).some(isVisibleYouTubeElement);
    } catch (_) {
        return false;
    }
}

function getBlockContextFingerprint(videoContext) {
    return (typeof getChannelFilterVideoKey === 'function'
        ? getChannelFilterVideoKey(videoContext)
        : '') || getVideoFingerprint(videoContext) || '';
}

function isBlockContextCurrent(videoContext, expectedFingerprint) {
    if (!videoContext || !document.contains(videoContext)) return false;
    if (!expectedFingerprint) return true;
    return getBlockContextFingerprint(videoContext) === expectedFingerprint;
}

async function tryYouTubeRecommendationSync(videoContext) {
    if (!isYouTubeSignedIn()) return 'unavailable';

    const menuBtn = findYouTubeMenuButton(videoContext);
    if (!menuBtn) return 'unavailable';

    const initialVideoKey = getBlockContextFingerprint(videoContext);
    let hideStyle = null;
    let found = false;
    let menuOpened = false;
    try {
        if (!isBlockContextCurrent(videoContext, initialVideoKey)) return 'unavailable';
        hideStyle = document.createElement('style');
        hideStyle.textContent = `
            ytd-menu-popup-renderer, tp-yt-paper-dialog, ytd-popup-container > *, tp-yt-iron-dropdown {
                visibility: hidden !important; pointer-events: none !important;
            }`;
        document.head?.appendChild(hideStyle);
        menuBtn.click();
        menuOpened = true;
        // Keep the YouTube account attempt bounded. The local filter must not
        // wait on a missing menu item, which is common while signed out.
        for (let i = 0; i < 18 && !found; i++) {
            await new Promise(resolve => setTimeout(resolve, 100));
            if (!isBlockContextCurrent(videoContext, initialVideoKey)) break;

            const items = document.querySelectorAll(
                'ytd-menu-service-item-renderer, yt-list-item-view-model, ' +
                'tp-yt-paper-item, [role="menuitem"], [role="listitem"]'
            );
            for (const item of items) {
                const text = (item.textContent || '').trim();
                const aria = (item.getAttribute('aria-label') || '').trim();
                if (isDontRecommendItem(item, text, aria)) {
                    item.click();
                    found = true;
                    break;
                }
            }
        }
    } catch (error) {
        console.warn('[ShortsBlocker] Could not inspect YouTube menu:', error);
        channelBlockerDeveloperLogger?.warn('channel.menu_inspection_failed', 'Could not inspect YouTube menu.', error?.message || String(error));
    } finally {
        hideStyle?.remove?.();
        if (!found && menuOpened && isBlockContextCurrent(videoContext, initialVideoKey)) {
            document.body?.click?.();
        }
    }

    return found ? 'synced' : 'unavailable';
}

async function handleLocalBlockButton(btn, videoContext) {
    const initialVideoKey = getBlockContextFingerprint(videoContext);
    const identity = typeof resolveChannelIdentity === 'function'
        ? resolveChannelIdentity(videoContext)
        : null;
    if (!identity) {
        showYouTubeNotification(
            i18n.t('notifChannelIdentityUnavailable'),
            i18n.t('notifChannelIdentityUnavailable'),
            null,
            'error'
        );
        if (isBlockContextCurrent(videoContext, initialVideoKey)) {
            resetButtonToDefault(btn);
            btn.dataset.blocking = 'false';
        }
        return;
    }

    const localResult = typeof addBlockedChannelLocally === 'function'
        ? await addBlockedChannelLocally(identity)
        : { ok: false, reason: 'filter_unavailable' };
    if (!localResult.ok) {
        const messageKey = localResult.reason === 'identity_unavailable'
            ? 'notifChannelIdentityUnavailable'
            : 'notifChannelStorageError';
        showYouTubeNotification(
            i18n.t(messageKey),
            i18n.t(messageKey),
            null,
            'error'
        );
        if (isBlockContextCurrent(videoContext, initialVideoKey)) {
            resetButtonToDefault(btn);
            btn.dataset.blocking = 'false';
        }
        return;
    }

    const contextIsCurrent = isBlockContextCurrent(videoContext, initialVideoKey);
    if (contextIsCurrent) setButtonBlocked(btn);
    const label = identity.name ? `"${identity.name}"` : 'Channel';
    const notification = showYouTubeNotification(
        label,
        i18n.t('notifLocalChannelBlocked'),
        null,
        'success'
    );

    // Start the account-level attempt before the renderer is hidden. The
    // local filter remains the source of truth if YouTube has no menu item.
    const syncPromise = contextIsCurrent
        ? tryYouTubeRecommendationSync(videoContext)
        : Promise.resolve('unavailable');
    if (typeof applyChannelFilter === 'function') applyChannelFilter();

    const syncResult = await syncPromise;
    if (notification?.setState) {
        notification.setState(
            syncResult === 'synced' ? 'synced' : 'unavailable',
            i18n.t(syncResult === 'synced'
                ? 'notifYouTubeSyncApplied'
                : 'notifYouTubeSyncUnavailable')
        );
    } else if (notification?.update) {
        notification.update(i18n.t(syncResult === 'synced'
            ? 'notifYouTubeSyncApplied'
            : 'notifYouTubeSyncUnavailable'));
    }
    if (isBlockContextCurrent(videoContext, initialVideoKey)) btn.dataset.blocking = 'false';
}

function createBlockButton(container, videoContext) {
    const btn = document.createElement('button');
    btn.className = 'my-block-button';
    btn.dataset.shortsControl = 'block';
    btn.title = i18n.t('btnDontRecommend');
    btn.innerHTML = `
        <div class="my-btn-circle">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="white">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8 0-1.85.63-3.55 1.69-4.9L16.9 18.31C15.55 19.37 13.85 20 12 20zm6.31-3.1L7.1 5.69C8.45 4.63 10.15 4 12 4c4.41 0 8 3.59 8 8 0 1.85-.63 3.55-1.69 4.9z"></path>
            </svg>
        </div>
        <span class="my-btn-text">${i18n.t('btnBlock')}</span>`;

    btn.addEventListener('click', async (e) => {
        e.stopPropagation(); e.preventDefault();
        if (btn.dataset.blocking === 'true') return;
        btn.dataset.blocking = 'true';
        btn.style.opacity = '0.5';
        btn.querySelector('.my-btn-text').textContent = i18n.t('btnBlocking');

        await handleLocalBlockButton(btn, videoContext);
        return;
    });

    appendShortsControl(container, btn);
    return btn;
}
