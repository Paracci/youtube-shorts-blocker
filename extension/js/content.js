// ─────────────────────────────────────────────────────────────────────────────
// content.js – Main entry point, DOM orchestration, and SPA routing
// Depends on: i18n, state.js, and all feature modules
// ─────────────────────────────────────────────────────────────────────────────

let debounceTimer = null;
const contentDeveloperLogger = typeof DeveloperLogger !== 'undefined'
    ? DeveloperLogger.create('content', 'content')
    : null;

try {
    window.addEventListener('error', event => {
        const message = event?.message || event?.error?.message || 'Unhandled content-script error.';
        contentDeveloperLogger?.error('content.unhandled_error', message);
    });
    window.addEventListener('unhandledrejection', event => {
        contentDeveloperLogger?.error('content.unhandled_rejection', event?.reason?.message || String(event?.reason || 'Unhandled rejection.'));
    });
} catch (_) { }

function triggerGlobalOptimization() {
    if (!EXTENSION_ENABLED) return;
    if (debounceTimer) clearTimeout(debounceTimer);

    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (!EXTENSION_ENABLED) return;
        if (typeof runOptimizationCheck === 'function') runOptimizationCheck();
        if (typeof applyHomepageVisibility === 'function') applyHomepageVisibility();
        if (typeof initVideoDownloadButton === 'function') initVideoDownloadButton();
    // YouTube builds the Shorts action bar in several small DOM batches. A
    // short debounce keeps discovery responsive without competing with that
    // render work or making buttons visibly late.
    }, 100);
}

const RELEVANT_DOM_SELECTOR = [
    'ytd-reel-video-renderer',
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-playlist-video-renderer',
    'ytd-video-with-context-renderer',
    'ytd-rich-grid-media',
    'yt-lockup-view-model',
    'ytd-rich-section-renderer',
    'ytd-rich-shelf-renderer',
    'ytd-reel-player-overlay-renderer',
    'yt-reel-player-overlay-view-model',
    'reel-action-bar-view-model',
    'button-view-model',
    'like-button-view-model',
    'toggle-button-view-model',
    'pivot-button-view-model',
    '#movie_player',
    '.html5-video-player',
    '#button-bar',
    '#actions',
    '#action-buttons',
    '[class*="action-bar" i]',
    '[class*="actions-container" i]',
    '[class*="action-buttons" i]',
    '.ytp-chrome-bottom',
    '.reel-action-bar-view-model'
].join(',');

function containsRelevantElement(node) {
    if (!node || (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE)) return false;
    try {
        return (node.nodeType === Node.ELEMENT_NODE && node.matches(RELEVANT_DOM_SELECTOR)) ||
            !!node.querySelector(RELEVANT_DOM_SELECTOR);
    } catch (_) {
        return false;
    }
}

function relevantAttributeTarget(target) {
    if (!target || target.nodeType !== Node.ELEMENT_NODE) return false;
    try {
        if (target.closest('.my-shorts-action-host, .my-block-button, .my-dl-btn-shorts')) {
            return false;
        }
        if (target.matches(RELEVANT_DOM_SELECTOR)) return true;
        const renderer = target.closest(
            'ytd-reel-video-renderer, ytd-rich-item-renderer, ytd-video-renderer, ' +
            'ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-playlist-video-renderer, ' +
            'ytd-video-with-context-renderer, ytd-rich-grid-media, yt-lockup-view-model'
        );
        if (renderer) {
            // Player controls update classes frequently; renderer metadata and
            // channel links are the mutations that can invalidate filtering.
            if (target.closest('#shorts-player, #player-container, .html5-video-player, ytd-player')) {
                return false;
            }
            return true;
        }
        return !!target.closest('#movie_player, .html5-video-player');
    } catch (_) {
        return false;
    }
}

// One observer handles structural changes, nested renderer insertions, and the
// small set of attributes YouTube changes when it recycles a Shorts renderer.
const globalObserver = new MutationObserver((mutations) => {
    if (!EXTENSION_ENABLED) return;

    const shouldTrigger = mutations.some(mutation => {
        if (mutation.type === 'attributes') {
            if (mutation.attributeName === 'class' &&
                (mutation.target.classList?.contains('my-channel-filtered') ||
                    mutation.target.classList?.contains('my-shorts-excluded'))) return false;
            return relevantAttributeTarget(mutation.target);
        }
        for (const node of mutation.addedNodes) {
            if (containsRelevantElement(node)) return true;
        }
        return false;
    });

    if (shouldTrigger) triggerGlobalOptimization();
});

function initOrchestrator() {
    const root = document.body || document.documentElement;
    if (!root) {
        setTimeout(initOrchestrator, 50);
        return;
    }

    contentDeveloperLogger?.info('content.orchestrator_started', 'YouTube content orchestrator started.', '', {
        route: location.pathname.slice(0, 80)
    });

    globalObserver.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
            'href', 'is-active', 'is-ads-overlay', 'data-video-id',
            'data-channel-id', 'data-owner-channel-id', 'data-owner-id', 'channel-id', 'hidden',
            'class', 'aria-label', 'role', 'style'
        ]
    });

    document.addEventListener('yt-navigate-finish', () => {
        contentDeveloperLogger?.debug('content.navigation', 'YouTube SPA navigation completed.', '', {
            route: location.pathname.slice(0, 80)
        });
        triggerGlobalOptimization();
    });
    if (typeof initVideoDownloadButton === 'function') initVideoDownloadButton();
    triggerGlobalOptimization();
}

initOrchestrator();
