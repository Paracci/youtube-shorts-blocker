// ─────────────────────────────────────────────────────────────────────────────
// content.js – Main entry point, DOM orchestration, and SPA routing
// Depends on: i18n, state.js, and all feature modules
// ─────────────────────────────────────────────────────────────────────────────

let debounceTimer = null;

function triggerGlobalOptimization() {
    if (!EXTENSION_ENABLED) return;
    if (debounceTimer) clearTimeout(debounceTimer);

    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (!EXTENSION_ENABLED) return;
        if (typeof runOptimizationCheck === 'function') runOptimizationCheck();
        if (typeof applyHomepageVisibility === 'function') applyHomepageVisibility();
        if (typeof initVideoDownloadButton === 'function') initVideoDownloadButton();
    }, 300);
}

const RELEVANT_DOM_SELECTOR = [
    'ytd-reel-video-renderer',
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
        const renderer = target.closest('ytd-reel-video-renderer');
        if (renderer) {
            // Player controls update classes frequently; action/overlay changes
            // are the mutations that can invalidate button placement.
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
        if (mutation.type === 'attributes') return relevantAttributeTarget(mutation.target);
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

    globalObserver.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
            'href', 'is-active', 'is-ads-overlay', 'data-video-id', 'hidden',
            'class', 'aria-label', 'role', 'style'
        ]
    });

    document.addEventListener('yt-navigate-finish', triggerGlobalOptimization);
    if (typeof initVideoDownloadButton === 'function') initVideoDownloadButton();
    triggerGlobalOptimization();
}

initOrchestrator();
