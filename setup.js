document.addEventListener('DOMContentLoaded', () => {
    const statusIndicator = document.getElementById('status-indicator');
    const statusText = document.getElementById('status-text');
    const instructionsBlock = document.getElementById('instructions-block');
    const checkBtn = document.getElementById('check-btn');
    const doneContainer = document.getElementById('done-container');
    const extIdDisplay = document.getElementById('extension-id-display');
    const copyBtn = document.getElementById('copy-btn');
    const setupView = document.getElementById('setup-view');

    const extensionId = chrome.runtime.id;
    extIdDisplay.textContent = extensionId;

    copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(extensionId).then(() => {
            const originalIcon = copyBtn.innerHTML;
            copyBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="#2ba640"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>';
            setTimeout(() => { copyBtn.innerHTML = originalIcon; }, 2000);
        });
    });

    document.getElementById('close-btn').addEventListener('click', () => {
        window.close();
    });

    function setStatus(state) {
        statusIndicator.className = 'status-dot';
        if (state === 'checking') {
            statusIndicator.classList.add('checking');
            statusText.textContent = 'Checking connection to Native Host...';
            instructionsBlock.style.display = 'none';
            checkBtn.style.display = 'none';
        } else if (state === 'connected') {
            statusIndicator.classList.add('connected');
            statusText.textContent = 'Connected successfully!';

            setTimeout(() => {
                setupView.style.display = 'none';
                doneContainer.style.display = 'flex';
            }, 600);

        } else if (state === 'disconnected') {
            statusIndicator.classList.add('disconnected');
            statusText.textContent = 'Native Host not detected.';
            instructionsBlock.style.display = 'block';
            checkBtn.style.display = 'inline-block';
        }
    }

    function checkConnection() {
        setStatus('checking');

        chrome.runtime.sendMessage({ action: 'check_native_host_status' }, (response) => {
            if (chrome.runtime.lastError) {
                setStatus('disconnected');
                return;
            }

            if (response && response.status === 'connected') {
                setStatus('connected');
            } else {
                setStatus('disconnected');
            }
        });
    }

    checkBtn.addEventListener('click', checkConnection);

    // Initial check
    setTimeout(checkConnection, 800); // small delay for visual effect

    // --- Updater Logic ---
    const updateBtn = document.getElementById('update-ytdlp-btn');
    const updateLogContainer = document.getElementById('update-log-container');

    if (updateBtn) {
        updateBtn.addEventListener('click', () => {
            updateBtn.disabled = true;
            updateBtn.textContent = 'Updating... Please wait';
            updateBtn.style.opacity = '0.5';

            updateLogContainer.classList.remove('hidden');
            updateLogContainer.textContent = 'Starting updater...\n';

            chrome.runtime.sendMessage({ action: 'update_downloader_native' }, (res) => {
                if (chrome.runtime.lastError || res?.status === 'failed_native_connect') {
                    updateLogContainer.textContent += '\nError: Could not connect to the native app.';
                    resetUpdateBtn();
                }
            });
        });
    }

    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === 'ytdlp_update_progress' && message.data) {
            const data = message.data;

            if (data.status === 'info' || data.status === 'progress' || data.status === 'error_log') {
                updateLogContainer.textContent += (data.data || data.message || '') + '\n';
                updateLogContainer.scrollTop = updateLogContainer.scrollHeight;
            }
            else if (data.status === 'update_success') {
                updateLogContainer.textContent += '\nUpdate process completed successfully!\n';
                updateLogContainer.scrollTop = updateLogContainer.scrollHeight;
                updateBtn.textContent = 'Up to Date!';
                updateBtn.style.borderColor = 'var(--success-color)';
                updateBtn.style.color = 'var(--success-color)';
                setTimeout(resetUpdateBtn, 4000);
            }
        }
    });

    function resetUpdateBtn() {
        if (updateBtn) {
            updateBtn.disabled = false;
            updateBtn.textContent = 'Check for Updates';
            updateBtn.style.opacity = '1';
            updateBtn.style.borderColor = '';
            updateBtn.style.color = '';
        }
    }
});