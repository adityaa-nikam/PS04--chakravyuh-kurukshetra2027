"""FastAPI Application for Reel Studio AI Worker Service.

Provides REST API endpoints for Next.js and external clients to trigger and monitor
the video processing pipeline (transcription, highlight selection, crop planning,
subtitle generation, and vertical video rendering).
"""

import json
import logging
import threading
import time
from pathlib import Path
from typing import Dict, Any, Optional, List

from fastapi import FastAPI, BackgroundTasks, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from app.config import settings
from app.schemas import (
    ValidatedTranscript,
    HighlightResult,
    CropPlan,
    RenderResult,
)
from app.services.media_probe import MediaProbeService
from app.services.audio_extractor import AudioExtractorService
from app.services.transcriber import TranscriberService
from app.services.term_normalizer import TermNormalizerService
from app.services.highlight_selector import HighlightSelectorService
from app.services.crop_planner import CropPlannerService
from app.services.caption_generator import CaptionGeneratorService, CaptionOptions
from app.services.video_renderer import VideoRendererService, RenderOptions
from app.services.youtube_downloader import YoutubeDownloaderService

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("reel_studio_api")

app = FastAPI(
    title="Reel Studio AI Worker API",
    description="Intelligent lecture highlight extraction, computer vision cropping, and vertical reel rendering.",
    version="1.0.0",
)

# Enable CORS for Next.js frontend (default ports 3000, 3001, etc.)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory thread-safe job state store
jobs_lock = threading.Lock()
job_store: Dict[str, Dict[str, Any]] = {}


# ============================================================================
# Request / Response Models
# ============================================================================

class PipelineStartRequest(BaseModel):
    video_path: Optional[str] = Field(None, description="Path to the input video file (.mp4, .mkv)")
    youtube_url: Optional[str] = Field(None, description="Direct YouTube video URL or ID to download and ingest.")
    download_quality: str = Field("360p", description="YouTube download quality: '360p', '480p', '720p', '1080p'. Default 360p.")
    job_id: Optional[str] = Field(None, description="Optional custom job ID. Generated if omitted.")
    render_video: bool = Field(True, description="Whether to render the final vertical reel MP4.")
    subtitles: bool = Field(True, description="Whether to burn in synchronized captions.")
    caption_style: str = Field("karaoke", description="Subtitle style: 'karaoke' or 'standard'.")
    composition_mode: str = Field("adaptive_hybrid", description="Adaptive hybrid composition mode.")
    model_size: str = Field("base.en", description="Whisper model size (tiny, base, small).")
    max_clips: int = Field(3, description="Maximum number of clips/topics to extract and render (1-10).")


class PipelineStartResponse(BaseModel):
    job_id: str
    status: str
    message: str


# ============================================================================
# Job Persistence Helper
# ============================================================================

def persist_job_to_disk(job_id: str, data: Dict[str, Any]) -> None:
    """Writes job status JSON to storage/jobs/<job_id>.json for persistence."""
    try:
        job_file = settings.JOBS_DIR / f"{job_id}.json"
        with open(job_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, default=str)
    except Exception as e:
        logger.warning(f"Failed to persist job {job_id} to disk: {e}")


def load_job_from_disk(job_id: str) -> Optional[Dict[str, Any]]:
    """Loads job status JSON from disk if not present in memory."""
    job_file = settings.JOBS_DIR / f"{job_id}.json"
    if job_file.exists():
        try:
            with open(job_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Failed to read job file {job_file}: {e}")
    return None


def update_job_status(
    job_id: str,
    status_code: str,
    progress_pct: int,
    stage_message: str,
    extra: Optional[Dict[str, Any]] = None,
) -> None:
    """Updates job state in memory and persists to disk."""
    with jobs_lock:
        if job_id not in job_store:
            job_store[job_id] = {
                "job_id": job_id,
                "created_at": time.time(),
            }
        
        entry = job_store[job_id]
        entry["status"] = status_code
        entry["progress_pct"] = progress_pct
        entry["stage_message"] = stage_message
        entry["updated_at"] = time.time()
        
        if extra:
            entry.update(extra)
        
        # Snapshot copy for disk write
        snapshot = dict(entry)
    
    persist_job_to_disk(job_id, snapshot)
    logger.info(f"[{job_id}] [{progress_pct}%] {status_code}: {stage_message}")


# ============================================================================
# Background Pipeline Worker
# ============================================================================

def execute_pipeline_worker(
    job_id: str,
    video_path_str: Optional[str] = None,
    render_video: bool = True,
    subtitles: bool = True,
    caption_style: str = "karaoke",
    composition_mode: str = "adaptive_hybrid",
    model_size: str = "base.en",
    max_clips: int = 3,
    youtube_url: Optional[str] = None,
    download_quality: str = "360p",
) -> None:
    """Executes the full AI pipeline asynchronously in a background thread."""
    start_time = time.time()

    try:
        # Check if input is a YouTube URL or explicit youtube_url parameter
        target_yt = youtube_url or (video_path_str if video_path_str and YoutubeDownloaderService.is_youtube_url(video_path_str) else None)

        if target_yt:
            update_job_status(
                job_id,
                "DOWNLOADING",
                3,
                f"Connecting to YouTube stream ({download_quality})...",
            )

            def _dl_progress(pct: float, msg: str):
                # Scale download progress to 3% - 15% of pipeline
                overall = int(3 + (pct / 100.0) * 12)
                update_job_status(job_id, "DOWNLOADING", overall, msg)

            dl_result = YoutubeDownloaderService.download_video(
                url_or_id=target_yt,
                output_dir=settings.RAW_DIR,
                quality=download_quality,
                progress_callback=_dl_progress,
            )
            video_path = dl_result["filepath"]
            video_title = dl_result.get("title", "YouTube Video")
            update_job_status(
                job_id,
                "INGESTING",
                15,
                f"YouTube stream ready ({download_quality}). Ingesting '{video_title}' for AI analysis...",
                {
                    "youtube_metadata": {
                        "title": video_title,
                        "id": dl_result.get("id"),
                        "duration": dl_result.get("duration"),
                        "quality": download_quality,
                    }
                }
            )
        else:
            if not video_path_str:
                raise ValueError("Neither video_path nor youtube_url was supplied.")
            video_path = Path(video_path_str).resolve()
            if not video_path.exists():
                alt_path = settings.RAW_DIR / Path(video_path_str).name
                if alt_path.exists():
                    video_path = alt_path
                else:
                    raise FileNotFoundError(f"Source video file not found at: {video_path_str}")

        stem = video_path.stem

        # Normalize composition_mode aliases
        comp_mode_map = {
            "adaptive": "adaptive_hybrid",
            "adaptive_hybrid": "adaptive_hybrid",
            "crop_only": "crop_only",
            "presenter": "crop_only",
            "presentation_fit_blur": "presentation_fit_blur",
            "content_only": "content_only",
            "screen_content": "content_only",
        }
        composition_mode = comp_mode_map.get(str(composition_mode).lower(), "adaptive_hybrid")

        # --------------------------------------------------------------------
        # Stage 1: Media Probing & Audio Extraction
        # --------------------------------------------------------------------
        update_job_status(job_id, "EXTRACTING_AUDIO", 10, "Probing media and extracting 16kHz audio...")
        media_meta = MediaProbeService.validate_for_transcription(video_path)
        
        audio_output_path = settings.AUDIO_DIR / f"{stem}.wav"
        audio_output_path = AudioExtractorService.extract_audio(
            video_path=video_path,
            output_wav_path=audio_output_path,
            force_reextract=False,
        )

        media_meta_dict = {
            "filename": video_path.name,
            "filepath": str(video_path),
            "duration_sec": media_meta.duration_sec,
            "width": media_meta.width,
            "height": media_meta.height,
            "fps": media_meta.fps,
            "has_audio": media_meta.has_audio,
            "audio_sample_rate": media_meta.audio_sample_rate,
            "audio_channels": media_meta.audio_channels,
            "video_codec": media_meta.video_codec,
            "audio_codec": media_meta.audio_codec,
        }

        # --------------------------------------------------------------------
        # Stage 2: Transcription & Technical Term Normalization
        # --------------------------------------------------------------------
        transcript_path = settings.TRANSCRIPTS_DIR / f"{stem}.json"
        
        if transcript_path.exists():
            update_job_status(job_id, "NORMALIZING_TERMS", 35, "Reusing existing validated transcript...", {
                "media_metadata": media_meta_dict
            })
            with open(transcript_path, "r", encoding="utf-8") as f:
                validated_transcript = ValidatedTranscript.model_validate_json(f.read())
        else:
            update_job_status(job_id, "TRANSCRIBING", 20, "Transcribing speech with faster-whisper...", {
                "media_metadata": media_meta_dict
            })
            normalizer = TermNormalizerService()
            transcriber = TranscriberService(
                model_size=model_size,
                device=settings.WHISPER_DEVICE,
                compute_type=settings.WHISPER_COMPUTE_TYPE,
                term_normalizer=normalizer,
            )

            def _transcription_progress(cur_sec, total_sec, text):
                sub_pct = min(100.0, (cur_sec / max(1.0, total_sec)) * 100.0)
                overall = int(20 + (sub_pct / 100.0) * 20)  # 20% to 40%
                update_job_status(
                    job_id,
                    "TRANSCRIBING",
                    overall,
                    f"Transcribing audio: {sub_pct:.1f}% ({int(cur_sec//60):02d}:{int(cur_sec%60):02d} / {int(total_sec//60):02d}:{int(total_sec%60):02d})"
                )

            validated_transcript = transcriber.transcribe(
                audio_path=audio_output_path,
                source_media_path=video_path,
                cache_transcript=True,
                force_retranscribe=False,
                progress_callback=_transcription_progress,
            )

            update_job_status(job_id, "NORMALIZING_TERMS", 45, "Technical terminology normalized.")

        # Format transcript words for handoff contract
        transcript_words_summary = [
            {
                "word": w.text,
                "start_abs_sec": w.start_sec,
                "end_abs_sec": w.end_sec,
                "confidence": w.confidence or 0.9,
                "is_technical_term": bool(w.correction and w.correction.applied),
                "term_id": w.correction.term_id if w.correction else None,
            }
            for w in validated_transcript.display_words
        ]

        # --------------------------------------------------------------------
        # Stage 3: Educational Highlight Selection (Multi-Topic with Mercury Decide)
        # --------------------------------------------------------------------
        update_job_status(job_id, "SELECTING_MOMENT", 50, f"Evaluating pedagogical topics with Mercury Decide (target {max_clips} clips)...", {
            "transcript_words": transcript_words_summary[:100],  # sample for lightweight status
        })
        
        highlight_selector = HighlightSelectorService(
            min_duration_sec=settings.HIGHLIGHT_MIN_DURATION_SEC,
            max_duration_sec=settings.HIGHLIGHT_MAX_DURATION_SEC,
            target_duration_sec=settings.HIGHLIGHT_TARGET_DURATION_SEC,
        )
        selected_highlights = highlight_selector.select_multiple_highlights(
            validated_transcript,
            max_clips=max_clips,
            use_decision_model=True
        )

        primary_highlight = selected_highlights[0]
        highlight_path = settings.HIGHLIGHTS_DIR / f"{stem}_highlight.json"
        HighlightSelectorService.save_highlight(primary_highlight, output_path=highlight_path)

        highlight_dict = {
            "clip_id": f"{stem}_hl_01",
            "start_time_sec": primary_highlight.start_sec,
            "end_time_sec": primary_highlight.end_sec,
            "duration_sec": primary_highlight.duration_sec,
            "pedagogical_score": primary_highlight.score,
            "topic_summary": primary_highlight.title or primary_highlight.transcript_excerpt[:120],
            "boundary_reasoning": primary_highlight.reason,
            "title": primary_highlight.title,
            "caption": primary_highlight.caption,
            "mercury_score": primary_highlight.mercury_score,
        }

        # --------------------------------------------------------------------
        # Stage 4 & 5: Multi-Clip 9:16 Crop Planning & Video Rendering
        # --------------------------------------------------------------------
        crop_planner = CropPlannerService(
            target_aspect_ratio="9:16",
            analysis_interval_sec=1.0 / settings.CV_SAMPLE_FPS,
            smoother_alpha=settings.CV_SMOOTHING_ALPHA,
        )

        rendered_clips = []
        primary_rendered_mp4_path = None
        subtitles_ass_path = None
        last_crop_plan = None
        num_highlights = len(selected_highlights)

        for k, hl in enumerate(selected_highlights):
            clip_num = k + 1
            clip_id = f"{stem}_hl_{clip_num:02d}"
            clip_title = hl.title or f"Highlight #{clip_num}"

            # Step 4: Crop planning for this highlight window
            crop_start_pct = int(55 + (k / num_highlights) * 15)
            update_job_status(
                job_id,
                "PLANNING_CROPS",
                crop_start_pct,
                f"Tracking subject & planning 9:16 crop for clip {clip_num}/{num_highlights}: '{clip_title}'...",
                {"selected_highlight": highlight_dict}
            )

            crop_plan_path = settings.CROP_PLANS_DIR / f"{stem}_clip_{clip_num:02d}_crop_plan.json"
            crop_plan = crop_planner.plan_crop(
                video_path=video_path,
                highlight=hl,
            )
            CropPlannerService.save_crop_plan(crop_plan, output_path=crop_plan_path)
            last_crop_plan = crop_plan

            clip_rendered_mp4 = None
            if render_video:
                render_pct = int(70 + (k / num_highlights) * 25)
                update_job_status(
                    job_id,
                    "RENDERING_VIDEO",
                    render_pct,
                    f"Rendering vertical 9:16 reel {clip_num}/{num_highlights}: '{clip_title}'..."
                )

                clip_rendered_mp4 = settings.RENDERED_DIR / f"{stem}_reel_{clip_num:02d}.mp4"
                manifest_path = settings.RENDERED_DIR / f"{stem}_reel_{clip_num:02d}_manifest.json"

                render_options = RenderOptions(
                    output_width=720,
                    output_height=1280,
                    composition_mode=composition_mode,
                    subtitles_enabled=subtitles,
                    caption_style=caption_style,
                    overwrite=True,
                )

                render_res = VideoRendererService.render_video(
                    video_path=video_path,
                    highlight_input=hl,
                    crop_plan_input=crop_plan,
                    transcript_input=validated_transcript,
                    output_path=clip_rendered_mp4,
                    options=render_options,
                    manifest_path_input=manifest_path,
                )

                if k == 0:
                    primary_rendered_mp4_path = clip_rendered_mp4
                    subtitles_ass_path = render_res.subtitles_ass_path
                    # Copy to legacy path for backward compatibility
                    legacy_path = settings.RENDERED_DIR / f"{stem}_reel_captioned.mp4"
                    try:
                        import shutil
                        shutil.copyfile(clip_rendered_mp4, legacy_path)
                    except Exception:
                        pass

            rendered_clips.append({
                "clip_index": k,
                "clip_id": clip_id,
                "title": clip_title,
                "start_time_sec": hl.start_sec,
                "end_time_sec": hl.end_sec,
                "duration_sec": hl.duration_sec,
                "pedagogical_score": round(hl.score, 1),
                "topic_summary": hl.transcript_excerpt[:140],
                "boundary_reasoning": hl.reason,
                "rendered_video_path": str(clip_rendered_mp4) if clip_rendered_mp4 else None,
                "video_url": f"/api/ai/video?filename={clip_rendered_mp4.name}" if clip_rendered_mp4 else None,
                "download_filename": f"{stem}_clip_{clip_num:02d}.mp4",
                "mercury_score": hl.mercury_score,
                "caption": hl.caption,
            })

        crop_plan_dict = {
            "clip_id": f"{stem}_crop",
            "aspect_ratio": "9:16",
            "target_resolution": {"width": 720, "height": 1280},
            "keyframes_count": len(last_crop_plan.keyframes) if last_crop_plan else 0,
        }

        # --------------------------------------------------------------------
        # Stage 6: Completed Successfully
        # --------------------------------------------------------------------
        elapsed = round(time.time() - start_time, 2)
        update_job_status(
            job_id,
            "COMPLETED",
            100,
            f"Pipeline complete in {elapsed}s! {len(rendered_clips)} distinct topic reel(s) ready for preview.",
            {
                "media_metadata": media_meta_dict,
                "selected_highlight": highlight_dict,
                "rendered_clips": rendered_clips,
                "crop_plan": crop_plan_dict,
                "rendered_video_path": str(primary_rendered_mp4_path) if primary_rendered_mp4_path else None,
                "subtitles_ass_path": str(subtitles_ass_path) if subtitles_ass_path else None,
                "elapsed_sec": elapsed,
            }
        )

    except Exception as exc:
        logger.exception(f"Pipeline job {job_id} failed: {exc}")
        update_job_status(
            job_id,
            "FAILED",
            0,
            f"Error: {str(exc)}",
            {"error_message": str(exc)}
        )


# ============================================================================
# API Endpoints
# ============================================================================

@app.get("/")
def root():
    """Health check and service status."""
    return {
        "service": "Reel Studio AI Worker API",
        "status": "healthy",
        "version": "1.0.0",
        "supported_features": [
            "transcription",
            "term_normalization",
            "highlight_selection",
            "crop_planning_9_16",
            "karaoke_captions",
            "adaptive_hybrid_rendering"
        ]
    }


@app.post("/api/v1/pipeline/start", status_code=status.HTTP_202_ACCEPTED, response_model=PipelineStartResponse)
def start_pipeline_job(request: PipelineStartRequest, background_tasks: BackgroundTasks):
    """Starts the full Reel Studio AI pipeline in the background."""
    if not request.video_path and not request.youtube_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Either video_path or youtube_url must be provided."
        )

    yt_id = YoutubeDownloaderService.extract_video_id(
        request.youtube_url or (request.video_path if request.video_path and YoutubeDownloaderService.is_youtube_url(request.video_path) else "")
    )
    stem_prefix = f"yt_{yt_id}" if yt_id else (Path(request.video_path).stem[:8] if request.video_path else "job")
    job_id = request.job_id or f"job_{int(time.time())}_{stem_prefix}"

    # Initialize pending record
    update_job_status(job_id, "PENDING", 0, "Job received, initializing background execution...")

    # Launch in background thread
    background_tasks.add_task(
        execute_pipeline_worker,
        job_id=job_id,
        video_path_str=request.video_path,
        render_video=request.render_video,
        subtitles=request.subtitles,
        caption_style=request.caption_style,
        composition_mode=request.composition_mode,
        model_size=request.model_size,
        max_clips=request.max_clips,
        youtube_url=request.youtube_url,
        download_quality=request.download_quality,
    )

    return PipelineStartResponse(
        job_id=job_id,
        status="PENDING",
        message="Pipeline job initiated. Poll /api/v1/pipeline/status/{job_id} for progress."
    )


@app.get("/api/v1/pipeline/status/{job_id}")
def get_pipeline_job_status(job_id: str):
    """Retrieves current job status, progress percentage, and stage artifacts."""
    with jobs_lock:
        data = job_store.get(job_id)

    if not data:
        data = load_job_from_disk(job_id)

    if not data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job ID '{job_id}' not found."
        )

    return data


@app.get("/api/v1/pipeline/video/{job_id}")
def stream_pipeline_video(job_id: str):
    """Streams the rendered vertical reel MP4 for a completed job."""
    with jobs_lock:
        data = job_store.get(job_id)

    if not data:
        data = load_job_from_disk(job_id)

    if not data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Job ID '{job_id}' not found.")

    if data.get("status") != "COMPLETED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Job '{job_id}' is not yet completed (current status: {data.get('status')})."
        )

    video_path_str = data.get("rendered_video_path")
    if not video_path_str or not Path(video_path_str).exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Rendered video file does not exist on disk."
        )

    return FileResponse(
        path=video_path_str,
        media_type="video/mp4",
        filename=Path(video_path_str).name,
    )


@app.get("/api/v1/pipeline/jobs")
def list_pipeline_jobs():
    """Lists all active and stored pipeline jobs."""
    results = []
    # Read memory store
    with jobs_lock:
        for j_id, j_data in job_store.items():
            results.append({
                "job_id": j_id,
                "status": j_data.get("status"),
                "progress_pct": j_data.get("progress_pct", 0),
                "stage_message": j_data.get("stage_message", ""),
            })

    # Read disk store
    for f in settings.JOBS_DIR.glob("*.json"):
        j_id = f.stem
        if not any(r["job_id"] == j_id for r in results):
            try:
                with open(f, "r", encoding="utf-8") as jf:
                    d = json.load(jf)
                    results.append({
                        "job_id": j_id,
                        "status": d.get("status"),
                        "progress_pct": d.get("progress_pct", 0),
                        "stage_message": d.get("stage_message", ""),
                    })
            except Exception:
                continue

    return {"total_jobs": len(results), "jobs": results}
