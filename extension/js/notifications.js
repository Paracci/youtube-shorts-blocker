// ─────────────────────────────────────────────────────────────────────────────
// notifications.js – YouTube-styled toast notification helper
// Depends on: (none – pure DOM utility)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shows a floating toast notification in YouTube's style.
 *
 * @param {string}  title    – Secondary line (video/channel name)
 * @param {string}  message  – Primary status line
 * @param {string|null} videoId – Used to show a thumbnail; pass null to skip
 * @param {'success'|'error'|'preparing'} state
 * @returns {{ remove: Function, success: Function }}
 */
function showYouTubeNotification(title, message, videoId, state = 'success') {
    let bgColor  = '#212121';
    let iconHTML = '';
    let duration = 4000;

    if (state === 'error') {
        bgColor = '#cc0000'; duration = 6000;
        iconHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="#fff" style="flex-shrink:0;">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
        </svg>`;
    } else if (state === 'success') {
        bgColor = '#2e7d32';
        iconHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="#fff" style="flex-shrink:0;">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
        </svg>`;
    } else {
        iconHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="#3ea6ff" style="flex-shrink:0;">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
        </svg>`;
    }

    const container = document.createElement('div');
    container.style.cssText = `
        position: fixed; top: 65px; right: 24px; z-index: 2200000000;
        background-color: ${bgColor}; color: #fff;
        font-family: 'Roboto', 'Arial', sans-serif; font-size: 14px;
        padding: 12px 16px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        display: flex; align-items: center; gap: 12px; max-width: 360px;
        opacity: 0; transform: translateY(-20px);
        transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
    `;

    let thumbHtml = '';
    if (videoId) {
        thumbHtml = `<div style="flex-shrink:0;width:40px;height:40px;border-radius:4px;overflow:hidden;background:#000;">
            <img src="https://i.ytimg.com/vi/${videoId}/default.jpg" style="width:100%;height:100%;object-fit:cover;" />
        </div>`;
    }

    container.innerHTML = `
        ${thumbHtml || iconHTML}
        <div style="display:flex;flex-direction:column;overflow:hidden;">
            <span style="font-weight:500;margin-bottom:2px;">${message}</span>
            ${title ? `<span style="font-size:12px;opacity:0.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${title}</span>` : ''}
        </div>
    `;

    document.body.appendChild(container);
    requestAnimationFrame(() => {
        container.style.opacity = '1';
        container.style.transform = 'translateY(0)';
    });

    const hide = () => {
        container.style.opacity = '0';
        container.style.transform = 'translateY(-20px)';
        setTimeout(() => { if (container.parentNode) container.parentNode.removeChild(container); }, 300);
    };
    setTimeout(hide, duration);

    return {
        remove: hide,
        success: (msg) => {
            container.querySelector('span').textContent = msg;
            container.style.backgroundColor = '#2e7d32';
            const svg = container.querySelector('svg');
            if (svg) {
                svg.style.fill = '#ffffff';
                svg.innerHTML = `<path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>`;
            }
        }
    };
}
