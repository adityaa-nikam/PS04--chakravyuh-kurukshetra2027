# ⚡ ASTRA STUDIO

> **AI-Powered Workstation Transforming Long Technical Lectures into Viral, Brand-Consistent Vertical Reels.**

[![Next.js](https://img.shields.io/badge/Next.js-15.1-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-blue?style=for-the-badge&logo=react)](https://react.dev/)
[![Python](https://img.shields.io/badge/Python-3.13-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Whisper](https://img.shields.io/badge/faster--whisper-1.0-orange?style=for-the-badge)](https://github.com/SYSTRAN/faster-whisper)
[![Remotion](https://img.shields.io/badge/Remotion-4.0-0B84F3?style=for-the-badge&logo=remotion)](https://www.remotion.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38B2AC?style=for-the-badge&logo=tailwind-css)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.style=for-the-badge)](LICENSE)

---

## 🌟 Executive Summary

Technical educators and coding creators face a massive bottleneck: turning dense 60-minute horizontal lectures into punchy, high-retention 9:16 vertical shorts for Instagram Reels, YouTube Shorts, and TikTok takes hours of tedious manual video editing, clipping, keyframing, and subtitle typing.

**Astra Studio** solves this end-to-end. Whether starting from a **raw lecture file**, a **YouTube URL**, or simply a **text prompt**, Astra Studio automatically extracts the core pedagogical "Aha!" moment, tracks the speaker and code editor using computer vision, overlays synchronized karaoke captions, and publishes the branded short directly to Instagram with automated performance analytics.

---

## 🚀 Core Pillars & Full Feature Ecosystem

```
┌────────────────────────────────────────────────────────────────────────┐
│                          ASTRA STUDIO WORKSPACE                        │
├─────────────────────┬─────────────────────┬────────────────────────────┤
│ 1. INGESTION        │ 2. AI PIPELINE      │ 3. DISTRIBUTION & GROWTH   │
│ • Local MP4/MKV     │ • Pedagogical Score │ • Direct Instagram Publish │
│ • YouTube Importer  │ • 9:16 CV Cropping  │ • Performance Analytics    │
│ • Chrome Extension  │ • Karaoke Captions  │ • Automated Growth Insights│
│ • Prompt-to-Video   │ • Brand Identity Kit│ • WebCodecs In-Browser Lab │
└─────────────────────┴─────────────────────┴────────────────────────────┘
```

### 1. 🎬 Lecture-to-Reel Core Engine (Phases 1 – 7)
- **Phase 1: Media Probing & Audio Extraction:** High-performance FFprobe metadata validation and FFmpeg extraction to normalized 16kHz mono 16-bit PCM WAV.
- **Phase 2: Word-Level Transcription & Technical Term Normalization:** Powered by `faster-whisper` on CPU (INT8). Includes a curated n-gram technical vocabulary dictionary (`vocabulary/technical_terms.json`) that converts misheard spoken terms (e.g. *"big o of n"* $\rightarrow$ `O(n)`, *"pie torch"* $\rightarrow$ `PyTorch`, *"sequel"* $\rightarrow$ `SQL`).
- **Phase 3: Pedagogical Highlight Selection:** Multi-heuristic scoring algorithm that segments speech into candidate windows (30–60s) and ranks them based on Information Value, Concept Self-Containment, Hook Strength, and Cadence.
- **Phase 4: Computer Vision 9:16 Intelligent Crop Planner:** Detects instructor faces via Haar cascades and applies spatial continuity tracking, scene-cut boundary detection, and Exponential Moving Average (EMA) smoothing to prevent camera jitter.
- **Phase 5: Adaptive Hybrid Video Composition:** Intelligently switches layouts dynamically:
  - `presenter`: High-definition focus on the speaker.
  - `screen_content`: Zooms in on active IDE, terminal code, or slide details (`ScreenContentDetector`).
  - `presentation_fit_blur`: Beautiful blurred background letterbox for wide architectural diagrams.
- **Phase 6: Word-Level Active Karaoke Captions:** Generates ASS sub-centisecond subtitles with bold typography, line balancing (2–5 words per line), and active-word gold illumination without text shifting.
- **Phase 7: Reusable Brand Identity Kit:** Custom logos, color palettes, watermark placement, and collision-avoidance algorithms that prevent logos from covering slides or speaker faces.

---

### 2. 🧩 Browser Extension — YouTube 1-Click Importer
- **Manifest V3 Chrome Extension** (`browser-extension/`).
- Injects a native, sleek Astra Studio action button directly onto YouTube video pages.
- Allows technical creators to import any public lecture into Astra Studio with 1 click, transferring metadata, video stream, and transcript straight to the processing studio.

---

### 3. 🤖 AI Explainer Generator (Prompt-to-Reel)
- Designed for creators without existing video footage.
- **Input:** Single topic prompt (e.g., *"Explain XML vs JSON with a simple example"*).
- **Execution:** Generates a pedagogical script with LLMs (Ollama / OpenRouter), creates automated narration voiceover, and renders high-definition motion graphics, syntax-highlighted code blocks, and dynamic layout cards using **Remotion (React 19)**.

---

### 4. 📲 1-Click Instagram Reel Publisher
- Direct Meta Graph API integration.
- Automated AI caption generation complete with targeted educational hashtags.
- Thumbnail frame selector and direct publishing toast with live Instagram permalink.

---

### 5. 📊 Real-Time Instagram Analytics & Retention Insights
- **Live Metrics Dashboard:** Tracks Views, Reach, Likes, Comments, Shares, and Saves.
- **Deep Retention Analytics:** Monitors Average Watch Time, Total Watch Time, and Watch-to-Duration ratio.
- **Automated Intelligence:** Generates algorithmic health assessments, engagement rates by reach, and actionable advice to optimize future content hook and duration.

---

### 6. ⚡ In-Browser WebCodecs Processing Lab (`/lab`)
- Experimental zero-server client pipeline.
- Uses **WebCodecs**, **Canvas API**, and **MP4 muxer** directly inside the browser for client-side frame seeking, canvas composition, and reel rendering without server compute overhead.

---

## 🏗️ System Architecture

```
PS04--chakravyuh-kurukshetra2027/
├── next-app/                      # Next.js 15+ / React 19 Frontend (Port 3000)
│   ├── app/
│   │   ├── page.tsx               # Main Workstation Studio Dashboard
│   │   ├── upload/page.tsx        # Smart Video Upload & Pipeline Studio
│   │   ├── import/page.tsx        # YouTube Video Ingestion Hub
│   │   ├── analytics/page.tsx     # Instagram Reel Analytics & Growth Dashboard
│   │   ├── lab/page.tsx           # Experimental In-Browser WebCodecs Lab
│   │   └── api/                   # Pipeline proxies, Remotion renderers, Instagram API
│   ├── lib/
│   │   ├── analytics/             # Instagram Insights & Performance Analyzers
│   │   └── browser-pipeline/      # Client-side WebCodecs frame compositing
│   └── public/                    # Logos, assets, and sound designs
│
├── services/ai-worker/            # Python 3.13 FastAPI Backend Service (Port 8000)
│   ├── app/
│   │   ├── main.py                # REST API & background thread pipeline executor
│   │   ├── cli.py                 # Multi-stage CLI testing tool
│   │   ├── schemas.py             # Strict Pydantic contracts for all pipeline phases
│   │   └── services/              # Pure modular engines (MediaProbe, Transcriber, CropPlanner, etc.)
│   ├── config/brands/             # JSON brand profiles (educational_default, tech_modern, etc.)
│   └── tests/                     # 171/171 comprehensive test suite
│
├── browser-extension/             # Chrome Manifest V3 YouTube 1-Click Importer
│   ├── manifest.json              # Extension manifest & permissions
│   ├── content.js                 # Floating button injector for YouTube
│   └── popup.html                 # Extension popup controller
│
├── storage/                       # Local runtime workspace storage (transcripts, crops, reels)
└── run_cli.py                     # Convenience root CLI runner
```

---

## ⚡ Quickstart Guide

### 1. Prerequisites
- **Node.js** $\ge$ 20.x
- **Python** $\ge$ 3.11 (Python 3.13 tested)
- **FFmpeg** installed and accessible in system `PATH`

---

### 2. Frontend Setup (Next.js)

```powershell
# Navigate to frontend directory
cd next-app

# Install dependencies
npm install

# Copy environment template & configure API keys
cp .env.example .env

# Run local development server
npm run dev
```
> Access dashboard at **[http://localhost:3000](http://localhost:3000)**

---

### 3. Backend AI Worker Setup (FastAPI)

```powershell
# Open a second terminal and navigate to worker
cd services/ai-worker

# Install Python dependencies
pip install -r requirements.txt

# Start FastAPI server on Port 8000
python -m uvicorn app.main:app --reload --port 8000
```
> API documentation available at **[http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)**

---

### 4. Chrome Extension Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (top right toggle).
3. Click **Load unpacked** and select the [`browser-extension`](file:///c:/Users/adiit/PS04--chakravyuh-kurukshetra2027/browser-extension) directory.
4. Navigate to any YouTube lecture to see the Astra Studio 1-click import button!

---

## 🧪 Testing & Verification

The core Python AI engine includes a comprehensive test suite covering all 7 pipeline phases:

```powershell
cd services/ai-worker
pytest tests/ -v
# 171 passed, 0 failed, 0 warnings
```

---

## 👥 Contributors

- **Aditya Nikam** ([@adityaa-nikam](https://github.com/adityaa-nikam))
- **Aditya Bhise** ([@adityabhise1111](https://github.com/adityabhise1111))
- **Maithili W** ([@Maithili2716](https://github.com/Maithili2716))

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
