# YouTube Shorts Blocker & Ultimate Downloader

A privacy-focused, premium Chrome extension designed to drastically improve your YouTube experience. Intelligently blocks unwanted Shorts channels, skips ads, hides distracting content, and provides a powerful native-feeling video and audio downloader — without ever leaving the page.

> Part of the **Paracci Browser Tools** collection — privacy-first, zero telemetry, built for power users.


### 🌐 [Live Demo & Showcase](https://paracci.github.io/youtube-shorts-blocker/)
Explore the interactive landing page to see the premium UI and features in action: **[paracci.github.io/youtube-shorts-blocker](https://paracci.github.io/youtube-shorts-blocker/)**

---

## ✨ Key Features

### 🛡️ Smart Blocking & Distraction-Free
- **One-Click Channel Blocking:** Instantly adds unwanted channels to YouTube's "Do not recommend" list via a custom button that blends natively into the Shorts action bar. The menu interaction is invisible — no popup flashes.
- **Persistent Blocked Channel List:** Every blocked channel is stored locally with its channel ID, display name, and timestamp. The popup's **Blocked** tab lists them all, newest first — with a "Remove from list" button for local tracking management.
- **Auto Ad Skipper:** Automatically detects, mutes, and skips sponsored/ad videos in your Shorts feed.
- **Hide Shorts from Homepage:** Completely removes the Shorts shelf from your main YouTube feed via CSS injection — toggleable live from the popup.

### 📥 High-Quality Media Downloader
- **Native-Like UI:** Download buttons are injected seamlessly into both the Shorts action bar and the standard video player controls bar.
- **Browser & Native Downloads:**
  - Instantly downloads standard MP4s in your browser via direct stream URLs.
  - Connects to a **Native Companion App** (`yt-dlp`) for ultra-high-quality 4K/1080p video and pure audio (MP3) downloads directly to your machine.
- **Custom Download Location:** Choose exactly where downloaded files are saved via the **Settings → Downloader → Download Location** panel. Click **Browse** to open Windows' modern File Explorer folder picker (Vista-style IFileOpenDialog — the same dialog used by "Save As" in any app). The selected path persists across sessions. If no custom path is set, files go to your default `Downloads` folder.
- **Correct Filenames:** Downloaded files are named after the actual video title, not a generic placeholder.
- **Stacked Toast Notifications:** Multiple downloads can run simultaneously with individual YouTube-themed toasts — each with its own progress, success/error state, and dismiss button. New toasts stack without overlapping.
- **Download Deduplication:** Starting the same download twice (same video + quality) is silently rejected — both in the extension and the native host.

### 🌍 Multi-Language Support
- **11 Languages:** English, Türkçe, Deutsch, Français, Español, Português, Italiano, Русский, 日本語, 한국어, 中文 — every UI element, button label, toast notification, modal text, and setup page string is fully translated.
- **Automatic Detection:** On first run the extension reads the browser's UI language (`chrome.i18n.getUILanguage()`) and selects the closest supported language automatically.
- **Manual Override:** A language selector in the **Settings** page lets you switch languages instantly. The choice persists across sessions via `chrome.storage.local`. Setting it back to *Auto (Browser)* re-enables automatic detection.
- **Zero Flash:** `i18n.init()` is awaited before any DOM text is rendered in both the popup and the setup page, so the correct language appears on the very first paint.
- **Consistent Architecture:** The same shared `translations.js` engine is used by the popup, the setup page, and the content script — keeping all 200+ string keys in one place and ensuring content-script notifications match the popup language.

### 🎛️ Fully Integrated Popup
- **YouTube-Native Design:** Dark-mode popup matching YouTube's exact color palette (`#0f0f0f`), typography (**Outfit**), red accent (`#ff0000`), and pill-shaped components — with a fixed sidebar navigation.
- **Real-Time Statistics:** Live-updating counters show how many unique channels have been blocked and how many Shorts shelves have been hidden, with smooth number animations.
- **Granular Controls — All Four Toggles Wired to Content Script:**
  - **Master toggle** — pauses/resumes all extension activity instantly, hiding all injected buttons on the page.
  - **Block channels** — shows/hides the Block button in the Shorts action bar.
  - **Hide Shorts from homepage** — toggles the CSS injection on `youtube.com/` in real time.
  - **Show download button** — shows/hides the download button in both the Shorts bar and the video player controls.
- **Native Downloader Status Badge:** Shows live connection state (`Connected` / `Not installed`) to the yt-dlp companion app.
- **Custom Download Location:** A **Browse** button in Settings opens the native Windows folder picker. The selected path is saved to `chrome.storage.local` and forwarded to the native host on every download. Leaving it empty uses the system `Downloads` folder. If a custom path is set but the native host is not connected, browser downloads fall back to `Downloads\YouTube\`.
- **Blocked Channels Tab:** Browse, review, and remove entries from your local blocked channel history. Includes a clear note explaining that "Remove from list" is local-only — to fully unblock a channel on YouTube's side, visit [Google My Activity → YouTube feedback](https://myactivity.google.com/page?page=youtube_user_feedback).
- **Reset Statistics** — clears both counters and the full blocked channel list, protected by a native confirm dialog.

### 🖥️ Setup Page
- **Premium YouTube-native setup flow** with a branded design, animated status pill, and numbered installation steps — all fully translated into all 11 supported languages.
- **yt-dlp Updater:** Built-in update panel with a **live log console** — update the downloader engine without leaving Chrome if downloads ever start failing.

---

## 🚀 Installation Guide

### Phase 1: Chrome Extension
1. Extract this repository to a permanent folder on your computer.
2. Open `chrome://extensions/` in any Chromium-based browser (Chrome, Edge, Brave, etc.).
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the **`extension`** folder (the one containing `manifest.json`).

### Phase 2: Native Companion App (Windows — for high-quality downloads)
High-quality 4K/1080p and audio-only downloads require the extension to communicate with `yt-dlp` via Chrome's Native Messaging API.

1. Click the extension icon in your browser toolbar to open the popup.
2. On the **Home** tab, click **Setup / Monitor**.
3. Follow the on-screen instructions on the setup page — you will be asked to run `install_host.bat` from the **`native-host`** folder.
4. The script will prompt you for your Extension ID (displayed and copyable on the setup page), register the native host with Chrome, and automatically download `yt-dlp.exe`.
5. Once connected, the popup badge will show **Connected** and downloads will route through yt-dlp.

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
│   ├── css/                      # Stylesheets for popup & content scripts
│   ├── js/
│   │   ├── i18n/
│   │   │   └── translations.js   # Shared i18n engine — all 200+ strings for 11 languages
│   │   ├── background.js         # Service worker — native messaging & download routing
│   │   ├── content.js            # Content script — blocking, downloading, notifications
│   │   ├── popup.js              # Popup logic — settings, stats, language switcher
│   │   └── setup.js              # Setup page logic — connection check, yt-dlp updater
│   ├── views/
│   │   ├── popup.html            # Popup markup — four-page layout with data-i18n attributes
│   │   └── setup.html            # Setup page markup — fully translated with data-i18n attributes
│   └── manifest.json             # Extension configuration (default_locale: en)
│
├── native-host/                  # Companion app for high-quality downloads
│   ├── install_host.bat          # Windows installer & registry config
│   ├── native-host.js            # Node.js wrapper for yt-dlp + folder picker dialog
│   └── ...                       # Auto-generated bat & JSON files after install
│
├── README.md                     # Project documentation
└── LICENSE                       # Open-source license
```

---

## ⚙️ Technical Notes

- **Popup ↔ Content Script Communication:** All popup toggles broadcast via `chrome.tabs.sendMessage` to every open YouTube tab. The content script listens via `chrome.runtime.onMessage` and responds instantly — no page refresh required.
- **Settings & Data Persistence:** All settings, statistics, language preference, the blocked channel list, and the custom download path are stored locally via `chrome.storage.local`. Nothing is sent externally.
- **Custom Download Path:** The path chosen in the popup is forwarded to the native host as a `savePath` parameter on every `download_video` call. If the folder does not exist it is created automatically via `fs.mkdirSync(..., { recursive: true })`. Browser-side downloads (non-native) with a custom path set are also routed through the native host so the path is respected — falling back to `Downloads\YouTube\` only when the native host is not connected.
- **Folder Picker:** Clicking **Browse** triggers a `pick_folder` message to the native host, which spawns a `powershell.exe -STA` process and opens the Windows **IFileOpenDialog** COM interface (the same Vista-style File Explorer dialog used by Save As in any Windows app). The dialog opens pre-navigated to the currently configured folder. On failure, it automatically falls back to the legacy `FolderBrowserDialog`. The PowerShell script is written to a temp `.ps1` file to avoid command-line escaping issues and deleted immediately after the dialog closes.
- **Multi-Language Architecture:** `translations.js` is listed as the **first entry** in both `content_scripts.js` and every HTML page's `<script>` order — guaranteeing the `i18n` global exists before any other script runs. Language resolution order: `storage.userLang` (manual) → `chrome.i18n.getUILanguage()` (browser) → `'en'` (fallback). `applyToDOM()` walks `data-i18n` / `data-i18n-html` / `data-i18n-title` / `data-i18n-placeholder` attributes in a single pass. Chrome's `_locales/` system localises the extension's name and description in `chrome://extensions/` independently.
- **Blocked Channel Tracking:** Each blocked channel is stored as `{ id, name, blockedAt }`. The counter reflects unique channels only — blocking the same channel twice does not inflate the count. Channel IDs are extracted from `/channel/UCxxx` links; `@handle` is used as a fallback.
- **"Don't recommend" vs. local list:** Clicking Block sends YouTube's own feedback signal. The local list is for your reference only. To remove the YouTube-side filter, visit [Google My Activity → YouTube feedback](https://myactivity.google.com/page?page=youtube_user_feedback) and delete the relevant entries.
- **API Format Fetching — Waterfall Strategy:** The extension first tries to extract stream URLs from the page's embedded `ytInitialPlayerResponse` (zero extra requests). Only if that yields no muxed formats does it fall back through InnerTube clients in priority order: IOS → Android → TVHTML5. This significantly reduces request volume compared to fetching all four clients in parallel.
- **Quality Lock:** On Shorts pages, playback quality is locked to the highest available level. The lock binds directly to the player's `onPlaybackQualityChange` and `onVideoDataChange` events for immediate reaction, with a 10-second fallback interval for edge cases.
- **Memory Management:** `IntersectionObserver` entries are unobserved as soon as their target element is detached from the DOM, preventing unbounded growth as YouTube recycles `ytd-reel-video-renderer` nodes during scrolling.
- **SPA Navigation:** A single `MutationObserver` on `document` handles all URL-change side effects — homepage visibility, quality lock transitions, and download button injection — without spawning redundant observers.
- **Native Host Stability:** The native Node.js host uses a single persistent stdin listener with a message queue, eliminating listener accumulation across multiple messages. Downloads are deduplicated by `videoId|quality` key in both the service worker and the native host.
- **n-Parameter Descrambling:** Browser-side downloads descramble YouTube's `n` query parameter from the player JS to prevent 403 errors on direct stream URLs.
- **Codec Priority:** AV1 → VP9 → H.264 at each resolution, always merging to `.mp4` output.

---

## 🔒 Privacy

- No data is collected, stored, or transmitted to any third party.
- All settings, statistics, language preference, and the blocked channel list are stored locally in your browser via `chrome.storage.local`.
- The only external network requests are to YouTube's own APIs — and only when you actively trigger a download.
- All processing happens entirely on your device.

---

## 📜 License

This project is licensed under the MIT License — see the `LICENSE` file for details.

---

## 🤝 Contact & Credit

Crafted with ❤️ by **Paracci**.

Part of the **Paracci Browser Tools** collection — check out the [Live Demo](https://paracci.github.io/youtube-shorts-blocker/) or visit [X Auto Ad Blocker](https://github.com/paracci/x-auto-ad-blocker).