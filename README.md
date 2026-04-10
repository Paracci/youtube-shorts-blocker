# YouTube Shorts Blocker & Ultimate Downloader (v1.10.0)

A privacy-focused, compliance-first Chrome extension designed to drastically improve your YouTube experience. Intelligently blocks unwanted Shorts channels, hides distracting content, and provides a powerful native-feeling media downloader — now with automatic YouTube Premium detection and enhanced safety controls.

> Part of the **Paracci Browser Tools** collection — privacy-first, zero telemetry, optimized for power users.


### 🌐 [Live Demo & Showcase](https://paracci.github.io/youtube-shorts-blocker/)
Explore the interactive landing page to see the premium UI and features in action: **[paracci.github.io/youtube-shorts-blocker](https://paracci.github.io/youtube-shorts-blocker/)**

---

## ✨ Key Features (New in v1.10.0)

### 🛡️ Smart Blocking & Compliance
- **YouTube Premium Compliance:** Automatically detects your subscription status. Ad-blocking features are gracefully disabled for Premium users to respect YouTube's Terms of Service while allowing creators to be supported. A premium-styled banner informs you when this is active.
- **Granular Safety Controls:** High-risk automated behaviors (like **Auto-scrolling Shorts ads**) are now isolated into separate toggles. You decide exactly how much "bot-like" activity you want on your account.
- **Improved Channel Blocking Buttons:** Renamed from "Auto-block" to "Enable channel blocking buttons" to clarify that the user remains in control. A custom button is injected into the Shorts action bar for manual, one-click blocking.
- **Auto Ad Skipper (Standard):** For non-premium users, a robust system that detects, mutes, and skips ads at 16x speed to minimize interruption.

### 📥 High-Quality Media Downloader
- **Native-Like UI:** Download buttons are injected seamlessly into the Shorts action bar and standard video player controls.
- **4K/8K & Studio Audio:** Connects to a **Native Companion App** (`yt-dlp`) for ultra-high-quality downloads directly to your machine.
- **Custom Download Location:** A dedicated folder picker in Settings lets you choose your save directory across sessions.

### 🔒 Quality Lock & Optimization
- **Always Highest Detail:** Automatically forces resolution to 4K/2160p using native player APIs.
- **Performance Optimized:** Uses a centralized `MutationObserver` architecture to handle DOM changes with minimal CPU impact during long sessions.

### 🌍 Multi-Language Support
- **11 Languages:** English, Türkçe, Deutsch, Français, Español, Português, Italiano, Русский, 日本語, 한국어, 中文.
- **Automatic Detection:** Reads your browser language and sets the UI accordingly on the first run.

---

## 🚀 Installation Guide

### Phase 1: Chrome Extension
1. Extract this repository to a permanent folder.
2. Go to `chrome://extensions/` and enable **Developer mode**.
3. Click **Load unpacked** and select the **`extension`** folder.

### Phase 2: Native Companion App (For High-Quality Downloads)
1. Open the extension popup and click **Setup / Monitor**.
2. Follow the instructions to run `install_host.bat` from the **`native-host`** folder.
3. Once connected, your download capability is upgraded to full `yt-dlp` power.

---

## ⚙️ Technical Notes (v1.10.0)

- **Premium Detection:** Uses a combination of `window.postMessage` and `ytcfg` inspection in the page context to determine subscription status reliably.
- **Centralized Orchestration:** All DOM-based features (Shorts hiding, blocking buttons, download buttons) are triggered by a single debounced observer in `content.js` for maximum performance.
- **Resource Management:** Intervals for "Quality Lock" and "Downloader Polling" are now fully cleared when features are toggled OFF, preventing background resource leaks.
- **Privacy First:** All data (blocked channels, settings, path) is stored locally via `chrome.storage.local`. No external tracking.

---

## 📜 License

MIT License — see `LICENSE` for details.

---

## 🤝 Contact & Credit

Crafted with ❤️ by **Paracci**.
Check out the [Live Demo](https://paracci.github.io/youtube-shorts-blocker/) or visit [X Auto Ad Blocker](https://github.com/paracci/x-auto-ad-blocker).