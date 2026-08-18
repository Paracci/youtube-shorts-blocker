'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const store = require(path.join(__dirname, '..', '..', 'extension', 'js', 'developer-log-store.js'));

test('developer log sanitization redacts secrets and keeps only approved context', () => {
    const entry = store.sanitizeEntry({
        level: 'error',
        scope: 'native-host',
        module: 'yt-dlp',
        event: 'process failed!',
        message: 'https://r1---sn.googlevideo.com/videoplayback?sig=secret Cookie: session=abc C:\\Users\\Test\\Downloads\\video.mp4',
        details: 'Authorization: Bearer abc123',
        context: { videoId: 'abc12345678', requestId: 'request-1', ignored: 'nope' }
    });

    assert.equal(entry.level, 'error');
    assert.equal(entry.event, 'process_failed_');
    assert.equal(entry.context.videoId, 'abc12345678');
    assert.equal('ignored' in entry.context, false);
    assert.equal(entry.message.includes('googlevideo.com'), false);
    assert.equal(entry.message.includes('session=abc'), false);
    assert.equal(entry.message.includes('C:\\Users'), false);
    assert.equal(entry.details.includes('Bearer abc123'), false);
});

test('developer ring buffer stays bounded', () => {
    let entries = [];
    for (let index = 0; index < store.MAX_ENTRIES + 25; index++) {
        entries = store.appendToBuffer(entries, { id: String(index), message: 'entry' });
    }
    assert.equal(entries.length, store.MAX_ENTRIES);
    assert.equal(entries[0].id, '25');
});

test('session store drops disabled entries, persists enabled entries, and clears them', async () => {
    const values = {};
    const session = {
        get(key, callback) { callback({ [key]: values[key] }); },
        set(data, callback) { Object.assign(values, data); callback?.(); },
        remove(key, callback) { delete values[key]; callback?.(); }
    };
    const fakeChrome = { storage: { session } };
    const diagnostics = store.create(fakeChrome);

    await diagnostics.append({ level: 'error', scope: 'background', event: 'ignored', message: 'off' });
    assert.equal(values.developerLogBuffer, undefined);

    diagnostics.setEnabled(true);
    await diagnostics.append({ level: 'info', scope: 'background', event: 'stored', message: 'on' });
    assert.equal(diagnostics.getEntries().length, 1);
    assert.equal(values.developerLogBuffer.length, 1);

    await diagnostics.clear();
    assert.deepEqual(diagnostics.getEntries(), []);
    assert.equal(values.developerLogBuffer, undefined);
});
