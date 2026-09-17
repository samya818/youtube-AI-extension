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

### 🎛️ 1. Complete Control Over AI Context & Token Budget
You are in 100% control of what information is sent to the AI model and how many tokens are used:

* **Visual Frame Control (Which & How Many Frames):**
  * **Single Frame (`T0`)**: Sends only the exact freeze-frame at the current timestamp — fast and token-efficient.
  * **Temporal Multi-Frame (`T-X`, `T0`, `T+X`)**: Sends a 3-frame sequence showing motion, step-by-step code changes, or animation progression.
  * **Frame Selection**: Pick precisely which specific frame from the timeline is passed to the AI.
  * **Text-Only Mode (`None`)**: Completely disables image sending to consume zero image tokens when you only need transcript/text answers.

* **Transcript Context Control (How Much Text Context):**
  * **Economical (30s before / 15s after)**: Compact context window for quick questions, maximizing speed and minimizing token usage.
  * **Standard (60s before / 30s after)**: Balanced default context window.
  * **Complete (120s before / 60s after)**: Deep local context for dense technical lectures.
  * **Global Video Context**: Feeds the entire video transcript to the model for whole-lecture summaries, overarching themes, or chapter breakdowns.
  * **Global + Local Hybrid**: Combines macro-level video understanding with fine-grained local context around the timestamp.
  * **Custom Time Windows**: Set your own exact seconds before and after the timestamp in Settings!

### 🔍 2. Interactive Spotlight Onboarding Guide
New to the extension? A built-in, **interactive 7-step walkthrough** highlights buttons with a pulsating spotlight ring and guides you step-by-step with practical *"Try it now!"* actions. Replay it anytime from the Settings tab.

### 📸 3. Canvas Annotations on Captured Frames
* **Visual Markup Tools**: Draw arrows, circle math formulas, or write notes directly onto the video snapshot before asking the AI.
* **Burn-in Merging**: Your hand-drawn annotations are merged directly onto the frame image, showing the AI exactly what you're pointing to.
* **Non-intrusive UI**: Opens in Chrome Side Panel or Firefox popup without obstructing the YouTube player.

### 📎 4. Ask Questions & Attach Local PC Photos
* **Video + Document Analysis**: Click the small **`📎` (paperclip)** button in the chat input to attach photos of homework, handwritten notes, or textbook problems.
* **Dual Vision Context**: The AI answers your question considering both the YouTube video context and your uploaded image together!

### 📌 5. Revision Memos (0 Tokens) vs. AI Vision
* **Send to AI (`📎`)**: Sends your image to the LLM model for deep visual understanding.
* **Revision Memos (`📌 Épingler capture` & `🖼 Photo mémo`)**: Save visual references directly into your chat log at **0 token cost**. They are preserved locally and appear in your PDF/Markdown exports!

### 💬 6. Resume Past Discussions ("Continuer")
Never lose a train of thought! Open any saved notebook entry and click **`💬 Continuer`** to instantly restore the full previous discussion and ask follow-up questions right where you left off.

### 📓 7. Multi-Notebook Organization
* Organize notes by course, subject, or playlist.
* Search and filter through past discussions in real-time.
* 100% offline persistence with browser IndexedDB.

### 🖨 8. Illustrated PDF & Markdown Export
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
