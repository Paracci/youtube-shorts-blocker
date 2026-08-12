(() => {
  'use strict';

  const root = document.querySelector('[data-landing-download-demo]');
  if (!root) return;

  const $ = (selector) => root.querySelector(selector);
  const $$ = (selector) => Array.from(root.querySelectorAll(selector));
  const form = $('#landing-download-form');
  const urlInput = $('#landing-demo-url');
  const status = $('#landing-demo-status');
  const results = $('#landing-demo-results');
  const clearButton = $('#landing-demo-clear');
  const sampleButton = $('#landing-demo-sample');
  const advancedToggle = $('#landing-demo-advanced-toggle');
  const advancedPanel = $('#landing-demo-advanced-panel');
  const jobStatus = $('#landing-demo-job-status');
  const jobTitle = $('#landing-demo-job-title');
  const retryButton = $('#landing-demo-retry');
  const cancelButton = $('#landing-demo-cancel');
  const progressBar = $('#landing-demo-progress-bar');
  const progressValue = $('#landing-demo-progress-value');
  const speed = $('#landing-demo-speed');
  const eta = $('#landing-demo-eta');
  const success = $('#landing-demo-success');
  const formatButtons = $$('[data-demo-format]');

  const SAMPLE_URL = 'https://www.youtube.com/watch?v=sample12345';
  const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
  const VALID_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);
  const formatLabels = {
    'best-mp4': 'Best MP4',
    '2160p': '2160p MP4',
    '1440p': '1440p MP4',
    '1080p': '1080p MP4',
    'mp3': 'MP3 audio',
    'm4a': 'M4A audio',
    'advanced-2160': '2160p WebM',
    'advanced-1080': '1080p MP4',
    'advanced-opus': 'Opus audio'
  };

  let progressTimer = null;
  let progress = 0;
  let lastFormatId = null;

  const setDemoState = (nextState) => {
    root.dataset.demoState = nextState;
  };

  const setStatus = (message, tone = '') => {
    status.textContent = message;
    status.classList.toggle('is-error', tone === 'error');
    status.classList.toggle('is-success', tone === 'success');
  };

  const setProgress = (value) => {
    progress = Math.max(0, Math.min(100, value));
    progressBar.style.width = `${progress}%`;
    progressValue.textContent = `${Math.round(progress)}%`;
  };

  const resetJob = () => {
    window.clearInterval(progressTimer);
    progressTimer = null;
    setProgress(0);
    jobStatus.textContent = 'Ready';
    jobTitle.textContent = 'Choose a format to start';
    speed.textContent = '—';
    eta.textContent = '—';
    retryButton.hidden = true;
    cancelButton.hidden = true;
    success.hidden = true;
    formatButtons.forEach((button) => {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    });
  };

  const validateDemoUrl = (value) => {
    const raw = value.trim();
    if (!raw) return { error: 'Paste a public YouTube video URL first.' };
    if (raw.length > 2048) return { error: 'That URL is too long for a single-video link.' };

    let url;
    try {
      url = new URL(raw);
    } catch {
      return { error: 'Use a complete HTTPS YouTube URL.' };
    }

    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:') return { error: 'Only secure HTTPS links are accepted.' };
    if (!VALID_HOSTS.has(hostname)) return { error: 'Only public YouTube video links are accepted.' };
    if (url.username || url.password) return { error: 'Links containing credentials are not accepted.' };
    if (url.searchParams.has('list')) return { error: 'Playlist links are not supported in this preview.' };

    let videoId = '';
    if (hostname === 'youtu.be') {
      const pathParts = url.pathname.split('/').filter(Boolean);
      if (pathParts.length !== 1) return { error: 'Use a single youtu.be video link.' };
      videoId = pathParts[0];
    } else if (url.pathname === '/watch') {
      videoId = url.searchParams.get('v') || '';
    } else if (/^\/shorts\/[A-Za-z0-9_-]+$/.test(url.pathname)) {
      videoId = url.pathname.split('/')[2];
    } else if (/^\/embed\/[A-Za-z0-9_-]+$/.test(url.pathname)) {
      videoId = url.pathname.split('/')[2];
    } else {
      return { error: 'Use a watch, Shorts, embed, or youtu.be video link.' };
    }

    if (!VIDEO_ID_PATTERN.test(videoId)) return { error: 'The URL does not contain a valid single-video ID.' };
    return { videoId };
  };

  const showFormats = () => {
    const validation = validateDemoUrl(urlInput.value);
    if (validation.error) {
      window.clearInterval(progressTimer);
      results.hidden = true;
      setDemoState('error');
      setStatus(validation.error, 'error');
      resetJob();
      return false;
    }

    resetJob();
    lastFormatId = null;
    results.hidden = false;
    setDemoState('formats-ready');
    setStatus('Formats resolved locally for the interactive preview.', 'success');
    advancedPanel.hidden = true;
    advancedToggle.setAttribute('aria-expanded', 'false');
    advancedToggle.textContent = 'Show advanced';
    return true;
  };

  const startDownload = (formatId) => {
    if (root.dataset.demoState === 'downloading') return;
    if (results.hidden && !showFormats()) return;

    const label = formatLabels[formatId] || 'Selected format';
    lastFormatId = formatId;
    window.clearInterval(progressTimer);
    setDemoState('downloading');
    setStatus(`${label} is being prepared in the local preview. No file will be created.`, '');
    jobStatus.textContent = 'Downloading';
    jobTitle.textContent = `${label} · A calmer way to watch`;
    cancelButton.hidden = false;
    success.hidden = true;
    retryButton.hidden = true;
    setProgress(8);
    speed.textContent = '2.4 MB/s';
    eta.textContent = 'calculating ETA';
    formatButtons.forEach((button) => {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
    });

    progressTimer = window.setInterval(() => {
      setProgress(progress + 14);
      eta.textContent = progress < 55 ? 'about 3 sec' : progress < 90 ? 'about 1 sec' : 'finishing';
      if (progress >= 100) {
        window.clearInterval(progressTimer);
        progressTimer = null;
        setDemoState('completed');
        jobStatus.textContent = 'Complete';
        retryButton.hidden = false;
        cancelButton.hidden = true;
        success.hidden = false;
        speed.textContent = '2.4 MB/s';
        eta.textContent = 'done';
        setStatus(`${label} finished in the local UI preview.`, 'success');
        formatButtons.forEach((button) => {
          button.disabled = false;
          button.removeAttribute('aria-busy');
        });
      }
    }, 260);
  };

  const cancelDownload = () => {
    if (root.dataset.demoState !== 'downloading') return;
    window.clearInterval(progressTimer);
    progressTimer = null;
    setDemoState('cancelled');
    jobStatus.textContent = 'Cancelled';
    jobTitle.textContent = 'Choose a format to try again';
    retryButton.hidden = !lastFormatId;
    cancelButton.hidden = true;
    speed.textContent = '—';
    eta.textContent = '—';
    setStatus('The simulated download was cancelled. Nothing was saved.', '');
    formatButtons.forEach((button) => {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    });
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    showFormats();
  });

  clearButton.addEventListener('click', () => {
    window.clearInterval(progressTimer);
    urlInput.value = '';
    results.hidden = true;
    setDemoState('idle');
    lastFormatId = null;
    resetJob();
    setStatus('Enter a public single-video URL to preview the format picker.');
    urlInput.focus();
  });

  sampleButton.addEventListener('click', () => {
    urlInput.value = SAMPLE_URL;
    urlInput.focus();
    setDemoState('idle');
    setStatus('Sample URL loaded. Click “Get formats” to continue.');
  });

  advancedToggle.addEventListener('click', () => {
    const expanded = advancedToggle.getAttribute('aria-expanded') === 'true';
    advancedToggle.setAttribute('aria-expanded', String(!expanded));
    advancedPanel.hidden = expanded;
    advancedToggle.textContent = expanded ? 'Show advanced' : 'Hide advanced';
  });

  formatButtons.forEach((button) => {
    button.addEventListener('click', () => startDownload(button.dataset.demoFormat));
  });

  retryButton.addEventListener('click', () => {
    if (lastFormatId) startDownload(lastFormatId);
  });

  cancelButton.addEventListener('click', cancelDownload);
})();
