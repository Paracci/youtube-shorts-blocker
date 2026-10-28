# YouTube Shorts Blocker & Ultimate Downloader (v1.15.0)

A privacy-focused Chrome extension designed to improve your YouTube experience without sending your data to a cloud service. It blocks unwanted Shorts channels, hides distracting content, handles explicit ad states with Premium-aware safety controls, and provides a private native downloader for public single-video URLs.

> Part of the **Paracci Browser Tools** collection — privacy-first, zero telemetry, built for power users.


### 🌐 [Live Demo & Showcase](https://paracci.github.io/youtube-shorts-blocker/)
Explore the interactive landing page to see the premium UI and features in action: **[paracci.github.io/youtube-shorts-blocker](https://paracci.github.io/youtube-shorts-blocker/)**

---

## ✨ Key Features

### 🛡️ Smart Blocking & Distraction-Free

> **Ad-blocking disclaimer:** This is not a professional or guaranteed ad-blocking extension. The ad-handling system is best-effort and may be affected by changes to YouTube's page structure, player behavior, or account state. Ads may still appear, and the extension may occasionally fail to block an ad, skip incorrectly, or interfere with playback. Do not rely on it for complete or uninterrupted ad blocking.

- **One-Click Local Channel Filtering:** The custom Block button writes a verified channel ID or normalized `@handle` to the local blocklist first, so it works signed out and immediately hides matching Shorts and recommendation cards.
- **Persistent Blocked Channel List:** Every blocked channel is stored locally with its stable identity, aliases, display name, and timestamp. The popup's **Blocked** tab lists them newest first; removing an entry immediately restores matching cards in open YouTube tabs.
- **Best-Effort YouTube Sync:** When YouTube exposes the signed-in "Don't recommend channel" action, the extension attempts it after the local block. A missing menu or signed-out session never removes the local block.
- **Auto Ad Skipper & Premium Compliance:** A bounded ad-blocking system that detects explicit ad markers, mutes and skips video ads, and restores media state after navigation. Premium-dependent automation is fail-closed: it stays off until a fresh boolean account result is received and remains disabled for YouTube Premium subscribers across initial loads, SPA navigations, and popup interactions.
- **Hide Shorts from Homepage:** Completely removes the Shorts shelf from your main YouTube feed via CSS injection — toggleable live from the popup.

### 📥 High-Quality Media Downloader
- **Native-Like UI:** Download buttons are injected seamlessly into both the Shorts action bar and the standard video player controls bar.
- **Standalone Downloader Page:** The popup's **Downloader** tab opens a dedicated full-page interface for public single YouTube videos, Shorts, embeds, and `youtu.be` links. It resolves metadata, shows quick profiles and advanced formats, and reports progress, speed, ETA, cancellation, and completion states.
- **Six output formats:** Native downloads support MP4, WebM, MKV, MP3, M4A, and Opus. Ready-made choices include Best MP4, 2160p, 1440p, 1080p, 720p, MP3, and M4A when those qualities are available.
- **Verified media tools:** The standalone page requires the Native Messaging host. Video/audio merging and conversion use an upstream SHA-256-verified ffmpeg artifact; signed stream URLs, cookies, account tokens, and third-party online downloader services are never exposed to the page.
- **Custom Download Location:** Choose exactly where downloaded files are saved via the **Settings → Downloader → Download Location** panel. Click **Browse** to open Windows' modern File Explorer folder picker (Vista-style IFileOpenDialog — the same dialog used by "Save As" in any app). The selected path persists across sessions. If no custom path is set, files go to your default `Downloads` folder.
- **Global Developer Mode Diagnostics:** Enable **Developer mode** in the global Developer tools section, the Developer Console, or the standalone Downloader page. The local-only console collects bounded, redacted diagnostics from popup, YouTube content scripts, setup, download, background, and native-host flows for the current browser session. Disable it at any time; verbose yt-dlp output is only requested for developer-mode operations.
- **Correct Filenames:** Downloaded files are named after the actual video title, not a generic placeholder.
- **Stacked Toast Notifications:** Multiple downloads can run simultaneously with individual YouTube-themed toasts — each with its own progress and success/error state. New toasts stack without overlapping.
- **Download Deduplication:** Starting the same download twice (same video + quality) is silently rejected — both in the extension and the native host.

The first standalone release accepts only HTTPS public single-video URLs: `youtube.com/watch`, `youtube.com/shorts`, `youtube.com/embed`, and `youtu.be`. Playlists, channels, searches, credentials, non-HTTPS URLs, invalid video IDs, and non-YouTube sites are rejected by the page, service worker, and native host.

| Quick choice | Result |
| --- | --- |
| Best MP4 | Highest suitable video quality with audio, merged as MP4 |
| 2160p / 1440p / 1080p / 720p | Available resolution profile, selected only when the source provides it |
| MP3 | Audio-only conversion through ffmpeg |
| M4A | Audio-only container without unnecessary video data |

The advanced table exposes normalized resolution, FPS, video/audio codec, stream type, container, estimated size, and a per-format download action. WebM, MKV, and Opus are available when the resolved source formats support them.

### 🌍 Multi-Language Support
- **11 Languages:** English, Türkçe, Deutsch, Français, Español, Português, Italiano, Русский, 日本語, 한국어, 中文 — every UI element, button label, toast notification, modal text, and setup page string is fully translated.
- **Automatic Detection:** On first run the extension reads the browser's UI language (`chrome.i18n.getUILanguage()`) and selects the closest supported language automatically.
- **Manual Override:** A language selector in the **Settings** page lets you switch languages instantly. The choice persists across sessions via `chrome.storage.local`. Setting it back to *Auto (Browser)* re-enables automatic detection.
- **Zero Flash:** `i18n.init()` is awaited before any DOM text is rendered in both the popup and the setup page, so the correct language appears on the very first paint.
- **Consistent Architecture:** The same shared `translations.js` engine is used by the popup, standalone downloader, setup page, and content script — keeping shared string keys in one place and ensuring dynamic notifications match the popup language.

### 🎛️ Fully Integrated Popup
- **YouTube-Native Design:** Dark-mode popup matching YouTube's exact color palette (`#0f0f0f`), typography (**Outfit**), red accent (`#ff0000`), and pill-shaped components — with a fixed sidebar navigation.
- **Real-Time Statistics:** Live-updating counters show how many unique channels have been blocked and how many Shorts shelves have been hidden, with smooth number animations.
- **Granular Controls — All Six Toggles Wired to Content Script:**
  - **Master toggle** — pauses/resumes all extension activity instantly.
  - **Enable local channel filtering** — shows/hides the manual Block button and the saved-channel recommendation filter.
  - **Hide Shorts from homepage** — toggles the CSS injection on `youtube.com/`.
  - **Show download button** — shows/hides the download buttons.
  - **Block video ads** — enables/disables skipping logic (Premium-aware).
  - **Auto-scroll Shorts ads** — **(New)** Isolated safety toggle for automated ad-navigation behavior.
  - **Developer mode** — enables detailed, local-only diagnostics from every extension surface for troubleshooting.
- **Developer Console:** Open the dedicated Developer Console from Settings or the setup/download pages to search, filter, copy, and clear the bounded session log buffer. Sensitive URLs, tokens, cookies, local paths, and page markup are redacted before storage.
- **Native Downloader Status Badge:** Shows live connection state (`Connected` / `Not installed`) to the yt-dlp companion app.
- **Custom Download Location:** A **Browse** button in Settings opens the native Windows folder picker. The selected path is saved to `chrome.storage.local` and forwarded to the native host on every native download. Leaving it empty uses the system `Downloads` folder; browser-direct downloads remain under Chrome's normal download handling.
- **Blocked Channels Tab:** Browse, review, and remove entries from the local filter. "Remove from list" restores matching content locally in open tabs; any previously sent YouTube feedback may remain and can be reviewed in [Google My Activity → YouTube feedback](https://myactivity.google.com/page?page=youtube_user_feedback).
- **Reset Statistics** — clears both counters and the full blocked channel list, protected by a native confirm dialog.

### 🖥️ Setup Page
- **Premium YouTube-native setup flow** with a branded design, animated status pill, and numbered installation steps — all fully translated into all 11 supported languages.
- **Native health checks:** The setup page reports the connection state of both `yt-dlp` and verified ffmpeg.
- **yt-dlp Updater:** Built-in update panel with a **live log console** — update the downloader engine without leaving Chrome if downloads ever start failing.
- **Developer Console Link:** Open the global diagnostics console while checking Native Host health or yt-dlp update failures.

---

## 🚀 Installation Guide

### GitHub updates (v1.15.0+)

Setup / Monitor now checks GitHub approximately daily and shows a toolbar `NEW` badge for a verified newer release. Click **Update now** in the **Extension updates** card to install an Ed25519-signed update and reload the extension. Downloads postpone installation; settings, blocked channels, and generated media tools are preserved. Old YouTube tabs should be reopened after updating.

Existing 1.14.x users must copy the full new release over the same installation folder and run the updated `native-host/install_host.bat` **once** to enable the recovery bootstrap. Git development checkouts use Git updates. See [update setup, recovery, and publishing](docs/UPDATES.md).

### Phase 1: Chrome Extension
1. Extract this repository to a permanent folder on your computer.
2. Open `chrome://extensions/` in any Chromium-based browser (Chrome, Edge, Brave, etc.).
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the **`extension`** folder (the one containing `manifest.json`).

### Phase 2: Native Companion App (Windows — required for the standalone downloader)
The standalone Downloader page communicates with `yt-dlp` through Chrome's Native Messaging API. Video/audio merging and MP3/M4A/Opus conversion also require the verified ffmpeg runtime. Current YouTube extraction also requires Node.js 22 or newer for yt-dlp's JavaScript challenge solver.

1. Click the extension icon in your browser toolbar to open the popup.
2. On the **Home** tab, click **Setup / Monitor**.
3. Follow the on-screen instructions on the setup page — you will be asked to run `install_host.bat` from the **`native-host`** folder.
4. The script will prompt you for your Extension ID (displayed and copyable on the setup page) and register the native host with Chrome.
5. If `yt-dlp.exe` is missing, the native host downloads the current executable and verifies its published digest before installation.
6. The setup page reports separate `yt-dlp` and ffmpeg states. On first use, both the in-player buttons and standalone page install missing ffmpeg atomically over HTTPS only after its published SHA-256 digest matches; yt-dlp receives the exact local ffmpeg directory.
7. Ensure Node.js 22 or newer is installed before downloading. The native host passes its exact Node executable to yt-dlp and selects the `web_embedded` YouTube player client so current signed stream URLs can be resolved and downloaded.
8. Once both checks pass, the popup and standalone page show **Connected** / **Ready** and downloads can use the selected output format.

The extension's in-player buttons may still use the browser's normal download handling for formats available directly in the page. The standalone Downloader page is intentionally native-only so it can safely support merging, conversion, custom save paths, and the full format list.

---

## 📁 File Structure

```text
youtube-shorts-blocker/
├── extension/                    # Main unpacked extension folder
│   ├── icons/                    # Extension logos
│   ├── _locales/                 # Chrome-native locale files (extension name & description)
│   │   ├── en/messages.json
│   │   ├── tr/messages.json
│   │   ├── de/messages.json
│   │   ├── fr/messages.json
│   │   ├── es/messages.json
│   │   ├── pt/messages.json
│   │   ├── it/messages.json
│   │   ├── ru/messages.json
│   │   ├── ja/messages.json
│   │   ├── ko/messages.json
│   │   └── zh_CN/messages.json
│   ├── css/                      # Popup, content and standalone page styles
│   │   ├── developer.css          # Global Developer Console styles
│   │   ├── download.css           # Standalone downloader styles
│   │   └── ...                    # Popup and content styles
│   ├── js/
│   │   ├── i18n/
│   │   │   └── translations.js   # Shared i18n engine for all 11 languages
│   │   ├── developer-logger.js    # Opt-in client logger for extension contexts
│   │   ├── developer-log-store.js # Background redaction and session ring buffer
│   │   ├── developer-page.js      # Global Developer Console controller
│   │   ├── ad-blocker.js         # Modular: skipping & hiding logic
│   │   ├── background.js         # Service worker — native messaging & bridge
│   │   ├── channel-blocker.js    # Modular: manual & auto blocking
│   │   ├── channel-filter.js     # Local ID/handle filter for Shorts and recommendations
│   │   ├── content.js            # Entry point: coordinates modular features
│   │   ├── downloader.js         # Modular: format fetching & button injection
│   │   ├── download-page.js      # Standalone downloader page controller
│   │   ├── download-policy.js    # Extension-side single-video URL policy
│   │   ├── notifications.js      # Modular: YouTube-style stackable toasts
│   │   ├── premium-detector.js   # Modular: fail-closed, nonce-bound, SPA-safe detection
│   │   ├── shorts-hider.js       # Modular: Homepage feed hider
│   │   ├── state.js              # Persistence: reactive settings state
│   │   ├── utils.js              # Helpers: DOM & wait utilities
│   │   ├── popup.js              # Popup logic — settings, stats, switcher
│   │   ├── setup.js              # Setup page logic — connection & updater
│   │   └── old-content.js        # ARCHIVE: Monolithic v1.10.5 core (unused)
│   ├── views/
│   │   ├── developer.html         # Global Developer Console
│   │   ├── download.html          # Standalone native downloader page
│   │   ├── popup.html             # Popup markup — navigation and settings
│   │   └── setup.html             # Setup page markup — fully translated
│   └── manifest.json             # Extension configuration (v1.15.0)
│
├── native-host/                  # Companion app for high-quality downloads
│   ├── install_host.bat          # Windows installer & registry config
│   ├── native-host.js            # Node.js wrapper for yt-dlp, ffmpeg and folder picker
│   ├── download-policy.js         # Native-side URL validation policy
│   ├── com.paracci.youtubedownloader.json # Legacy ignored manifest; new installs store it outside the repo
│   ├── yt-dlp.exe                 # Ignored generated downloader runtime
│   ├── ffmpeg/                    # Ignored generated, verified ffmpeg runtime
│   │   └── ffmpeg.exe
│   └── native-host.bat             # Ignored generated launcher
│
├── landing-demo.css              # GitHub Pages downloader preview styles
├── landing-demo.js               # GitHub Pages downloader preview behavior
├── README.md                     # Project documentation
└── LICENSE                       # Open-source license
```

---

## ⚙️ Technical Notes

- **Centralized Orchestration (v1.11.5):** All DOM-based features (Shorts hiding, blocking buttons, download buttons) are triggered by a single debounced `MutationObserver` in `content.js` for maximum performance and zero resource leaks.
- **Premium Detection:** Runs through a manifest-declared `MAIN` world content script (`inject.js`) and a nonce-bound message bridge, without loading an external extension script URL. It accepts only explicit boolean signals: YouTube's premium flags, a logged-in false signal, or a visible Premium badge/header. Unknown results are sent as `null`; the content script never treats unknown or stale cached state as permission to enable ad automation. Messages are source- and nonce-validated, and detection is re-run on every SPA navigation.
- **Popup ↔ Content Script Communication:** All popup toggles broadcast via `chrome.tabs.sendMessage` to every open YouTube tab. The content script listens via `chrome.runtime.onMessage` and responds instantly — no page refresh required.
- **Settings & Data Persistence:** All settings, statistics, language preference, the blocked channel list, and the custom download path are stored locally via `chrome.storage.local`. Local filtering does not transmit channel data; optional YouTube feedback is triggered only through the current YouTube page/session.
- **Custom Download Path:** The path chosen in the popup is forwarded to the native host as a `savePath` parameter on every native `download_video` call. If the folder does not exist it is created automatically via `fs.mkdirSync(..., { recursive: true })`. Browser-direct downloads use Chrome's normal download location because a content script cannot select an arbitrary filesystem path.
- **Folder Picker:** Clicking **Browse** triggers a `pick_folder` message to the native host, which spawns a `powershell.exe -STA` process and opens the Windows **IFileOpenDialog** COM interface (the same Vista-style File Explorer dialog used by Save As in any Windows app). The dialog opens pre-navigated to the currently configured folder. On failure, it automatically falls back to the legacy `FolderBrowserDialog`. The PowerShell script is written to a temp `.ps1` file to avoid command-line escaping issues and deleted immediately after the dialog closes.
- **Multi-Language Architecture:** `translations.js` is listed as the **first entry** in both `content_scripts.js` and every HTML page's `<script>` order — guaranteeing the `i18n` global exists before any other script runs. Language resolution order: `storage.userLang` (manual) → `chrome.i18n.getUILanguage()` (browser) → `'en'` (fallback). `applyToDOM()` walks `data-i18n` / `data-i18n-html` / `data-i18n-title` / `data-i18n-placeholder` attributes in a single pass. Chrome's `_locales/` system localises the extension's name and description in `chrome://extensions/` independently.
- **Local Channel Filter:** Each blocked channel is stored as `{ id, aliases, name, blockedAt }` in `chrome.storage.local`; legacy `{ id, name, blockedAt }` entries remain valid. A stable `UC...` channel ID is preferred and a normalized `@handle` is retained as an alias. Display names are never used as matching keys.
- **Filter Scope:** Local filtering applies to Shorts, Home cards, and Watch Next/related recommendations. Search results, directly opened watch videos, channel pages, and playlist pages are intentionally preserved. Turning the extension or channel-filter setting off restores hidden renderers without deleting the blocklist.
- **"Don't recommend" vs. local filter:** Clicking Block saves the local filter before attempting YouTube's account-level feedback. The account action is best-effort and may require sign-in; its failure never rolls back the local block. Removing a local entry does not automatically delete an older YouTube signal, which can be reviewed in [Google My Activity → YouTube feedback](https://myactivity.google.com/page?page=youtube_user_feedback).
- **Ad Blocker Strategy:** Uses CSS for confirmed feed/banner ad slots and a scoped `MutationObserver` for explicit player/Shorts ad markers. Shorts navigation targets the active renderer and removes only confirmed overlay content; it never hides the entire Shorts player. Media mute/playback-rate changes are restored when the ad state ends or the feature is disabled. For Premium subscribers all ad-related logic is disabled at the state level before this runs.
- **In-player Download Flow:** Buttons already present on YouTube pages can use the browser-side stream path for formats available directly in the player. The standalone Downloader intentionally uses the native host so merging, conversion, custom paths, and cancellation remain under one controlled flow. Native yt-dlp calls explicitly enable the host's Node.js runtime and use YouTube's `web_embedded` player client to avoid the current `android_vr` stream URLs that can return HTTP 403.
- **Memory Management:** `IntersectionObserver` entries are unobserved as soon as their target element is detached from the DOM, preventing unbounded growth as YouTube recycles `ytd-reel-video-renderer` nodes during scrolling.
- **SPA Navigation:** A debounced `MutationObserver` on `document` handles nested renderer additions and relevant attribute changes for homepage visibility, channel controls, ad state, and download buttons. Premium re-detection also fires on every `yt-navigate-finish` event with a fresh nonce-bound detection request.
- **URL Policy:** `download-policy.js` accepts only HTTPS public single-video URLs on `youtube.com`, its supported subdomains, and `youtu.be`. It rejects credentials, playlists, channel/search routes, malformed IDs, excessive URL length, and non-YouTube hosts at three independent boundaries.
- **Standalone Native Protocol:** `download.html` communicates through a dedicated `runtime.connect({ name: 'download-page' })` port. Requests carry scoped `requestId`/`jobId` values, and background routing never broadcasts one page's format or progress state to another page.
- **Safe Format Selection:** The page receives normalized metadata only (`id`, type, extension, dimensions, FPS, codecs, size, and audio/video flags). Signed `googlevideo.com` stream URLs and raw yt-dlp arguments never cross into the page.
- **Native Conversion:** The native host maps approved profile IDs or normalized format IDs to safe argv arrays, automatically pairs video-only streams with audio, and uses ffmpeg for merging and MP3/M4A/Opus conversion. Playlist mode remains disabled.
- **ffmpeg provenance:** The native host resolves the maintained `ffmpeg-n8.1-latest-win64-gpl-shared-8.1.zip` asset through the official BtbN FFmpeg-Builds GitHub release API and requires its published SHA-256 digest before downloading. It verifies the archive against that digest before extraction and installs the complete binary directory (including ffprobe and DLLs) under the ignored `native-host/ffmpeg/` directory. Dated autobuild URLs are intentionally avoided because upstream removes old releases. Missing or mismatched digests stop installation. The selected shared build is GPL-licensed; review the upstream FFmpeg and build-distribution licenses before redistribution.

---

## ✅ Validation and Test Commands

The repository includes a dependency-free Node.js test harness for the extension, landing demo, service worker, URL policy, native host, Native Messaging framing, and download notification flows. Node.js 18 or newer is sufficient for the test harness; Node.js 22 or newer is required for native YouTube downloads.

```powershell
npm run test:syntax   # syntax-check every shipped production JavaScript file
npm test              # run unit and native-host protocol tests
npm run test:all      # run both commands above
```

The suite covers accepted and rejected YouTube URLs, format normalization and safe argv construction, folder-opening and download-page request isolation, cancellation and retry state, fixed activity-panel rendering, the developer logger/store redaction and session-buffer contracts, all 11 locale contracts, MV3/local asset references, Premium fail-closed behavior, Shorts shelf accounting, landing-demo states, and Native Messaging framing. Native protocol tests do not download media, contact YouTube, open Explorer, or install generated binaries. A manual real-browser pass should still be performed for Chrome-extension permissions, YouTube DOM changes, Developer Console filters/copy/clear, and final desktop/mobile visual QA.

---

## 🔒 Privacy

- No data is collected, stored, or transmitted to any third party.
- All settings, statistics, language preference, and the blocked channel list are stored locally in your browser via `chrome.storage.local`.
- The extension does not make separate account/API calls for channel blocking. If available, the optional YouTube menu action uses the current YouTube page/session; the native host may contact GitHub only to retrieve the `yt-dlp.exe` or ffmpeg release artifacts, and verifies the published digest before installation.
- No cookies, account tokens, signed stream URLs, or third-party online downloader services are used.
- All processing happens entirely on your device.
- Developer diagnostics use `chrome.storage.session` when available and fall back to memory only; logs are cleared when the browser extension session ends and are never sent to a cloud service.

---

## 📜 License

This project is licensed under the MIT License — see the `LICENSE` file for details.

---

## 🤝 Contact & Credit

Crafted with ❤️ by **Paracci**.

Part of the **Paracci Browser Tools** collection — check out the [Live Demo](https://paracci.github.io/youtube-shorts-blocker/) or visit [X Auto Ad Blocker](https://github.com/paracci/x-auto-ad-blocker).
