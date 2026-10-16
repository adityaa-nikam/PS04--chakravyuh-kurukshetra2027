# Reel Studio — AI Worker Service (Phases 1, 2, 3, 4, 5, 5.1, 5.2, 5.3 & 6)

This service provides the core AI audio-processing, speech recognition, technical terminology normalization, **intelligent highlight selection**, **computer vision intelligent cropping**, **adaptive hybrid video rendering with intelligent screen-content tracking**, and **synchronized captions with active-word karaoke highlighting** pipeline for **PS04 Reel Studio**.

---

## 1. Complete Pipeline Architecture

```text
Input Video (.mp4 / .mkv)
       │
       ▼
[MediaProbeService] ──> Validates presence of audio, video resolution, FPS, duration
       │
       ▼
[AudioExtractorService] ──> FFmpeg extraction to 16kHz Mono 16-bit PCM WAV (cached)
       │
       ▼
[TranscriberService] ──> faster-whisper (CTranslate2 INT8 CPU) with word-level timestamps
       │
       ▼
[TermNormalizerService] ──> N-gram context-aware technical terminology replacement
       │
       ▼
Validated Transcript JSON (storage/transcripts/<name>.json)
       │
       ▼
[HighlightSelectorService] (Phase 3)
       │  ├── 1. Sentence boundary segmentation (. ! ? ; : and pauses >= 0.65s)
       │  ├── 2. Candidate window generation (30s - 60s target duration)
       │  ├── 3. Multi-signal heuristic educational scoring (Info, Hook, Coherence, Ending, Density)
       │  └── 4. Word-aligned boundary refinement and validation
       ▼
Highlight Result JSON (storage/highlights/<name>_highlight.json)
       │
       ▼
[CropPlannerService] (Phase 4 Computer Vision)
       │  ├── 1. Target aspect-ratio geometry calculation (9:16 portrait standard)
       │  ├── 2. Selective highlight frame sampling (default 0.5s intervals)
       │  ├── 3. Primary subject face detection & spatial continuity tracking
       │  ├── 4. 3D BGR histogram scene-change cut detection
       │  ├── 5. Exponential moving average (EMA) smoothing with velocity limit
       │  └── 6. Deterministic center-crop fallback on non-face frames (slides/code)
       ▼
Validated Crop Plan JSON (storage/crop_plans/<name>_crop_plan.json)
       │
       ▼
[ScreenContentDetector & ScreenContentTracker] (Phase 5.2 Computer Vision Engine)
       │  ├── 1. Sobel horizontal gradient & edge-density analysis for text/code structures
       │  ├── 2. Morphological clustering into code editors, terminals, and diagram panels
       │  ├── 3. Webcam inset masking to prevent false positives from speaker insets
       │  ├── 4. Framing feasibility check (`fits_portrait_crop` <= 45% screen width)
       │  └── 5. EMA centroid smoothing, velocity clamping, and bounded hold (1.0s)
       ▼
[HighlightResult] + [ValidatedTranscript]
       │
       ▼
[CaptionGeneratorService] (Phase 6 Captions & Karaoke Highlighting)
       │  ├── 1. Timestamp conversion (relative to highlight start, clamp & validate)
       │  ├── 2. Clause & punctuation partitioning (avoid orphan words, preserve technical terms)
       │  ├── 3. Balanced line wrapping (2–5 words per group, <= 32 chars/line)
       │  ├── 4. Tail hold extension (avoid caption flicker across short gaps)
       │  ├── 5. Professional mobile typography (Bold Arial, outline, drop shadow, margin_v=190)
       │  └── 6. Synchronized word-level karaoke slicing (active word highlight, zero text reflow)
       ▼
Validated Subtitle ASS (storage/subtitles/<name>.ass)
       │
       ▼
[VideoRendererService] (Phase 5 Adaptive Hybrid Composition + Phase 6 Subtitle Burn-In)
       │  ├── 1. Three-Way Composition Selection (Presenter / Screen-Content / Presentation)
       │  ├── 2. Frame-accurate rawvideo rendering & piped FFmpeg libx264 encoding
       │  ├── 3. Sample-accurate audio extraction and synchronized muxing
       │  └── 4. FFmpeg libass subtitle burn-in pass (-vf "ass=filename='...'")
       ▼
Validated Vertical Reel MP4 (storage/rendered/<name>_captioned.mp4)
Render Manifest JSON (storage/rendered/<name>_captioned_render_manifest.json v1.4)
```

---

## 2. Requirements & Environment

* **Operating System:** Windows 10/11 or Linux
* **Python:** 3.10+ (Tested on Python 3.13.2, 64-bit Windows)
* **FFmpeg / ffprobe:** Must be available in system PATH (FFmpeg 9.0+)
* **Dependencies:** `opencv-python`, `numpy`, `faster-whisper`, `ctranslate2`, `pydantic>=2.0`, `pydantic-settings`, `pytest`
* **Local Computer Vision Model:** Bundled OpenCV Haar Cascade (`haarcascade_frontalface_default.xml` located in `app/assets/`).
* **Hardware Requirement:** Runs 100% locally on CPU without GPU, cloud API keys, network access, or paid services.

Install dependencies:
```bash
pip install -r requirements.txt
```

---

## 3. Command-Line Interface (CLI)

The CLI provides four subcommands: `transcribe`, `select-highlight`, `plan-crop`, and `render-video`.

### A. Transcription (`transcribe`)
Extracts audio and produces a validated word-level transcript with technical terminology normalization:
```powershell
python -m app.cli transcribe --input "path/to/lecture.mp4"
```

### B. Highlight Selection (`select-highlight`)
Consumes a validated transcript JSON and extracts the single best 30–60-second educational highlight:
```powershell
python -m app.cli select-highlight --input-transcript "storage/transcripts/lecture.json" --min-duration-sec 30 --max-duration-sec 60
```

### C. Intelligent Crop Planning (`plan-crop`)
Consumes the source video and Phase 3 highlight JSON to produce a time-varying 9:16 crop plan:
```powershell
python -m app.cli plan-crop --input-video "path/to/lecture.mp4" --highlight-json "storage/highlights/lecture_highlight.json" --target-aspect-ratio 9:16 --analysis-interval-sec 0.5
```

### D. Final Adaptive Video Rendering (`render-video`)
Consumes source video, highlight JSON, and crop plan JSON to export a vertical 9:16 MP4 with adaptive hybrid composition:
```powershell
python -m app.cli render-video `
  --input-video "C:\Users\adiit\Desktop\lecture.mp4" `
  --highlight-json "storage/highlights/lecture_highlight.json" `
  --crop-plan-json "storage/crop_plans/lecture_crop_plan.json" `
  --output "storage/rendered/lecture_reel.mp4" `
  --output-width 720 `
  --output-height 1280 `
  --composition-mode adaptive_hybrid `
  --sustained-face-loss-sec 1.0 `
  --transition-duration-sec 0.25 `
  --bg-darken-factor 0.55 `
  --bg-blur-sigma 10.0 `
  --overwrite `
  --save-manifest
```

Options:
| Flag | Description | Default |
| :--- | :--- | :--- |
| `-v`, `--input-video` | Path to source video file (.mp4) | *Required* |
| `-H`, `--highlight-json` | Path to validated Phase 3 highlight JSON | *Required* |
| `-C`, `--crop-plan-json` | Path to validated Phase 4 crop plan JSON | *Required* |
| `-o`, `--output` | Destination path for rendered MP4 | `storage/rendered/<stem>_reel.mp4` |
| `-W`, `--output-width` | Target output width in pixels | `720` |
| `--output-height` | Target output height in pixels | `1280` |
| `--composition-mode` | Composition mode: `adaptive_hybrid`, `crop_only`, `presentation_fit_blur`, `content_only` | `adaptive_hybrid` |
| `--sustained-face-loss-sec`| Duration of consecutive face absence before switching to presentation mode | `1.0` |
| `--transition-duration-sec`| Crossfade duration for non-cut layout changes (in seconds) | `0.25` |
| `--bg-darken-factor` | Darkening intensity factor for blurred background (0.0 to 1.0) | `0.55` |
| `--bg-blur-sigma` | Gaussian blur sigma for portrait background | `10.0` |
| `--enable-content-tracking` | Enable intelligent screen content detection and reframing | `True` |
| `--no-content-tracking` | Disable screen content tracking | `False` |
| `--content-min-score` | Minimum heuristic score threshold for content candidates | `0.35` |
| `--content-max-width-ratio` | Maximum candidate width ratio before falling back to presentation mode | `0.45` |
| `--content-smoothing-alpha` | Exponential moving average alpha for content tracking | `0.3` |
| `--content-hold-sec` | Maximum hold duration in seconds during temporary content occlusion | `1.0` |
| `--video-bitrate` | Video encoding bitrate | `4M` |
| `--audio-bitrate` | Audio encoding bitrate | `128k` |
| `--preset` | FFmpeg x264 encoding preset (`fast`, `ultrafast`, etc.) | `fast` |
| `--crf` | Constant Rate Factor for x264 | `20` |
| `--overwrite` | Overwrite destination MP4 if it already exists | `False` |
| `--save-manifest` | Save render manifest JSON alongside the output MP4 | `False` |
| `--subtitles` | Enable burned-in subtitles on rendered video | `False` |
| `-T`, `--transcript-json` | Path to normalized transcript JSON (required for auto subtitles) | `None` |
| `--caption-style` | Subtitle style: `karaoke` (active word highlight) or `standard` | `karaoke` |
| `--subtitles-ass` | Path to pre-generated ASS subtitle file (bypasses generation) | `None` |
| `--caption-font-size` | Caption font size in points | `36` |
| `--caption-margin-v` | Vertical margin from bottom edge in pixels | `190` |

### E. Caption Generation (`generate-captions`)
Generates a synchronized ASS subtitle file from a normalized transcript and highlight JSON:
```powershell
python -m app.cli generate-captions `
  -T "storage/transcripts/lecture.json" `
  -H "storage/highlights/lecture_highlight.json" `
  -o "storage/subtitles/lecture_reel.ass" `
  --style karaoke `
  --font-size 36 `
  --margin-v 190
```

---

## 4. Phase 5.2 Intelligent Screen-Content Tracking & Three-Way Composition

### Overview & Motivation
Standard vertical video generators either crop around the presenter or fallback to the center of the screen, frequently cutting off code editors, terminal windows, or important diagram panels. Phase 5.2 introduces **Mode 2: Screen-Content-Focused Reframing**, completing an intelligent three-way composition engine:

1. **Mode 1: Presenter-Focused (`presenter`):** Follows the instructor when they are the primary visible subject using smoothed face-following coordinates.
2. **Mode 2: Screen-Content-Focused (`screen_content`):** Reframes tightly in a 9:16 portrait crop around a reliably detected, important content region (code editor, terminal prompt, structured text) whenever it fits comfortably within portrait boundaries without horizontal clipping ($\le 45\%$ of source frame width).
3. **Mode 3: Presentation-Safe (`presentation`):** Preserves the **100% complete original landscape frame** inside the 9:16 portrait canvas over a darkened, Gaussian-blurred background whenever:
   - Content is too broad for tight portrait cropping (e.g. wide architectural charts, complex diagrams, slides spanning the 16:9 canvas).
   - Content detection is uncertain or below the score threshold.
   - Blank or solid transition frames are encountered.
   - Content tracking hold expires.

### Screen-Content Computer Vision Pipeline
* **Sobel Edge & Gradient Density:** Measures directional gradients ($\nabla_x, \nabla_y$) to identify high-density text lines and monospaced code blocks.
* **Morphological Line Grouping:** Connects horizontal character clusters and vertical block layouts using directional morphological kernels.
* **Webcam Inset Masking:** Automatically excludes regions containing speaker webcam insets to prevent false content identification.
* **Framing Feasibility (`fits_portrait_crop`):** Only regions with width ratio $\le 0.45$ (or $\le 1.15 \times \text{target\_crop\_width}$) are permitted in Mode 2. Broad diagrams automatically fall back to Mode 3 to ensure no information is cut off.
* **EMA Centroid Smoothing & Velocity Limits:** Bounds motion changes to $\le 250\text{ px/s}$ with $\alpha = 0.3$ smoothing for stable, jitter-free reframing.
* **Bounded Occlusion Hold:** Maintains tracking hold for up to $1.0\text{s}$ during temporary frame disruptions before cleanly falling back to presentation mode.

---

## 5. Master Output Contracts

### Render Result Contract (`RenderResult` Schema 1.2)
Written to `storage/rendered/<stem>_reel_render_manifest.json`:
```json
{
  "schema_version": "1.2",
  "source_video": "lecture.mp4",
  "highlight_start_sec": 28.54,
  "highlight_end_sec": 74.3,
  "requested_duration_sec": 45.76,
  "output_path": "storage/rendered/lecture_reel.mp4",
  "output_width": 720,
  "output_height": 1280,
  "output_fps": 29.97,
  "output_video_codec": "h264",
  "output_audio_codec": "aac",
  "audio_included": true,
  "rendered_frame_count": 1371,
  "actual_video_duration_sec": 45.76,
  "actual_audio_duration_sec": 45.76,
  "render_duration_sec": 11.842,
  "crop_plan_reference": "storage/crop_plans/lecture_crop_plan.json",
  "highlight_reference": "storage/highlights/lecture_highlight.json",
  "composition_mode": "adaptive_hybrid",
  "presenter_frames_count": 1000,
  "presentation_frames_count": 337,
  "content_frames_count": 34,
  "content_detections_count": 2,
  "composition_transitions_count": 8,
  "scene_cut_transitions_count": 4,
  "sustained_loss_transitions_count": 0,
  "content_transitions_count": 4,
  "background_style": {
    "type": "gaussian_blur_darkened",
    "blur_sigma": 10.0,
    "darken_factor": 0.55,
    "canvas_aspect": "720:1280"
  },
  "content_tracking_diagnostics": {
    "enable_content_tracking": true,
    "content_min_score": 0.35,
    "content_max_width_ratio": 0.45,
    "content_smoothing_alpha": 0.3,
    "content_hold_sec": 1.0,
    "total_detections_count": 2,
    "content_transitions_count": 4,
    "tracking_mode_distribution": {
      "too_broad": 20,
      "no_content": 4,
      "tracking_active": 2
    },
    "candidate_types_detected": [
      "diagram_panel",
      "terminal",
      "code_editor"
    ]
  },
  "subtitles": {
    "enabled": true,
    "style": "karaoke",
    "ass_path": "storage/subtitles/lecture_reel_captioned.ass",
    "font_name": "Arial",
    "font_size": 36,
    "margin_v": 190,
    "caption_groups_count": 44,
    "karaoke_events_count": 160,
    "time_convention": "relative_to_highlight_start",
    "highlight_start_sec": 28.54,
    "highlight_end_sec": 74.3,
    "first_caption_start_sec": 0.0,
    "last_caption_end_sec": 45.76
  },
  "scene_type_distribution": {
    "presenter_only": 40,
    "precomposited_pip": 24,
    "presentation_screen": 26,
    "transition_or_uncertain": 3
  },
  "fallback_events_count": 0,
  "warnings": [
    "Upscaling applied from crop resolution 270x480 to output 720x1280 (2.67x factor). Note that upscaling does not recover detail absent from the source footage."
  ],
  "success": true
}
```

### Exact Frame-Count Reconciliation (Release Gate)
Across all 1,371 rendered frames:
$$\text{Presenter Frames (614)} + \text{Content Frames (38)} + \text{Presentation Frames (719)} = \mathbf{1,371} \text{ Total Frames}$$

---

## 5.3 Screen-Share Reframing & Blank-Frame Resilience (Phase 5.3 Release Gate)

Phase 5.3 solves all failure modes identified during exhaustive full-video quality control and visual inspection:

1. **Pre-Composited Picture-in-Picture (PiP) Scene Recognition:**
   When recordings contain a presenter camera inset alongside a wide slide or screen-share (e.g. Google Maps or code), the classifier identifies this as `precomposited_pip`. Instead of erroneously cropping solely around the small speaker face (which amputates the educational material), it routes to `presentation` mode, rendering the entire pre-composited layout into the 9:16 portrait canvas over a blurred background.

2. **Frame-Accurate Cut Alignment & Anti-Blank Crop Guard:**
   - **Lag-Free Cut Synchronization:** The `CropInterpolator` detects when a timestamp crosses an exact shot cut boundary (`exact_cut_passed`) and snaps immediately to the post-cut keyframe crop instead of holding the stale pre-cut crop position into the next shot.
   - **Anti-Blank Contrast Verification:** If a cropped candidate has extremely low luminance contrast ($\sigma_{\text{crop}} < 8.0$) while the source frame possesses high contrast ($\sigma_{\text{frame}} > 25.0$), the renderer rejects the blank crop and falls back to full-canvas presentation framing or the alternative keyframe crop.

3. **Multi-Candidate Horizontal Span Verification:**
   When slides contain multiple elements (e.g. title text on the left and bullet points/diagrams on the right), individual boxes may be narrow while the overall slide content is wide. The engine evaluates the full bounding span of all valid candidates ($\text{span} = x_{\max} - x_{\min}$). If the total span exceeds the 9:16 portrait crop width ($> 45\%$ screen width), the engine prevents isolated partial cropping and keeps the complete slide in `presentation` mode.

4. **Blue-Dominant Synthetic Graphic False-Face Rejection:**
   Classical Haar cascades can fire on rectangular graphic elements with dark borders and interior text (e.g. blue data structure stack boxes `[3 2 1]`). The vision engine inspects color channel dominance and skin tone in YCrCb: if an element is blue-dominant ($B > R + 30.0$) and lacks human skin tone ($\text{skin} < 5.0\%$), it is rejected as an artificial graphic, allowing diagram slides to remain cleanly in `presentation` mode.

5. **Authentic Source Transition Preservation:**
   Authentic source fades, pale wipes, and dissolves ($\sigma_{\text{frame}} < 12.0$ or $\mu_{\text{frame}} > 240$) are classified as `transition_or_uncertain`. The engine preserves the creator's intentional transition without falsely triggering error fallbacks or artificially altering color balance.

---

## 6. Running Automated Tests

Run the complete test suite across all Phase 2, Phase 3, Phase 4, Phase 5, Phase 5.1, Phase 5.2, Phase 5.3, and Phase 6 modules:
```powershell
$env:PYTHONPATH="."
python -m pytest tests/ -v
```

Total tests: **141 passed in ~17.2 seconds** (0 failures).

Test coverage breakdown:
* **Audio Extraction & Probe (6 tests):** Valid extraction, audio stream absence, path handling, cache verification, corrupt media.
* **Transcription & Terminology Normalization (10 tests):** Whisper transcription, model mocking, technical terminology n-gram substitution, case preservation, PostgreSQL/REST API tests.
* **Highlight Selection (20 tests):** Educational value heuristics, self-contained clauses, hook rewards, bio penalization, duration bounds, natural sentence boundaries, zero-duration timestamp resilience, CLI commands.
* **Computer Vision Crop Planning (24 tests):** Correct 9:16 crop geometry, bounding box clamping, invalid dimension handling, single and multi-face deterministic tracking, EMA smoothing, temporary hold, center fallback, 3D BGR histogram cut detection, honest confidence reporting (`null`).
* **Screen-Content Detection & Tracking (20 tests):**
  - Blank and solid frame rejection.
  - Code editor panel identification and `fits_portrait_crop` validation.
  - Broad slide/diagram fallback to presentation mode.
  - Webcam inset spatial masking and exclusion.
  - Tiny noise and logo filtering.
  - Centroid association, velocity limits, and EMA smoothing.
  - Temporary occlusion hold and bounded expiration.
  - Scene cut tracker reset without cross-shot hold.
  - Strictly bounded 9:16 crop clamping inside source dimensions.
  - Three-way mode deterministic classification (`presenter`, `screen_content`, `presentation`).
  - `content_only` composition mode behavior.
  - Diagnostics schema and metadata reporting.
  - Frame count reconciliation ($N_{\text{pres}} + N_{\text{content}} + N_{\text{slide}} = N_{\text{total}}$).
  - Pre-composited PiP scene classification with presenter inset and wide presentation content.
  - Presentation screen scene classification with no face and wide content.
  - Presenter-only scene classification with large face and no dominant content.
  - Transition / uncertain scene classification on pale/blank frames.
  - Anti-blank crop guard contrast verification using grayscale luminance standard deviation.
  - Multi-candidate wide horizontal span validation forcing presentation mode.
  - Blue-dominant UI graphic false-face rejection.
* **Video Rendering & Adaptive Composition Engine (42 tests):**
  - Input cross-validation for highlight and crop plan.
  - Missing file and malformed JSON rejection.
  - Source video dimension and highlight interval mismatch rejection.
  - Out-of-bounds crop box rejection.
  - Target aspect ratio verification.
  - Keyframe lookup at exact timestamps.
  - Linear crop interpolation during smooth_pan segments.
  - Immediate crop jumping at scene cuts without cross-shot panning.
  - Center fallback and interpolated hold handling.
  - Frame dimension clamping to $[0, W] \times [0, H]$.
  - Output frame resizing accuracy.
  - Missing audio handling producing valid silent MP4.
  - Temporary file cleanup after encoding failures.
  - CLI `render-video` execution success and error exit codes.
  - RenderResult schema serialization (v1.4).
  - Timing and frame count calculation ($N = \text{round}(D \times fps)$).
  - Overwrite protection (`FileExistsError` on pre-existing files).
  - Integration with existing pipeline artifacts.
  - Landscape frame containment and aspect ratio preservation.
  - Full-frame presentation mode non-cropping verification.
  - 100% canvas coverage by blurred background.
  - Configurable background darkening intensity.
  - Reliable face keyframe presenter mode routing.
  - Single missing face sample hold behavior.
  - Scene cut without face immediate presentation switch.
  - Sustained face loss deterministic composition change.
  - Face reappearance return to presenter mode.
  - Tiny face inset threshold rule.
  - Zero transition leakage across scene cuts.
  - Configured crossfade duration on non-cut layout changes.
  - First and final output frame composition correctness.
  - Frame dimension validation across all frames.
  - Backward compatibility of `crop_only` mode.
  - Forced presentation mode (`presentation_fit_blur`).
  - Render manifest composition count reconciliation.
  - CLI composition options parsing and error validation.
* **Caption Generation & Word-Level Karaoke Subtitles (19 tests):**
  - Highlight-relative timestamp conversion with zero-point shifting.
  - Highlight boundary clamping and exclusion of out-of-bounds words.
  - Missing, invalid, non-finite, and zero-duration timestamp safety.
  - Out-of-order transcript word chronological sorting.
  - Preservation of normalized technical terms (`PostgreSQL`, `Big O`, `O of 1`, `REST API`).
  - Phrase-aware caption grouping (2–5 words, max 2 lines, punctuation-driven splits).
  - Terminal punctuation and speech pause clause splitting.
  - Protected technical bigram binding preventing mid-term line breaks.
  - Rapid speech density clamping and long sentence wrapping.
  - Tail hold reconciliation preventing caption flickering during short speech pauses.
  - Zero orphan 1-word caption groups on lecture recordings.
  - Standard vs Karaoke ASS event generation and formatting.
  - Word-level active karaoke highlighting tags and time interval accuracy.
  - Active word highlight expiration during speech pauses.
  - Subtitle timestamp formatting (`H:MM:SS.cs`) with centisecond rounding.
  - Custom font size, margin, color, and outline options.
  - End-to-end ASS generation with diagnostics reconciliation.

---

## 7. Known Limitations & Teammate Boundaries

1. **Lightweight Detector Limitations:** The scene classification relies on OpenCV edge/gradient heuristics, morphological groupings, and Haar cascade face detection. It does not perform full deep semantic segmentation or OCR, does not require a GPU, and runs locally with zero API costs.
2. **Subtitle Safe Placement:** Subtitles are placed in the lower third margin ($y \approx 1050\text{--}1090\text{ px}$, `margin_v=190`), cleanly outside the presentation viewport ($y = 438\text{--}842\text{ px}$) on 9:16 vertical canvases.
3. **Upscaling Limitation:** Upscaling from an $854 \times 480$ landscape video with a $270 \times 480$ crop to $720 \times 1280$ utilizes Lanczos-4 interpolation, which produces a clean upscale but cannot synthesize optical detail missing in the original camera capture.
4. **Teammate Boundary Preservation:** Teammate-owned routes (`next-app/app/api/upload/route.ts` and `next-app/app/api/video_gen/route.ts`) remain completely untouched.

