#!/usr/bin/env node
// native-host.js – v1.9.0

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

// The local path where we expect to find our bundled/downloaded yt-dlp tool
const YTDLP_BIN = path.join(__dirname, 'yt-dlp.exe');

const downloadYtdlp = () => {
    return new Promise((resolve, reject) => {
        const fileStream = fs.createWriteStream(YTDLP_BIN);
        // Follow redirects since GitHub releases redirect to objects
        const attemptDownload = (url) => {
            https.get(url, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    attemptDownload(res.headers.location);
                } else if (res.statusCode === 200) {
                    res.pipe(fileStream);
                    fileStream.on('finish', () => {
                        fileStream.close();
                        resolve();
                    });
                } else {
                    reject(new Error(`Server returned ${res.statusCode}`));
                }
            }).on('error', (err) => {
                fs.unlink(YTDLP_BIN, () => { });
                reject(err);
            });
        };
        attemptDownload('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe');
    });
};

// ── Native Messaging stdin reader ─────────────────────────────────────────────
// The old implementation called process.stdin.on('data', ...) inside getMessage()
// which is called in a while(true) loop — each iteration added a NEW listener
// without removing the previous one. After N messages, N listeners were all
// reading the same bytes simultaneously, causing duplicate/corrupt parses.
//
// Fix: one single persistent data handler with a queue of pending resolvers.
// Chrome's Native Messaging protocol: 4-byte LE length header + UTF-8 JSON body.

const _messageQueue = [];   // resolved messages waiting to be consumed
const _resolverQueue = [];  // pending getMessage() callers waiting for a message
let _stdinBuf = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
    _stdinBuf = Buffer.concat([_stdinBuf, chunk]);

    // A single chunk may contain multiple complete messages — drain all of them
    while (true) {
        if (_stdinBuf.length < 4) break; // not enough bytes for the length header yet

        const msgLen = _stdinBuf.readUInt32LE(0);

        if (_stdinBuf.length < 4 + msgLen) break; // message body not fully arrived yet

        const msgBody = _stdinBuf.slice(4, 4 + msgLen).toString('utf8');
        _stdinBuf = _stdinBuf.slice(4 + msgLen); // advance past this message

        let parsed;
        try { parsed = JSON.parse(msgBody); }
        catch (e) { continue; } // malformed JSON — skip

        if (_resolverQueue.length > 0) {
            // Someone is already waiting — resolve them directly
            _resolverQueue.shift()(parsed);
        } else {
            // No one waiting yet — buffer the message
            _messageQueue.push(parsed);
        }
    }
});

process.stdin.on('end', () => process.exit(0));

const getMessage = () => {
    return new Promise((resolve) => {
        if (_messageQueue.length > 0) {
            // A message already arrived before anyone asked for it
            resolve(_messageQueue.shift());
        } else {
            _resolverQueue.push(resolve);
        }
    });
};

const sendMessage = (msg) => {
    const buffer = Buffer.from(JSON.stringify(msg));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(buffer.length, 0);
    process.stdout.write(header);
    process.stdout.write(buffer);
};

// Main loop
const activeNativeDownloads = new Set(); // videoId → prevents duplicate spawns

async function main() {
    sendMessage({ status: 'ready', message: 'Native host started' });

    while (true) {
        try {
            const request = await getMessage();

            if (request.action === 'download_video') {
                const { videoId, title, videoQuality, qualityHeight, isAudioOnly, isDirectUrl, url, savePath } = request;

                if (!videoId) {
                    sendMessage({ status: 'error', message: 'No videoId provided.' });
                    continue;
                }

                // Second-line dedup defence (first is in background.js)
                if (activeNativeDownloads.has(videoId)) {
                    sendMessage({ status: 'error', message: `Already downloading ${videoId} — ignoring duplicate.` });
                    continue;
                }
                activeNativeDownloads.add(videoId);

                if (!fs.existsSync(YTDLP_BIN)) {
                    sendMessage({ status: 'info', message: 'Local yt-dlp.exe not found! Downloading it now...' });
                    try {
                        await downloadYtdlp();
                        sendMessage({ status: 'info', message: 'Successfully downloaded yt-dlp.exe!' });
                    } catch (e) {
                        sendMessage({ status: 'error', message: 'Failed to download yt-dlp.exe: ' + e.message });
                        continue;
                    }
                }

                // ── Output directory ───────────────────────────────────────────
                // Use custom savePath if provided & non-empty; otherwise default Downloads.
                const saveDir = (savePath && savePath.trim())
                    ? savePath.trim()
                    : path.join(process.env.USERPROFILE || process.env.HOME, 'Downloads');

                // Ensure the target directory exists (create recursively if needed)
                try {
                    if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });
                } catch (mkdirErr) {
                    sendMessage({ status: 'error', message: `Cannot create save folder: ${mkdirErr.message}` });
                    activeNativeDownloads.delete(videoId);
                    continue;
                }

                const ytUrl = isDirectUrl ? url : `https://www.youtube.com/watch?v=${videoId}`;

                // Normalize quality label for use in filename (strip chars unsafe for Windows paths)
                const safeQuality = (videoQuality || 'best')
                    .replace(/[/\\<>:"|?*\x00-\x1f]/g, '_')
                    .trim();

                // Keep full Unicode title (Windows NTFS handles it), only strip truly unsafe chars
                const safeTitle = (title || 'video')
                    .replace(/[/\\<>:"|?*\x00-\x1f]/g, '_')
                    .replace(/\.{2,}/g, '.')
                    .trim()
                    .substring(0, 150);

                // ── Build yt-dlp format selector ───────────────────────────────
                //
                // Codec priority — H.264 (avc1) FIRST for maximum device compatibility:
                //
                //   H.264 (avc1): Plays on ALL devices — iPhone, iPad, old Android,
                //                  Smart TVs, QuickTime, Windows Media Player, etc.
                //                  This is the only codec Apple's native player supports.
                //
                //   VP9  (vp9):   iOS QuickTime/Dosyalar/Fotoğraflar do NOT play VP9.
                //                  Even when muxed into mp4, the video track is silent/black
                //                  on Apple devices. Only VLC or modern browsers handle it.
                //
                //   AV1  (av01):  Only iPhone 12+ / iOS 16+. Very limited compatibility.
                //
                // Summary: We intentionally prefer H.264 over VP9/AV1 so that downloaded
                // files play natively on every device without needing a third-party player.
                // The quality difference at ≤1080p is imperceptible for most content.
                //
                // Audio: m4a (mp4a) is paired with H.264 for full iOS compatibility.
                // bestaudio is kept as fallback since opus/webm audio also re-muxes fine.
                //
                // --merge-output-format mp4 ensures the final file is always .mp4
                // regardless of which streams were selected.
                //
                let formatSelector;
                let outExt = 'mp4';

                if (isAudioOnly) {
                    formatSelector = null; // handled via -x flag below
                    outExt = 'mp3';
                } else if (qualityHeight) {
                    formatSelector = [
                        // ① H.264 at exact requested height — best device compatibility
                        `bestvideo[height=${qualityHeight}][vcodec^=avc1]+bestaudio[acodec^=mp4a]`,
                        `bestvideo[height=${qualityHeight}][vcodec^=avc1]+bestaudio`,
                        // ② H.264 at any height ≤ requested
                        `bestvideo[height<=${qualityHeight}][vcodec^=avc1]+bestaudio[acodec^=mp4a]`,
                        `bestvideo[height<=${qualityHeight}][vcodec^=avc1]+bestaudio`,
                        // ③ VP9 fallback (for devices/players that support it)
                        `bestvideo[height=${qualityHeight}][vcodec^=vp9]+bestaudio`,
                        `bestvideo[height<=${qualityHeight}][vcodec^=vp9]+bestaudio`,
                        // ④ AV1 fallback
                        `bestvideo[height=${qualityHeight}][vcodec^=av01]+bestaudio`,
                        `bestvideo[height<=${qualityHeight}][vcodec^=av01]+bestaudio`,
                        // ⑤ Any codec — last resort
                        `bestvideo[height=${qualityHeight}]+bestaudio`,
                        `bestvideo[height<=${qualityHeight}]+bestaudio`,
                        `best[height<=${qualityHeight}]`
                    ].join('/');
                } else {
                    formatSelector = [
                        // ① H.264 — universal compatibility
                        'bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]',
                        'bestvideo[vcodec^=avc1]+bestaudio',
                        // ② VP9 fallback
                        'bestvideo[vcodec^=vp9]+bestaudio',
                        // ③ AV1 fallback
                        'bestvideo[vcodec^=av01]+bestaudio',
                        // ④ Any codec
                        'bestvideo+bestaudio',
                        'best'
                    ].join('/');
                }

                const outTemplate = path.join(
                    saveDir,
                    isAudioOnly
                        ? `${safeTitle} [${safeQuality}].%(ext)s`
                        : `${safeTitle} [${safeQuality}].mp4`
                );

                // Common quality flags applied to every download:
                //   --concurrent-fragments 4  → parallel fragment download (faster)
                //   --no-playlist             → never accidentally grab a playlist
                //   --no-part                 → write directly, no .part temp file clutter
                const commonArgs = [
                    '--concurrent-fragments', '4',
                    '--no-playlist',
                    '--no-part'
                ];

                let args;
                if (isDirectUrl) {
                    // Direct stream URL (browser fallback routed to native for custom path)
                    args = [
                        '--no-playlist',
                        '--no-part',
                        '-o', outTemplate,
                        ytUrl
                    ];
                } else if (isAudioOnly) {
                    args = [
                        ...commonArgs,
                        '-x', '--audio-format', 'mp3', '--audio-quality', '0',
                        '-o', outTemplate, ytUrl
                    ];
                } else {
                    args = [
                        ...commonArgs,
                        '-f', formatSelector,
                        '--merge-output-format', 'mp4',
                        '-o', outTemplate, ytUrl
                    ];
                }

                sendMessage({ status: 'info', message: `Starting yt-dlp: ${args.join(' ')}` });

                const ytdlp = spawn(YTDLP_BIN, args, { windowsHide: true });

                ytdlp.stdout.on('data', (data) => {
                    sendMessage({ status: 'progress', data: data.toString() });
                });
                ytdlp.stderr.on('data', (data) => {
                    sendMessage({ status: 'error_log', data: data.toString() });
                });
                ytdlp.on('close', (code) => {
                    activeNativeDownloads.delete(videoId);
                    if (code === 0) {
                        sendMessage({
                            action: 'download_video_result',
                            status: 'success',
                            message: 'Download completed.',
                            videoId: videoId,
                            title: safeTitle
                        });
                    } else {
                        sendMessage({
                            action: 'download_video_result',
                            status: 'error',
                            message: `yt-dlp error code: ${code}`,
                            videoId: videoId,
                            title: safeTitle
                        });
                    }
                });

            } else if (request.action === 'pick_folder') {
                // ── IFileOpenDialog (Vista-style File Explorer picker) ────────
                // C# compiled at runtime via Add-Type in a temp PS1 (STA thread).
                // Falls back to WinForms FolderBrowserDialog if COM compile fails.

                const initialPath = (request.currentPath && request.currentPath.trim())
                    ? request.currentPath.trim()
                    : path.join(process.env.USERPROFILE || process.env.HOME, 'Downloads');

                const safeInit = initialPath.replace(/\\/g, '\\\\').replace(/'/g, "''");

                // C# lines — single-quoted PS here-string safe (no backticks, no $ expansion)
                const csLines = [
                    'using System;',
                    'using System.Runtime.InteropServices;',
                    'public class VistaPicker {',
                    '  [DllImport("shell32.dll", CharSet=CharSet.Unicode, PreserveSig=false)]',
                    '  public static extern void SHCreateItemFromParsingName(',
                    '    string pszPath, IntPtr pbc, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out object ppv);',
                    '  [ComImport]',
                    '  [Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]',
                    '  [CoClass(typeof(object))]',
                    '  public interface FileOpenDialogRCW {}',
                    '  [ComImport]',
                    '  [Guid("42F85136-DB7E-439C-85F1-E4075D135FC8")]',
                    '  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
                    '  public interface IFileDialog {',
                    '    [PreserveSig] uint Show([In] IntPtr parent);',
                    '    void SetFileTypes(uint c, [In, MarshalAs(UnmanagedType.LPArray)] IntPtr[] p);',
                    '    void SetFileTypeIndex(uint i);',
                    '    void GetFileTypeIndex(out uint pi);',
                    '    void Advise(IntPtr pfde, out uint pdwCookie);',
                    '    void Unadvise(uint dwCookie);',
                    '    void SetOptions([In] uint fos);',
                    '    void GetOptions(out uint pfos);',
                    '    void SetDefaultFolder([In, MarshalAs(UnmanagedType.Interface)] object psi);',
                    '    void SetFolder([In, MarshalAs(UnmanagedType.Interface)] object psi);',
                    '    void GetFolder([MarshalAs(UnmanagedType.Interface)] out object ppsi);',
                    '    void GetCurrentSelection([MarshalAs(UnmanagedType.Interface)] out object ppsi);',
                    '    void SetFileName([In, MarshalAs(UnmanagedType.LPWStr)] string pszName);',
                    '    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);',
                    '    void SetTitle([In, MarshalAs(UnmanagedType.LPWStr)] string pszTitle);',
                    '    void SetOkButtonLabel([In, MarshalAs(UnmanagedType.LPWStr)] string pszText);',
                    '    void SetFileNameLabel([In, MarshalAs(UnmanagedType.LPWStr)] string pszLabel);',
                    '    void GetResult([MarshalAs(UnmanagedType.Interface)] out object ppsi);',
                    '    void AddPlace([In, MarshalAs(UnmanagedType.Interface)] object psi, int alignment);',
                    '    void SetDefaultExtension([In, MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);',
                    '    void Close([MarshalAs(UnmanagedType.Error)] int hr);',
                    '    void SetClientGuid([In] ref Guid guid);',
                    '    void ClearClientData();',
                    '    void SetFilter([MarshalAs(UnmanagedType.Interface)] object pFilter);',
                    '  }',
                    '  [ComImport]',
                    '  [Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE")]',
                    '  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
                    '  public interface IShellItem {',
                    '    void BindToHandler(IntPtr pbc, [In] ref Guid bhid, [In] ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out object ppv);',
                    '    void GetParent([MarshalAs(UnmanagedType.Interface)] out IShellItem ppsi);',
                    '    void GetDisplayName([In] uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);',
                    '    void GetAttributes([In] uint sfgaoMask, out uint psfgaoAttribs);',
                    '    void Compare([In, MarshalAs(UnmanagedType.Interface)] IShellItem psi, [In] uint hint, out int piOrder);',
                    '  }',
                    '  public static string PickFolder(string startPath) {',
                    '    try {',
                    '      var clsid = new Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7");',
                    '      var iid   = new Guid("42F85136-DB7E-439C-85F1-E4075D135FC8");',
                    '      var dlg = (IFileDialog)Activator.CreateInstance(Type.GetTypeFromCLSID(clsid));',
                    '      uint opts; dlg.GetOptions(out opts);',
                    '      dlg.SetOptions(opts | 0x20 | 0x40 | 0x8);', // FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST
                    '      dlg.SetTitle("Select Download Folder");',
                    '      dlg.SetOkButtonLabel("Select");',
                    '      try {',
                    '        var shellGuid = new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");',
                    '        object siObj;',
                    '        SHCreateItemFromParsingName(startPath, IntPtr.Zero, ref shellGuid, out siObj);',
                    '        dlg.SetFolder(siObj);',
                    '      } catch {}',
                    '      uint hr = dlg.Show(IntPtr.Zero);',
                    '      if (hr != 0) return "";',
                    '      object result;',
                    '      dlg.GetResult(out result);',
                    '      var si = (IShellItem)result;',
                    '      string name;',
                    '      si.GetDisplayName(0x80058000, out name);', // SIGDN_FILESYSPATH
                    '      return name ?? "";',
                    '    } catch (Exception ex) {',
                    '      return "ERR:" + ex.Message;',
                    '    }',
                    '  }',
                    '}'
                ];

                const psLines = [
                    // Use single-quoted here-string @'...'@ — NO variable expansion, NO escaping needed
                    "Add-Type -TypeDefinition @'",
                    ...csLines,
                    "'@",
                    `$r = [VistaPicker]::PickFolder('${safeInit}')`,
                    // If C# COM fails (returns ERR:... or empty), fall back to WinForms
                    "if ($r -eq $null -or $r -eq '' -or $r.StartsWith('ERR:')) {",
                    "    Add-Type -AssemblyName System.Windows.Forms",
                    "    [System.Windows.Forms.Application]::EnableVisualStyles()",
                    "    $d = New-Object System.Windows.Forms.FolderBrowserDialog",
                    "    $d.Description = 'Select download folder'",
                    "    $d.ShowNewFolderButton = $true",
                    `    $d.SelectedPath = '${safeInit}'`,
                    "    if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath } else { Write-Output '' }",
                    "} else {",
                    "    Write-Output $r",
                    "}"
                ];

                const tmpPs1 = path.join(
                    process.env.TEMP || process.env.TMP || __dirname,
                    `fp-${Date.now()}.ps1`
                );

                try {
                    // BOM ensures PowerShell reads UTF-8 correctly on all locales
                    fs.writeFileSync(tmpPs1, '\ufeff' + psLines.join('\r\n'), 'utf8');
                } catch (e) {
                    sendMessage({ action: 'pick_folder_result', path: '', error: 'tmp write: ' + e.message });
                    continue;
                }

                const ps = spawn('powershell.exe', [
                    '-NoProfile',
                    '-STA',
                    '-ExecutionPolicy', 'Bypass',
                    '-File', tmpPs1
                ], { windowsHide: false, detached: false });

                let psOut = '', psErr = '';
                ps.stdout.on('data', d => { psOut += d.toString(); });
                ps.stderr.on('data', d => { psErr += d.toString(); });
                ps.on('close', (code) => {
                    try { fs.unlinkSync(tmpPs1); } catch (_) { }
                    sendMessage({
                        action: 'pick_folder_result',
                        path: psOut.trim(),
                        _exitCode: code,
                        _stderr: psErr.trim()
                    });
                });
                ps.on('error', err => {
                    try { fs.unlinkSync(tmpPs1); } catch (_) { }
                    sendMessage({ action: 'pick_folder_result', path: '', error: err.message });
                });

            } else if (request.action === 'update_ytdlp') {
                if (!fs.existsSync(YTDLP_BIN)) {
                    sendMessage({ status: 'info', message: 'yt-dlp.exe is missing. Downloading the latest version now...' });
                    try {
                        await downloadYtdlp();
                        sendMessage({ status: 'update_success', message: 'Successfully installed yt-dlp.exe!' });
                    } catch (e) {
                        sendMessage({ status: 'error', message: 'Failed to download yt-dlp.exe: ' + e.message });
                    }
                } else {
                    sendMessage({ status: 'info', message: 'Checking for yt-dlp updates...' });
                    const ytdlp = spawn(YTDLP_BIN, ['-U'], { windowsHide: true });

                    ytdlp.stdout.on('data', (data) => {
                        sendMessage({ status: 'progress', data: data.toString() });
                    });
                    ytdlp.stderr.on('data', (data) => {
                        sendMessage({ status: 'error_log', data: data.toString() });
                    });
                    ytdlp.on('close', (code) => {
                        if (code === 0) {
                            sendMessage({ status: 'update_success', message: 'Update check finished.' });
                        } else {
                            sendMessage({ status: 'error', message: `yt-dlp updater error code: ${code}` });
                        }
                    });
                }

            } else if (request.action === 'ping') {
                sendMessage({ status: 'pong' });
            }

        } catch (e) {
            sendMessage({ status: 'error', message: e.toString() });
        }
    }
}

main();