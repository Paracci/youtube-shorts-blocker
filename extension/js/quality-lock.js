// ─────────────────────────────────────────────────────────────────────────────
// quality-lock.js – Logic to force the highest resolution (4K/HD)
// Depends on: state.js
// ─────────────────────────────────────────────────────────────────────────────

let _qualityInterval = null;

/**
 * Attempts to force YouTube's player to the highest possible quality.
 */
function forceHighestQuality() {
    if (!EXTENSION_ENABLED || !QUALITY_LOCK_ENABLED) return;

    const player = document.getElementById('movie_player') || 
                   document.querySelector('.html5-video-player');

    if (player && typeof player.setPlaybackQualityRange === 'function') {
        player.setPlaybackQualityRange('hd2160');
    }
}

/**
 * Monitors the player state to re-apply the quality lock.
 */
function applyQualityLock() {
    // Clear existing to avoid duplicates
    if (_qualityInterval) {
        clearInterval(_qualityInterval);
        _qualityInterval = null;
    }

    if (EXTENSION_ENABLED && QUALITY_LOCK_ENABLED) {
        _qualityInterval = setInterval(forceHighestQuality, 2500);
        forceHighestQuality();
    }
}

// Initial setup
document.addEventListener('yt-navigate-finish', () => {
    if (EXTENSION_ENABLED && QUALITY_LOCK_ENABLED) {
        forceHighestQuality();
    }
});

// Initial call (state.js calls this too, but let's be safe)
applyQualityLock();
