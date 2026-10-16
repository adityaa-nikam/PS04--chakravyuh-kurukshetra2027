# PS04 Reel Studio — Pipeline Integration Documentation

This document defines the interface contracts between:
1. **Teammate 1 (Upload Module):** Ingests raw lecture video.
2. **Our Pipeline (AI Worker & /api/cropping):** Transcribes with word timestamps, corrects tech terms, identifies single winning educational moment (30–60s), tracks active screen regions, and outputs smooth 9:16 crop keyframes.
3. **Teammate 2 (Video Rendering Module):** Consumes the highlight cut, dynamic crop plan, and synchronized captions to render the final 9:16 vertical MP4.

---

## 1. Timestamp & Coordinate Conventions

To guarantee mathematical consistency and prevent off-by-one errors:

* **Source Video Timestamps (`start_abs_sec`, `end_abs_sec`):**
  Absolute floating-point seconds from the beginning of the original recording (e.g. `312.40s`).
* **Highlight Window (`start_time_sec`, `end_time_sec`):**
  Defines the exact cut interval: $[T_{start}, T_{end}]$ where $30.0 \le (T_{end} - T_{start}) \le 60.0$.
* **Relative Timestamps (`timestamp_rel_sec`):**
  Relative floating-point seconds from the start of the selected clip ($t_{rel} = t_{abs} - T_{start}$). The clip always starts at $t_{rel} = 0.00$.
* **Normalized Coordinate System (`crop_box_norm`):**
  All bounding boxes are expressed as normalized floats in the range $[0.0, 1.0]$ relative to source dimensions:
  $$x_{min} = \frac{X_{pixel}}{W_{source}}, \quad y_{min} = \frac{Y_{pixel}}{H_{source}}$$
  $$width = \frac{W_{pixel}}{W_{source}}, \quad height = \frac{H_{pixel}}{H_{source}}$$
  Target vertical aspect ratio is strictly 9:16:
  $$\frac{width \cdot W_{source}}{height \cdot H_{source}} = \frac{9}{16} = 0.5625$$

---

## 2. Interface 1: Upload Module -> Analysis Pipeline

When Teammate 1 saves an uploaded video (e.g., to `storage/raw/<filename>.mp4`), trigger the analysis pipeline:

### HTTP Request
```http
POST /api/cropping
Content-Type: application/json

{
  "videoPath": "storage/raw/lecture_k8s.mp4",
  "jobId": "job_reel_101"
}
```

### HTTP Response (202 Accepted)
```json
{
  "success": true,
  "jobId": "job_reel_101",
  "status": "PENDING",
  "message": "Analysis job initiated. Poll /api/cropping/[jobId] for progress."
}
```

### Polling Status
```http
GET /api/cropping/job_reel_101
```

---

## 3. Interface 2: Pipeline Handoff -> Video Rendering Engine

When the pipeline completes (`status: "COMPLETED"`), Teammate 2's rendering engine (`/api/video_gen`) receives or reads the complete `PipelineHandoffPackage`:

```json
{
  "job_id": "job_reel_101",
  "status": "COMPLETED",
  "media_metadata": {
    "filename": "lecture_k8s.mp4",
    "filepath": "c:/Users/.../storage/raw/lecture_k8s.mp4",
    "duration_sec": 894.25,
    "width": 1920,
    "height": 1080,
    "fps": 30.0,
    "has_audio": true,
    "audio_sample_rate": 16000,
    "audio_channels": 1,
    "video_codec": "h264",
    "audio_codec": "aac"
  },
  "selected_highlight": {
    "clip_id": "clip_win_01",
    "start_time_sec": 312.40,
    "end_time_sec": 357.80,
    "duration_sec": 45.40,
    "pedagogical_score": 0.887,
    "topic_summary": "Kubernetes Pod networking and service discovery",
    "boundary_reasoning": "Starts after pause at 'Now watch what happens when we expose the service'; ends at resolved clause."
  },
  "transcript_words": [
    {
      "word": "Now",
      "start_rel_sec": 0.12,
      "end_rel_sec": 0.35,
      "start_abs_sec": 312.52,
      "end_abs_sec": 312.75,
      "confidence": 0.98,
      "is_technical_term": false
    },
    {
      "word": "kubectl",
      "raw_asr_word": "cube ctl",
      "start_rel_sec": 0.38,
      "end_rel_sec": 0.92,
      "start_abs_sec": 312.78,
      "end_abs_sec": 313.32,
      "confidence": 0.96,
      "is_technical_term": true,
      "term_id": "k8s_kubectl"
    }
  ],
  "crop_plan": {
    "clip_id": "clip_win_01",
    "aspect_ratio": "9:16",
    "target_resolution": {
      "width": 1080,
      "height": 1920
    },
    "interpolation_mode": "cubic_ease_in_out",
    "keyframes": [
      {
        "timestamp_rel_sec": 0.00,
        "timestamp_abs_sec": 312.40,
        "crop_box_norm": {
          "x_min": 0.185,
          "y_min": 0.000,
          "width": 0.3164,
          "height": 1.000
        },
        "active_region_type": "code_editor_active_line",
        "detection_confidence": 0.92,
        "is_fallback": false,
        "transition": "cut"
      },
      {
        "timestamp_rel_sec": 8.50,
        "timestamp_abs_sec": 320.90,
        "crop_box_norm": {
          "x_min": 0.220,
          "y_min": 0.000,
          "width": 0.3164,
          "height": 1.000
        },
        "active_region_type": "code_editor_typing",
        "detection_confidence": 0.95,
        "is_fallback": false,
        "transition": "smooth_pan"
      }
    ],
    "safe_fallback": {
      "crop_box_norm": {
        "x_min": 0.200,
        "y_min": 0.000,
        "width": 0.3164,
        "height": 1.000
      }
    }
  },
  "subtitles_ass_path": "storage/subtitles/job_reel_101.ass",
  "code_overlays": []
}
```

---

## 4. How the Rendering Engine Consumes Crop Keyframes

Teammate 2 can render the video using either:

### Option A: FFmpeg Dynamic Crop Filter
For piecewise pans between keyframes, Teammate 2 can construct an expression using `ffmpeg -vf`:
```bash
# Example crop filter using linear interpolation between keyframes
ffmpeg -ss 312.40 -to 357.80 -i storage/raw/lecture_k8s.mp4 \
  -vf "crop=w=in_h*9/16:h=in_h:x='min(max(0, ...), in_w - out_w)':y=0,scale=1080:1920" \
  -c:v libx264 -crf 20 -c:a aac storage/rendered/job_reel_101.mp4
```

### Option B: Remotion / Canvas
In Remotion, the camera position can interpolate smoothly between `keyframe[i].crop_box_norm` and `keyframe[i+1].crop_box_norm` using `interpolate(frame, [k1, k2], [x1, x2], { easing: Easing.bezier(...) })`.

---

## 5. Local Runtime Storage Layout

All runtime files are placed in `storage/` and are excluded from Git:
```text
storage/
├── test_samples/   <- Place test recording: lecture.mp4
├── raw/            <- Ingested source MP4s
├── audio/          <- Extracted 16kHz mono WAVs
├── transcripts/    <- Cached JSON transcripts with word timings
├── highlights/     <- Selected moment metadata
├── frames/         <- Sampled analysis frames
├── crop_plans/     <- Generated 9:16 framing keyframes
├── overlays/       <- Syntax-highlighted code graphics
├── rendered/       <- Final 9:16 output videos
└── jobs/           <- Job status records
```
