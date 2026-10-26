'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');
const test = require('node:test');

const hostDir = path.resolve(__dirname, '../../native-host');
const source = fs.readFileSync(path.join(hostDir, 'native-host.js'), 'utf8');
const host = require(path.join(hostDir, 'native-host.js'));

function cleanInstallHarness(t, { badHash = false, existingFfmpeg = false } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paracci-install-test-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const directory = path.join(root, 'Temiz kurulum T\u00fcrk\u00e7e');
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'yt-dlp.exe'), 'fixture');
    if (existingFfmpeg) {
        fs.mkdirSync(path.join(directory, 'ffmpeg'));
        fs.writeFileSync(path.join(directory, 'ffmpeg', 'ffmpeg.exe'), 'existing');
    }
    const archive = Buffer.from('verified archive fixture');
    const digest = crypto.createHash('sha256').update(archive).digest('hex');
    const messages = [];
    const requests = [];
    const children = [];
    let corrupt = badHash;
    const stdin = new EventEmitter();
    const stdout = new EventEmitter();
    stdout.write = frame => messages.push(JSON.parse(frame.subarray(4).toString('utf8')));
    const https = {
        get(url, _options, callback) {
            requests.push(url);
            const request = new EventEmitter();
            request.setTimeout = () => request;
            setImmediate(() => {
                const response = new EventEmitter();
                response.statusCode = 200;
                response.headers = {};
                response.resume = () => {};
                callback(response);
                const body = url === host.FFMPEG_RELEASE_API
                    ? Buffer.from(JSON.stringify({ assets: [{
                        name: host.FFMPEG_ARCHIVE_NAME,
                        digest: 'sha256:' + (corrupt ? '0'.repeat(64) : digest),
                        browser_download_url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/' + host.FFMPEG_ARCHIVE_NAME
                    }] }))
                    : archive;
                response.emit('data', body);
                response.emit('end');
            });
            return request;
        }
    };
    const spawn = (file, args) => {
        children.push({ file, args });
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        setImmediate(() => {
            if (file === 'powershell.exe') {
                const destination = args.at(-1).match(/-DestinationPath '([^']+)'/)[1];
                const bin = path.join(destination, 'archive', 'bin');
                fs.mkdirSync(bin, { recursive: true });
                for (const name of ['ffmpeg.exe', 'ffprobe.exe', 'avcodec.dll']) {
                    fs.writeFileSync(path.join(bin, name), 'fixture');
                }
            }
            child.emit('close', 0);
        });
        return child;
    };
    const context = vm.createContext({
        Buffer, URL, console, __dirname: directory, module: { exports: {} },
        process: { stdin, stdout, env: { USERPROFILE: directory, HOME: directory }, execPath: process.execPath },
        require(name) {
            if (name === 'https') return https;
            if (name === 'child_process') return { spawn };
            if (name === './download-policy') return require(path.join(hostDir, 'download-policy'));
            return require(name);
        }
    });
    vm.runInContext(source, context);
    vm.runInContext('main()', context);
    return {
        directory, messages, requests, children,
        fixHash() { corrupt = false; },
        send(message) { stdin.emit('data', host.encodeNativeMessage(message)); }
    };
}

async function resultFor(harness, downloadId) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
        const result = harness.messages.find(msg => msg.action === 'download_video_result' && msg.downloadId === downloadId);
        if (result) return result;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('No download result: ' + JSON.stringify(harness.messages));
}

const videoRequest = { action: 'download_video', videoId: 'abc12345678', title: 'Clean install', videoQuality: '1080p', qualityHeight: 1080 };

test('player video and MP3 downloads install the full ffmpeg directory and pass its location', async t => {
    const h = cleanInstallHarness(t);
    h.send({ ...videoRequest, downloadId: 'clean-video-001' });
    assert.equal((await resultFor(h, 'clean-video-001')).status, 'success');
    const first = h.children.find(child => child.file.endsWith('yt-dlp.exe'));
    assert.equal(first.args[first.args.indexOf('--ffmpeg-location') + 1], path.join(h.directory, 'ffmpeg'));
    assert.ok(first.args.includes('--merge-output-format'));
    assert.ok(fs.existsSync(path.join(h.directory, 'ffmpeg', 'avcodec.dll')));
    assert.ok(fs.existsSync(path.join(h.directory, 'ffmpeg', 'ffprobe.exe')));
    assert.equal(fs.existsSync(path.join(h.directory, 'ffmpeg.download')), false);
    const requestCount = h.requests.length;
    h.send({ ...videoRequest, isAudioOnly: true, downloadId: 'clean-audio-002' });
    assert.equal((await resultFor(h, 'clean-audio-002')).status, 'success');
    const audio = h.children.at(-1);
    assert.equal(audio.args[audio.args.indexOf('--ffmpeg-location') + 1], path.join(h.directory, 'ffmpeg'));
    assert.ok(audio.args.includes('--audio-format'));
    assert.equal(h.requests.length, requestCount);
});

test('hash mismatch blocks extraction and yt-dlp, reports a correlated error, and allows retry', async t => {
    const h = cleanInstallHarness(t, { badHash: true });
    h.send({ ...videoRequest, downloadId: 'failed-video-001' });
    const failed = await resultFor(h, 'failed-video-001');
    assert.equal(failed.status, 'error');
    assert.equal(failed.errorCode, 'ffmpeg_required');
    assert.match(failed.message, /SHA-256 verification failed/);
    assert.equal(h.children.length, 0);
    assert.equal(fs.existsSync(path.join(h.directory, 'ffmpeg')), false);
    h.fixHash();
    h.send({ ...videoRequest, downloadId: 'retry-video-002' });
    assert.equal((await resultFor(h, 'retry-video-002')).status, 'success');
});

test('existing ffmpeg is used without any network request on the player path', async t => {
    const h = cleanInstallHarness(t, { existingFfmpeg: true });
    h.send({ ...videoRequest, downloadId: 'existing-video-001' });
    assert.equal((await resultFor(h, 'existing-video-001')).status, 'success');
    assert.equal(h.requests.length, 0);
    assert.equal(h.children.length, 1);
});
