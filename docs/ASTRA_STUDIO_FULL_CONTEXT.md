# ASTRA STUDIO — Complete Master Context & Specification (Phases 1 to 7)

> **Document Purpose:** Single source of truth for **Astra Studio**. Paste this file into any AI agent, LLM, or developer session to provide 100% complete technical and architectural context without needing prior conversation transcripts.

---

## 1. Executive Summary & Product Vision

### What is Astra Studio?
**Astra Studio** is an AI-powered workstation designed specifically for educators, technical instructors, and coding creators. It solves a major creator bottleneck: turning long, horizontal (16:9) lecture recordings into engaging, brand-consistent vertical (9:16) short-form reels for Instagram, YouTube Shorts, and TikTok.

### The 3 Core Pillars of Astra Studio:
1. **Lecture-to-Reel Engine (Completed Core Worker):** Automatically ingests raw lecture footage, transcribes speech with technical term correction, selects the single most valuable 30–60 second pedagogical "Aha!" moment, dynamically tracks the speaker and active code/slides using computer vision, overlays synchronized karaoke subtitles, and brands the final vertical video with custom logos and color themes.
2. **AI Explainer Video Generator (Teammate 3 Branch):** Enables creators without raw footage to generate an educational explainer reel from scratch using a text prompt/script, automated voiceover, and motion slides.
3. **One-Click Instagram Reel Publisher (Teammate 2 Branch):** Seamlessly publishes the rendered vertical reel directly to a creator's connected Instagram professional account with automated AI captions, hashtags, and thumbnail selection.

---

## 2. System Architecture & Tech Stack

The project is structured as a high-performance monorepo:

```
PS04--chakravyuh-kurukshetra2027/
├── next-app/                      # Next.js 15+ (App Router) / React 19 / Tailwind CSS v4 Frontend (Port 3000)
│   ├── app/                       # App router pages, layouts, and API routes
│   │   ├── api/                   # Upload, Instagram publish, and video gen proxies
│   │   └── page.tsx               # Main Astra Studio workstation dashboard
│   ├── components/                # Modular UI components (Studio, Explainer, Instagram modal)
│   └── lib/                       # API clients, hooks, and helper functions
│
├── services/ai-worker/            # Python 3.13 AI Engine & FastAPI Service (Port 8000)
│   ├── app/
│   │   ├── config.py              # Centralized environment, paths, and algorithm settings
│   │   ├── schemas.py             # Strict Pydantic contracts for every pipeline phase
│   │   ├── main.py                # FastAPI REST API & background thread pipeline executor
│   │   ├── cli.py                 # Multi-command CLI for independent phase verification
│   │   └── services/              # Pure modular service implementations (Phases 1-7)
│   │       ├── media_probe.py             # Phase 1: FFprobe metadata validation
│   │       ├── audio_extractor.py         # Phase 1: 16kHz mono WAV extraction
│   │       ├── transcriber.py             # Phase 2: faster-whisper word-level speech recognition
│   │       ├── term_normalizer.py         # Phase 2: Technical vocabulary regex replacement
│   │       ├── highlight_selector.py      # Phase 3: Pedagogical moment scoring
│   │       ├── crop_planner.py            # Phase 4: Computer vision 9:16 keyframe tracking
│   │       ├── screen_content_detector.py # Phase 5.1/5.2: Code editor/terminal detection
│   │       ├── caption_generator.py       # Phase 6: Karaoke ASS subtitle generator
│   │       ├── brand_manager.py           # Phase 7: Brand profiles & logo overlay engine
│   │       └── video_renderer.py          # Phase 5/7: FFmpeg adaptive hybrid compositor
│   ├── config/brands/             # Built-in reusable JSON brand profiles
│   │   ├── educational_default.json
│   │   ├── tech_modern.json
│   │   └── minimal_dark.json
│   ├── vocabulary/
│   │   └── technical_terms.json   # Curated technical term correction dictionary
│   └── tests/                     # Comprehensive test suite (171/171 passing)
│
├── storage/                       # Centralized runtime artifact storage
│   ├── raw/                       # Uploaded horizontal input videos (.mp4)
│   ├── audio/                     # Extracted 16kHz mono audio (.wav)
│   ├── transcripts/               # Validated transcript contracts (.json)
│   ├── highlights/                # Highlight moment decisions (.json)
│   ├── crop_plans/                # 9:16 crop keyframe trajectories (.json)
│   ├── subtitles/                 # Generated ASS subtitle files (.ass)
│   ├── rendered/                  # Final vertical MP4 reels & manifests
│   └── jobs/                      # Pipeline job state snapshots (.json)
│
└── run_cli.py                     # Root CLI wrapper for developer convenience
```

---

## 3. Phase-by-Phase Technical Walkthrough (Phases 1 to 7)

### Phase 1: Media Probing & Audio Extraction
- **Services:** `MediaProbeService` (`app/services/media_probe.py`), `AudioExtractorService` (`app/services/audio_extractor.py`)
- **Functionality:** 
  - Runs non-blocking `ffprobe` to extract width, height, FPS, duration, video codec, audio sample rate, and audio channel count.
  - Validates that the media has a valid audio stream before processing.
  - Extracts audio into a normalized **16kHz mono 16-bit PCM WAV** file using FFmpeg (`-vn -acodec pcm_s16le -ar 16000 -ac 1`).
  - Supports smart caching (reuses existing WAV if mtime is newer than source video).

### Phase 2: Speech Recognition & Technical Term Normalization
- **Services:** `TranscriberService` (`app/services/transcriber.py`), `TermNormalizerService` (`app/services/term_normalizer.py`)
- **Functionality:**
  - Uses `faster-whisper` (`base.en` or `small` on CPU with `int8` quantization) to produce word-level timestamps.
  - Bypasses PyAV `av.open()` bugs on Windows Python 3.13 by reading standard PCM WAV waveforms directly through Python's native `wave` module.
  - Separates word streams into `raw_words` (verbatim ASR output) and `display_words` (corrected output).
  - Uses `vocabulary/technical_terms.json` to normalize misrecognized technical expressions and acronyms (e.g., *"big o of n"* $\rightarrow$ `O(n)`, *"sequel"* $\rightarrow$ `SQL`, *"pie torch"* $\rightarrow$ `PyTorch`, *"kubernetes"* $\rightarrow$ `Kubernetes`).
  - Outputs validated `ValidatedTranscript` conforming to schema `1.0`.

### Phase 3: Pedagogical Highlight Selection
- **Service:** `HighlightSelectorService` (`app/services/highlight_selector.py`)
- **Functionality:**
  - Segments display words into sentences and evaluates candidate windows between **30.0s and 60.0s** (target **45.0s**).
  - Computes a multi-dimensional pedagogical score based on:
    1. *Information Value (25%):* Presence of concept definitions, technical terms, and educational keywords.
    2. *Self-Containment (20%):* Completeness of thought, lack of dangling pronouns/referents at boundaries.
    3. *Opening Hook (20%):* Strong introductory problem statement or conceptual question.
    4. *Ending Quality (15%):* Clean boundary sentence closure without mid-word or mid-sentence cutoffs.
    5. *Speech Density & Cadence (10%):* Natural speaking cadence (2.0–3.8 words/sec), low filler words.
    6. *ASR Confidence (10%):* Average model confidence score.
    7. *Duration Penalty:* Exponential penalty for clips deviating from optimal length.
  - Outputs a validated `HighlightResult` with exact start and end timestamps.

### Phase 4: Computer Vision & Intelligent 9:16 Crop Planning
- **Service:** `CropPlannerService` (`app/services/crop_planner.py`)
- **Functionality:**
  - Samples video frames across the highlight window at fixed intervals (default `0.5s` or `4 FPS`).
  - Employs local OpenCV Haar cascades (`FaceDetector`) to locate instructor faces.
  - `PrimarySubjectTracker` tracks the primary speaker across frames with spatial continuity and a 2-frame loss hold before falling back to centered framing.
  - Exponential Moving Average (EMA) smoother (`CropSmoother`) prevents camera jitter while enforcing a maximum pan velocity limit.
  - `SceneChangeDetector` detects shot cuts and forces instantaneous crop transitions (`transition: "cut"`) instead of pans.
  - Outputs `CropPlanResult` detailing pixel bounding boxes, normalized coordinates, and tracking modes (`face_following`, `interpolated_hold`, `center_fallback`).

### Phase 5: Video Rendering Engine & Adaptive Hybrid Composition
- **Service:** `VideoRendererService` (`app/services/video_renderer.py`)
- **Functionality:**
  - Produces a frame-accurate vertical (720x1280 or 1080x1920) MP4 video with synchronized audio.
  - **Composition Modes:**
    1. `adaptive_hybrid` (Default): Dynamically balances speaker webcam framing with active technical presentation slides / code editor content.
    2. `crop_only`: Pure primary subject tracking crop.
    3. `presentation_fit_blur`: Letterboxes wide presentation in center with darkened, blurred background.
    4. `content_only`: Locks camera onto active screen elements.
  - Sub-phases **5.1 & 5.2** (`ScreenContentDetector`): Identifies high-density text regions, active code editor typing, terminal commands, and static slides.
  - Compiles full FFmpeg filter graphs using `libx264`, `aac` audio copy/encode, `yuv420p` pixel format, and `+faststart` for instant streaming.

### Phase 6: Synchronized Karaoke Captions
- **Service:** `CaptionGeneratorService` (`app/services/caption_generator.py`)
- **Functionality:**
  - Converts source transcript word timestamps to clip-relative timestamps `[0.0s, clip_duration]`.
  - Groups words into short, punchy 2-to-6 word visual captions balanced over 1 or 2 lines.
  - Respects grammatical clauses, natural pauses ($\ge 0.35$s), and keeps protected technical expressions (e.g., *"Big O"*, *"time complexity"*) on the same line.
  - Generates complaint **Advanced SubStation Alpha (ASS v4.00+)** subtitle files.
  - In `karaoke` mode, generates sub-centisecond temporal dialogue slices so only the active word illuminates in brand highlight color while maintaining rock-solid text stability without layout shift.

### Phase 7: Reusable Brand Profiles & Brand-Aware Video Rendering
- **Service:** `BrandManager` (`app/services/brand_manager.py`)
- **Functionality:**
  - Provides reusable brand profile definitions (`BrandProfile`) supporting custom logos, colors, fonts, and watermarks.
  - **3 Built-in Starter Presets:**
    - `educational_default`: Cobalt primary (`#1E40AF`), Gold active highlight (`#F59E0B`), Montserrat font, top-right logo.
    - `tech_modern`: Neon cyan primary (`#06B6D4`), Violet highlight (`#8B5CF6`), JetBrains Mono font, bottom-left logo.
    - `minimal_dark`: Pure white text (`#FFFFFF`), Emerald highlight (`#10B981`), Inter font, minimal branding.
  - **Dynamic Logo Placement & Collision Avoidance:** `BrandSceneTracker` monitors scene transitions, subtitle boundaries, and safe margins to hide or switch logo placement if overlapping key educational content.
  - Embeds brand metadata into the master **Manifest v1.5** alongside rendering diagnostics.

---

## 4. REST API Reference (FastAPI Worker — Port 8000)

The AI worker exposes clean, non-blocking REST endpoints:

### 1. Health & Features
`GET /`
```json
{
  "service": "Reel Studio AI Worker API",
  "status": "healthy",
  "version": "1.0.0",
  "supported_features": [
    "transcription",
    "term_normalization",
    "highlight_selection",
    "crop_planning_9_16",
    "karaoke_captions",
    "adaptive_hybrid_rendering",
    "brand_profiles"
  ]
}
```

### 2. Start End-to-End Pipeline
`POST /api/v1/pipeline/start`
- **Request Body:**
```json
{
  "video_path": "storage/raw/lecture.mp4",
  "job_id": "job_optional_custom_id",
  "render_video": true,
  "subtitles": true,
  "caption_style": "karaoke",
  "composition_mode": "adaptive_hybrid",
  "model_size": "base.en",
  "brand_profile": "educational_default"
}
```
- **Response (HTTP 202 Accepted):**
```json
{
  "job_id": "job_1729123456_lecture",
  "status": "PENDING",
  "message": "Pipeline job initiated. Poll /api/v1/pipeline/status/{job_id} for progress."
}
```

### 3. Poll Job Status
`GET /api/v1/pipeline/status/{job_id}`
- **Response:**
```json
{
  "job_id": "job_1729123456_lecture",
  "status": "RENDERING_VIDEO",
  "progress_pct": 85,
  "stage_message": "Rendering vertical reel with FFmpeg...",
  "media_metadata": { "duration_sec": 412.5, "width": 1920, "height": 1080 },
  "selected_highlight": {
    "start_time_sec": 28.54,
    "end_time_sec": 62.80,
    "duration_sec": 34.26,
    "topic_summary": "Understanding Constant Time Complexity with Hash Maps"
  },
  "rendered_video_path": "storage/rendered/lecture_reel_branded.mp4",
  "subtitles_ass_path": "storage/subtitles/lecture_captioned.ass"
}
```
*(Status progresses: `PENDING` $\rightarrow$ `EXTRACTING_AUDIO` $\rightarrow$ `TRANSCRIBING` $\rightarrow$ `NORMALIZING_TERMS` $\rightarrow$ `SELECTING_MOMENT` $\rightarrow$ `PLANNING_CROPS` $\rightarrow$ `GENERATING_CAPTIONS` $\rightarrow$ `RENDERING_VIDEO` $\rightarrow$ `COMPLETED` / `FAILED`)*

### 4. Stream Rendered Video
`GET /api/v1/pipeline/video/{job_id}`
- Returns HTTP 200 with `video/mp4` binary stream once status is `COMPLETED`.

### 5. List All Jobs
`GET /api/v1/pipeline/jobs`
- Returns array of active in-memory and persisted disk jobs.

---

## 5. Teammate Features & Integration Contracts

### Teammate 2: Direct Instagram Reel Publishing
- **Endpoint:** `POST /api/instagram/publish`
- **Request Body:**
```typescript
interface InstagramPublishRequest {
  video_url_or_path: string;       // URL or local storage path of rendered reel
  caption: string;                 // AI-suggested or creator-edited post text
  hashtags: string[];              // e.g. ["#computerscience", "#coding", "#reels"]
  cover_timestamp_sec?: number;    // Frame timestamp for reel cover thumbnail
}
```
- **UI Element:** Prominent "Publish to Instagram Reel" button with official Instagram gradient styling below the video preview. Opens a modal with caption editing, hashtag pills, and instant publish action.

### Teammate 3: Text-to-Video AI Explainer Generator
- **Endpoint:** `POST /api/video_gen`
- **Request Body:**
```typescript
interface VideoGenRequest {
  prompt: string;                  // e.g. "Explain how QuickSort chooses its pivot"
  script?: string;                 // Optional explicit script override
  duration_sec: number;            // 30, 45, or 60
  visual_style: string;            // "motion_graphics" | "whiteboard" | "dark_tech"
  voice_id: string;                // Narrator voice selection
}
```
- **UI Element:** Dedicated "AI Explainer Generator" tab allowing creators without existing video footage to create full educational shorts from scratch.

---

## 6. CLI Verification Tools

All pipeline steps can be executed and tested via command line:

```powershell
# Navigate to worker directory (or run from root via run_cli.py)
cd services/ai-worker

# 1. Validate Brand Profile
python run_cli.py validate-brand -p educational_default

# 2. Extract 16kHz WAV Audio
python run_cli.py extract-audio -v "storage/raw/lecture.mp4"

# 3. Transcribe & Normalize Speech
python run_cli.py transcribe -v "storage/raw/lecture.mp4" -m base.en

# 4. Select Pedagogical Highlight
python run_cli.py select-highlight -t "storage/transcripts/lecture.json"

# 5. Plan 9:16 Crop
python run_cli.py plan-crop -v "storage/raw/lecture.mp4" -H "storage/highlights/lecture_highlight.json"

# 6. Generate Karaoke ASS Subtitles
python run_cli.py generate-subtitles -T "storage/transcripts/lecture.json" -H "storage/highlights/lecture_highlight.json" -s karaoke --brand-profile educational_default

# 7. Render Complete Vertical Reel with Branding
python run_cli.py render-video `
  -v "storage/raw/lecture.mp4" `
  -H "storage/highlights/lecture_highlight.json" `
  -C "storage/crop_plans/lecture_crop_plan.json" `
  -T "storage/transcripts/lecture.json" `
  -o "storage/rendered/lecture_reel_branded.mp4" `
  --subtitles `
  --caption-style karaoke `
  --brand-profile educational_default `
  --composition-mode adaptive_hybrid `
  --overwrite `
  --save-manifest
```

---

## 7. Current Project Status & Health Check

- **Test Suite Status:** **171 passed** (`pytest tests/`) with 0 failures and 0 warnings.
- **Git Branch:** Currently working on branch `nikam` / `frontend`.
- **Verified Deliverables:**
  - `storage/rendered/lecture_reel_branded.mp4` successfully generated.
  - Visual contact sheet validation: `storage/rendered/inspection_phase7/phase7_brand_qc_contact_sheet.jpg`.
  - Brand-aware manifest v1.5 validated with zero schema defects.
  - FastAPI server (`app/main.py`) fully verified against service signatures.

---

## 8. Frontend Implementation Roadmap (for Next.js / `next-app`)

When building or updating the user interface in `next-app`:
1. **Design System:** Obsidian dark mode (`#09090b`), electric indigo (`#6366f1`) and cyan glow accents, glassmorphic cards, tabular timecodes.
2. **Two Primary Creation Tabs:**
   - **Tab 1: Auto-Reel Studio:** Drag-and-drop video upload $\rightarrow$ Brand preset & caption styling options $\rightarrow$ Live 6-stage animated progress tracker $\rightarrow$ Vertical smartphone reel preview player $\rightarrow$ Publish to Instagram / Download MP4.
   - **Tab 2: AI Explainer Generator:** Script/topic prompt box $\rightarrow$ Duration & voice selector $\rightarrow$ Automated generation preview.
3. **Real-Time Job Polling Hook (`usePipelineJob`):**
   - Calls `POST /api/v1/pipeline/start`.
   - Polls `GET /api/v1/pipeline/status/{job_id}` every 1.5 seconds.
   - Smoothly advances stepper through the 6 stages until `COMPLETED`.
   - Embeds video from `GET /api/v1/pipeline/video/{job_id}`.
4. **Direct Instagram Reel Modal:**
   - Triggered by "Publish to Instagram Reel" button.
   - Pre-populates AI caption and hashtags.
   - Calls `POST /api/instagram/publish` and presents confirmation toast with live link.
