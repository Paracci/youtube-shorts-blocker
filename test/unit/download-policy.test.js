'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const nativePolicy = require(path.join(repoRoot, 'native-host', 'download-policy.js'));

function loadExtensionPolicy() {
    const source = fs.readFileSync(path.join(repoRoot, 'extension', 'js', 'download-policy.js'), 'utf8');
    const context = { URL, URLSearchParams, globalThis: {} };
    vm.runInNewContext(source, context, { filename: 'download-policy.js' });
    return context.globalThis.DownloadPolicy;
}

const extensionPolicy = loadExtensionPolicy();
const videoUrl = 'https://www.youtube.com/watch?v=abc12345678';

test('extension and native URL policies expose the same strict contract', () => {
    assert.equal(extensionPolicy.MAX_URL_LENGTH, nativePolicy.MAX_URL_LENGTH);
    assert.equal(extensionPolicy.VIDEO_ID_PATTERN.source, nativePolicy.VIDEO_ID_PATTERN.source);

    const corpus = [
        videoUrl,
        'https://youtube.com/shorts/abc12345678?feature=share',
        'https://www.youtube.com/embed/abc12345678',
        'https://youtu.be/abc12345678',
        'https://m.youtube.com/watch?v=abc12345678&t=20',
        'https://music.youtube.com/watch?v=abc12345678',
        'http://www.youtube.com/watch?v=abc12345678',
        'https://www.youtube.com/playlist?list=abc12345678',
        'https://www.youtube.com/watch?v=abc12345678&list=abc12345678',
        'https://www.youtube.com/channel/abc12345678',
        'https://example.com/watch?v=abc12345678',
        'https://user:pass@www.youtube.com/watch?v=abc12345678',
        'https://youtu.be/abc1234567',
        'https://www.youtube.com/watch?v=abc12345678/extra'
    ];

    corpus.forEach(value => {
        assert.equal(
            JSON.stringify(extensionPolicy.parse(value)),
            JSON.stringify(nativePolicy.parseYouTubeUrl(value)),
            value
        );
    });
});

test('accepted URL forms canonicalize to a single watch URL', () => {
    const cases = [
        ['https://www.youtube.com/watch?v=abc12345678', 'abc12345678'],
        ['https://www.youtube.com/shorts/abc12345678', 'abc12345678'],
        ['https://www.youtube.com/embed/abc12345678', 'abc12345678'],
        ['https://youtu.be/abc12345678', 'abc12345678']
    ];

    cases.forEach(([input, id]) => {
        const parsed = extensionPolicy.parse(input);
        assert.equal(parsed.ok, true);
        assert.equal(parsed.videoId, id);
        assert.equal(parsed.canonicalUrl, videoUrl);
    });
});

test('URL policy rejects unsafe, non-single-video, and malformed inputs with explicit reasons', () => {
    const cases = [
        [null, 'invalid_type'],
        ['', 'empty'],
        ['not a URL', 'invalid_url'],
        ['http://www.youtube.com/watch?v=abc12345678', 'https_required'],
        ['https://user:pass@www.youtube.com/watch?v=abc12345678', 'credentials_not_allowed'],
        ['https://vimeo.com/12345678901', 'youtube_only'],
        ['https://www.youtube.com/watch?v=abc12345678&list=PL123', 'playlist_not_allowed'],
        ['https://www.youtube.com/playlist?list=PL123', 'playlist_not_allowed'],
        ['https://www.youtube.com/channel/abc12345678', 'video_only'],
        ['https://www.youtube.com/results?search_query=abc12345678', 'video_only'],
        ['https://youtu.be/abc12345678/extra', 'video_only'],
        ['https://www.youtube.com/watch?v=short', 'invalid_video_id'],
        ['https://www.youtube.com/watch?v=abc1234567!', 'invalid_video_id']
    ];

    cases.forEach(([input, reason]) => {
        assert.equal(extensionPolicy.parse(input).reason, reason, String(input));
        assert.equal(nativePolicy.parseYouTubeUrl(input).reason, reason, String(input));
    });
});

test('URL length limit is enforced before parsing', () => {
    const oversized = 'https://www.youtube.com/watch?v=abc12345678&x=' + 'a'.repeat(2050);
    assert.equal(extensionPolicy.parse(oversized).reason, 'too_long');
    assert.equal(nativePolicy.parseYouTubeUrl(oversized).reason, 'too_long');
});
