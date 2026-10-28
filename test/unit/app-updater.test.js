'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const updater = require('../../native-host/app-updater');
const keys = crypto.generateKeyPairSync('ed25519');

function bundle(change = data => data) {
    const files = Object.entries({
        'extension/manifest.json': JSON.stringify({ version: '1.15.0', manifest_version: 3 }),
        'extension/js/example.js': 'new file',
        'native-host/download-policy.js': 'new policy',
        'native-host/native-host.js': 'new host'
    }).map(([name, value]) => ({ path: name, content: Buffer.from(value).toString('base64'),
        sha256: crypto.createHash('sha256').update(value).digest('hex') }));
    const data = change({ protocol: 1, repository: 'Paracci/youtube-shorts-blocker', version: '1.15.0', files });
    const payload = Buffer.from(JSON.stringify(data));
    return Buffer.from(JSON.stringify({ payload: payload.toString('base64'), signature: crypto.sign(null, payload, keys.privateKey).toString('base64') }));
}
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paracci-update-test-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, 'extension'));
    fs.mkdirSync(path.join(root, 'native-host/ffmpeg'), { recursive: true });
    fs.writeFileSync(path.join(root, 'extension/manifest.json'), JSON.stringify({ version: '1.14.1', manifest_version: 3 }));
    fs.writeFileSync(path.join(root, 'native-host/native-host.js'), 'old host');
    fs.writeFileSync(path.join(root, 'native-host/ffmpeg/ffmpeg.exe'), 'preserve ffmpeg');
    return root;
}
const valid = () => updater.verify(bundle(), keys.publicKey, '1.14.1');

test('updates require a valid publisher signature and reject tampering, wrong keys, downgrades and malformed inventories', () => {
    assert.equal(valid().version, '1.15.0');
    const envelope = JSON.parse(bundle());
    envelope.payload = Buffer.from('tampered').toString('base64');
    assert.throws(() => updater.verify(Buffer.from(JSON.stringify(envelope)), keys.publicKey, '1.14.1'), /signature/);
    assert.throws(() => updater.verify(bundle(), crypto.generateKeyPairSync('ed25519').publicKey, '1.14.1'), /signature/);
    assert.throws(() => updater.verify(bundle(), keys.publicKey, '1.15.0'), /Older/);
    for (const file of ['../outside', 'extension/../outside', 'native-host/app-updater.js', 'native-host/update-public-key.pem', 'native-host/ffmpeg/ffmpeg.exe', 'extension/C:/bad', 'extension//bad']) {
        assert.throws(() => updater.verify(bundle(d => { d.files[1].path = file; return d; }), keys.publicKey, '1.14.1'), /Invalid update file/);
    }
    assert.throws(() => updater.verify(bundle(d => { d.files.push(d.files[0]); return d; }), keys.publicKey, '1.14.1'), /Invalid update file/);
    assert.throws(() => updater.verify(bundle(d => { d.files[1].sha256 = '0'.repeat(64); return d; }), keys.publicKey, '1.14.1'), /checksum/);
    assert.throws(() => updater.verify(bundle(d => { d.version = '1.16.0'; return d; }), keys.publicKey, '1.14.1'), /version mismatch/);
});

test('successful update preserves generated tools and stable installation paths', t => {
    const root = fixture(t);
    assert.equal(updater.install(root, valid()).status, 'installed');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'))).version, '1.15.0');
    assert.equal(fs.readFileSync(path.join(root, 'native-host/native-host.js'), 'utf8'), 'new host');
    assert.equal(fs.readFileSync(path.join(root, 'native-host/ffmpeg/ffmpeg.exe'), 'utf8'), 'preserve ffmpeg');
    assert.equal(updater.recover(root), false);
    assert.throws(() => updater.install(root, valid()), /no longer newer/);
});

test('failed writes roll back changed and newly created files without touching tools', t => {
    const root = fixture(t);
    assert.throws(() => updater.install(root, valid(), { afterWrite(name) {
        if (name === 'native-host/native-host.js') throw new Error('injected disk failure');
    } }), /injected disk failure/);
    assert.equal(fs.readFileSync(path.join(root, 'native-host/native-host.js'), 'utf8'), 'old host');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'))).version, '1.14.1');
    assert.equal(fs.existsSync(path.join(root, 'extension/js/example.js')), false);
    assert.equal(fs.existsSync(path.join(root, 'native-host/download-policy.js')), false);
    assert.equal(fs.existsSync(path.join(root, '.paracci-updater/journal.json')), false);
});

test('bootstrap recovery repairs a process killed partway through an update', t => {
    const root = fixture(t);
    const modulePath = path.resolve(__dirname, '../../native-host/app-updater.js');
    const data = valid();
    const result = spawnSync(process.execPath, ['-e',
        `require(process.argv[1]).install(process.argv[2], JSON.parse(process.argv[3]), {afterWrite(){process.exit(42)}})`,
        modulePath, root, JSON.stringify(data)], { windowsHide: true });
    assert.equal(result.status, 42);
    assert.equal(updater.recover(root), true);
    assert.equal(fs.existsSync(path.join(root, 'extension/js/example.js')), false);
    assert.equal(fs.readFileSync(path.join(root, 'native-host/native-host.js'), 'utf8'), 'old host');
    assert.equal(updater.recover(root), false);
});

test('development checkouts, live update locks and linked destination paths are protected', t => {
    const root = fixture(t);
    fs.mkdirSync(path.join(root, '.git'));
    assert.throws(() => updater.install(root, valid()), /Development checkout/);
    fs.rmdirSync(path.join(root, '.git'));
    fs.mkdirSync(path.join(root, '.paracci-updater'));
    fs.writeFileSync(path.join(root, '.paracci-updater/lock'), String(process.pid));
    assert.throws(() => updater.install(root, valid()), /in progress/);
    fs.unlinkSync(path.join(root, '.paracci-updater/lock'));
    fs.symlinkSync(path.join(root, 'native-host'), path.join(root, 'extension/js'), 'junction');
    assert.throws(() => updater.install(root, valid()), /Linked update paths/);
});

test('GitHub discovery verifies stable release version, exact asset URL and signed content', async t => {
    const root = fixture(t);
    let assetUrl = 'https://github.com/Paracci/youtube-shorts-blocker/releases/download/v1.15.0/paracci-update.json';
    let tag = 'v1.15.0';
    let assets = true;
    const client = updater.createUpdater({ root, publicKey: keys.publicKey, request: async url => {
        if (url === updater.API) return Buffer.from(JSON.stringify({ tag_name: tag,
            assets: assets ? [{ name: updater.ASSET, browser_download_url: assetUrl }] : [], body: 'release notes' }));
        return bundle();
    } });
    assert.throws(() => client.apply('1.15.0'), /Check for updates/);
    assert.equal((await client.check()).status, 'available');
    assert.throws(() => client.apply('1.16.0'), /Check for updates/);
    assetUrl = 'https://example.com/update';
    await assert.rejects(client.check(), /Unexpected update/);
    assert.throws(() => client.apply('1.15.0'), /Check for updates/);
    assets = false;
    assert.equal((await client.check()).status, 'unavailable');
    tag = 'v1.14.1';
    assert.equal((await client.check()).status, 'current');
});
