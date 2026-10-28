'use strict';
// Opt-in end-to-end Native Messaging update test in a disposable installation.
// Local: node test/scripts/app-update-smoke.js
// Published GitHub release: node test/scripts/app-update-smoke.js --live
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { encodeNativeMessage } = require('../../native-host/native-host');
const updater = require('../../native-host/app-updater');
const repo = path.resolve(__dirname, '../..');

async function main() {
    const asset = path.join(repo, 'dist/paracci-update.json');
    const publicKey = fs.readFileSync(path.join(repo, 'native-host/update-public-key.pem'));
    const data = updater.verify(fs.readFileSync(asset), publicKey, '1.14.1');
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'paracci-app-smoke-'));
    const root = path.join(temp, 'Kurulum T\u00fcrk\u00e7e');
    let child;
    let closePromise;
    try {
        fs.mkdirSync(path.join(root, 'native-host/ffmpeg'), { recursive: true });
        fs.mkdirSync(path.join(root, 'extension'));
        for (const name of ['native-host.js', 'download-policy.js', 'app-updater.js', 'update-bootstrap.js', 'update-public-key.pem']) {
            fs.copyFileSync(path.join(repo, 'native-host', name), path.join(root, 'native-host', name));
        }
        fs.writeFileSync(path.join(root, 'extension/manifest.json'), JSON.stringify({ version: '1.14.1', manifest_version: 3 }));
        fs.writeFileSync(path.join(root, 'native-host/ffmpeg/ffmpeg.exe'), 'preserved-ffmpeg');
        fs.writeFileSync(path.join(root, 'native-host/yt-dlp.exe'), 'preserved-ytdlp');
        fs.writeFileSync(path.join(root, 'user-settings-marker'), 'preserved-settings');
        const args = [];
        if (!process.argv.includes('--live')) {
            const preload = path.join(temp, 'github-fixture.cjs');
            fs.writeFileSync(preload, `
const fs=require('fs'),{EventEmitter}=require('events');
require('https').get=(url,options,callback)=>{
 const request=new EventEmitter();request.setTimeout=()=>request;
 setImmediate(()=>{const response=new EventEmitter();response.statusCode=200;response.headers={};callback(response);
 const body=url===${JSON.stringify(updater.API)}?Buffer.from(JSON.stringify({tag_name:'v${data.version}',assets:[{name:'paracci-update.json',browser_download_url:'https://github.com/Paracci/youtube-toolkit/releases/download/v${data.version}/paracci-update.json'}]})):fs.readFileSync(${JSON.stringify(asset)});
 response.emit('data',body);response.emit('end');});return request;
};`);
            args.push('--require', preload);
        }
        child = spawn(process.execPath, [...args, path.join(root, 'native-host/update-bootstrap.js')], { windowsHide: true });
        closePromise = new Promise(resolve => child.on('close', resolve));
        let buffer = Buffer.alloc(0);
        const queue = [], waiters = [];
        child.stdout.on('data', chunk => {
            buffer = Buffer.concat([buffer, chunk]);
            while (buffer.length >= 4) {
                const length = buffer.readUInt32LE(0);
                if (buffer.length < length + 4) return;
                const message = JSON.parse(buffer.subarray(4, length + 4));
                buffer = buffer.subarray(length + 4);
                const resolve = waiters.shift();
                if (resolve) resolve(message); else queue.push(message);
            }
        });
        child.stderr.on('data', chunk => process.stderr.write(chunk));
        async function next() {
            if (queue.length) return queue.shift();
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Native update smoke timed out.')), 60000);
                waiters.push(value => { clearTimeout(timer); resolve(value); });
            });
        }
        const ready = await next();
        if (ready.status !== 'ready') throw new Error('Bootstrap did not start the host.');
        child.stdin.write(encodeNativeMessage({ action: 'check_app_update', requestId: 'smoke-check' }));
        const available = await next();
        if (available.status !== 'available' || available.version !== data.version) throw new Error(JSON.stringify(available));
        child.stdin.write(encodeNativeMessage({ action: 'install_app_update', requestId: 'smoke-install', version: data.version }));
        const result = await next();
        if (result.status !== 'installed') throw new Error(JSON.stringify(result));
        child.stdin.end();
        await closePromise;
        for (const file of data.files) {
            const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file.path))).digest('hex');
            if (hash !== file.sha256) throw new Error('Installed file differs: ' + file.path);
        }
        for (const [name, value] of [['native-host/ffmpeg/ffmpeg.exe', 'preserved-ffmpeg'],
            ['native-host/yt-dlp.exe', 'preserved-ytdlp'], ['user-settings-marker', 'preserved-settings']]) {
            if (fs.readFileSync(path.join(root, name), 'utf8') !== value) throw new Error('Preserved file changed.');
        }
        if (!fs.readFileSync(path.join(root, 'native-host/update-public-key.pem')).equals(publicKey)) throw new Error('Trust root changed.');
        if (updater.recover(root)) throw new Error('Successful update needed rollback.');
        console.log((process.argv.includes('--live') ? 'LIVE_GITHUB' : 'LOCAL_SIGNED') + '_NATIVE_UPDATE_PASS ' +
            JSON.stringify({ version: data.version, verifiedFiles: data.files.length, toolsPreserved: true, unicodePath: true }));
    } finally {
        if (child && child.exitCode === null) { child.kill(); await closePromise; }
        fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
