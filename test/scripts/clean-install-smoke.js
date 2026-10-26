'use strict';

// Opt-in Windows smoke test: downloads real media tools into an isolated temp
// directory. Does not change the registered host, registry, or existing tools.
// Run: node test/scripts/clean-install-smoke.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { encodeNativeMessage } = require('../../native-host/native-host');

async function main() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paracci-clean-install-'));
    const runtime = path.join(root, 'Temiz kurulum T\u00fcrk\u00e7e');
    let child;
    try {
        fs.mkdirSync(runtime);
        for (const file of ['native-host.js', 'download-policy.js']) {
            fs.copyFileSync(path.resolve(__dirname, '../../native-host', file), path.join(runtime, file));
        }
        child = spawn(process.execPath, [path.join(runtime, 'native-host.js')], { windowsHide: true });
        const exited = new Promise(resolve => child.once('close', resolve));
        try {
            await new Promise((resolve, reject) => {
                let pending = Buffer.alloc(0);
                const deadline = setTimeout(() => reject(new Error('Clean installation timed out.')), 240000);
                const finish = (error) => { clearTimeout(deadline); error ? reject(error) : resolve(); };
                child.on('error', finish);
                child.on('close', code => finish(new Error('Host exited before tools were ready: ' + code)));
                child.stderr.on('data', data => process.stderr.write(data));
                child.stdout.on('data', chunk => {
                    pending = Buffer.concat([pending, chunk]);
                    while (pending.length >= 4) {
                        const length = pending.readUInt32LE(0);
                        if (pending.length < length + 4) return;
                        const message = JSON.parse(pending.subarray(4, length + 4).toString('utf8'));
                        pending = pending.subarray(length + 4);
                        console.log(JSON.stringify(message));
                        if (message.status === 'ready') {
                            if (message.ytdlpReady || message.ffmpegReady) {
                                finish(new Error('Smoke test must start without media tools.'));
                                return;
                            }
                            child.stdin.write(encodeNativeMessage({ action: 'update_media_tools' }));
                        }
                        if (message.status === 'error') finish(new Error(message.message));
                        if (message.status === 'media_tools_ready') {
                            finish(message.ytdlpReady && message.ffmpegReady ? null : new Error('Incomplete tool installation.'));
                        }
                    }
                });
            });
        } finally {
            child.kill();
            await exited;
        }

        function run(relativeFile, args) {
            const result = spawnSync(path.join(runtime, relativeFile), args,
                { windowsHide: true, timeout: 20000, encoding: 'utf8' });
            if (result.error || result.status !== 0) {
                throw new Error(relativeFile + ': ' + (result.error?.message || result.stderr));
            }
            return result.stdout;
        }
        console.log('YT_DLP_VERSION ' + run('yt-dlp.exe', ['--version']).trim());
        console.log('FFMPEG_VERSION ' + run('ffmpeg/ffmpeg.exe', ['-version']).split(/\r?\n/)[0]);
        console.log('FFPROBE_VERSION ' + run('ffmpeg/ffprobe.exe', ['-version']).split(/\r?\n/)[0]);
        const output = path.join(root, 'smoke.mp4');
        run('ffmpeg/ffmpeg.exe', ['-hide_banner', '-loglevel', 'error',
            '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10',
            '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
            '-t', '1', '-c:v', 'libx264', '-c:a', 'aac', output]);
        const metadata = JSON.parse(run('ffmpeg/ffprobe.exe', ['-v', 'error',
            '-show_entries', 'stream=codec_type,codec_name', '-of', 'json', output]));
        if (!metadata.streams.some(stream => stream.codec_type === 'video') ||
            !metadata.streams.some(stream => stream.codec_type === 'audio')) {
            throw new Error('Generated MP4 is missing video or audio.');
        }
        console.log('ENCODE_MERGE_PROBE ' + JSON.stringify(metadata));
        console.log('LIVE_CLEAN_INSTALL_PASS');
    } finally {
        fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
