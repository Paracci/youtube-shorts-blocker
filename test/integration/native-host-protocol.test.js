'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const hostPath = path.join(repoRoot, 'native-host', 'native-host.js');
const { encodeNativeMessage } = require(path.join(repoRoot, 'native-host', 'native-host.js'));

function wait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function frameReader(stream) {
    let buffer = Buffer.alloc(0);
    const queue = [];
    const waiters = [];

    const drain = () => {
        while (buffer.length >= 4) {
            const length = buffer.readUInt32LE(0);
            if (buffer.length < length + 4) return;
            const body = buffer.subarray(4, length + 4).toString('utf8');
            buffer = buffer.subarray(length + 4);
            let message;
            try { message = JSON.parse(body); } catch (_) { continue; }
            const waiter = waiters.shift();
            if (waiter) waiter.resolve(message);
            else queue.push(message);
        }
    };

    stream.on('data', chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        drain();
    });

    return {
        next(timeout = 3000) {
        if (queue.length > 0) return Promise.resolve(queue.shift());
            return new Promise((resolve, reject) => {
                const waiter = {
                    resolve: value => { clearTimeout(timer); resolve(value); },
                    reject
                };
                const timer = setTimeout(() => {
                    const index = waiters.indexOf(waiter);
                    if (index >= 0) waiters.splice(index, 1);
                    reject(new Error('Timed out waiting for native host message'));
                }, timeout);
                waiters.push(waiter);
            });
        }
    };
}

test('native host speaks framed Native Messaging protocol without network access', async t => {
    const child = spawn(process.execPath, [hostPath], {
        cwd: path.dirname(hostPath),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
    });
    t.after(() => {
        if (!child.killed) child.kill();
    });

    const reader = frameReader(child.stdout);
    const ready = await reader.next();
    assert.equal(ready.status, 'ready');
    assert.equal(typeof ready.ytdlpReady, 'boolean');
    assert.equal(typeof ready.ffmpegReady, 'boolean');

    const ping = encodeNativeMessage({ action: 'ping' });
    child.stdin.write(ping.subarray(0, 2));
    await wait(10);
    child.stdin.write(ping.subarray(2));
    assert.equal((await reader.next()).status, 'pong');

    child.stdin.write(Buffer.concat([
        encodeNativeMessage({ action: 'ping' }),
        encodeNativeMessage({ action: 'ping' })
    ]));
    assert.equal((await reader.next()).status, 'pong');
    assert.equal((await reader.next()).status, 'pong');
});

test('native host rejects invalid resolve requests before yt-dlp access', async t => {
    const child = spawn(process.execPath, [hostPath], {
        cwd: path.dirname(hostPath),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
    });
    t.after(() => {
        if (!child.killed) child.kill();
    });

    const reader = frameReader(child.stdout);
    await reader.next();
    child.stdin.write(encodeNativeMessage({
        action: 'resolve_formats',
        requestId: 'short',
        url: 'https://www.youtube.com/watch?v=abc12345678'
    }));
    const response = await reader.next();
    assert.equal(response.action, 'download_page_formats');
    assert.equal(response.status, 'error');
    assert.equal(response.errorCode, 'invalid_url');
    assert.equal(response.requestId, 'short');
});

test('native host rejects unsafe folder paths before opening Explorer', async t => {
    const child = spawn(process.execPath, [hostPath], {
        cwd: path.dirname(hostPath),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
    });
    t.after(() => {
        if (!child.killed) child.kill();
    });

    const reader = frameReader(child.stdout);
    await reader.next();
    child.stdin.write(encodeNativeMessage({
        action: 'open_download_folder',
        requestId: 'folder-test',
        path: 'relative\\folder'
    }));
    const response = await reader.next();
    assert.equal(response.action, 'open_download_folder_result');
    assert.equal(response.status, 'error');
    assert.match(response.message, /absolute|path/i);
    assert.equal(response.requestId, 'folder-test');
});
