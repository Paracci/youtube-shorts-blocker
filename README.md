# YouTube Shorts Blocker & Ultimate Downloader (v1.13.0)

A privacy-focused Chrome extension designed to improve your YouTube experience without sending your data to a cloud service. It blocks unwanted Shorts channels, hides distracting content, handles explicit ad states with Premium-aware safety controls, and provides a private native downloader for public single-video URLs.

> Part of the **Paracci Browser Tools** collection — privacy-first, zero telemetry, built for power users.


### 🌐 [Live Demo & Showcase](https://paracci.github.io/youtube-shorts-blocker/)
Explore the interactive landing page to see the premium UI and features in action: **[paracci.github.io/youtube-shorts-blocker](https://paracci.github.io/youtube-shorts-blocker/)**

---

## ✨ Key Features

### 🛡️ Smart Blocking & Distraction-Free
- **One-Click Channel Blocking:** Instantly adds unwanted channels to YouTube's "Do not recommend" list via a custom button that blends natively into the Shorts action bar. The menu interaction is invisible — no popup flashes.
- **Persistent Blocked Channel List:** Every blocked channel is stored locally with its channel ID, display name, and timestamp. The popup's **Blocked** tab lists them all, newest first — with a "Remove from list" button for local tracking management.
- **Auto Ad Skipper & Premium Compliance:** A bounded ad-blocking system that detects explicit ad markers, mutes and skips video ads, and restores media state after navigation. Premium-dependent automation is fail-closed: it stays off until a fresh boolean account result is received and remains disabled for YouTube Premium subscribers across initial loads, SPA navigations, and popup interactions.
- **Hide Shorts from Homepage:** Completely removes the Shorts shelf from your main YouTube feed via CSS injection — toggleable live from the popup.

### 📥 High-Quality Media Downloader
- **Native-Like UI:** Download buttons are injected seamlessly into both the Shorts action bar and the standard video player controls bar.
- **Standalone Downloader Page:** The popup's **Downloader** tab opens a dedicated full-page interface for public single YouTube videos, Shorts, embeds, and `youtu.be` links. It resolves metadata, shows quick profiles and advanced formats, and reports progress, speed, ETA, cancellation, and completion states.
- **Six output formats:** Native downloads support MP4, WebM, MKV, MP3, M4A, and Opus. Ready-made choices include Best MP4, 2160p, 1440p, 1080p, 720p, MP3, and M4A when those qualities are available.
- **Verified media tools:** The standalone page requires the Native Messaging host. Video/audio merging and conversion use a pinned, SHA-256-verified ffmpeg artifact; signed stream URLs, cookies, account tokens, and third-party online downloader services are never exposed to the page.
- **Custom Download Location:** Choose exactly where downloaded files are saved via the **Settings → Downloader → Download Location** panel. Click **Browse** to open Windows' modern File Explorer folder picker (Vista-style IFileOpenDialog — the same dialog used by "Save As" in any app). The selected path persists across sessions. If no custom path is set, files go to your default `Downloads` folder.
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
  - **Enable channel blocking buttons** — shows/hides the manual Block button in the Shorts action bar.
  - **Hide Shorts from homepage** — toggles the CSS injection on `youtube.com/`.
  - **Show download button** — shows/hides the download buttons.
  - **Block video ads** — enables/disables skipping logic (Premium-aware).
  - **Auto-scroll Shorts ads** — **(New)** Isolated safety toggle for automated ad-navigation behavior.
- **Native Downloader Status Badge:** Shows live connection state (`Connected` / `Not installed`) to the yt-dlp companion app.
- **Custom Download Location:** A **Browse** button in Settings opens the native Windows folder picker. The selected path is saved to `chrome.storage.local` and forwarded to the native host on every native download. Leaving it empty uses the system `Downloads` folder; browser-direct downloads remain under Chrome's normal download handling.
- **Blocked Channels Tab:** Browse, review, and remove entries from your local blocked channel history. Includes a clear note explaining that "Remove from list" is local-only — to fully unblock a channel on YouTube's side, visit [Google My Activity → YouTube feedback](https://myactivity.google.com/page?page=youtube_user_feedback).
- **Reset Statistics** — clears both counters and the full blocked channel list, protected by a native confirm dialog.

### 🖥️ Setup Page
- **Premium YouTube-native setup flow** with a branded design, animated status pill, and numbered installation steps — all fully translated into all 11 supported languages.
- **Native health checks:** The setup page reports the connection state of both `yt-dlp` and verified ffmpeg.
- **yt-dlp Updater:** Built-in update panel with a **live log console** — update the downloader engine without leaving Chrome if downloads ever start failing.

---

## 🚀 Installation Guide

### Phase 1: Chrome Extension
1. Extract this repository to a permanent folder on your computer.
2. Open `chrome://extensions/` in any Chromium-based browser (Chrome, Edge, Brave, etc.).
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the **`extension`** folder (the one containing `manifest.json`).

### Phase 2: Native Companion App (Windows — required for the standalone downloader)
The standalone Downloader page communicates with `yt-dlp` through Chrome's Native Messaging API. Video/audio merging and MP3/M4A/Opus conversion also require the verified ffmpeg runtime.

1. Click the extension icon in your browser toolbar to open the popup.
2. On the **Home** tab, click **Setup / Monitor**.
3. Follow the on-screen instructions on the setup page — you will be asked to run `install_host.bat` from the **`native-host`** folder.
4. The script will prompt you for your Extension ID (displayed and copyable on the setup page) and register the native host with Chrome.
5. If `yt-dlp.exe` is missing, the native host downloads the pinned executable and verifies its published digest before installation.
6. The setup page reports separate `yt-dlp` and ffmpeg states. Missing ffmpeg is installed atomically from the pinned HTTPS artifact only after its SHA-256 digest matches.
7. Once both checks pass, the popup and standalone page show **Connected** / **Ready** and downloads can use the selected output format.

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
│   │   ├── download.css           # Standalone downloader styles
│   │   └── ...                    # Popup and content styles
│   ├── js/
│   │   ├── i18n/
│   │   │   └── translations.js   # Shared i18n engine for all 11 languages
│   │   ├── ad-blocker.js         # Modular: skipping & hiding logic
│   │   ├── background.js         # Service worker — native messaging & bridge
│   │   ├── channel-blocker.js    # Modular: manual & auto blocking
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
│   │   ├── download.html          # Standalone native downloader page
│   │   ├── popup.html             # Popup markup — navigation and settings
│   │   └── setup.html             # Setup page markup — fully translated
│   └── manifest.json             # Extension configuration (v1.13.0)
│
├── native-host/                  # Companion app for high-quality downloads
│   ├── install_host.bat          # Windows installer & registry config
│   ├── native-host.js            # Node.js wrapper for yt-dlp, ffmpeg and folder picker
│   ├── download-policy.js         # Native-side URL validation policy
│   ├── com.paracci.youtubedownloader.json # Ignored generated host manifest
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
- **Premium Detection:** Runs in the page context via `inject.js` and accepts only explicit boolean signals: YouTube's premium flags, a logged-in false signal, or a visible Premium badge/header. Unknown results are sent as `null`; the content script never treats unknown or stale cached state as permission to enable ad automation. Messages are source- and nonce-validated, and detection is re-run on every SPA navigation.
- **Popup ↔ Content Script Communication:** All popup toggles broadcast via `chrome.tabs.sendMessage` to every open YouTube tab. The content script listens via `chrome.runtime.onMessage` and responds instantly — no page refresh required.
- **Settings & Data Persistence:** All settings, statistics, language preference, the blocked channel list, and the custom download path are stored locally via `chrome.storage.local`. Nothing is sent externally.
- **Custom Download Path:** The path chosen in the popup is forwarded to the native host as a `savePath` parameter on every native `download_video` call. If the folder does not exist it is created automatically via `fs.mkdirSync(..., { recursive: true })`. Browser-direct downloads use Chrome's normal download location because a content script cannot select an arbitrary filesystem path.
- **Folder Picker:** Clicking **Browse** triggers a `pick_folder` message to the native host, which spawns a `powershell.exe -STA` process and opens the Windows **IFileOpenDialog** COM interface (the same Vista-style File Explorer dialog used by Save As in any Windows app). The dialog opens pre-navigated to the currently configured folder. On failure, it automatically falls back to the legacy `FolderBrowserDialog`. The PowerShell script is written to a temp `.ps1` file to avoid command-line escaping issues and deleted immediately after the dialog closes.
- **Multi-Language Architecture:** `translations.js` is listed as the **first entry** in both `content_scripts.js` and every HTML page's `<script>` order — guaranteeing the `i18n` global exists before any other script runs. Language resolution order: `storage.userLang` (manual) → `chrome.i18n.getUILanguage()` (browser) → `'en'` (fallback). `applyToDOM()` walks `data-i18n` / `data-i18n-html` / `data-i18n-title` / `data-i18n-placeholder` attributes in a single pass. Chrome's `_locales/` system localises the extension's name and description in `chrome://extensions/` independently.
- **Blocked Channel Tracking:** Each blocked channel is stored as `{ id, name, blockedAt }`. The counter reflects unique channels only — blocking the same channel twice does not inflate the count. Channel IDs are extracted from `/channel/UCxxx` links; `@handle` is used as a fallback.
- **"Don't recommend" vs. local list:** Clicking Block sends YouTube's own feedback signal. The local list is for your reference only. To remove the YouTube-side filter, visit [Google My Activity → YouTube feedback](https://myactivity.google.com/page?page=youtube_user_feedback) and delete the relevant entries.
- **Ad Blocker Strategy:** Uses CSS for confirmed feed/banner ad slots and a scoped `MutationObserver` for explicit player/Shorts ad markers. Shorts navigation targets the active renderer and removes only confirmed overlay content; it never hides the entire Shorts player. Media mute/playback-rate changes are restored when the ad state ends or the feature is disabled. For Premium subscribers all ad-related logic is disabled at the state level before this runs.
- **In-player Download Flow:** Buttons already present on YouTube pages can use the browser-side stream path for formats available directly in the player. The standalone Downloader intentionally uses the native host so merging, conversion, custom paths, and cancellation remain under one controlled flow.
- **Memory Management:** `IntersectionObserver` entries are unobserved as soon as their target element is detached from the DOM, preventing unbounded growth as YouTube recycles `ytd-reel-video-renderer` nodes during scrolling.
- **SPA Navigation:** A debounced `MutationObserver` on `document` handles nested renderer additions and relevant attribute changes for homepage visibility, channel controls, ad state, and download buttons. Premium re-detection also fires on every `yt-navigate-finish` event with a fresh nonce-bound page-context script.
- **URL Policy:** `download-policy.js` accepts only HTTPS public single-video URLs on `youtube.com`, its supported subdomains, and `youtu.be`. It rejects credentials, playlists, channel/search routes, malformed IDs, excessive URL length, and non-YouTube hosts at three independent boundaries.
- **Standalone Native Protocol:** `download.html` communicates through a dedicated `runtime.connect({ name: 'download-page' })` port. Requests carry scoped `requestId`/`jobId` values, and background routing never broadcasts one page's format or progress state to another page.
- **Safe Format Selection:** The page receives normalized metadata only (`id`, type, extension, dimensions, FPS, codecs, size, and audio/video flags). Signed `googlevideo.com` stream URLs and raw yt-dlp arguments never cross into the page.
- **Native Conversion:** The native host maps approved profile IDs or normalized format IDs to safe argv arrays, automatically pairs video-only streams with audio, and uses ffmpeg for merging and MP3/M4A/Opus conversion. Playlist mode remains disabled.
- **ffmpeg provenance:** The native host downloads only the pinned HTTPS BtbN FFmpeg-Builds archive (`autobuild-2026-08-11-13-11`, `ffmpeg-n8.1.2-34-g9b6c8969e0-win64-gpl-shared-8.1.zip`), verifies SHA-256 `e9d24d8cdd3c2aab4bc5923839d777b693d72a5cb6152bf61c263454b9023dd6` before installation, and keeps generated binaries under the ignored `native-host/ffmpeg/` directory. The selected shared build is GPL-licensed; review the upstream FFmpeg and build-distribution licenses before redistribution.

---

## ✅ Validation and Test Commands

The repository includes a dependency-free Node.js test harness for the extension, landing demo, service worker, URL policy, native host, Native Messaging framing, and download notification flows. Node.js 18 or newer is recommended.

```powershell
npm run test:syntax   # syntax-check every shipped production JavaScript file
npm test              # run unit and native-host protocol tests
npm run test:all      # run both commands above
```

The suite covers accepted and rejected YouTube URLs, format normalization and safe argv construction, folder-opening and download-page request isolation, cancellation and retry state, fixed activity-panel rendering, all 11 locale contracts, MV3/local asset references, Premium fail-closed behavior, Shorts shelf accounting, landing-demo states, and Native Messaging framing. Native protocol tests do not download media, contact YouTube, open Explorer, or install generated binaries. A manual real-browser pass should still be performed for Chrome-extension permissions, YouTube DOM changes, and final desktop/mobile visual QA.

---

## 🔒 Privacy

- No data is collected, stored, or transmitted to any third party.
- All settings, statistics, language preference, and the blocked channel list are stored locally in your browser via `chrome.storage.local`.
- The extension contacts YouTube only for active download requests. The native host may contact GitHub only to retrieve the pinned `yt-dlp.exe` or ffmpeg artifacts, and verifies the published digest before installation.
- No cookies, account tokens, signed stream URLs, or third-party online downloader services are used.
- All processing happens entirely on your device.

---

## 📜 License

This project is licensed under the MIT License — see the `LICENSE` file for details.

---

## 🤝 Contact & Credit

Crafted with ❤️ by **Paracci**.

Part of the **Paracci Browser Tools** collection — check out the [Live Demo](https://paracci.github.io/youtube-shorts-blocker/) or visit [X Auto Ad Blocker](https://github.com/paracci/x-auto-ad-blocker).
