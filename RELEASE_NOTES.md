# v1.14.1 — Reliable FFmpeg Setup on Fresh Windows Installations

This patch fixes native video and audio downloads on Windows computers that do not already have FFmpeg installed.

## Fixes

- Replace the expired FFmpeg autobuild URL, which returned HTTP 404, with release discovery for the maintained BtbN FFmpeg 8.1 Windows build. The archive must match the SHA-256 digest published by the official GitHub release API before extraction and installation.
- Install missing FFmpeg on first use of the YouTube player download buttons, and pass its exact local directory to yt-dlp for video/audio merging and MP3 conversion. The standalone downloader also uses the corrected installer.
- Copy FFmpeg, ffprobe, and the required DLLs correctly when the installation path contains Turkish or other non-ASCII characters, avoiding a Windows file-copy issue reproduced with Node.js 22.18.0.
- Report interrupted or stalled tool downloads as errors so they can be retried.

## Updating

1. Extract the new source archive to a permanent folder, or update your existing checkout.
2. Reload the unpacked extension from `chrome://extensions/` and refresh any open YouTube tabs. If Chrome keeps an older native host process open, exit Chrome completely and reopen it.
3. If you moved the installation to a different folder, run `native-host/install_host.bat` again with the extension ID shown on the setup page. Replacing files in the same folder does not require re-registering the host.
4. Keep Node.js 22 or newer installed. On the first native download, allow time for the roughly 90 MB FFmpeg archive to download and install.

Generated media-tool binaries are not included in the source archive; the native host downloads and verifies them when needed.

## Local validation

- `npm run test:all`: 26 production JavaScript files passed syntax validation; all 80 automated tests passed.
- Regression tests cover fresh player video/MP3 downloads, complete FFmpeg/DLL installation under a Turkish-character path, digest rejection, retry after failure, and reuse of an existing installation without network access.
- `node test/scripts/clean-install-smoke.js`: downloaded and installed real yt-dlp and FFmpeg into an isolated temporary Windows directory containing Turkish characters. Both FFmpeg and ffprobe ran successfully; a generated MP4 was verified to contain H.264 video and AAC audio. The registered host and existing media tools were left unchanged.
- The original failure on the second computer has not yet been retested on that device. The live smoke test validates tool installation and local media processing, not a live YouTube download.

## GitHub Actions availability

The maintainer reports that GitHub Actions usage is currently blocked by the account's usage/budget limits. Hosted verification may therefore appear failed or unavailable without running validation. A check blocked for that reason is not a passing CI result; the validation evidence for this release is the local testing described above. Any actual build or test failure must still be investigated separately.
