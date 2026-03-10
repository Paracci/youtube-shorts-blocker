# YouTube Shorts Blocker & Ultimate Downloader

A privacy-focused, premium Chrome extension designed to drastically improve your YouTube experience. It intelligently blocks unwanted Shorts, removes ads, hides distracting content, and provides a powerful, native-feeling video and audio downloader without leaving the page.

## ✨ Key Features

### 🛡️ Smart Blocking & Distraction Free
- **One-Click Channel Blocking:** Instantly add unwanted channels to your "Do not recommend" list with a custom button that flawlessly blends into the YouTube Shorts UI.
- **Auto Ad Skipper:** Automatically detects, mutes, and skips sponsored/ad videos in your Shorts feed.
- **Hide Shorts from Homepage:** A toggleable feature in the extension popup that completely removes the "Shorts Shelf" from your main YouTube homepage, protecting your focus.

### 📥 High-Quality Media Downloader
- **Native-Like UI:** Download buttons are injected seamlessly into the native YouTube video and Shorts player controls.
- **Blob & Native Downloads:** 
  - Downloads standard MP4s instantly in your browser.
  - Optionally connects to a **Native Companion App (`yt-dlp`)** to download ultra-high-quality (4K/1080p Desktop) video and pure audio files directly to your machine.
- **YouTube-Styled Notifications:** Get rich, non-intrusive toast notifications (with video thumbnails) that appear in the top right corner indicating download progress, success, or errors—exactly like YouTube's official design.

### 🎨 Premium Extension Popup
- **Fully YouTube-Themed:** The extension popup features a sleek, dark-mode design matching YouTube's exact color palette (`#0f0f0f`), typography (Roboto), and pill-shaped components.
- **Real-Time Statistics:** Track exactly how many annoying channels you've successfully blocked.
- **Live Settings:** Toggle the blocker, adjust homepage preferences, or monitor your native downloader status in real time.

---

## 🚀 Installation Guide

### Phase 1: Installing the Chrome Extension
1. Save or extract this repository to a safe, permanent location on your computer.
2. Open your Chromium-based browser (Chrome, Edge, Brave, etc.) and navigate to `chrome://extensions/`.
3. Enable **"Developer mode"** in the top right corner.
4. Click **"Load unpacked"** in the top left.
5. Select the folder containing this extension (the folder with the `manifest.json` file).

### Phase 2: Installing the Companion Downloader App (Windows)
To enable high-quality 4K/1080p and Audio-only downloads, the extension needs to communicate with `yt-dlp` using Chrome's Native Messaging API.

1. Open the extension popup by clicking the extension icon in your browser toolbar.
2. Click the **"Setup / Monitor Settings"** button on the Home tab.
3. You will be guided to run the `install_host.bat` script located in the extension folder.
4. Running this script registers the native host with Chrome and automatically downloads `yt-dlp.exe` for you.
5. Keep the command prompt open while downloading videos!

---

## ⚙️ Technical Details & Notes
- **Permissions:** The extension requires `storage` (for settings), `nativeMessaging` (for the downloader app), and `scripting`/`host permissions` for youtube.com.
- **Storage:** All your settings and blocker stats are saved locally via `chrome.storage.local`.
- **Dynamic DOM:** The extension relies heavily on observing YouTube's Web DOM structure via `MutationObserver`. If a feature suddenly stops working, YouTube likely updated their UI.

## 🤝 Contact & Credit
Designed to emulate native YouTube aesthetics and improve digital wellbeing. 

Crafted with ❤️ by **Paracci**.
