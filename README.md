# YouTube Shorts Blocker & Ultimate Downloader

A privacy-focused, premium Chrome extension designed to drastically improve your YouTube experience. Intelligently blocks unwanted Shorts channels, skips ads, hides distracting content, and provides a powerful native-feeling video and audio downloader — without ever leaving the page.

---

## ✨ Key Features

### 🛡️ Smart Blocking & Distraction-Free
- **One-Click Channel Blocking:** Instantly adds unwanted channels to your "Do not recommend" list via a custom button that blends natively into the YouTube Shorts action bar.
- **Auto Ad Skipper:** Automatically detects, mutes, and skips sponsored/ad videos in your Shorts feed.
- **Hide Shorts from Homepage:** Completely removes the Shorts shelf from your main YouTube feed via CSS injection — toggleable live from the popup.

### 📥 High-Quality Media Downloader
- **Native-Like UI:** Download buttons are injected seamlessly into both the Shorts action bar and the standard video player controls bar.
- **Browser & Native Downloads:**
  - Instantly downloads standard MP4s in your browser via direct stream URLs.
  - Connects to a **Native Companion App** (`yt-dlp`) for ultra-high-quality 4K/1080p video and pure audio (MP3) downloads directly to your machine.
- **YouTube-Styled Toast Notifications:** Non-intrusive, YouTube-themed toasts appear in the top-right corner for download progress, success, and errors.

### 🎛️ Fully Integrated Popup
- **YouTube-Native Design:** Dark-mode popup matching YouTube's exact color palette (`#0f0f0f`), typography (**Outfit**), red accent (`#ff0000`), and pill-shaped components — with a fixed sidebar navigation.
- **Real-Time Statistics:** Live-updating counters show exactly how many channels have been blocked (**blockedCount**) and how many Shorts shelves have been hidden (**hiddenCount**), with smooth number animations.
- **Granular Controls — All Four Toggles Wired to Content Script:**
  - **Master toggle** — pauses/resumes all extension activity instantly, hiding all injected buttons on the page.
  - **Block channels automatically** — shows/hides the Block button in the Shorts action bar.
  - **Hide Shorts from homepage** — toggles the CSS injection on `youtube.com/` in real time.
  - **Show download button** — shows/hides the download button in both the Shorts bar and the video player controls.
- **Native Downloader Status Badge:** Shows live connection state (`Connected` / `Not installed`) to the yt-dlp companion app.
- **Reset Statistics** — clears both the blocked and hidden counters.

### 🖥️ Setup Page
- **Premium YouTube-native setup flow** with a branded design, animated status pill, and numbered installation steps.
- **yt-dlp Updater:** Built-in update panel with a **live log console** — update the downloader engine without leaving Chrome if downloads ever start failing.

---

## 🚀 Installation Guide

### Phase 1: Chrome Extension
1. Extract this repository to a permanent folder on your computer.
2. Open `chrome://extensions/` in any Chromium-based browser (Chrome, Edge, Brave, etc.).
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the extension folder (the one containing `manifest.json`).

### Phase 2: Native Companion App (Windows — for high-quality downloads)
High-quality 4K/1080p and Audio-only downloads require the extension to communicate with `yt-dlp` via Chrome's Native Messaging API.

1. Click the extension icon in your browser toolbar to open the popup.
2. On the **Home** tab, click **Setup / Monitor**.
3. Follow the on-screen instructions on the setup page — you will be asked to run `install_host.bat` from the extension folder.
4. The script will prompt you for your Extension ID (displayed and copyable on the setup page), register the native host with Chrome, and automatically download `yt-dlp.exe`.
5. Once connected, the popup badge will show **Connected** and downloads will route through yt-dlp.

---

## 📁 File Structure

| File | Description |
|---|---|
| `manifest.json` | Extension manifest v3 — permissions: `downloads`, `nativeMessaging`, `storage`, `tabs` |
| `content.js` | Core content script — blocking, ad-skipping, download button injection, full popup integration |
| `background.js` | Service worker — native messaging bridge, install handler |
| `popup.html` | Extension popup shell |
| `popup.css` | YouTube-native popup styles (Outfit font, red/dark palette, sidebar layout) |
| `popup.js` | Popup logic — settings sync, live stats, message broadcasting to content script |
| `setup.html` | Native host setup & updater page |
| `setup.js` | Setup page logic — connection check, yt-dlp updater with live log |
| `style.css` | Content script styles — Shorts buttons, download modal, toast notifications |
| `native-host.js` | Node.js native messaging host — yt-dlp wrapper for downloading and updating |
| `install_host.bat` | Windows installer script — registers native host and downloads yt-dlp.exe |

---

## ⚙️ Technical Notes

- **Popup ↔ Content Script Communication:** All popup toggles broadcast via `chrome.tabs.sendMessage` to every open YouTube tab. The content script listens via `chrome.runtime.onMessage` and responds instantly — no page refresh required.
- **Settings Persistence:** All settings and statistics are stored locally via `chrome.storage.local`. Nothing is sent externally.
- **Stats Tracking:** `blockedCount` increments each time a channel block succeeds; `hiddenCount` increments when the homepage Shorts shelf is hidden. Both update live in the popup via `chrome.storage.onChanged`.
- **Dynamic DOM:** YouTube is a heavily dynamic SPA. The extension uses `MutationObserver` for button injection and SPA navigation detection. If a feature suddenly stops working, YouTube likely updated their DOM structure.
- **n-Parameter Descrambling:** Browser-side downloads descramble YouTube's `n` query parameter from the player JS to prevent 403 errors on direct stream URLs.
- **Codec Priority:** The yt-dlp format selector prioritises AV1 → VP9 → H.264 at the requested resolution, always merging to `.mp4` output.

---

## 🤝 Contact & Credit

Crafted with ❤️ by **Paracci**.