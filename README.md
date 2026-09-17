# 🎓 YouTube AI Tutor — Your Smart Visual Study Buddy for YouTube
> Turn any YouTube video into your interactive AI study companion. Ask questions, annotate frames, attach homework photos, organize revision notebooks, and export illustrated study guides — 100% Free & Privacy-Friendly.

[![Firefox Add-on](https://img.shields.io/badge/Firefox-Add--on-FF7139?style=for-the-badge&logo=firefox-browser&logoColor=white)](https://addons.mozilla.org)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?style=for-the-badge&logo=google-chrome&logoColor=white)](https://github.com/samya818/youtube-AI-extension)
[![License: MIT](https://img.shields.io/badge/License-MIT-success.svg?style=for-the-badge)](LICENSE)
[![Live Demo](https://img.shields.io/badge/Intro%20Website-Visit-6366f1?style=for-the-badge)](https://kcbluojkxicfs.kimi.page/)

---

## 🌟 What is YouTube AI Tutor?

Tired of pausing complex YouTube tutorials, switching between tabs, copying code by hand, or getting stuck on diagrams? 

**YouTube AI Tutor** gives you an instant AI tutor right beside your video. It observes the **video frames**, reads the **spoken transcript**, sees your **drawn annotations**, and can even analyze **photos of your textbook or homework sheets** uploaded directly from your computer!

---

## 🚀 Key Features

### 🔍 1. Interactive Spotlight Onboarding Guide
New to the extension? A built-in, **interactive 7-step walkthrough** highlights buttons with a pulsating spotlight ring and guides you step-by-step with practical *"Try it now!"* actions. Replay it anytime from the Settings tab.

### 📸 2. Smart Frame Capture & Canvas Annotations
* **Temporal Multi-Frame (`T-X`, `T0`, `T+X`)**: Capture progressions, movements, or algorithm animations rather than just a static image.
* **Canvas Drawing Tools**: Draw arrows, circle formulas, or write notes directly onto the video snapshot before asking the AI.
* **Non-intrusive UI**: Opens in Chrome Side Panel or Firefox popup without obstructing the YouTube player.

### 📎 3. Ask Questions & Attach Local PC Photos
* **Video + Document Analysis**: Click the small **`📎` (paperclip)** button in the chat input to attach photos of homework, handwritten notes, or textbook problems.
* **Dual Vision Context**: The AI answers your question considering both the YouTube video context and your uploaded image together!

### 📌 4. Revision Memos (0 Tokens) vs. AI Vision
* **Send to AI (`📎`)**: Sends your image to the LLM model for deep visual understanding.
* **Revision Memos (`📌 Épingler capture` & `🖼 Photo mémo`)**: Save visual references directly into your chat log at **0 token cost**. They are preserved locally and appear in your PDF/Markdown exports!

### 💬 5. Resume Past Discussions ("Continuer")
Never lose a train of thought! Open any saved notebook entry and click **`💬 Continuer`** to instantly restore the full previous discussion and ask follow-up questions right where you left off.

### 📓 6. Multi-Notebook Organization
* Organize notes by course, subject, or playlist.
* Search and filter through past discussions in real-time.
* 100% offline persistence with browser IndexedDB.

### 🖨 7. Illustrated PDF & Markdown Export
* Export clean, beautifully formatted study sheets with syntax-highlighted code, rendered LaTeX math formulas, and all your visual memo photos included.

---

## 🤖 Supported AI Models & Free Setup

YouTube AI Tutor connects directly to AI providers without markups or subscriptions. You use your own API keys:

* **Google Gemini (Recommended — 100% Free)**:
  1. Open [Google AI Studio](https://aistudio.google.com/app/apikey).
  2. Click **"Create API key"** (free, generous quota).
  3. Paste it into the extension Settings and click **Save Key**.
* **Other Providers Supported**: OpenAI (GPT-4o, GPT-4o-mini), Anthropic (Claude 3.5 Sonnet), Mistral AI, and OpenRouter.

---

## ⚡ Installation Guide

### 🦊 Firefox (Recommended & Easiest)
1. Download or clone this repository.
2. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
3. Click **"Load Temporary Add-on..."** (*Charger un module temporaire*).
4. Select `youtube-ai-tutor/manifest.json`.
5. Open any YouTube video and click the **YouTube AI Tutor** icon in your toolbar!

### 🌐 Google Chrome / Brave / Edge
1. Download or clone this repository.
2. Open Chrome and go to `chrome://extensions`.
3. Toggle **Developer mode** in the top-right corner to **ON**.
4. Click **"Load unpacked"** and select the `youtube-ai-tutor` folder.
5. Pin the extension to your toolbar.

---

## 🔒 Privacy First

* **Direct AI Connection**: All API calls are made directly from your browser to your chosen AI provider (Gemini, OpenAI, etc.). No intermediary servers read your prompts.
* **Local Storage**: Your API keys, notes, chat histories, and images are stored locally in your browser's IndexedDB.
* **Anonymous Active-User Counter**: To measure daily active users without tracking personal data, the extension sends a minimal anonymous daily ping (client UUID, browser, version). No URLs, no prompts, and no IP addresses are ever stored. You can opt out anytime in Settings.

---

## 💬 A Message from the Creator

> "I built this extension because I was tired of pausing YouTube lectures, switching tabs, and losing my train of thought. YouTube AI Tutor is completely free, your API keys stay in your browser, and I literally can't see anything you do. If you find it useful, send me some nice words! 💖"
>
> — **Samya Loukili** 📧 [samyaloukili2@gmail.com](mailto:samyaloukili2@gmail.com) • [GitHub @samya818](https://github.com/samya818)

---
*For more information, visit the official presentation page: **[kcbluojkxicfs.kimi.page](https://kcbluojkxicfs.kimi.page/)***
