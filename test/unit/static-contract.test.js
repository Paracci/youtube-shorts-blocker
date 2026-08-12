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
    assert.equal(manifest.version, '1.13.0');
    assert.equal(manifest.background.service_worker, 'js/background.js');
    assert.deepEqual(manifest.permissions.sort(), ['downloads', 'nativeMessaging', 'storage', 'tabs']);
    assert.equal(manifest.host_permissions.includes('<all_urls>'), false);
    assert.deepEqual(manifest.content_scripts[0].js.slice(0, 2), [
        'js/i18n/translations.js',
        'js/utils.js'
    ]);

    [
        'extension/js/background.js',
        'extension/js/download-policy.js',
        'extension/js/download-page.js',
        'extension/js/i18n/translations.js',
        'extension/views/download.html',
        'extension/css/download.css',
        'native-host/native-host.js',
        'native-host/download-policy.js'
    ].forEach(file => assert.equal(exists(file), true, file));

    Object.values(manifest.icons).forEach(file => {
        assert.equal(exists('extension/' + file), true, file);
    });
    manifest.content_scripts.flatMap(entry => entry.css).forEach(file => {
        assert.equal(exists('extension/' + file), true, file);
    });
    manifest.web_accessible_resources.flatMap(entry => entry.resources).forEach(file => {
        assert.equal(exists('extension/' + file), true, file);
    });

    manifest.content_scripts.flatMap(entry => entry.js).forEach(file => {
        assert.equal(exists('extension/' + file), true, file);
    });
});

test('extension HTML documents have unique IDs and valid local asset references', () => {
    const htmlFiles = [
        'extension/views/download.html',
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
    assert.equal((download.match(/id="jobs-open-folder"/g) || []).length, 1);
    assert.match(download, /\.\.\/js\/download-policy\.js/);
    assert.match(download, /\.\.\/js\/download-page\.js/);
    assert.match(download, /data-i18n="downloadOpenFolder"/);
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

test('download message protocol preserves page/job isolation markers', () => {
    const background = read('extension/js/background.js');
    const page = read('extension/js/download-page.js');
    const host = read('native-host/native-host.js');

    assert.match(background, /download_page_formats/);
    assert.match(background, /download_page_progress/);
    assert.match(background, /download_page_result/);
    assert.match(background, /requestId/);
    assert.match(background, /jobId/);
    assert.match(background, /open_download_folder_result/);
    assert.match(page, /runtime\.connect\(\{ name: 'download-page' \}\)/);
    assert.match(page, /state\.jobs\.has\(message\.jobId\)/);
    assert.match(page, /Array\.from\(state\.jobs\.values\(\)\)\.reverse/);
    assert.match(host, /request\.mode === 'page'/);
    assert.match(host, /--no-playlist/);
    assert.match(host, /spawn\(YTDLP_BIN, args/);
    assert.doesNotMatch(host, /spawn\(YTDLP_BIN,\s*[^,]+,\s*\{[^}]*shell\s*:\s*true/s);
});

test('popup, YouTube notifications, and download activity expose folder actions', () => {
    const popupHtml = read('extension/views/popup.html');
    const popup = read('extension/js/popup.js');
    const notifications = read('extension/js/notifications.js');
    const downloader = read('extension/js/downloader.js');
    const downloadHtml = read('extension/views/download.html');
    const downloadCss = read('extension/css/download.css');

    assert.match(popupHtml, /id="nav-download"/);
    assert.match(popup, /function openStandaloneDownloader\(\)/);
    assert.match(popup, /DownloadPolicy\.parse\(activeUrl\)\.ok/);
    assert.match(popup, /chrome\.tabs\.create\(\{ url: target \}\)/);

    assert.match(notifications, /data-toast-action/);
    assert.match(notifications, /showAction:/);
    assert.match(downloader, /actionLabel: i18n\.t\('downloadOpenFolder'\)/);
    assert.match(downloader, /onAction: openDownloadFolderFromNotification/);
    assert.match(downloader, /toast\.showAction\?\.\(\)/);

    assert.match(downloadHtml, /id="jobs-open-folder"/);
    assert.match(downloadHtml, /id="jobs-indicator"/);
    assert.match(downloadHtml, /id="jobs-live-status"[^>]*aria-live="polite"/);
    assert.match(downloadCss, /\.jobs-notification\s*\{[^}]*position:\s*fixed/s);
    assert.match(downloadCss, /@media\s*\(max-width:\s*760px\)/);
    assert.match(downloadCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test('core content orchestration preserves resilient Shorts and Premium safety contracts', () => {
    const content = read('extension/js/content.js');
    const downloader = read('extension/js/downloader.js');
    const channelBlocker = read('extension/js/channel-blocker.js');
    const adBlocker = read('extension/js/ad-blocker.js');
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

    assert.match(adBlocker, /function applyAdBlocker\(\)/);
    assert.match(adBlocker, /if \(!AD_BLOCKER_ENABLED \|\| !EXTENSION_ENABLED\)/);
    assert.match(adBlocker, /_attachAdClassObserver/);
    assert.match(adBlocker, /_isShortsPage/);

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
