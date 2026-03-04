// [OPTIMIZATION 1] Debounce Mechanism
let debounceTimer = null;

const observer = new MutationObserver((mutations) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        runOptimizationCheck();
    }, 100);
});

observer.observe(document.body, { childList: true, subtree: true });

// [OPTIMIZATION 2] Intersection Observer
const scrollObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const renderer = entry.target;

            // --- NEW: AD CHECK ---
            if (checkForAdAndSkip(renderer)) {
                return;
            }

            // [OPTIMIZATION 4] Force Highest Quality
            // Force quality when a new video enters the screen
            forceHighestQuality();

            const btn = renderer.querySelector('.my-block-button');
            if (btn) {
                checkAndResetButton(btn, renderer);
            }
        }
    });
}, { threshold: 0.5 });

// --- NEW: FORCE QUALITY FUNCTION ---
function forceHighestQuality() {
    // Attempt to access YouTube's main "movie_player" object.
    // This object on the DOM is more capable than the standard HTML5 video element.
    const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');

    if (player && typeof player.setPlaybackQualityRange === 'function') {
        // By sending 'hd2160' (4K), YouTube is forced to select the highest
        // quality (as a range) it can play.
        player.setPlaybackQualityRange("hd2160");
        // console.log("Quality set to maximum."); // Uncomment to test
    }
}

// --- NEW: AD SKIP FUNCTION ---
function checkForAdAndSkip(renderer) {
    const isAd = renderer.querySelector('ytd-ad-slot-renderer') ||
        renderer.tagName.toLowerCase().includes('ad-slot');

    if (isAd) {
        const video = renderer.querySelector('video');
        if (video) {
            video.muted = true;
            video.currentTime = video.duration || 1000;
        }
        renderer.style.display = "none";
        return true;
    }
    return false;
}

function getVideoFingerprint(renderer) {
    const link = renderer.querySelector('a[href^="/shorts/"]');
    if (link) return link.getAttribute('href');

    const channelName = renderer.querySelector('ytd-channel-name');
    const title = renderer.querySelector('h2.title');
    if (channelName && title) return channelName.textContent + title.textContent;

    const video = renderer.querySelector('video');
    if (video && video.src) return video.src;

    return null;
}

function runOptimizationCheck() {
    const videoRenderers = document.querySelectorAll('ytd-reel-video-renderer');

    videoRenderers.forEach(renderer => {
        if (checkForAdAndSkip(renderer)) return;

        const buttonBar = renderer.querySelector('#button-bar');

        if (buttonBar) {
            let btn = buttonBar.querySelector('.my-block-button');
            if (!btn) {
                btn = createBlockButton(buttonBar, renderer);
                scrollObserver.observe(renderer);
            }
            if (btn) {
                checkAndResetButton(btn, renderer);
            }
        }
    });
}

function checkAndResetButton(btn, videoContext) {
    const currentFingerprint = getVideoFingerprint(videoContext);
    if (!currentFingerprint) return;

    const lastFingerprint = btn.dataset.videoFingerprint;

    if (currentFingerprint !== lastFingerprint) {
        resetButtonToDefault(btn);
        btn.dataset.videoFingerprint = currentFingerprint;
    }
}

function resetButtonToDefault(btn) {
    btn.classList.remove('blocked-state');
    btn.style.opacity = "1";
    btn.style.pointerEvents = "auto";
    const textEl = btn.querySelector('.my-btn-text');
    if (textEl) textEl.textContent = "Block";
    const svgEl = btn.querySelector('svg');
    if (svgEl) svgEl.style.fill = "white";
}

function createBlockButton(container, videoContext) {
    const btn = document.createElement('button');
    btn.className = 'my-block-button';
    btn.title = "Don't recommend channel";

    btn.innerHTML = `
        <div class="my-btn-circle">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="white">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8 0-1.85.63-3.55 1.69-4.9L16.9 18.31C15.55 19.37 13.85 20 12 20zm6.31-3.1L7.1 5.69C8.45 4.63 10.15 4 12 4c4.41 0 8 3.59 8 8 0 1.85-.63 3.55-1.69 4.9z"></path>
            </svg>
        </div>
        <span class="my-btn-text">Block</span>
    `;

    btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();

        btn.style.opacity = "0.5";
        btn.querySelector('.my-btn-text').textContent = "Searching...";

        let menuButton = videoContext.querySelector('ytd-menu-renderer button');

        if (!menuButton) {
            menuButton = Array.from(videoContext.querySelectorAll('button')).find(b => {
                const label = b.getAttribute('aria-label');
                return label && (label.includes('More actions') || label.includes('Diğer') || label.includes('işlemler'));
            });
        }

        if (menuButton) {
            menuButton.click();

            setTimeout(() => {
                const menuItems = document.querySelectorAll('ytd-menu-service-item-renderer');
                let found = false;

                for (let item of menuItems) {
                    const text = item.textContent;
                    if (text.includes('Bu kanalı önerme') || text.includes('recommend this channel') || text.includes('Kanalı önerme') || text.includes("Don't recommend channel")) {
                        item.click();
                        found = true;

                        btn.querySelector('.my-btn-text').textContent = "Blocked";
                        btn.querySelector('svg').style.fill = "#ff4444";
                        btn.style.opacity = "1";
                        btn.style.pointerEvents = "none";
                        btn.classList.add('blocked-state');
                        break;
                    }
                }

                if (!found) {
                    document.body.click();
                    resetButtonToDefault(btn);
                }

            }, 50);
        } else {
            resetButtonToDefault(btn);
        }
    });

    container.appendChild(btn);
    return btn;
}