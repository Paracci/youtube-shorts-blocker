// Standalone downloader page.
// Depends on: translations.js, download-policy.js
(function () {
    'use strict';

    const state = {
        port: null,
        requestId: null,
        media: null,
        formats: [],
        jobs: new Map(),
        logs: [],
        jobsExpanded: true,
        developerMode: false,
        hostConnected: false,
        ffmpegReady: false
    };

    const MAX_DEVELOPER_LOGS = 400;

    const $ = (id) => document.getElementById(id);
    const t = (key) => i18n.t(key);
    const pageLogger = typeof DeveloperLogger !== 'undefined'
        ? DeveloperLogger.create('download-page', 'download-page')
        : null;

    document.addEventListener('DOMContentLoaded', async () => {
        await i18n.init();
        i18n.applyToDOM();

        connectPort();
        bindEvents();
        loadPath();
        loadDeveloperMode();
        checkHostStatus();
        prefillUrl();
    });

    function bindEvents() {
        $('url-form').addEventListener('submit', (event) => {
            event.preventDefault();
            resolveFormats();
        });

        $('paste-url').addEventListener('click', pasteUrl);
        $('clear-url').addEventListener('click', () => {
            $('video-url').value = '';
            setUrlStatus('');
            $('video-url').focus();
        });
        $('use-current-url').addEventListener('click', useCurrentUrl);
        $('open-setup').addEventListener('click', openSetup);
        $('change-path').addEventListener('click', choosePath);
        $('jobs-panel-toggle').addEventListener('click', toggleJobsPanel);
        $('jobs-indicator').addEventListener('click', expandJobsPanel);
        $('developer-mode-toggle')?.addEventListener('change', event => {
            setDeveloperMode(event.target.checked);
        });
        $('clear-developer-logs')?.addEventListener('click', clearDeveloperLogs);

        $('advanced-toggle').addEventListener('click', () => {
            const panel = $('advanced-panel');
            const collapsed = !panel.hidden;
            panel.hidden = collapsed;
            $('advanced-toggle').setAttribute('aria-expanded', String(!collapsed));
            $('advanced-toggle').textContent = collapsed ? t('downloadExpand') : t('downloadCollapse');
        });

        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName === 'local' && changes.downloadPath) {
                renderPath(changes.downloadPath.newValue || '');
            }
            if (areaName === 'local' && changes.developerMode) {
                state.developerMode = changes.developerMode.newValue === true;
                renderDeveloperMode();
            }
        });
    }

    function connectPort() {
        try {
            state.port = chrome.runtime.connect({ name: 'download-page' });
            state.port.onMessage.addListener(handlePortMessage);
            state.port.onDisconnect.addListener(() => {
                state.port = null;
                if (state.jobs.size > 0) {
                    state.jobs.forEach(job => {
                        if (job.status === 'active') {
                            job.status = 'error';
                            job.message = t('downloadBridgeDisconnected');
                            announceJob(job, 'error');
                        }
                    });
                    renderJobs();
                }
            });
        } catch (_) {
            state.port = null;
        }
    }

    function handlePortMessage(message) {
        if (!message || typeof message !== 'object') return;

        if (message.action === 'download_page_log') {
            const belongsToCurrentRequest = message.requestId === state.requestId;
            const belongsToKnownJob = message.jobId && state.jobs.has(message.jobId);
            if (belongsToCurrentRequest || belongsToKnownJob) appendDeveloperLog(message, false);
            return;
        }

        if (message.action === 'download_page_formats') {
            if (message.requestId !== state.requestId) return;
            if (message.status !== 'success') {
                if (message.errorDetail) {
                    appendDeveloperLog({
                        level: 'error',
                        stream: 'stderr',
                        message: message.errorDetail,
                        requestId: message.requestId
                    }, false);
                }
                showResolveError(message);
                return;
            }
            state.media = {
                url: message.url || $('video-url').value.trim(),
                title: message.title || 'video',
                duration: message.duration || 0,
                videoId: message.videoId || ''
            };
            state.formats = Array.isArray(message.formats) ? message.formats : [];
            renderMedia();
            renderPresets();
            renderAdvanced();
            setUrlStatus(t('downloadReady'), 'success');
            return;
        }

        if (message.action === 'download_page_dispatch_result') {
            if (message.status !== 'accepted' && message.jobId) {
                updateJob(message.jobId, {
                    status: 'error',
                    message: message.message || t('downloadFailed')
                });
            }
            return;
        }

        if (message.action === 'download_page_progress') {
            if (!message.jobId || !state.jobs.has(message.jobId)) return;
            const percent = Number.isFinite(Number(message.percent))
                ? Math.max(0, Math.min(100, Number(message.percent)))
                : null;
            updateJob(message.jobId, {
                status: 'active',
                percent,
                message: message.message || message.data || t('downloadInProgress')
            });
            return;
        }

        if (message.action === 'download_page_result') {
            if (!message.jobId || !state.jobs.has(message.jobId)) return;
            if (message.details) {
                appendDeveloperLog({
                    level: 'error',
                    stream: 'stderr',
                    message: message.details,
                    requestId: message.requestId,
                    jobId: message.jobId
                }, false);
            }
            updateJob(message.jobId, {
                status: message.status === 'success' ? 'success' :
                    message.status === 'cancelled' ? 'cancelled' : 'error',
                percent: message.status === 'success' ? 100 : null,
                message: message.message || resultMessage(message.status)
            });
        }
    }

    function resolveFormats() {
        const parsed = DownloadPolicy.parse($('video-url').value);
        if (!parsed.ok) {
            setUrlStatus(policyMessage(parsed.reason), 'error');
            return;
        }

        if (!state.port) connectPort();
        if (!state.port) {
            setUrlStatus(t('downloadBridgeDisconnected'), 'error');
            return;
        }

        state.requestId = makeId();
        state.media = null;
        state.formats = [];
        hideResults();
        setUrlStatus(t('downloadLoading'), '');
        $('fetch-formats').disabled = true;
        appendDeveloperLog({
            level: 'info',
            phase: 'resolve',
            requestId: state.requestId,
            message: t('downloadDeveloperResolveStart')
        });

        try {
            state.port.postMessage({
                action: 'resolve_formats',
                requestId: state.requestId,
                url: parsed.canonicalUrl
            });
        } catch (_) {
            $('fetch-formats').disabled = false;
            setUrlStatus(t('downloadBridgeDisconnected'), 'error');
        }
    }

    function showResolveError(message) {
        $('fetch-formats').disabled = false;
        hideResults();
        const code = message.errorCode || message.code;
        if (code === 'native_required') {
            setUrlStatus(t('downloadNativeRequired'), 'error');
        } else if (code === 'ffmpeg_required') {
            setUrlStatus(t('downloadFfmpegRequired'), 'error');
        } else if (code === 'no_formats') {
            setUrlStatus(t('downloadNoFormats'), 'error');
        } else {
            setUrlStatus(message.message || t('downloadResolveFailed'), 'error');
        }
    }

    function renderMedia() {
        $('fetch-formats').disabled = false;
        $('media-title').textContent = state.media.title;
        const duration = formatDuration(state.media.duration);
        $('media-meta').textContent = duration
            ? duration + ' · ' + state.media.url
            : state.media.url;
        $('format-count').textContent = state.formats.length + ' ' + t('downloadFormatsFound');
        $('media-card').classList.remove('hidden');
    }

    function renderPresets() {
        const grid = $('preset-grid');
        grid.replaceChildren();

        addPreset(grid, 'best_mp4', t('downloadQualityBest'), 'MP4', t('downloadBestAvailable'));

        [2160, 1440, 1080, 720].forEach(height => {
            if (state.formats.some(format => Number(format.height) >= height && hasVideo(format))) {
                addPreset(grid, 'height_' + height, height + 'p MP4', t('downloadMergedVideo'), t('downloadHeightLimit'));
            }
        });

        if (state.formats.some(hasAudio)) {
            addPreset(grid, 'audio_mp3', t('downloadAudioMp3'), 'MP3', t('downloadExtractedAudio'));
            addPreset(grid, 'audio_m4a', t('downloadAudioM4a'), 'M4A', t('downloadExtractedAudio'));
        }

        $('presets-section').classList.remove('hidden');
    }

    function addPreset(parent, profileId, title, format, subtitle) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'preset-card';
        button.innerHTML =
            '<span><span class="preset-title"></span><span class="preset-subtitle"></span></span>' +
            '<svg class="preset-arrow" viewBox="0 0 24 24" aria-hidden="true">' +
            '<path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg>';
        button.querySelector('.preset-title').textContent = title;
        button.querySelector('.preset-subtitle').textContent = format + ' · ' + subtitle;
        button.addEventListener('click', () => startDownload({
            profileId,
            outputFormat: profileId === 'audio_mp3' ? 'mp3' :
                profileId === 'audio_m4a' ? 'm4a' : 'mp4',
            label: title
        }));
        parent.appendChild(button);
    }

    function renderAdvanced() {
        const body = $('format-table-body');
        body.replaceChildren();
        const formats = state.formats
            .slice()
            .sort((a, b) => {
                const typeOrder = { muxed: 0, video: 1, audio: 2 };
                const typeDiff = (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9);
                if (typeDiff) return typeDiff;
                return (Number(b.height) || 0) - (Number(a.height) || 0);
            });

        formats.forEach(format => {
            const row = document.createElement('tr');
            const quality = document.createElement('td');
            quality.dataset.label = t('downloadResolution');
            const qualityPrimary = document.createElement('span');
            qualityPrimary.className = 'format-primary';
            qualityPrimary.textContent = qualityText(format);
            const qualitySecondary = document.createElement('span');
            qualitySecondary.className = 'format-secondary';
            qualitySecondary.textContent = format.id || '';
            quality.append(qualityPrimary, qualitySecondary);

            const codec = document.createElement('td');
            codec.dataset.label = t('downloadCodec');
            codec.textContent = codecText(format);

            const type = document.createElement('td');
            type.dataset.label = t('downloadType');
            const typeBadge = document.createElement('span');
            typeBadge.className = 'format-badge ' + (format.type === 'audio' ? 'audio' :
                format.type === 'muxed' ? 'muxed' : '');
            typeBadge.textContent = typeText(format.type);
            type.appendChild(typeBadge);

            const size = document.createElement('td');
            size.dataset.label = t('downloadSize');
            size.textContent = formatSize(format.filesize);

            const output = document.createElement('td');
            output.dataset.label = t('downloadOutputLabel');
            const outputSelect = createOutputSelect(format);
            output.appendChild(outputSelect);

            const action = document.createElement('td');
            action.dataset.label = t('downloadAction');
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'row-download';
            button.textContent = t('downloadDownload');
            button.addEventListener('click', () => startDownload({
                formatId: format.id,
                outputFormat: outputSelect.value,
                label: qualityText(format)
            }));
            action.appendChild(button);

            row.append(quality, codec, type, size, output, action);
            body.appendChild(row);
        });

        $('advanced-empty').classList.toggle('hidden', formats.length > 0);
        $('advanced-section').classList.remove('hidden');
        $('advanced-panel').hidden = false;
        $('advanced-toggle').setAttribute('aria-expanded', 'true');
        $('advanced-toggle').textContent = t('downloadCollapse');
    }

    function createOutputSelect(format) {
        const select = document.createElement('select');
        select.className = 'output-select';
        select.setAttribute('aria-label', t('downloadOutputLabel'));

        const values = format.type === 'audio'
            ? ['mp3', 'm4a', 'opus']
            : ['mp4', 'webm', 'mkv'];
        values.forEach(value => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value.toUpperCase();
            select.appendChild(option);
        });
        select.value = format.type === 'audio' ? 'm4a' : 'mp4';
        return select;
    }

    function startDownload(selection) {
        if (!state.media || !state.port) {
            setUrlStatus(t('downloadNativeRequired'), 'error');
            return;
        }

        const hadJobs = state.jobs.size > 0;
        const jobId = makeId();
        state.jobs.set(jobId, {
            jobId,
            label: selection.label || t('downloadDownload'),
            status: 'active',
            percent: 0,
            message: t('downloadPreparing'),
            requestId: state.requestId,
            selection
        });
        if (!hadJobs) state.jobsExpanded = true;
        renderJobs();
        announceJob(state.jobs.get(jobId), 'active');
        appendDeveloperLog({
            level: 'info',
            phase: 'download',
            requestId: state.requestId,
            jobId,
            message: 'Starting ' + jobSummary(state.jobs.get(jobId)) + '.'
        });

        try {
            state.port.postMessage({
                action: 'start_download',
                jobId,
                requestId: state.requestId,
                url: state.media.url,
                formatId: selection.formatId || '',
                profileId: selection.profileId || '',
                outputFormat: selection.outputFormat || 'mp4',
                title: state.media.title
            });
        } catch (_) {
            updateJob(jobId, { status: 'error', message: t('downloadBridgeDisconnected') });
        }
    }

    function cancelJob(jobId) {
        const job = state.jobs.get(jobId);
        if (!job || job.status !== 'active') return;
        job.message = t('downloadCancelling');
        renderJobs();
        announceJob(job, 'cancelling');
        try {
            state.port?.postMessage({
                action: 'cancel_download',
                requestId: job.requestId,
                jobId
            });
        } catch (_) {
            updateJob(jobId, { status: 'error', message: t('downloadBridgeDisconnected') });
        }
    }

    function retryJob(jobId) {
        const oldJob = state.jobs.get(jobId);
        if (!oldJob) return;
        startDownload(oldJob.selection);
    }

    function toggleJobsPanel() {
        state.jobsExpanded = !state.jobsExpanded;
        renderJobs();
        if (state.jobsExpanded) {
            $('jobs-panel-toggle').focus();
        } else {
            $('jobs-indicator').focus();
        }
    }

    function expandJobsPanel() {
        state.jobsExpanded = true;
        renderJobs();
        $('jobs-panel-toggle').focus();
    }

    function jobFormat(job) {
        const format = String(job?.selection?.outputFormat || '').trim();
        return format ? format.toUpperCase() : t('downloadFormat');
    }

    function jobSummary(job) {
        return (job?.label || t('downloadDownload')) + ' · ' + jobFormat(job);
    }

    function jobStatusLabel(status) {
        if (status === 'success') return t('downloadComplete');
        if (status === 'cancelled') return t('downloadCancelled');
        if (status === 'error') return t('downloadFailed');
        return t('downloadInProgress');
    }

    function announceJob(job, status, message) {
        const liveStatus = $('jobs-live-status');
        if (!liveStatus || !job) return;
        const statusMessage = message || (status === 'active'
            ? t('downloadPreparing')
            : status === 'cancelling'
                ? t('downloadCancelling')
                : jobStatusLabel(status));
        liveStatus.textContent = jobSummary(job) + ': ' + statusMessage;
    }

    function renderJobs() {
        const list = $('jobs-list');
        const notification = $('jobs-section');
        const panel = $('jobs-panel');
        const indicator = $('jobs-indicator');
        const jobs = Array.from(state.jobs.values()).reverse();

        list.replaceChildren();
        notification.classList.toggle('hidden', jobs.length === 0);
        if (jobs.length === 0) return;
        notification.setAttribute('aria-label', t('downloadJobsTitle'));

        const activeCount = jobs.filter(job => job.status === 'active').length;
        const count = $('jobs-count');
        count.hidden = activeCount === 0;
        count.textContent = String(activeCount);
        count.setAttribute('aria-label', t('downloadJobsActive') + ': ' + activeCount);

        panel.hidden = !state.jobsExpanded;
        indicator.hidden = state.jobsExpanded;
        $('jobs-panel-toggle').setAttribute('aria-expanded', String(state.jobsExpanded));
        $('jobs-panel-toggle').setAttribute('aria-label', state.jobsExpanded
            ? t('downloadJobsCollapse')
            : t('downloadJobsExpand'));
        $('jobs-panel-toggle').title = state.jobsExpanded
            ? t('downloadJobsCollapse')
            : t('downloadJobsExpand');

        const latest = jobs[0];
        $('jobs-indicator-format').textContent = jobSummary(latest);
        $('jobs-indicator-status').textContent = latest.message || jobStatusLabel(latest.status);
        const indicatorCount = $('jobs-indicator-count');
        indicatorCount.hidden = jobs.length < 2;
        indicatorCount.textContent = String(jobs.length);
        indicator.setAttribute('aria-label', t('downloadJobsExpand') + ': ' +
            jobSummary(latest) + ' · ' + jobStatusLabel(latest.status));

        jobs.forEach(job => {
            const row = document.createElement('article');
            const rowStatus = ['active', 'success', 'cancelled', 'error'].includes(job.status)
                ? job.status
                : 'active';
            row.className = 'job-row is-' + rowStatus;
            row.dataset.jobId = job.jobId;
            row.setAttribute('aria-label', jobSummary(job) + ': ' + jobStatusLabel(job.status));

            const info = document.createElement('div');
            const heading = document.createElement('div');
            heading.className = 'job-heading';
            const title = document.createElement('div');
            title.className = 'job-title';
            title.textContent = job.label || t('downloadDownload');
            const format = document.createElement('span');
            format.className = 'job-format';
            format.textContent = jobFormat(job);
            heading.append(title, format);

            const statusRow = document.createElement('div');
            statusRow.className = 'job-status-row';
            const statusDot = document.createElement('span');
            statusDot.className = 'job-status-dot';
            statusDot.setAttribute('aria-hidden', 'true');
            const status = document.createElement('span');
            status.className = 'job-status';
            status.textContent = job.message || jobStatusLabel(job.status);
            statusRow.append(statusDot, status);
            if (job.percent != null) {
                const percent = document.createElement('span');
                percent.className = 'job-percent';
                percent.textContent = Math.round(job.percent) + '%';
                statusRow.appendChild(percent);
            }

            const progress = document.createElement('div');
            progress.className = 'job-progress';
            const bar = document.createElement('div');
            bar.className = 'job-progress-bar';
            if (job.status === 'success') bar.classList.add('done');
            if (job.status === 'error') bar.classList.add('failed');
            bar.style.width = (job.percent == null ? 0 : job.percent) + '%';
            progress.appendChild(bar);
            info.append(heading, statusRow, progress);

            const controls = document.createElement('div');
            controls.className = 'job-controls';
            if (job.status === 'active') {
                const cancel = document.createElement('button');
                cancel.type = 'button';
                cancel.className = 'job-action';
                cancel.textContent = t('downloadCancel');
                cancel.addEventListener('click', () => cancelJob(job.jobId));
                controls.appendChild(cancel);
            } else if (job.status === 'error' || job.status === 'cancelled') {
                const retry = document.createElement('button');
                retry.type = 'button';
                retry.className = 'job-action';
                retry.textContent = t('downloadRetry');
                retry.addEventListener('click', () => retryJob(job.jobId));
                controls.appendChild(retry);
            }

            row.append(info, controls);
            list.appendChild(row);
        });
    }

    function updateJob(jobId, patch) {
        const job = state.jobs.get(jobId);
        if (!job) return;
        const previousStatus = job.status;
        Object.assign(job, patch);
        renderJobs();
        if (patch.status && patch.status !== previousStatus && patch.status !== 'active') {
            announceJob(job, patch.status);
        }
    }

    function loadDeveloperMode() {
        chrome.storage.local.get('developerMode', result => {
            state.developerMode = result?.developerMode === true;
            renderDeveloperMode();
        });
    }

    function setDeveloperMode(enabled) {
        state.developerMode = enabled === true;
        if (typeof DeveloperLogger !== 'undefined') {
            DeveloperLogger.setEnabled(state.developerMode);
        } else {
            chrome.storage.local.set({ developerMode: state.developerMode });
        }
        renderDeveloperMode();
        if (state.developerMode) {
            appendDeveloperLog({
                level: 'info',
                phase: 'page',
                message: t('downloadDeveloperModeOn')
            });
        }
    }

    function renderDeveloperMode() {
        const toggle = $('developer-mode-toggle');
        const section = $('developer-section');
        if (toggle) toggle.checked = state.developerMode;
        if (section) {
            section.hidden = !state.developerMode;
            section.classList.toggle('hidden', !state.developerMode);
        }
        if (state.developerMode) renderDeveloperLogs();
    }

    function clearDeveloperLogs() {
        state.logs = [];
        renderDeveloperLogs();
        try {
            chrome.runtime.sendMessage({ action: 'developer_logs_clear' }, () => {
                void chrome.runtime.lastError;
            });
        } catch (_) { }
    }

    function appendDeveloperLog(entry, persist = true) {
        if (!state.developerMode) return;
        const rawMessage = String(entry?.message || entry?.data || '').replace(/\r/g, '').trim();
        if (!rawMessage) return;

        if (persist && pageLogger) {
            pageLogger.log(
                ['debug', 'info', 'warn', 'error'].includes(entry?.level) ? entry.level : 'info',
                entry?.event || `download.${entry?.phase || 'log'}`,
                rawMessage,
                entry?.details,
                {
                    requestId: entry?.requestId,
                    jobId: entry?.jobId
                }
            );
        }

        const level = ['debug', 'info', 'warn', 'error'].includes(entry?.level)
            ? entry.level
            : 'info';
        const context = [entry?.phase, entry?.stream, entry?.jobId ? 'job:' + String(entry.jobId).slice(0, 8) : '']
            .filter(Boolean)
            .join(' · ');
        const timestamp = Number.isFinite(Number(entry?.timestamp))
            ? Number(entry.timestamp)
            : Date.now();

        rawMessage.split(/\n+/).forEach(line => {
            const message = line.trim().slice(0, 2000);
            if (!message) return;
            state.logs.push({ level, context, timestamp, message });
        });
        if (state.logs.length > MAX_DEVELOPER_LOGS) {
            state.logs = state.logs.slice(-MAX_DEVELOPER_LOGS);
        }
        renderDeveloperLogs();
    }

    function renderDeveloperLogs() {
        const list = $('developer-log-list');
        const empty = $('developer-log-empty');
        const count = $('developer-log-count');
        if (!list || !empty || !count) return;

        list.replaceChildren();
        count.textContent = String(state.logs.length);
        empty.hidden = state.logs.length > 0;

        state.logs.forEach(entry => {
            const line = document.createElement('div');
            line.className = 'developer-log-line is-' + entry.level;

            const time = document.createElement('span');
            time.className = 'developer-log-time';
            time.textContent = formatLogTime(entry.timestamp);

            const level = document.createElement('span');
            level.className = 'developer-log-level';
            level.textContent = entry.level.toUpperCase();

            const context = document.createElement('span');
            context.className = 'developer-log-stream';
            context.textContent = entry.context ? '[' + entry.context + ']' : '';

            const message = document.createElement('span');
            message.className = 'developer-log-message';
            message.textContent = entry.message;

            line.append(time, level, context, message);
            list.appendChild(line);
        });

        const wrap = list.parentNode;
        if (wrap) wrap.scrollTop = wrap.scrollHeight;
    }

    function formatLogTime(timestamp) {
        try {
            return new Date(timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
        } catch (_) {
            return '--:--:--';
        }
    }

    function checkHostStatus() {
        setHostStatus('checking');
        chrome.runtime.sendMessage({ action: 'check_native_host_status' }, (response) => {
            if (chrome.runtime.lastError || !response || response.status !== 'connected') {
                setHostStatus('disconnected');
                return;
            }
            state.hostConnected = true;
            state.ffmpegReady = response.ffmpegReady !== false;
            setHostStatus('connected');
        });
    }

    function setHostStatus(status) {
        const dot = $('host-status-dot');
        dot.className = 'status-dot ' + status;
        const text = $('host-status-text');
        if (status === 'checking') {
            text.textContent = t('downloadHostChecking');
        } else if (status === 'connected') {
            text.textContent = state.ffmpegReady ? t('downloadHostConnected') :
                t('downloadFfmpegRequired');
        } else {
            text.textContent = t('downloadHostDisconnected');
        }
    }

    function loadPath() {
        chrome.storage.local.get('downloadPath', (result) => renderPath(result.downloadPath || ''));
    }

    function renderPath(pathValue) {
        const display = $('path-display');
        if (pathValue) {
            display.classList.add('has-path');
            display.removeAttribute('data-i18n');
            display.textContent = pathValue;
        } else {
            display.classList.remove('has-path');
            display.setAttribute('data-i18n', 'downloadPathDefault');
            display.textContent = t('downloadPathDefault');
        }
    }

    function choosePath() {
        chrome.storage.local.get('downloadPath', (result) => {
            chrome.runtime.sendMessage({
                action: 'pick_folder',
                currentPath: result.downloadPath || ''
            }, (response) => {
                if (chrome.runtime.lastError || !response) {
                    $('path-status').textContent = t('downloadPathError');
                    $('path-status').className = 'side-hint error';
                    return;
                }
                if (response.status === 'ok' && response.path) {
                    chrome.storage.local.set({ downloadPath: response.path });
                    $('path-status').textContent = t('downloadPathSaved');
                    $('path-status').className = 'side-hint success';
                } else {
                    $('path-status').textContent = t('downloadPathCancelled');
                    $('path-status').className = 'side-hint';
                }
            });
        });
    }

    async function pasteUrl() {
        try {
            $('video-url').value = await navigator.clipboard.readText();
            $('video-url').focus();
            setUrlStatus('');
        } catch (_) {
            setUrlStatus(t('downloadPasteUnavailable'), 'error');
        }
    }

    function useCurrentUrl() {
        // The downloader opens in its own tab. If that tab is active, fall
        // back to the first supported YouTube tab in the focused window.
        chrome.tabs.query({ lastFocusedWindow: true }, (tabs) => {
            const candidateTab = (tabs || []).find(tab => DownloadPolicy.parse(tab?.url || '').ok);
            const candidate = candidateTab?.url || '';
            const parsed = DownloadPolicy.parse(candidate);
            if (!parsed.ok) {
                setUrlStatus(t('downloadCurrentTabInvalid'), 'error');
                return;
            }
            $('video-url').value = candidate;
            setUrlStatus('');
            $('video-url').focus();
        });
    }

    function prefillUrl() {
        const value = new URLSearchParams(window.location.search).get('url');
        if (value) {
            const parsed = DownloadPolicy.parse(value);
            if (parsed.ok) $('video-url').value = value;
        }
    }

    function openSetup() {
        chrome.tabs.create({ url: chrome.runtime.getURL('views/setup.html') });
    }

    function setUrlStatus(message, kind) {
        const element = $('url-status');
        element.textContent = message || '';
        element.className = 'inline-status' + (kind ? ' ' + kind : '');
    }

    function hideResults() {
        ['media-card', 'presets-section', 'advanced-section'].forEach(id => $(id).classList.add('hidden'));
    }

    function policyMessage(reason) {
        if (reason === 'playlist_not_allowed') return t('downloadPlaylistRejected');
        if (reason === 'youtube_only') return t('downloadYouTubeOnly');
        if (reason === 'https_required') return t('downloadHttpsRequired');
        return t('downloadInvalidUrl');
    }

    function resultMessage(status) {
        if (status === 'success') return t('downloadComplete');
        if (status === 'cancelled') return t('downloadCancelled');
        return t('downloadFailed');
    }

    function hasVideo(format) {
        return format?.hasVideo === true || format?.type === 'video' || format?.type === 'muxed';
    }

    function hasAudio(format) {
        return format?.hasAudio === true || format?.type === 'audio' || format?.type === 'muxed';
    }

    function qualityText(format) {
        if (format.type === 'audio') {
            return t('downloadAudioOnly');
        }
        const height = Number(format.height);
        if (height) return height + 'p' + (format.fps ? ' · ' + format.fps + 'fps' : '');
        return format.ext ? format.ext.toUpperCase() : t('downloadFormat');
    }

    function codecText(format) {
        if (format.type === 'audio') return format.acodec || 'Audio';
        if (format.type === 'muxed') return (format.vcodec || 'Video') + ' + ' + (format.acodec || 'Audio');
        return format.vcodec || 'Video';
    }

    function typeText(type) {
        if (type === 'audio') return t('downloadAudioOnly');
        if (type === 'muxed') return t('downloadMuxed');
        return t('downloadVideoOnly');
    }

    function formatSize(bytes) {
        const size = Number(bytes);
        if (!Number.isFinite(size) || size <= 0) return '—';
        const units = ['B', 'KB', 'MB', 'GB'];
        let index = 0;
        let value = size;
        while (value >= 1024 && index < units.length - 1) {
            value /= 1024;
            index++;
        }
        return value.toFixed(index === 0 ? 0 : value >= 100 ? 0 : 1) + ' ' + units[index];
    }

    function formatDuration(seconds) {
        const value = Number(seconds);
        if (!Number.isFinite(value) || value <= 0) return '';
        const total = Math.round(value);
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        const secs = total % 60;
        return hours
            ? hours + ':' + String(minutes).padStart(2, '0') + ':' + String(secs).padStart(2, '0')
            : minutes + ':' + String(secs).padStart(2, '0');
    }

    function makeId() {
        if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
        return 'dl-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    }
})();
