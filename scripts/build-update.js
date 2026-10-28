'use strict';
// Offline release publisher. Never include the private signing key in a release.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { verify } = require('../native-host/app-updater');
const root = path.resolve(__dirname, '..');
const keyFile = process.env.PARACCI_UPDATE_SIGNING_KEY;
if (!keyFile) throw new Error('Set PARACCI_UPDATE_SIGNING_KEY to the private Ed25519 PEM outside this repository.');
const key = crypto.createPrivateKey(fs.readFileSync(keyFile));
const publicKey = fs.readFileSync(path.join(root, 'native-host/update-public-key.pem'));
if (crypto.createPublicKey(key).export({ type: 'spki', format: 'pem' }) !== crypto.createPublicKey(publicKey).export({ type: 'spki', format: 'pem' })) throw new Error('Signing key does not match the installed trust root.');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json')));
const names = execFileSync('git', ['ls-files', '--', 'extension'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/);
names.push('native-host/native-host.js', 'native-host/download-policy.js');
const files = names.map(name => {
    const target = path.join(root, name);
    if (fs.lstatSync(target).isSymbolicLink()) throw new Error('Cannot publish symbolic links.');
    // Sign the exact Git index bytes, including binary assets. This avoids
    // signing unrelated unstaged edits or Windows checkout newline changes.
    const bytes = execFileSync('git', ['show', ':' + name], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
    return { path: name, content: bytes.toString('base64'), sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
});
const payload = Buffer.from(JSON.stringify({ protocol: 1, repository: 'Paracci/youtube-shorts-blocker', version: manifest.version, files }));
const envelope = Buffer.from(JSON.stringify({ payload: payload.toString('base64'), signature: crypto.sign(null, payload, key).toString('base64') }));
verify(envelope, publicKey, '0.0.0');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/paracci-update.json'), envelope);
console.log('Verified signed update package: dist/paracci-update.json (' + manifest.version + ', ' + files.length + ' files)');
