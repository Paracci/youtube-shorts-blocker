# v1.16.0 — Paracci YouTube Toolkit

The project is now **Paracci YouTube Toolkit**, hosted at **Paracci/youtube-toolkit**. The name reflects its local channel filtering, Shorts controls, best-effort ad handling, high-quality video/audio downloads, and signed GitHub update workflow.

## Updated

- Project README, installation guide, repository links, GitHub Pages demo links, and release-publishing instructions.
- Product names in the popup, setup page, standalone downloader, Developer Console, landing-page previews, and all 11 extension locales.
- Package metadata, native-host display names, and update discovery/signature repository validation for Paracci/youtube-toolkit.
- Local Git origin now points to the new repository URL.

The live demo is [paracci.github.io/youtube-toolkit](https://paracci.github.io/youtube-toolkit/).

## Important: one-time migration for existing installations

**Version 1.15.0 cannot install this repository migration with its old one-click updater.** Its immutable updater pins the previous repository identity and asset URL. GitHub redirects do not satisfy that validation. Releases before v1.15.0 have no application updater.

1. Download this release's **full Source code (zip)** archive.
2. Copy its contents over your existing installation **in the same folder**, including native-host/app-updater.js, update-bootstrap.js, and update-public-key.pem. Preserve your generated FFmpeg directory and yt-dlp.exe.
3. Run native-host/install_host.bat once with your current extension ID.
4. Reload the extension in chrome://extensions/ and reopen YouTube tabs.

Future signed releases can then use the normal **Setup / Monitor → Extension updates → Update now** workflow from the new repository. The Ed25519 signing key is unchanged. The signed paracci-update.json attachment is for the updater, not a manual installation archive.

Keep the existing local installation path, Native Messaging host identifier, and legacy runtime/signing-key storage directories. Those compatibility identifiers preserve the current setup and do not change the public product name. Git checkouts use git pull rather than automatic file replacement.

## Validation

- All 93 automated tests passed; all 30 production JavaScript files passed syntax validation.
- Updater regressions verify the new repository identity and reject the old identity or old asset URL rather than trusting redirects.
- A signed-package Native Messaging smoke test updated an isolated Turkish-character Windows installation and verified all 50 installed source files while preserving generated tools and the local marker file.

## Hosted verification

The maintainer has reported account usage/budget restrictions that may prevent GitHub Actions checks from running. A quota-blocked check provides no test verdict; actual build/test failures must still be investigated separately.

See [migration and update documentation](https://github.com/Paracci/youtube-toolkit/blob/v1.16.0/docs/UPDATES.md).
