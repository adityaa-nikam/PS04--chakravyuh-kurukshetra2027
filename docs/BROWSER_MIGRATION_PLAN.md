# Browser-Only Video Pipeline Migration Plan
**Date:** Oct 18, 2026 · **Branch:** `browser`

## Executive Summary
**Verdict:** Moving the reel pipeline (transcribe, highlight, crop, caption, render, export) into the browser is feasible. Three items need a product decision or a benchmark first: YouTube ingestion, word-level Whisper quality, and Safari/Firefox encoding.

### What the repo actually does (verified)
- The FastAPI worker (`services/ai-worker/app/main.py`) runs one background thread per job: `yt-dlp` download, `ffprobe`, `ffmpeg` to 16 kHz WAV, `faster-whisper` base.en, regex term normalisation, heuristic highlight scoring, OpenCV Haar-cascade face tracking for 9:16 crops, a frame-by-frame OpenCV compositor piped to `ffmpeg libx264`, and `libass` caption burn-in.
- The only external AI is OpenRouter, called from Python in `highlight_selector.py`: `inception/mercury-decide` to score each candidate clip, and a free `nvidia/nemotron` chat model for a title and caption. Both fall back to heuristics when no key is set.
- There is no YOLO, MediaPipe, torch, ONNX or scene-detection library in this repo. Object detection is a 2001-era Haar cascade plus Sobel/morphology heuristics. That makes the browser port easier than assumed.

### What can run in the browser
- Everything except the OpenRouter calls and YouTube download. Decoding and encoding use **WebCodecs**, vision runs in a **Web Worker**, and Whisper runs through **ONNX Runtime Web** / **Transformers.js**. The highlight, caption, term and crop logic is plain algorithmic code that ports directly to TypeScript.
- Only transcript text excerpts (about 400 characters per candidate) need to reach the AI API, through a thin authenticated Next.js proxy route. No video or audio leaves the client device.

### Blockers and key findings
1. **YouTube import cannot move to the browser.** `yt-dlp` needs a server, and the browser cannot fetch YouTube streams directly due to CORS and browser sandboxing. The target client-only pipeline keeps local-file input (`<input type="file">` / File System Access API).
2. **Authentication requirement:** Need session-based auth for Next.js API endpoints before proxying any third-party AI keys.
3. **`/api/ai/video` path traversal security risk:** Path query parameter must be restricted to canonical `storage/rendered/` paths only.
4. **`/api/video_gen` is a separate Remotion server pipeline:** Requires decision on whether to retire or render in-browser using WebCodecs + canvas capture.

---

## 1. Processing Feasibility Matrix

| # | Stage | Today (Python/Server) | Browser Technology | Model / Algorithm Port | Offline Capable? |
|---|---|---|---|---|---|
| 1 | Local File Access | Upload to server | `<input type="file">`, `File.slice()` | Streaming chunks | Yes |
| 2 | YouTube Download | `yt-dlp` server-side | Infeasible client-side (CORS) | Local files only / optional server fetch | No |
| 3 | Media Probing | `ffprobe` | `mediabunny` or `mp4box.js`, `VideoDecoder.isConfigSupported` | JS Demuxer | Yes |
| 4 | Audio Extraction (16kHz WAV) | `ffmpeg` | WebCodecs `AudioDecoder` or `decodeAudioData` + `OfflineAudioContext` | Resampler | Yes |
| 5 | Speech Transcription | `faster-whisper` (CPU int8) | Transformers.js / ONNX Runtime Web (`whisper-base.en` / `tiny.en`) in Web Worker (WebGPU/WASM) | ONNX Whisper + cross-attention DTW word timestamps | Yes |
| 6 | Voice Activity Detection (VAD) | Silero inside faster-whisper | Silero VAD ONNX / Web Audio energy gate | ONNX | Yes |
| 7 | Term Normalization | Regex & JSON vocabulary | TypeScript regex port | Direct port | Yes |
| 8 | Sentence Segmentation & Candidates | Python heuristics | TypeScript port in Web Worker | Direct port | Yes |
| 9 | Heuristic Scoring | Python weighted rules | TypeScript port | Direct port | Yes |
| 10 | Mercury Decide Score | OpenRouter API (6s timeout) | Thin authenticated Next.js proxy (sending 400-char excerpt only) | Server-gated | No (has heuristic fallback) |
| 11 | Title & Caption Gen | OpenRouter LLM chat | Same proxy route | Server-gated | No (has template fallback) |
| 12 | Face Detection | OpenCV Haar cascade | OpenCV.js Haar Cascade or MediaPipe BlazeFace | WebAssembly | Yes |
| 13 | Subject Tracking & Smooth Crop | Python math/heuristics | TypeScript port | Direct port | Yes |
| 14 | Scene Change Detection | OpenCV 16^3 histogram correlation | TypeScript on downscaled `ImageData` | Direct port | Yes |
| 15 | Screen Content Detection | OpenCV Sobel, morphology, contours | OpenCV.js or pure JS canvas analysis | Direct port | Yes |
| 16 | Frame Sampling (4 fps) | `cv2.VideoCapture.set(POS_MSEC)` | WebCodecs linear decode of highlight window at 4 fps | Linear window scan | Yes |
| 17 | 9:16 Composition & Blur | OpenCV frame-by-frame | `OffscreenCanvas` 2D / WebGL2 in Worker | Canvas blur & draw | Yes |
| 18 | Brand Overlay & Presets | OpenCV alpha blend | `CanvasRenderingContext2D.drawImage` | Direct port | Yes |
| 19 | Subtitles & Karaoke | `ffmpeg` `libass` | Canvas text rendering per-frame with bundled fonts | Direct port | Yes |
| 20 | H.264 Video Encode | `ffmpeg` `libx264` (CRF 20) | WebCodecs `VideoEncoder` (`avc1`) + `mp4-muxer` | Hardware/Software WebCodecs | Yes |
| 21 | AAC Audio Encode & Mux | `ffmpeg` | WebCodecs `AudioEncoder` or fallback | Muxer | Yes |

---

## 2. Target Browser Architecture

```
Browser Tab
+--------------------------------------------------------------+
| Main Thread (React UI)                                       |
|  usePipeline() -> PipelineController                         |
|  Progress, Cancel, Capability Check, Preview <video>         |
+---------+---------------+----------------+-------------------+
          | postMessage   | postMessage    | postMessage
   +------v------+  +-----v--------+  +----v----------------+
   | probe+audio |  | transcribe   |  | vision + render     |
   | worker      |  | worker       |  | worker              |
   | demux,      |  | Silero VAD,  |  | decode, sample,     |
   | resample    |  | Whisper ONNX |  | face/crop, canvas   |
   |             |  | WebGPU/WASM  |  | composite, encode   |
   +-------------+  +--------------+  +----+----------------+
   IndexedDB / OPFS: checkpoints, transcript cache, model cache
          |                                  |
          | fetch (JSON, excerpts only)      | TUS (final MP4)
+---------v----------------------------------v-----------------+
| Next.js (Lightweight Coordinator, No GPU Worker)             |
|  Auth (Supabase) | /api/ai/score | /api/ai/caption           |
|  /api/publish/instagram | headers (COOP/COEP if needed)      |
+---------+----------------------------------+-----------------+
          v                                  v
      OpenRouter                     Supabase Storage + DB
  (the only AI API)                  -> Instagram Graph API
```

---

## 3. Phased Implementation Roadmap

### Phase 0: Baseline & Security Stop-Gaps
1. Lock down `/api/ai/video` against arbitrary path traversal (allow only canonical `storage/` paths).
2. Establish baseline test fixtures from representative video samples (short, presenter, slides, screen-share).
3. Review and secure Supabase upload policies.

### Phase 1: Browser Proof-of-Concept & Benchmark Lab (`app/lab/page.tsx`)
1. Implement `capabilities.ts` detecting WebCodecs (`VideoEncoder`, `AudioEncoder`), WebGPU adapter, device memory.
2. Build lab test for:
   - WebCodecs decode -> 9:16 `OffscreenCanvas` composite -> H.264 encode via `mp4-muxer`.
   - Whisper ONNX (Transformers.js) in Web Worker on WebGPU vs WASM.
   - Face detection benchmark (OpenCV.js Haar vs MediaPipe BlazeFace).

### Phase 2: No-AI Client Stages & Canvas Renderer
1. Demuxing & Audio extraction via `mediabunny` / Web Audio.
2. Pure TypeScript ports of `CropInterpolator`, `CompositionRenderer`, `CaptionGrouping`, and `BrandManager`.
3. WebCodecs encoding loop with back-pressure (`encodeQueueSize` control and `frame.close()`).

### Phase 3: Local Whisper Transcription & Vision
1. Web Worker for Whisper ONNX + VAD with incremental progress events.
2. TypeScript ports of `PrimarySubjectTracker`, `CropSmoother`, `SceneChangeDetector`, `ScreenContentDetector`.
3. IndexedDB caching for transcripts and job checkpoints.

### Phase 4: AI API Proxy
1. Authenticated Next.js route proxies `/api/ai/score` and `/api/ai/caption` calling OpenRouter with prompt templates and timeouts.
2. Add user consent toggle ("Use AI to rank clips").

### Phase 5: UI Unification & Publishing Integration
1. Wire `usePipeline` hook into `app/page.tsx`.
2. Connect completed client-side MP4 `Blob` directly to Supabase TUS upload and Instagram Publisher.

### Phase 6: Decommissioning & Cleanup
1. Deprecate and remove `services/ai-worker`.
2. Clean up obsolete server dependencies and update documentation.
