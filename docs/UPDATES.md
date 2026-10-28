# GitHub application updates

Version 1.15.0 introduces an updater for unpacked Windows installations. This is a native-companion feature; it is not Chrome Web Store distribution.

## One-time upgrade to 1.16.0

The project moved from `Paracci/youtube-shorts-blocker` to `Paracci/youtube-toolkit` in v1.16.0. The v1.15.0 updater pins the previous GitHub asset URL and signed repository identity. GitHub redirects cannot satisfy those checks, and its updater module is deliberately excluded from automatic updates. Therefore **v1.15.0 also requires this manual migration**; a one-click update cannot bootstrap this repository move. The Ed25519 signing key is unchanged.

1. Download the complete **v1.16.0** source ZIP. To keep the existing unpacked extension ID and browser settings, copy the new files over the existing installation **in the same folder**, including `native-host/app-updater.js`, the bootstrap, and the public key. Keep your existing `native-host/ffmpeg/` directory and `yt-dlp.exe`.
2. Run the updated `native-host/install_host.bat` once with the extension ID from Setup / Monitor. This registers the recovery bootstrap as the native entry point.
3. Reload the extension in `chrome://extensions/`, approve the new `alarms` permission if Chrome asks, and reopen YouTube tabs.
4. Open Setup / Monitor. The **Extension updates** card provides **Check for updates** and, when a newer signed release exists, **Update now**.

The current source archive always includes the bootstrap, updater, and public key. Releases before v1.15.0 have no application updater; v1.15.0 has the previous repository pinned. Do not use the small FFmpeg-only or Premium-only hotfix ZIPs for this migration. After migration, newer signed releases from `Paracci/youtube-toolkit` use the normal one-click workflow.

The local installation folder need not be renamed. Keep `com.paracci.youtubedownloader` and the existing `%LOCALAPPDATA%\Paracci\YouTube Shorts Blocker\NativeMessagingHosts` registration directory; these are compatibility identifiers, not current product branding. Developers should run `git remote set-url origin https://github.com/Paracci/youtube-toolkit.git` in existing clones.

## User behavior

- Chrome alarms check the latest stable GitHub release approximately daily while Chrome is running. Checks also run at browser startup when the last stored result is at least 24 hours old. A toolbar `NEW` badge indicates an available verified update; details are shown in Setup / Monitor.
- Checks download and verify release metadata/package bytes but **do not install code**. Installation requires clicking **Update now** in the extension's own setup page. YouTube content scripts cannot request application updates.
- Every install re-fetches and verifies the expected release, so a daily check remains usable after restarting Chrome. If the release changed, check again and review the new version.
- Active downloads or media-tool preparation postpone the operation. New downloads are blocked while installation/reload is pending.
- Source files are updated in place, and the extension reloads after success. Reopen existing YouTube tabs afterwards. Browser storage, blocked channels, settings, download paths, and generated FFmpeg/yt-dlp tools are not overwritten.
- Installation is rejected in a checkout containing `.git`; developers use Git instead. Web Store installations are not supported by this local-file updater.

## Package trust and recovery

The only discovery source is `Paracci/youtube-toolkit`'s latest stable GitHub release. It must provide an asset named `paracci-update.json` at the expected tag URL. The envelope carries a base64 JSON payload and an Ed25519 signature. The signature covers the complete payload, including the protocol, repository, version, file paths, bytes, and SHA-256 hashes.

The pinned `native-host/update-public-key.pem` authenticates the publisher independently of GitHub's asset digest. Missing signatures, wrong keys, tampering, duplicate paths, traversal, missing manifest resources, downgraded versions, identity-key changes, and linked destinations are rejected. Updates cannot write outside `extension/`, `native-host/native-host.js`, or `native-host/download-policy.js`.

`app-updater.js`, `update-bootstrap.js`, and `update-public-key.pem` form the protocol-1 trust/recovery root and are **excluded from automatic updates**. Updating these components or rotating the signing key requires an explicit manual bootstrap upgrade. Future native-host releases must remain compatible with protocol 1 until that manual upgrade is distributed.

Before writing source files, the updater writes a recovery journal containing the previous bytes. Each replacement uses a temporary file and rename, with `manifest.json` last. Write failures trigger rollback. If the host exits partway through installation, the stable bootstrap restores the previous inventory before loading the host on its next invocation. A PID lock prevents concurrent transactions. If recovery itself fails, the host stops and retains its journal for repair; it does not claim success. This protects interrupted installations, but is not a guarantee against physical disk failure.

## Publishing a signed release

The private key is deliberately outside this repository. On this publishing computer it is held under `%LOCALAPPDATA%\Paracci\YouTube Shorts Blocker\ReleaseSigning\ed25519-private.pem`, in a directory restricted to the current Windows user and SYSTEM. Back up that key securely before replacing the publishing computer. Do not commit, attach, print, or upload it.

1. Update the extension/package versions and release notes; run `npm run test:all`.
2. Stage all reviewed source changes and every new extension asset with Git. The publisher takes its inventory from `git ls-files extension` and signs the exact staged bytes, including binary assets. Unstaged changes are not part of the package.
3. Set `PARACCI_UPDATE_SIGNING_KEY` to the private key path, then run `npm run build:update`.
4. Commit/push the reviewed source, create the matching `vVERSION` tag, and publish a stable release with `dist/paracci-update.json` attached. Do not edit the package after signing. Release tag, manifest, and signed payload versions must match.
5. Check the published asset with a temporary older installation before announcing availability.

GitHub Actions is not required to sign/publish; this workflow can run locally when hosted Actions usage is unavailable. Never place the private key in a release or in the source ZIP. A release without a signed package is shown as unavailable for automatic installation.
