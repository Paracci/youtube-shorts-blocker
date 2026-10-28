# v1.15.0 — Signed GitHub Updates & Premium Detection Fix

Unpacked Windows installations can now discover stable GitHub releases automatically and install a verified update from Setup / Monitor with one click.

## New

- Daily update checks through GitHub Releases, plus a startup check when the previous result is at least a day old.
- A toolbar NEW badge and an Extension updates card with release notes, Check for updates, and Update now.
- Ed25519 publisher signatures and per-file SHA-256 verification. Unsigned packages, mismatched releases, downgraded versions, unsafe paths, and extension identity changes are rejected.
- In-place updates for extension/native-host source files, followed by an extension reload. Browser settings, blocked channels, and installed FFmpeg/yt-dlp binaries are preserved.
- Active-download protection, transactional rollback after write failures, and recovery on the next native-host launch if installation was interrupted.
- An offline signed-package publisher; GitHub Actions is not required to create releases. Trust-root updates and signing-key rotation require a manual bootstrap upgrade.

## Premium detection fix

The Premium detector now uses a manifest-declared MAIN world content script instead of loading chrome-extension://…/inject.js from the YouTube page. Nonce/source/origin checks and fail-closed handling of unknown Premium status are retained across SPA navigation.

## One-time upgrade from 1.14.x

1. Download the **full source ZIP** and copy the new files over your existing installation **in the same folder** to retain its unpacked extension ID and settings. Preserve existing generated media tools.
2. Run the updated native-host/install_host.bat once with the extension ID shown in Setup / Monitor. This enables the recovery bootstrap needed by the updater.
3. Reload the extension in chrome://extensions/, approve the new alarms permission if prompted, and reopen YouTube tabs.
4. Future signed releases can be installed using **Setup / Monitor → Extension updates → Update now**.

The signed paracci-update.json asset is consumed by the updater; it is not a ZIP to install manually. Existing 1.14.x releases cannot install the new updater automatically. Development checkouts containing .git use Git instead of automatic file replacement.

## Validation

- npm run test:all: all 93 tests passed; all 30 production JavaScript files passed syntax checks.
- Tests cover signature tampering, wrong keys, traversal, trust-root protection, downgrade rejection, generated-tool preservation, write-failure rollback, process-exit recovery, concurrent-update locks, caller restrictions, and reload behavior.
- Real signed-package Native Messaging smoke test passed in an isolated Turkish-character Windows installation: 50 installed files verified, generated media tools preserved, and successful recovery bootstrap/journal handling. Browser settings preservation follows from keeping the existing extension path/ID; a separate file marker was preserved in the smoke test.
- Browser UI checks with simulated Chrome/native responses confirmed Turkish labels and the check → available → install → completed flow, with no console errors. This is separate from the real native installation smoke test.

## GitHub Actions availability

The maintainer has reported account usage/budget restrictions that may prevent hosted verification from running. A quota-blocked check does not provide a test verdict. Local validation is listed above; actual build or test failures must be investigated separately.

See [update setup, trust model, recovery, and release publishing](https://github.com/Paracci/youtube-shorts-blocker/blob/v1.15.0/docs/UPDATES.md) for details.
