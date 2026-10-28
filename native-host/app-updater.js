'use strict';
// Protocol 1 bootstrap: this file and update-public-key.pem are deliberately
// excluded from automatic updates. Trust-root changes require a manual install.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const API = 'https://api.github.com/repos/Paracci/youtube-toolkit/releases/latest';
const ASSET = 'paracci-update.json';
const MAX_BYTES = 16 * 1024 * 1024;

function version(value) {
    if (typeof value !== 'string' || !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(value)) throw new Error('Invalid update version.');
    const parts = value.split('.').map(Number);
    if (parts.some(n => n > 65535)) throw new Error('Invalid update version.');
    return [...parts, ...Array(4 - parts.length).fill(0)];
}
function compare(a, b) {
    const x = version(a), y = version(b);
    for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return Math.sign(x[i] - y[i]);
    return 0;
}
function allowed(name) {
    return typeof name === 'string' && /^[a-zA-Z0-9_./-]+$/.test(name) &&
        !name.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.')) &&
        (name.startsWith('extension/') || ['native-host/native-host.js', 'native-host/download-policy.js'].includes(name));
}
function safePath(root, name) {
    if (!allowed(name)) throw new Error('Disallowed update path: ' + name);
    let current = root;
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Linked installation roots are not supported.');
    for (const part of name.split('/')) {
        current = path.join(current, part);
        if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('Linked update paths are not supported.');
    }
    return current;
}
function atomicWrite(file, bytes) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = file + '.paracci-tmp';
    if (fs.existsSync(temp) && fs.lstatSync(temp).isSymbolicLink()) throw new Error('Linked staging path.');
    fs.writeFileSync(temp, bytes, { flag: 'w' });
    fs.renameSync(temp, file);
}
function stateDir(root) {
    const dir = path.join(root, '.paracci-updater');
    if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw new Error('Linked updater state.');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}
function readJournal(root) {
    const file = path.join(stateDir(root), 'journal.json');
    if (!fs.existsSync(file)) return null;
    if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > MAX_BYTES * 2) throw new Error('Invalid recovery journal.');
    const journal = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(journal.files) || journal.files.some(f => !allowed(f.path) || (f.previous !== null && typeof f.previous !== 'string'))) {
        throw new Error('Invalid recovery journal.');
    }
    return journal;
}
function rollback(root, journal) {
    for (const entry of [...journal.files].reverse()) {
        const target = safePath(root, entry.path);
        if (entry.previous === null) fs.rmSync(target, { force: true });
        else atomicWrite(target, Buffer.from(entry.previous, 'base64'));
    }
}
function recoverUnlocked(root) {
    const journal = readJournal(root);
    if (!journal) return false;
    if (!journal.committed) rollback(root, journal);
    fs.unlinkSync(path.join(stateDir(root), 'journal.json'));
    return !journal.committed;
}
function locked(root, callback) {
    const lock = path.join(stateDir(root), 'lock');
    if (fs.existsSync(lock)) {
        if (fs.lstatSync(lock).isSymbolicLink()) throw new Error('Linked updater lock.');
        const pid = Number(fs.readFileSync(lock, 'utf8'));
        if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid updater lock.');
        let alive = true;
        try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
        if (alive) throw new Error('Another update is in progress. Please retry later.');
        fs.unlinkSync(lock);
    }
    const fd = fs.openSync(lock, 'wx');
    try { fs.writeFileSync(fd, String(process.pid)); return callback(); }
    finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
function recover(root) { return locked(root, () => recoverUnlocked(root)); }

function verify(envelopeBytes, publicKey, currentVersion) {
    if (envelopeBytes.length > MAX_BYTES) throw new Error('Update package is too large.');
    const envelope = JSON.parse(envelopeBytes.toString('utf8'));
    if (typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string') throw new Error('Unsigned update package.');
    const payload = Buffer.from(envelope.payload, 'base64');
    if (!crypto.verify(null, payload, publicKey, Buffer.from(envelope.signature, 'base64'))) throw new Error('Update signature verification failed.');
    const data = JSON.parse(payload.toString('utf8'));
    if (data.protocol !== 1 || data.repository !== 'Paracci/youtube-toolkit') throw new Error('Unsupported update package.');
    if (compare(data.version, currentVersion) <= 0) throw new Error('Older or identical update rejected.');
    if (!Array.isArray(data.files) || !data.files.length || data.files.length > 256) throw new Error('Invalid update inventory.');
    const names = new Set();
    for (const file of data.files) {
        if (!allowed(file.path) || names.has(file.path.toLowerCase()) || typeof file.content !== 'string') throw new Error('Invalid update file.');
        names.add(file.path.toLowerCase());
        const hash = crypto.createHash('sha256').update(Buffer.from(file.content, 'base64')).digest('hex');
        if (hash !== file.sha256) throw new Error('Update file checksum failed.');
    }
    const manifestFile = data.files.find(f => f.path === 'extension/manifest.json');
    if (!manifestFile || !names.has('native-host/native-host.js') || !names.has('native-host/download-policy.js')) throw new Error('Incomplete update package.');
    const manifest = JSON.parse(Buffer.from(manifestFile.content, 'base64').toString('utf8'));
    if (manifest.version !== data.version || manifest.manifest_version !== 3) throw new Error('Update manifest version mismatch.');
    const referenced = [manifest.background?.service_worker, manifest.action?.default_popup,
        ...Object.values(manifest.icons || {}),
        ...(manifest.content_scripts || []).flatMap(s => [...(s.js || []), ...(s.css || [])])].filter(Boolean);
    if (referenced.some(name => !names.has(('extension/' + name).toLowerCase()))) throw new Error('Update is missing a manifest resource.');
    return data;
}

function install(root, data, { afterWrite } = {}) {
    if (fs.existsSync(path.join(root, '.git'))) throw new Error('Development checkout: use git pull instead of automatic installation.');
    return locked(root, () => {
        recoverUnlocked(root);
        const current = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
        if (compare(data.version, current.version) <= 0) throw new Error('Update is no longer newer than the installed version.');
        const next = JSON.parse(Buffer.from(data.files.find(f => f.path === 'extension/manifest.json').content, 'base64'));
        if (next.key !== current.key) throw new Error('Update cannot change the extension identity.');
        // Install dependencies first and manifest last. Never remove generated
        // binaries, browser storage, or files outside the signed inventory.
        const files = [...data.files].sort((a, b) => (a.path === 'extension/manifest.json') - (b.path === 'extension/manifest.json'));
        const journal = { committed: false, files: files.map(f => {
            const target = safePath(root, f.path);
            return { path: f.path, previous: fs.existsSync(target) ? fs.readFileSync(target).toString('base64') : null };
        }) };
        const journalPath = path.join(stateDir(root), 'journal.json');
        atomicWrite(journalPath, JSON.stringify(journal));
        try {
            for (const file of files) {
                atomicWrite(safePath(root, file.path), Buffer.from(file.content, 'base64'));
                afterWrite?.(file.path);
            }
            journal.committed = true;
            atomicWrite(journalPath, JSON.stringify(journal));
        } catch (error) {
            // Keep the journal if rollback itself fails, for bootstrap recovery.
            rollback(root, journal);
            fs.unlinkSync(journalPath);
            throw error;
        }
        fs.unlinkSync(journalPath);
        return { status: 'installed', version: data.version };
    });
}

function createUpdater({ root, request, publicKey = fs.readFileSync(path.join(__dirname, 'update-public-key.pem')) }) {
    let candidate = null;
    let pending = null;
    async function check() {
        if (pending) return pending;
        pending = (async () => {
            candidate = null;
            const current = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8')).version;
            const release = JSON.parse((await request(API, { Accept: 'application/vnd.github+json' }, 0, 2 * 1024 * 1024)).toString('utf8'));
            const latest = String(release.tag_name || '').replace(/^v/, '');
            version(latest);
            if (release.draft || release.prerelease) throw new Error('Only stable releases are supported.');
            if (compare(latest, current) <= 0) return { status: 'current', currentVersion: current, version: latest };
            const asset = Array.isArray(release.assets) && release.assets.find(a => a.name === ASSET);
            if (!asset) return { status: 'unavailable', currentVersion: current, version: latest, message: 'This release has no signed update package.' };
            const expected = `https://github.com/Paracci/youtube-toolkit/releases/download/v${latest}/${ASSET}`;
            if (asset.browser_download_url !== expected) throw new Error('Unexpected update download URL.');
            const bytes = await request(expected, {}, 0, MAX_BYTES);
            const data = verify(bytes, publicKey, current);
            if (data.version !== latest) throw new Error('Release and signed package versions differ.');
            candidate = data;
            return { status: 'available', currentVersion: current, version: latest, notes: String(release.body || '').slice(0, 4000) };
        })().finally(() => { pending = null; });
        return pending;
    }
    function apply(expectedVersion) {
        if (!candidate || candidate.version !== expectedVersion) throw new Error('Check for updates again before installing.');
        const result = install(root, candidate);
        candidate = null;
        return result;
    }
    return { check, apply };
}
module.exports = { createUpdater, verify, install, recover, compare, allowed, API, ASSET };
