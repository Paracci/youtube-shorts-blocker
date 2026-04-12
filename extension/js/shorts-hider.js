// ─────────────────────────────────────────────────────────────────────────────
// shorts-hider.js – Hide / show the Shorts shelf on the YouTube homepage
// Depends on: utils.js, state.js
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Applies CSS hiding and logs stats for homepage Shorts shelves.
 */
const _countedShelves = new WeakSet();

function applyHomepageVisibility() {
    const isHome = window.location.pathname === '/' || window.location.pathname === '';
    if (isHome && EXTENSION_ENABLED && HIDE_SHORTS_HOMEPAGE) {
        document.body.classList.add('my-hide-shorts-home');
        const shelves = document.querySelectorAll(
            'ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]), ' +
            'ytd-rich-section-renderer:has(a[href^="/shorts/"])'
        );
        const newShelves = Array.from(shelves).filter(s => !_countedShelves.has(s));
        newShelves.forEach(s => _countedShelves.add(s));
        if (newShelves.length > 0) {
            safeStorageGet('hiddenCount', (res) => {
                safeStorageSet({ hiddenCount: (res.hiddenCount || 0) + newShelves.length });
            });
        }
    } else {
        document.body.classList.remove('my-hide-shorts-home');
    }
}

// Observer removed. Centralized observer in content.js will now call applyHomepageVisibility().
