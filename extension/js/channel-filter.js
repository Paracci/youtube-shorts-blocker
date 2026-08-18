// channel-filter.js - Local channel filtering for recommendation surfaces
// Depends on: utils.js, state.js, shorts-transition.js, ad-blocker.js

const channelFilterDeveloperLogger = typeof DeveloperLogger !== 'undefined'
    ? DeveloperLogger.create('content', 'channel-filter')
    : null;

const CHANNEL_FILTER_RENDERER_SELECTOR = [
    'ytd-reel-video-renderer',
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-playlist-video-renderer',
    'ytd-video-with-context-renderer',
    'ytd-rich-grid-media',
    'yt-lockup-view-model'
].join(',');

const CHANNEL_FILTER_STATE = {
    entries: [],
    keys: new Set(),
    initialized: false,
    applyTimer: null,
    storageQueue: Promise.resolve()
};

function channelFilterDecode(value) {
    try {
        return decodeURIComponent(String(value || ''));
    } catch (_) {
        return String(value || '');
    }
}

function normalizeChannelId(value) {
    let raw = channelFilterDecode(value).trim();
    if (!raw) return null;

    raw = raw.split(/[?#]/, 1)[0].replace(/\/+$/, '');
    const fromPath = raw.match(/(?:^|\/)channel\/(UC[A-Za-z0-9_-]{10,})(?:\/|$)/i);
    const direct = raw.match(/^(UC[A-Za-z0-9_-]{10,})$/i);
    const candidate = fromPath ? fromPath[1] : direct ? direct[1] : null;
    return candidate && /^UC[A-Za-z0-9_-]{10,}$/.test(candidate) ? candidate : null;
}

function normalizeChannelHandle(value) {
    let raw = channelFilterDecode(value).trim();
    if (!raw) return null;

    raw = raw.split(/[?#]/, 1)[0].replace(/\/+$/, '');
    const fromPath = raw.match(/(?:^|\/)@([^/?#]+)(?:\/|$)/);
    const direct = raw.match(/^@([^/?#]+)$/);
    const handle = fromPath ? fromPath[1] : direct ? direct[1] : null;
    if (!handle || !/^[\p{L}\p{N}._-]{3,30}$/u.test(handle)) return null;
    return '@' + handle.toLowerCase();
}

function normalizeChannelIdentityValues(values, name = '') {
    const ids = [];
    const handles = [];
    const seen = new Set();

    for (const value of Array.isArray(values) ? values : [values]) {
        const channelId = normalizeChannelId(value);
        if (channelId && !seen.has(channelId)) {
            ids.push(channelId);
            seen.add(channelId);
            continue;
        }

        const handle = normalizeChannelHandle(value);
        if (handle && !seen.has(handle)) {
            handles.push(handle);
            seen.add(handle);
        }
    }

    const primary = ids[0] || handles[0] || null;
    if (!primary) return null;

    return {
        id: primary,
        aliases: [...ids.slice(1), ...handles],
        name: String(name || '').replace(/\s+/g, ' ').trim().slice(0, 200),
        keys: [primary, ...ids.slice(1), ...handles]
    };
}

function normalizeBlockedChannelEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const values = [entry.id, ...(Array.isArray(entry.aliases) ? entry.aliases : [])];
    const identity = normalizeChannelIdentityValues(values, entry.name);
    if (!identity) return null;

    return {
        id: identity.id,
        aliases: identity.aliases,
        name: identity.name || identity.id,
        blockedAt: Number.isFinite(Number(entry.blockedAt)) ? Number(entry.blockedAt) : 0
    };
}

function rebuildChannelFilterIndex(rawEntries) {
    const entries = [];
    const keys = new Set();

    for (const rawEntry of Array.isArray(rawEntries) ? rawEntries : []) {
        const entry = normalizeBlockedChannelEntry(rawEntry);
        if (!entry) continue;

        const entryKeys = [entry.id, ...entry.aliases];
        if (entryKeys.some(key => keys.has(key))) {
            const existing = entries.find(candidate =>
                [candidate.id, ...candidate.aliases].some(key => entryKeys.includes(key))
            );
            if (existing) {
                const displayName = existing.name && existing.name !== existing.id
                    ? existing.name
                    : entry.name;
                const merged = normalizeChannelIdentityValues([
                    existing.id,
                    ...existing.aliases,
                    entry.id,
                    ...entry.aliases
                ], displayName);
                existing.id = merged.id;
                existing.aliases = merged.aliases;
                existing.name = displayName || merged.id;
                keys.clear();
                entries.forEach(candidate => {
                    [candidate.id, ...candidate.aliases].forEach(key => keys.add(key));
                });
            }
            continue;
        }

        entries.push(entry);
        entryKeys.forEach(key => keys.add(key));
    }

    CHANNEL_FILTER_STATE.entries = entries;
    CHANNEL_FILTER_STATE.keys = keys;
    return entries;
}

function extractChannelDisplayName(context) {
    if (!context || typeof context.querySelector !== 'function') return null;
    const selectors = [
        'ytd-reel-player-header-renderer ytd-channel-name yt-formatted-string',
        'ytd-reel-player-header-renderer #channel-name yt-formatted-string',
        'ytd-reel-player-header-renderer #channel-name',
        'ytd-channel-name yt-formatted-string',
        '#channel-name yt-formatted-string',
        '#channel-name',
        '.ytp-title-channel-name',
        '[id*="channel-name" i]',
        'yt-dynamic-text-view-model'
    ];

    for (const selector of selectors) {
        const element = context.querySelector(selector);
        const text = element && String(element.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) return text.slice(0, 200);
    }
    return null;
}

function resolveChannelIdentity(context) {
    if (!context || typeof context.querySelectorAll !== 'function') return null;

    const values = [];
    const addValue = value => {
        if (value !== undefined && value !== null && String(value).trim()) values.push(String(value));
    };

    if (typeof context.getAttribute === 'function') {
        ['data-channel-id', 'channel-id', 'data-owner-channel-id', 'data-owner-id'].forEach(attribute => {
            addValue(context.getAttribute(attribute));
        });
    }

    let metadataNodes = [];
    try {
        metadataNodes = Array.from(context.querySelectorAll(
            '[data-channel-id], [channel-id], [data-owner-channel-id], [data-owner-id]'
        ));
    } catch (_) { }
    metadataNodes.forEach(node => {
        ['data-channel-id', 'channel-id', 'data-owner-channel-id', 'data-owner-id'].forEach(attribute => {
            addValue(node.getAttribute(attribute));
        });
    });

    let links = [];
    try {
        links = Array.from(context.querySelectorAll('a[href*="/channel/"], a[href*="/@"]'));
    } catch (_) { }
    links.forEach(link => addValue(link.getAttribute('href')));

    return normalizeChannelIdentityValues(values, extractChannelDisplayName(context));
}

function channelFilterKeysForIdentity(identity) {
    if (!identity) return [];
    return normalizeChannelIdentityValues([
        identity.id,
        ...(Array.isArray(identity.aliases) ? identity.aliases : [])
    ], identity.name)?.keys || [];
}

function isChannelLocallyBlocked(contextOrIdentity) {
    const identity = contextOrIdentity && Array.isArray(contextOrIdentity.keys)
        ? contextOrIdentity
        : resolveChannelIdentity(contextOrIdentity);
    return channelFilterKeysForIdentity(identity).some(key => CHANNEL_FILTER_STATE.keys.has(key));
}

function channelFilterIsSearchSurface(renderer) {
    const pathname = String(window.location?.pathname || '');
    if (pathname === '/results' || pathname.startsWith('/results/')) return true;
    try {
        return !!renderer.closest('ytd-search, #search, #contents ytd-search');
    } catch (_) {
        return false;
    }
}

function channelFilterIsRecommendationSurface(renderer) {
    if (!renderer || typeof renderer.matches !== 'function') return false;
    if (channelFilterIsSearchSurface(renderer)) return false;

    const pathname = String(window.location?.pathname || '/');
    if (pathname === '/' || pathname === '') return true;
    if (pathname === '/watch') {
        try {
            return !!renderer.closest(
                '#related, #secondary, ytd-watch-next-secondary-results-renderer, ' +
                'ytd-watch-next-results-renderer'
            );
        } catch (_) {
            return false;
        }
    }
    if (pathname.startsWith('/shorts/')) return true;
    return false;
}

function channelFilterHasCandidateAncestor(renderer) {
    let parent = renderer && renderer.parentElement;
    while (parent) {
        if (typeof parent.matches === 'function' && parent.matches(CHANNEL_FILTER_RENDERER_SELECTOR)) {
            return true;
        }
        parent = parent.parentElement;
    }
    return false;
}

function getChannelFilterRenderers() {
    if (!document || typeof document.querySelectorAll !== 'function') return [];
    let renderers = [];
    try {
        renderers = Array.from(document.querySelectorAll(CHANNEL_FILTER_RENDERER_SELECTOR));
    } catch (_) {
        return [];
    }

    return renderers.filter(renderer =>
        channelFilterIsRecommendationSurface(renderer) && !channelFilterHasCandidateAncestor(renderer)
    );
}

function getChannelFilterVideoKey(renderer) {
    if (!renderer || typeof renderer.querySelector !== 'function') return '';
    const dataVideoId = renderer.getAttribute?.('data-video-id');
    if (dataVideoId) return `id:${dataVideoId}`;

    const link = renderer.querySelector('a[href*="/shorts/"], a[href*="/watch"]');
    if (link) {
        const href = link.getAttribute('href') || '';
        try {
            const url = new URL(href, window.location.origin);
            const id = url.pathname.startsWith('/shorts/')
                ? url.pathname.split('/')[2]
                : url.searchParams.get('v');
            if (id) return `id:${id}`;
        } catch (_) { }
    }

    const title = renderer.querySelector('#video-title, h3, h2, [id*="title" i]');
    if (title) return `title:${String(title.textContent || '').trim().slice(0, 160)}`;

    // The active Shorts route is a safe last-resort fingerprint when a
    // transient renderer has not received its owner link yet. Do not use a
    // channel name or a renderer object as a key; both can target the wrong
    // video after YouTube recycles the node.
    const pathname = String(window.location?.pathname || '');
    if (renderer.matches?.('ytd-reel-video-renderer') && pathname.startsWith('/shorts/')) {
        const routeId = pathname.split('/')[2];
        if (routeId) return `route:${routeId}`;
    }
    return '';
}

function channelFilterIsActiveShort(renderer) {
    if (!renderer) return false;
    // The active renderer is intentionally kept in the DOM but hidden while
    // YouTube transitions to the next Short. Do not let our own visibility
    // rule make the renderer look inactive and cancel its navigation lock.
    if (renderer.classList?.contains('my-channel-filtered--active')) {
        // Once the user moves to another Short, the recycled renderer can
        // remain marked by us while it is far outside the viewport. Keep the
        // transition lock only while that renderer still occupies the active
        // player slot; this prevents retries from hijacking manual scrolling.
        try {
            const rect = renderer.getBoundingClientRect?.();
            const viewportHeight = Number(window.innerHeight || 0);
            if (rect && viewportHeight > 0 &&
                (rect.bottom <= viewportHeight * 0.2 || rect.top >= viewportHeight * 0.8)) {
                return false;
            }
        } catch (_) { }
        return true;
    }
    if (renderer.hasAttribute?.('is-active')) return true;
    if (typeof _isActiveShortRenderer === 'function') return _isActiveShortRenderer(renderer);
    return false;
}

function getBlockedShortNavigationKey(renderer) {
    return getChannelFilterVideoKey(renderer) || '';
}

function queueBlockedShortNavigation(renderer) {
    const fingerprint = getBlockedShortNavigationKey(renderer);
    if (!fingerprint) return;

    const options = {
        reason: 'channel',
        fingerprint,
        isCurrent: () => channelFilterIsEnabled() &&
            channelFilterIsRecommendationSurface(renderer) &&
            channelFilterIsActiveShort(renderer) &&
            getBlockedShortNavigationKey(renderer) === fingerprint &&
            isChannelLocallyBlocked(renderer)
    };

    if (typeof scheduleShortsInvisibleTransition === 'function') {
        scheduleShortsInvisibleTransition(renderer, options);
    } else if (typeof navigateToNextShort === 'function' &&
        renderer.__myChannelFallbackFingerprint !== fingerprint) {
        // Compatibility fallback for isolated legacy test pages. The shipped
        // manifest always loads the shared transition coordinator.
        renderer.__myChannelFallbackFingerprint = fingerprint;
        navigateToNextShort();
    }
}

function hideChannelFilterRenderer(renderer, identity) {
    const videoKey = getChannelFilterVideoKey(renderer);
    const active = renderer.matches?.('ytd-reel-video-renderer') && channelFilterIsActiveShort(renderer);
    renderer.classList.add('my-channel-filtered');
    renderer.setAttribute('data-my-channel-filtered', 'true');
    if (videoKey) renderer.setAttribute('data-my-channel-filter-key', videoKey);

    if (active) {
        renderer.classList.add('my-channel-filtered--active');
        renderer.querySelector?.('video')?.pause?.();
        queueBlockedShortNavigation(renderer);
    } else {
        renderer.classList.remove('my-channel-filtered--active');
        if (typeof releaseShortsInvisibleTransitionReason === 'function') {
            releaseShortsInvisibleTransitionReason(renderer, videoKey, 'channel');
        }
    }

    if (identity?.id) renderer.setAttribute('data-my-channel-filter-identity', identity.id);
}

function clearChannelFilterRenderer(renderer) {
    const fingerprint = renderer.getAttribute?.('data-my-channel-filter-key') ||
        getBlockedShortNavigationKey(renderer);
    if (typeof releaseShortsInvisibleTransitionReason === 'function') {
        releaseShortsInvisibleTransitionReason(renderer, fingerprint, 'channel');
    }
    renderer.classList.remove('my-channel-filtered', 'my-channel-filtered--active');
    renderer.removeAttribute('data-my-channel-filtered');
    renderer.removeAttribute('data-my-channel-filter-key');
    renderer.removeAttribute('data-my-channel-filter-identity');
    delete renderer.__myChannelFallbackFingerprint;
}

function channelFilterIsEnabled() {
    const extensionEnabled = typeof EXTENSION_ENABLED === 'undefined' ? true : !!EXTENSION_ENABLED;
    const blockingEnabled = typeof BLOCKING_ENABLED === 'undefined' ? true : !!BLOCKING_ENABLED;
    return extensionEnabled && blockingEnabled;
}

function restoreChannelFilter() {
    if (!document || typeof document.querySelectorAll !== 'function') return;
    document.querySelectorAll('.my-channel-filtered').forEach(clearChannelFilterRenderer);
    if (typeof reevaluateShortsInvisibleTransitions === 'function') {
        reevaluateShortsInvisibleTransitions();
    }
}

function applyChannelFilter() {
    if (!channelFilterIsEnabled()) {
        restoreChannelFilter();
        return;
    }

    // A renderer can survive an SPA route change. Clear stale marks before
    // scanning the current route so a card hidden on Home cannot remain hidden
    // when YouTube reuses it on Search, a channel page, or a playlist.
    if (typeof document.querySelectorAll === 'function') {
        document.querySelectorAll('.my-channel-filtered').forEach(renderer => {
            if (!channelFilterIsRecommendationSurface(renderer)) clearChannelFilterRenderer(renderer);
        });
    }

    if (typeof reevaluateShortsInvisibleTransitions === 'function') {
        reevaluateShortsInvisibleTransitions();
    }

    for (const renderer of getChannelFilterRenderers()) {
        const currentVideoKey = getChannelFilterVideoKey(renderer);
        const previousVideoKey = renderer.getAttribute('data-my-channel-filter-key');
        const previousIdentityKey = renderer.getAttribute('data-my-channel-filter-identity');
        if (previousVideoKey && previousVideoKey !== currentVideoKey) {
            clearChannelFilterRenderer(renderer);
        }

        const identity = resolveChannelIdentity(renderer);
        if (identity && isChannelLocallyBlocked(identity)) {
            hideChannelFilterRenderer(renderer, identity);
        } else if (identity || currentVideoKey !== previousVideoKey ||
            (renderer.classList.contains('my-channel-filtered') &&
                (!previousIdentityKey || !CHANNEL_FILTER_STATE.keys.has(previousIdentityKey)))) {
            clearChannelFilterRenderer(renderer);
        }
    }
}

function scheduleChannelFilterApply(delay = 0) {
    if (CHANNEL_FILTER_STATE.applyTimer !== null) return;
    CHANNEL_FILTER_STATE.applyTimer = setTimeout(() => {
        CHANNEL_FILTER_STATE.applyTimer = null;
        applyChannelFilter();
    }, delay);
}

function setChannelFilterStorage(data, callback) {
    try {
        if (!chrome?.storage?.local?.set) {
            callback(false);
            return;
        }
        chrome.storage.local.set(data, () => callback(!chrome.runtime?.lastError));
    } catch (_) {
        callback(false);
    }
}

function addBlockedChannelLocally(identity) {
    channelFilterDeveloperLogger?.info('channel.block_requested', 'Local channel block requested.');
    const operation = () => new Promise(resolve => {
        const normalized = normalizeChannelIdentityValues([
            identity?.id,
            ...(Array.isArray(identity?.aliases) ? identity.aliases : [])
        ], identity?.name);
        if (!normalized) {
            resolve({ ok: false, reason: 'identity_unavailable' });
            return;
        }

        safeStorageGet(['blockedChannels'], result => {
            const entries = rebuildChannelFilterIndex(result.blockedChannels);
            const matching = entries.find(entry =>
                [entry.id, ...entry.aliases].some(key => normalized.keys.includes(key))
            );
            if (matching) {
                const displayName = matching.name && matching.name !== matching.id
                    ? matching.name
                    : normalized.name || matching.name;
                const merged = normalizeChannelIdentityValues([
                    matching.id,
                    ...matching.aliases,
                    normalized.id,
                    ...normalized.aliases
                ], displayName);
                const upgraded = {
                    ...matching,
                    id: merged.id,
                    aliases: merged.aliases,
                    name: displayName || merged.id
                };
                const changed = upgraded.id !== matching.id ||
                    upgraded.name !== matching.name ||
                    upgraded.aliases.length !== matching.aliases.length ||
                    upgraded.aliases.some((alias, index) => alias !== matching.aliases[index]);
                if (changed) {
                    const nextEntries = entries.map(entry => entry === matching ? upgraded : entry);
                    setChannelFilterStorage({
                        blockedChannels: nextEntries,
                        blockedCount: nextEntries.length
                    }, ok => {
                        if (!ok) {
                            resolve({ ok: false, reason: 'storage_error' });
                            return;
                        }
                        rebuildChannelFilterIndex(nextEntries);
                        scheduleChannelFilterApply();
                        resolve({ ok: true, alreadyBlocked: true, upgraded: true, entry: upgraded });
                    });
                    return;
                }
                scheduleChannelFilterApply();
                resolve({ ok: true, alreadyBlocked: true, entry: matching });
                return;
            }

            const nextEntry = {
                id: normalized.id,
                aliases: normalized.aliases,
                name: normalized.name || normalized.id,
                blockedAt: Date.now()
            };
            const nextEntries = [...entries, nextEntry];
            setChannelFilterStorage({
                blockedChannels: nextEntries,
                blockedCount: nextEntries.length
            }, ok => {
                if (!ok) {
                    resolve({ ok: false, reason: 'storage_error' });
                    return;
                }
                rebuildChannelFilterIndex(nextEntries);
                scheduleChannelFilterApply();
                resolve({ ok: true, alreadyBlocked: false, entry: nextEntry });
            });
        });
    });
    const result = CHANNEL_FILTER_STATE.storageQueue.then(operation, operation);
    CHANNEL_FILTER_STATE.storageQueue = result.catch(() => {});
    return result;
}

function initializeChannelFilter() {
    if (CHANNEL_FILTER_STATE.initialized) return;
    CHANNEL_FILTER_STATE.initialized = true;

    safeStorageGet(['blockedChannels'], result => {
        rebuildChannelFilterIndex(result.blockedChannels);
        applyChannelFilter();
    });

    try {
        chrome.storage.onChanged?.addListener((changes, namespace) => {
            if (namespace !== 'local') return;
            if (changes.blockedChannels) {
                rebuildChannelFilterIndex(changes.blockedChannels.newValue);
                scheduleChannelFilterApply();
            }
            if (changes.extensionEnabled || changes.blockingEnabled) scheduleChannelFilterApply();
        });
    } catch (_) { }

    document.addEventListener('yt-navigate-finish', () => {
        scheduleChannelFilterApply(0);
        if (typeof reevaluateShortsInvisibleTransitions === 'function') {
            reevaluateShortsInvisibleTransitions();
        }
    });
}

initializeChannelFilter();
