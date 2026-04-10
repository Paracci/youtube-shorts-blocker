// ─────────────────────────────────────────────────────────────────────────────
// shorts-hider.js – Hide / show the Shorts shelf on the YouTube homepage
// Depends on: utils.js, state.js
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Applies CSS hiding and logs stats for homepage Shorts shelves.
 */
function applyHomepageVisibility() {
    const isHome = window.location.pathname === '/' || window.location.pathname === '';
    
    if (isHome && EXTENSION_ENABLED && HIDE_SHORTS_HOMEPAGE) {
        document.body.classList.add('my-hide-shorts-home');
        
        // Count how many shelves are currently visible that we are about to hide
        const shelves = document.querySelectorAll(
            'ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]), ' +
            'ytd-rich-section-renderer:has(a[href^="/shorts/"])'
        );
        
        if (shelves.length > 0) {
            safeStorageGet('hiddenCount', (res) => {
                safeStorageSet({ hiddenCount: (res.hiddenCount || 0) + shelves.length });
            });
        }
    } else {
        document.body.classList.remove('my-hide-shorts-home');
    }
}

// Observer removed. Centralized observer in content.js will now call applyHomepageVisibility().
