'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const host = require(path.join(repoRoot, 'native-host', 'native-host.js'));

const metadata = {
    formats: [
        { id: '137', type: 'video', hasVideo: true, hasAudio: false },
        { id: '140', type: 'audio', hasVideo: false, hasAudio: true },
        { id: '18', type: 'muxed', hasVideo: true, hasAudio: true }
    ]
};

test('yt-dlp formats normalize to bounded, typed records', () => {
    assert.deepEqual(host.normalizeYtdlpFormat({
        format_id: '137',
        ext: 'mp4?x',
        width: 1920,
        height: 1080,
        fps: 60,
        vcodec: 'avc1.640028',
        acodec: 'none',
        filesize: 123456
    }), {
        id: '137',
        type: 'video',
        ext: 'mp4x',
        width: 1920,
        height: 1080,
        fps: 60,
        vcodec: 'avc1.640028',
        acodec: '',
        filesize: 123456,
        hasVideo: true,
        hasAudio: false
    });

    assert.equal(host.normalizeYtdlpFormat({ format_id: 'bad', vcodec: 'none', acodec: 'none' }), null);
    assert.equal(host.normalizeYtdlpFormat({ format_id: '140', vcodec: 'none', acodec: 'mp4a.40.2' }).type, 'audio');
    assert.equal(host.normalizeYtdlpFormat({ format_id: '18', vcodec: 'avc1', acodec: 'mp4a' }).type, 'muxed');
});

test('native host sanitizes filenames and redacts signed stream URLs', () => {
    const unsafe = '../folder/..\\video:secret?.mp4';
    const safe = host.sanitizeFilePart(unsafe);
    assert.equal(safe.includes('..'), false);
    assert.equal(/[\\/:*?"<>|]/.test(safe), false);
    assert.ok(safe.length <= 150);
    assert.equal(host.sanitizeFilePart('', 'video'), 'video');
    assert.equal(host.sanitizeFilePart('////', 'video').includes('\\'), false);

    const redacted = host.redactStreamUrls(
        'download https://r1---sn.googlevideo.com/videoplayback?expire=123&sig=secret now'
    );
    assert.equal(redacted.includes('googlevideo.com'), false);
    assert.equal(redacted.includes('[stream URL hidden]'), true);
});

test('progress and JSON parsing are bounded and deterministic', () => {
    assert.deepEqual(host.parseProgressLine('  [download] 42.5% of 10MiB at 1MiB/s  '), {
        percent: 42.5,
        speed: '1MiB/s',
        eta: null,
        message: '[download] 42.5% of 10MiB at 1MiB/s'
    });
    assert.deepEqual(host.parseProgressLine('[download] 72% of 20MiB at 2.5MiB/s ETA 00:08'), {
        percent: 72,
        speed: '2.5MiB/s',
        eta: '00:08',
        message: '[download] 72% of 20MiB at 2.5MiB/s ETA 00:08'
    });
    assert.equal(host.parseProgressLine('[download] 999%').percent, 100);
    assert.equal(host.parseProgressLine('[download] waiting').percent, null);
    assert.equal(host.isDownloadId('download-abc12345'), true);
    assert.equal(host.isDownloadId('bad id'), false);
    assert.deepEqual(host.parseJsonOutput('warning\n{"title":"Video","formats":[]}\n'), {
        title: 'Video',
        formats: []
    });
    assert.throws(() => host.parseJsonOutput('no json'), /no media metadata/i);
});

test('profile selectors enforce output and audio/video compatibility', async () => {
    assert.deepEqual(await host.resolvePageSelector({ profileId: 'best_mp4', outputFormat: 'mp4' }, metadata), {
        selector: 'bestvideo+bestaudio/best',
        audioOnly: false
    });
    assert.deepEqual(await host.resolvePageSelector({ profileId: 'height_1080', outputFormat: 'mp4' }, metadata), {
        selector: 'bestvideo[height<=1080]+bestaudio/best[height<=1080]',
        audioOnly: false
    });
    assert.deepEqual(await host.resolvePageSelector({ profileId: 'audio_mp3', outputFormat: 'mp3' }, metadata), {
        selector: 'bestaudio',
        audioOnly: true,
        outputFormat: 'mp3'
    });
    assert.deepEqual(await host.resolvePageSelector({ profileId: 'audio_m4a', outputFormat: 'm4a' }, metadata), {
        selector: 'bestaudio',
        audioOnly: true,
        outputFormat: 'm4a'
    });
    for (const height of [2160, 1440, 1080, 720]) {
        const selection = await host.resolvePageSelector({ profileId: 'height_' + height, outputFormat: 'mp4' }, metadata);
        assert.equal(selection.audioOnly, false);
        assert.match(selection.selector, new RegExp('height<=' + height));
    }
    assert.deepEqual(await host.resolvePageSelector({ formatId: '137', outputFormat: 'mp4' }, metadata), {
        selector: '137+bestaudio',
        audioOnly: false
    });
    assert.deepEqual(await host.resolvePageSelector({ formatId: '18', outputFormat: 'webm' }, metadata), {
        selector: '18',
        audioOnly: false
    });
    await assert.rejects(host.resolvePageSelector({ profileId: 'audio_mp3', outputFormat: 'mp4' }, metadata), /match/i);
    await assert.rejects(host.resolvePageSelector({ formatId: '140', outputFormat: 'mp4' }, metadata), /audio output/i);
    await assert.rejects(host.resolvePageSelector({ formatId: '137', outputFormat: 'mp3' }, metadata), /audio format/i);
    await assert.rejects(host.resolvePageSelector({ formatId: '999', outputFormat: 'mp4' }, metadata), /no longer available/i);
    await assert.rejects(host.resolvePageSelector({ profileId: 'best_mp4', outputFormat: 'avi' }, metadata), /unsupported/i);
});

test('native command construction covers every approved video and audio output', () => {
    const common = {
        saveDir: 'C:\\Users\\Test\\Downloads',
        title: 'Video',
        label: 'format',
        ffmpegPath: 'C:\\Tools\\ffmpeg\\ffmpeg.exe',
        url: 'https://www.youtube.com/watch?v=abc12345678'
    };

    for (const outputFormat of ['mp4', 'webm', 'mkv']) {
        const args = host.buildPageDownloadArgs({
            ...common,
            outputFormat,
            selector: '137+bestaudio',
            audioOnly: false
        });
        const mergeIndex = args.indexOf('--merge-output-format');
        assert.ok(mergeIndex >= 0);
        assert.equal(args[mergeIndex + 1], outputFormat);
    }

    for (const outputFormat of ['mp3', 'm4a', 'opus']) {
        const args = host.buildPageDownloadArgs({
            ...common,
            outputFormat,
            selector: '140',
            audioOnly: true
        });
        const audioIndex = args.indexOf('--audio-format');
        assert.ok(audioIndex >= 0);
        assert.equal(args[audioIndex + 1], outputFormat);
        assert.equal(args.includes('--merge-output-format'), false);
    }
});

test('YouTube downloads pin the supported JS runtime and embedded player client', () => {
    assert.deepEqual(host.getYtdlpRuntimeArgs(), ['--js-runtimes', 'node:' + process.execPath]);
    assert.deepEqual(host.getYtdlpYouTubeArgs(), [
        '--js-runtimes', 'node:' + process.execPath,
        '--extractor-args',
        'youtube:player_client=web_embedded'
    ]);

    const args = host.buildPageDownloadArgs({
        saveDir: 'C:\\Users\\Test\\Downloads',
        title: 'Video',
        label: 'best_mp4',
        outputFormat: 'mp4',
        ffmpegPath: 'C:\\Tools\\ffmpeg\\ffmpeg.exe',
        selector: 'bestvideo+bestaudio/best',
        audioOnly: false,
        url: 'https://www.youtube.com/watch?v=abc12345678'
    });
    assert.equal(args.includes('--js-runtimes'), true);
    assert.equal(args.includes('node:' + process.execPath), true);
    assert.equal(args.includes('--extractor-args'), true);
    assert.equal(args.includes('youtube:player_client=web_embedded'), true);
});

test('page download command is an argument array with safe output rules', () => {
    const videoArgs = host.buildPageDownloadArgs({
        saveDir: 'C:\\Users\\Test\\Downloads',
        title: 'A video',
        label: 'height_1080',
        outputFormat: 'mp4',
        ffmpegPath: 'C:\\Tools\\ffmpeg\\ffmpeg.exe',
        selector: 'bestvideo[height<=1080]+bestaudio',
        audioOnly: false,
        url: 'https://www.youtube.com/watch?v=abc12345678'
    });
    assert.equal(Array.isArray(videoArgs), true);
    assert.equal(videoArgs.includes('--no-playlist'), true);
    assert.equal(videoArgs.includes('--merge-output-format'), true);
    assert.equal(videoArgs.at(-1), 'https://www.youtube.com/watch?v=abc12345678');
    assert.equal(videoArgs.some(value => String(value).includes(';')), false);

    const audioArgs = host.buildPageDownloadArgs({
        saveDir: 'C:\\Users\\Test\\Downloads',
        title: 'Audio',
        label: 'audio_mp3',
        outputFormat: 'mp3',
        ffmpegPath: 'C:\\Tools\\ffmpeg\\ffmpeg.exe',
        selector: 'bestaudio',
        audioOnly: true,
        url: 'https://www.youtube.com/watch?v=abc12345678'
    });
    assert.deepEqual(audioArgs.slice(-6, -1), ['-x', '--audio-format', 'mp3', '--audio-quality', '0']);
    assert.equal(audioArgs.includes('--merge-output-format'), false);

    const developerArgs = host.buildPageDownloadArgs({
        saveDir: 'C:\\Users\\Test\\Downloads',
        title: 'Debug video',
        label: 'best_mp4',
        outputFormat: 'mp4',
        ffmpegPath: 'C:\\Tools\\ffmpeg\\ffmpeg.exe',
        selector: 'bestvideo+bestaudio/best',
        audioOnly: false,
        url: 'https://www.youtube.com/watch?v=abc12345678',
        developerMode: true
    });
    assert.equal(developerArgs[0], '--verbose');
});

test('folder and direct-stream policies fail closed', () => {
    assert.equal(host.resolveDownloadFolderPath('', 'C:\\Users\\Test'), path.resolve('C:\\Users\\Test\\Downloads'));
    assert.equal(host.resolveDownloadFolderPath('C:\\Videos', 'C:\\Users\\Test'), path.resolve('C:\\Videos'));
    assert.throws(() => host.resolveDownloadFolderPath('relative\\folder', 'C:\\Users\\Test'), /absolute/i);

    assert.equal(host.isAllowedDirectUrl('https://r1---sn.googlevideo.com/videoplayback'), true);
    assert.equal(host.isAllowedDirectUrl('https://googlevideo.com/videoplayback'), true);
    assert.equal(host.isAllowedDirectUrl('http://r1.googlevideo.com/videoplayback'), false);
    assert.equal(host.isAllowedDirectUrl('https://youtube.com/watch?v=abc12345678'), false);
    assert.equal(host.isAllowedDirectUrl('https://googlevideo.com.evil.example/videoplayback'), false);
});

test('verified ffmpeg artifact metadata is pinned', () => {
    assert.match(host.FFMPEG_ARCHIVE_URL, /^https:\/\/github\.com\//);
    assert.match(host.FFMPEG_ARCHIVE_SHA256, /^[a-f0-9]{64}$/);
    assert.match(host.FFMPEG_ARCHIVE_NAME, /\.zip$/);
    assert.match(host.FFMPEG_RELEASE_TAG, /^autobuild-/);
});
