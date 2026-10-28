'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const read = relativePath => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
const exists = relativePath => fs.existsSync(path.join(repoRoot, relativePath));

function idsFromHtml(html) {
    return [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
}

function duplicateValues(values) {
    return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
}

function localAssetReferences(relativePath, html) {
    const tagPattern = /<(?:script|link|img|audio|video)\b[^>]*(?:src|href)=["']([^"']+)["'][^>]*>/gi;
    return [...html.matchAll(tagPattern)]
        .map(match => match[1].split(/[?#]/, 1)[0])
        .filter(value => value && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value))
        .map(value => path.resolve(repoRoot, path.dirname(relativePath), value));
}

test('Manifest V3 contract points to every shipped runtime', () => {
    const manifest = JSON.parse(read('extension/manifest.json'));
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.version, '1.15.0');
    assert.equal(manifest.background.service_worker, 'js/background.js');
    assert.deepEqual(manifest.permissions.sort(), ['alarms', 'downloads', 'nativeMessaging', 'storage', 'tabs']);
    assert.equal(manifest.host_permissions.includes('<all_urls>'), false);
    assert.deepEqual(manifest.content_scripts[0].js.slice(0, 3), [
        'js/i18n/translations.js',
        'js/developer-logger.js',
        'js/utils.js'
    ]);
    const contentScripts = manifest.content_scripts[0].js;
    assert.ok(contentScripts.indexOf('js/shorts-transition.js') > contentScripts.indexOf('js/state.js'));
    assert.ok(contentScripts.indexOf('js/shorts-transition.js') < contentScripts.indexOf('js/ad-blocker.js'));
    assert.ok(contentScripts.indexOf('js/channel-filter.js') > contentScripts.indexOf('js/ad-blocker.js'));
    assert.ok(contentScripts.indexOf('js/channel-filter.js') < contentScripts.indexOf('js/channel-blocker.js'));

    [
        'extension/js/background.js',
        'extension/js/developer-logger.js',
        'extension/js/developer-log-store.js',
        'extension/js/developer-page.js',
        'extension/js/download-policy.js',
        'extension/js/download-page.js',
        'extension/js/i18n/translations.js',
        'extension/js/shorts-transition.js',
        'extension/views/download.html',
        'extension/views/developer.html',
        'extension/css/download.css',
        'extension/css/developer.css',
        'native-host/native-host.js',
        'native-host/download-policy.js'
    ].forEach(file => assert.equal(exists(file), true, file));

    Object.values(manifest.icons).forEach(file => {
        assert.equal(exists('extension/' + file), true, file);
    });
    manifest.content_scripts.flatMap(entry => entry.css || []).forEach(file => {
        assert.equal(exists('extension/' + file), true, file);
    });
    (manifest.web_accessible_resources || []).flatMap(entry => entry.resources).forEach(file => {
        assert.equal(exists('extension/' + file), true, file);
    });

    manifest.content_scripts.flatMap(entry => entry.js).forEach(file => {
        assert.equal(exists('extension/' + file), true, file);
    });
});

test('extension HTML documents have unique IDs and valid local asset references', () => {
    const htmlFiles = [
        'extension/views/download.html',
        'extension/views/developer.html',
        'extension/views/popup.html',
        'extension/views/setup.html',
        'index.html'
    ];
    htmlFiles.forEach(file => {
        const html = read(file);
        assert.deepEqual(duplicateValues(idsFromHtml(html)), [], file);
        localAssetReferences(file, html).forEach(assetPath => {
            assert.equal(fs.existsSync(assetPath), true, `${file} -> ${assetPath}`);
        });

        const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(match => match[1]);
        if (file.startsWith('extension/views/')) {
            assert.equal(scripts[0], '../js/i18n/translations.js', `${file} translation bootstrap`);
        }
    });

    const download = read('extension/views/download.html');
    const mainStart = download.indexOf('<main');
    const mainEnd = download.indexOf('</main>');
    const jobsIndex = download.indexOf('id="jobs-section"');
    assert.ok(mainStart >= 0 && mainEnd > mainStart && jobsIndex > mainEnd);
    assert.equal((download.match(/id="jobs-section"/g) || []).length, 1);
    assert.match(download, /\.\.\/js\/download-policy\.js/);
    assert.match(download, /\.\.\/js\/download-page\.js/);
});

test('landing demo remains a local-only deterministic preview', () => {
    const html = read('index.html');
    const script = read('landing-demo.js');
    assert.match(html, /href="\.\/landing-demo\.css\?v=/);
    assert.match(html, /src="\.\/landing-demo\.js\?v=/);
    [
        'data-landing-download-demo',
        'landing-download-form',
        'landing-demo-url',
        'landing-demo-results',
        'landing-demo-advanced-toggle',
        'landing-demo-job-status',
        'landing-demo-retry',
        'landing-demo-cancel'
    ].forEach(marker => assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), marker));
    assert.doesNotMatch(script, /\bfetch\s*\(/);
    assert.doesNotMatch(script, /chrome\./);
    assert.doesNotMatch(script, /navigator\.clipboard/);
    assert.doesNotMatch(script, /URL\.createObjectURL/);
    assert.match(script, /data-demo-format/);
    assert.match(script, /setInterval/);
});

test('landing Developer Console preview remains local-only and scoped', () => {
    const html = read('index.html');
    const script = read('landing-developer-demo.js');
    const css = read('landing-developer.css');

    assert.match(html, /href="\.\/landing-developer\.css\?v=/);
    assert.match(html, /src="\.\/landing-developer-demo\.js\?v=/);
    assert.match(html, /href="#developer-demo"/);
    assert.match(html, /id="setup-demo"/);
    [
        'data-landing-developer-demo',
        'landing-developer-mode-toggle',
        'landing-developer-status',
        'landing-developer-search',
        'landing-developer-scope-filter',
        'landing-developer-module-filter',
        'landing-developer-level-filter',
        'landing-developer-copy',
        'landing-developer-clear',
        'landing-developer-log-list',
        'landing-developer-log-empty'
    ].forEach(marker => assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), marker));

    assert.doesNotMatch(script, /\bfetch\s*\(/);
    assert.doesNotMatch(script, /\bchrome\s*\./);
    assert.doesNotMatch(script, /navigator\.clipboard/);
    assert.doesNotMatch(script, /XMLHttpRequest|WebSocket|sendBeacon|URL\.createObjectURL/);
    assert.match(script, /Developer mode on/);
    assert.match(script, /filter/);
    assert.match(css, /\.landing-developer-preview/);
    assert.match(css, /@media\s*\(max-width:\s*980px\)/);
    assert.match(css, /@media\s*\(max-width:\s*760px\)/);
    assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    assert.doesNotMatch(css, /(^|\n)\s*body\s*\{/);
});

test('download message protocol preserves page/job isolation markers', () => {
    const background = read('extension/js/background.js');
    const page = read('extension/js/download-page.js');
    const host = read('native-host/native-host.js');

    assert.match(background, /download_page_formats/);
    assert.match(background, /download_page_log/);
    assert.match(background, /developer_log/);
    assert.match(background, /developer-console/);
    assert.match(background, /download_page_progress/);
    assert.match(background, /download_page_result/);
    assert.match(background, /requestId/);
    assert.match(background, /jobId/);
    assert.match(page, /runtime\.connect\(\{ name: 'download-page' \}\)/);
    assert.match(page, /state\.jobs\.has\(message\.jobId\)/);
    assert.match(page, /developer-mode-toggle/);
    assert.match(page, /developer-section/);
    assert.match(page, /Array\.from\(state\.jobs\.values\(\)\)\.reverse/);
    assert.match(host, /request\.mode === 'page'/);
    assert.match(host, /action: 'developer_log'/);
    assert.match(host, /--no-playlist/);
    assert.match(host, /--verbose/);
    assert.match(host, /stderrTail/);
    assert.match(host, /spawn\(YTDLP_BIN, args/);
    assert.doesNotMatch(host, /spawn\(YTDLP_BIN,\s*[^,]+,\s*\{[^}]*shell\s*:\s*true/s);
});

test('popup, YouTube notifications, and download activity expose download controls', () => {
    const popupHtml = read('extension/views/popup.html');
    const popup = read('extension/js/popup.js');
    const notifications = read('extension/js/notifications.js');
    const downloader = read('extension/js/downloader.js');
    const downloadHtml = read('extension/views/download.html');
    const downloadCss = read('extension/css/download.css');
    const developerHtml = read('extension/views/developer.html');
    const developerPage = read('extension/js/developer-page.js');
    const developerCss = read('extension/css/developer.css');

    assert.match(popupHtml, /id="nav-download"/);
    assert.match(popupHtml, /id="toggle-developer-mode"/);
    assert.match(popup, /function openStandaloneDownloader\(\)/);
    assert.match(popup, /developerMode/);
    assert.match(popup, /DownloadPolicy\.parse\(activeUrl\)\.ok/);
    assert.match(popup, /chrome\.tabs\.create\(\{ url: target \}\)/);

    assert.match(downloadHtml, /id="jobs-indicator"/);
    assert.match(downloadHtml, /id="jobs-live-status"[^>]*aria-live="polite"/);
    assert.match(downloadCss, /\.jobs-notification\s*\{[^}]*position:\s*fixed/s);
    assert.match(downloadCss, /@media\s*\(max-width:\s*760px\)/);
    assert.match(downloadCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    assert.match(popupHtml, /id="btn-developer-console"/);
    assert.match(developerHtml, /id="developer-log-list"/);
    assert.match(developerHtml, /class="[^"]*\bpage-brand\b[^"]*"/);
    assert.match(developerHtml, /class="[^"]*\bdeveloper-layout\b[^"]*"/);
    assert.match(developerHtml, /class="[^"]*\bdeveloper-mode-card\b[^"]*"/);
    assert.match(developerHtml, /class="[^"]*\bsession-card\b[^"]*"/);
    assert.match(developerPage, /runtime\.connect\(\{ name: 'developer-console' \}\)/);
    assert.match(developerPage, /navigator\.clipboard\.writeText/);
    assert.match(developerCss, /@import url\('https:\/\/fonts\.googleapis\.com\/css2\?family=Outfit/);
    assert.match(developerCss, /--bg:\s*#0f0f0f/);
    assert.match(developerCss, /--red:\s*#ff0000/);
    assert.match(developerCss, /body::after/);
    assert.match(developerCss, /\.developer-layout\s*\{[^}]*grid-template-columns/s);
    assert.match(developerCss, /\.log-entry/);
    assert.match(developerCss, /@media\s*\(max-width:\s*980px\)/);
    assert.match(developerCss, /@media\s*\(max-width:\s*760px\)/);
    assert.match(developerCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test('local channel filtering is wired through the manifest, popup, observer, and notifications', () => {
    const manifest = read('extension/manifest.json');
    const filter = read('extension/js/channel-filter.js');
    const blocker = read('extension/js/channel-blocker.js');
    const content = read('extension/js/content.js');
    const popup = read('extension/views/popup.html');
    const notifications = read('extension/js/notifications.js');

    assert.match(manifest, /"js\/channel-filter\.js"/);
    assert.match(filter, /CHANNEL_FILTER_RENDERER_SELECTOR/);
    assert.match(filter, /normalizeChannelHandle/);
    assert.match(filter, /chrome\.storage\.onChanged/);
    assert.match(filter, /my-channel-filtered/);
    assert.match(filter, /navigateToNextShort/);
    assert.match(blocker, /addBlockedChannelLocally/);
    assert.match(blocker, /tryYouTubeRecommendationSync/);
    assert.match(blocker, /function isYouTubeSignedIn\(\)/);
    assert.match(blocker, /if \(!isYouTubeSignedIn\(\)\) return 'unavailable'/);
    assert.match(blocker, /isBlockContextCurrent/);
    assert.match(content, /data-owner-channel-id/);
    assert.match(content, /my-channel-filtered/);
    assert.match(popup, /data-i18n="channelFilterSetting"/);
    assert.match(popup, /data-i18n="blocklistLocalNote"/);
    assert.match(notifications, /setState(?:\s*:\s*|\()\s*\(?nextState, nextMessage/);
});

test('core content orchestration preserves resilient Shorts and Premium safety contracts', () => {
    const content = read('extension/js/content.js');
    const downloader = read('extension/js/downloader.js');
    const channelBlocker = read('extension/js/channel-blocker.js');
    const adBlocker = read('extension/js/ad-blocker.js');
    const shortsTransition = read('extension/js/shorts-transition.js');
    const premiumDetector = read('extension/js/premium-detector.js');
    const state = read('extension/js/state.js');
    const setup = read('extension/js/setup.js');

    assert.match(content, /new MutationObserver/);
    assert.match(content, /attributeFilter/);
    assert.match(content, /yt-navigate-finish/);
    assert.match(content, /typeof initVideoDownloadButton === 'function'\) initVideoDownloadButton\(\)/);
    assert.match(downloader, /VIDEO_PLAYER_POLL_INTERVAL = 100/);
    assert.match(downloader, /new MutationObserver/);
    assert.match(downloader, /window\.addEventListener\('yt-navigate-finish',[\s\S]*initVideoDownloadButton\(\)/);
    assert.match(content, /reel-action-bar-view-model/);

    assert.match(channelBlocker, /SHORTS_ACTION_RETRY_DELAYS/);
    assert.match(channelBlocker, /semantic-controls/);
    assert.match(channelBlocker, /my-block-button/);
    assert.match(channelBlocker, /my-dl-btn-shorts/);
    assert.match(channelBlocker, /createShortsFallbackHost/);
    assert.match(channelBlocker, /positionReady/);

    assert.match(adBlocker, /function applyAdBlocker\(\)/);
    assert.match(adBlocker, /if \(!AD_BLOCKER_ENABLED \|\| !EXTENSION_ENABLED\)/);
    assert.match(adBlocker, /_attachAdClassObserver/);
    assert.match(adBlocker, /_isShortsPage/);
    assert.match(adBlocker, /my-shorts-excluded/);
    assert.match(adBlocker, /function _attachShortsAdObserver\(/);
    assert.match(adBlocker, /MutationObserver/);
    assert.match(adBlocker, /currentTime\s*=\s*video\.duration/);
    assert.match(adBlocker, /data-my-short-excluded/);
    assert.match(channelBlocker, /checkForAdAndSkip\(renderer\)/);
    assert.match(shortsTransition, /SHORTS_TRANSITION_RETRY_DELAYS/);
    assert.match(shortsTransition, /function scheduleShortsInvisibleTransition\(/);
    assert.match(shortsTransition, /function cancelShortsInvisibleTransition\(/);
    assert.match(shortsTransition, /function resetShortsInvisibleTransitions\(/);
    assert.match(shortsTransition, /function isShortsTransitionCurrent\(/);
    assert.match(shortsTransition, /actionAttempted/);

    assert.match(premiumDetector, /YT_PREMIUM_STATUS/);
    assert.match(premiumDetector, /data\.nonce !== currentNonce/);
    assert.match(premiumDetector, /yt-navigate-finish/);
    assert.match(state, /AD_BLOCKER_ENABLED = false/);
    assert.match(state, /IS_PREMIUM === false/);
    assert.match(setup, /ffmpegReady/);
    assert.match(setup, /check_native_host_status/);
});

test('normal video download button keeps a visible and accessible tooltip contract', () => {
    const downloader = read('extension/js/downloader.js');
    const style = read('extension/css/style.css');

    assert.match(downloader, /data-tooltip-text/);
    assert.match(downloader, /bindVideoButtonTooltip\(btn\)/);
    assert.match(downloader, /addEventListener\('mouseenter'/);
    assert.match(downloader, /addEventListener\('focus'/);
    assert.match(downloader, /aria-describedby/);
    assert.match(style, /\.my-video-dl-tooltip\s*\{[^}]*position:\s*fixed/s);
    assert.match(style, /\.my-video-dl-tooltip\.is-visible/);
    assert.match(style, /\.my-video-dl-tooltip\[hidden\]/);
});

test('generated native runtimes and temporary artifacts stay ignored', () => {
    const gitignore = read('.gitignore');
    [
        'native-host/yt-dlp.exe',
        'native-host/ffmpeg/',
        'native-host/ffmpeg.download/',
        'native-host/*.previous',
        'native-host/com.paracci.youtubedownloader.json'
    ].forEach(entry => assert.match(gitignore, new RegExp(entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))));
    assert.equal(exists('extension/views/download-folder-test.html'), false);
    assert.equal(exists('extension/views/youtube-notification-test.html'), false);
});

test('README documents the standalone downloader security boundary', () => {
    const readme = read('README.md');
    [
        'Standalone Downloader',
        'yt-dlp',
        'ffmpeg',
        'watch',
        'shorts',
        'youtu.be',
        'playlist',
        'native host',
        'SHA-256',
        'telemetry',
        'npm run test:all',
        'test harness'
    ].forEach(term => assert.match(readme, new RegExp(term, 'i'), term));
});
