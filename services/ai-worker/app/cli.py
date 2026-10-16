"""Command-Line Interface for Reel Studio AI Worker (Phase 2 Transcription Pipeline)."""

import argparse
import logging
import sys
import time
from pathlib import Path
from typing import Optional

from app.config import settings
from app.services.media_probe import MediaProbeService, NoAudioStreamError, MediaCorruptError
from app.services.audio_extractor import AudioExtractorService, AudioExtractionError
from app.services.transcriber import TranscriberService
from app.services.term_normalizer import TermNormalizerService

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("reel_studio_cli")


def run_transcription_pipeline(
    input_path: str | Path,
    model_size: str = "small",
    device: str = "cpu",
    compute_type: str = "int8",
    language: str | None = None,
    output_path: str | Path | None = None,
    limit_sec: float | None = None,
    force: bool = False
) -> int:
    """Runs the end-to-end Phase 2 audio extraction, transcription, and normalization pipeline.
    
    Returns:
        0 on success, non-zero on failure.
    """
    start_time = time.time()
    source_path = Path(input_path).resolve()

    print("\n" + "=" * 70)
    print("PS04 REEL STUDIO — PHASE 2 TRANSCRIPTION PIPELINE")
    print("=" * 70)
    print(f"Source Media:       {source_path}")
    print(f"Model Selection:    {model_size}")
    print(f"Device / Compute:   {device} / {compute_type}")
    print(f"Language:           {language or 'Auto-Detect'}")
    print(f"Processing Limit:   {f'{limit_sec} seconds' if limit_sec else 'Full Recording'}")
    print("=" * 70 + "\n")

    # Step 1: Media Probing and Validation
    logger.info("Stage 1/3: Validating media headers with ffprobe...")
    try:
        media_meta = MediaProbeService.validate_for_transcription(source_path)
        print(f"  -> Duration:     {media_meta.duration_sec:.2f} seconds")
        print(f"  -> Video Stream: {'Yes (' + str(media_meta.width) + 'x' + str(media_meta.height) + ' @ ' + str(media_meta.fps) + ' fps)' if media_meta.has_video else 'Audio-only'}")
        print(f"  -> Audio Stream: Yes ({media_meta.audio_sample_rate} Hz, {media_meta.audio_channels} ch, {media_meta.audio_codec})")
    except FileNotFoundError as e:
        logger.error("Input file does not exist: %s", e)
        print(f"\n[ERROR] Input file not found: {source_path}", file=sys.stderr)
        return 1
    except NoAudioStreamError as e:
        logger.error("Audio validation failed: %s", e)
        print(f"\n[ERROR] {e}", file=sys.stderr)
        return 2
    except MediaCorruptError as e:
        logger.error("Media corrupt or unreadable: %s", e)
        print(f"\n[ERROR] {e}", file=sys.stderr)
        return 3
    except Exception as e:
        logger.exception("Unexpected error probing media: %s", e)
        return 4

    # Step 2: Audio Extraction to 16kHz mono WAV
    logger.info("Stage 2/3: Extracting 16kHz mono WAV via FFmpeg...")
    try:
        wav_path = AudioExtractorService.extract_audio(
            video_path=source_path,
            force_reextract=force
        )
        print(f"  -> Extracted WAV: {wav_path} ({wav_path.stat().st_size} bytes)")
    except AudioExtractionError as e:
        logger.error("Audio extraction failed: %s", e)
        print(f"\n[ERROR] Audio extraction failed: {e}", file=sys.stderr)
        return 5
    except Exception as e:
        logger.exception("Unexpected error during audio extraction: %s", e)
        return 6

    # Step 3: Speech Recognition & Word Alignment & Terminology Normalization
    logger.info("Stage 3/3: Running speech recognition (faster-whisper) & terminology normalizer...")
    try:
        normalizer = TermNormalizerService()
        transcriber = TranscriberService(
            model_size=model_size,
            device=device,
            compute_type=compute_type,
            language=language,
            term_normalizer=normalizer
        )

        validated_transcript = transcriber.transcribe(
            audio_path=wav_path,
            source_media_path=source_path,
            force_retranscribe=force,
            limit_sec=limit_sec
        )

        # Count normalized technical terms
        tech_terms_found = [
            d for d in validated_transcript.display_words
            if d.correction is not None and d.correction.applied
        ]

        elapsed = time.time() - start_time
        target_json = settings.TRANSCRIPTS_DIR / f"{wav_path.stem}.json"
        if output_path:
            out_p = Path(output_path).resolve()
            if out_p.is_dir():
                target_json = out_p / f"{wav_path.stem}.json"
            else:
                target_json = out_p
            # Write explicitly to user-specified output path
            with open(target_json, "w", encoding="utf-8") as f:
                f.write(validated_transcript.model_dump_json(indent=2))

        print("\n" + "=" * 70)
        print("TRANSCRIPTION PIPELINE COMPLETED SUCCESSFULLY")
        print("=" * 70)
        print(f"Detected Language:        {validated_transcript.transcription.detected_language}")
        print(f"Processed Audio Duration: {validated_transcript.source.duration_sec:.2f}s")
        print(f"Raw Words Recognized:    {len(validated_transcript.raw_words)}")
        print(f"Display Tokens Produced:  {len(validated_transcript.display_words)}")
        print(f"Technical Terms Corrected:{len(tech_terms_found)}")
        for t in tech_terms_found[:10]:
            print(f"   * [{t.start_sec:.2f}s - {t.end_sec:.2f}s] '{t.correction.matched_alias}' -> '{t.text}' ({t.correction.term_id})")
        if len(tech_terms_found) > 10:
            print(f"   * ... and {len(tech_terms_found) - 10} more.")
        print(f"Wall-Clock Elapsed Time:  {elapsed:.2f}s")
        print(f"Validated Transcript JSON:{target_json}")
        print("=" * 70 + "\n")

        return 0

    except Exception as e:
        logger.exception("Transcription pipeline failed: %s", e)
        print(f"\n[ERROR] Transcription failed: {e}", file=sys.stderr)
        return 7


def main():
    parser = argparse.ArgumentParser(
        description="Reel Studio AI Worker — Phase 2 Audio Extraction & Word-Level Transcription CLI",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter
    )

    subparsers = parser.add_subparsers(dest="command", required=True, help="Sub-commands")

    # 'transcribe' command
    transcribe_parser = subparsers.add_parser("transcribe", help="Transcribe audio/video to validated transcript JSON")
    transcribe_parser.add_argument(
        "-i", "--input",
        required=True,
        type=str,
        help="Path to the input video (e.g. storage/test_samples/lecture.mp4) or WAV file"
    )
    transcribe_parser.add_argument(
        "-m", "--model",
        type=str,
        default="small",
        help="Whisper model size (tiny, base, small, medium, large-v3)"
    )
    transcribe_parser.add_argument(
        "--device",
        type=str,
        default="cpu",
        help="Device to run inference on (cpu, cuda)"
    )
    transcribe_parser.add_argument(
        "--compute-type",
        type=str,
        default="int8",
        help="Quantization type (int8, float32, float16)"
    )
    transcribe_parser.add_argument(
        "-l", "--language",
        type=str,
        default=None,
        help="Language code (e.g. 'en'). Defaults to auto-detect."
    )
    transcribe_parser.add_argument(
        "-o", "--output",
        type=str,
        default=None,
        help="Custom output file or directory path for transcript JSON"
    )
    transcribe_parser.add_argument(
        "--limit-sec",
        type=float,
        default=None,
        help="Optional duration limit in seconds for fast smoke testing"
    )
    transcribe_parser.add_argument(
        "--force",
        action="store_true",
        help="Force re-extraction and re-transcription, bypassing cache"
    )

def run_highlight_selection(
    transcript_path: str | Path,
    min_duration_sec: float = 30.0,
    max_duration_sec: float = 60.0,
    output_path: str | Path | None = None
) -> int:
    """Runs intelligent highlight selection on a validated transcript JSON file.
    
    Returns:
        0 on success, non-zero on failure.
    """
    from app.services.highlight_selector import HighlightSelectorService

    start_time = time.time()
    path = Path(transcript_path).resolve()

    print("\n" + "=" * 70)
    print("PS04 REEL STUDIO — PHASE 3 HIGHLIGHT SELECTION")
    print("=" * 70)
    print(f"Input Transcript:   {path}")
    print(f"Target Duration:    {min_duration_sec:.1f}s - {max_duration_sec:.1f}s")
    print("=" * 70 + "\n")

    if not path.exists():
        logger.error("Transcript file does not exist: %s", path)
        print(f"\n[ERROR] Transcript file not found: {path}", file=sys.stderr)
        return 1

    try:
        logger.info("Loading transcript and analyzing candidate highlight windows...")
        result = HighlightSelectorService.select_from_file(
            transcript_path=path,
            min_duration_sec=min_duration_sec,
            max_duration_sec=max_duration_sec
        )

        saved_path = HighlightSelectorService.save_highlight(result, output_path=output_path)
        elapsed = time.time() - start_time
        sb = result.score_breakdown

        print("\n" + "=" * 70)
        print("HIGHLIGHT SELECTION COMPLETED SUCCESSFULLY")
        print("=" * 70)
        print(f"Selected Window:     [{result.start_sec:.2f}s - {result.end_sec:.2f}s] ({result.duration_sec:.2f}s)")
        print(f"Selection Score:     {result.score:.2f} / 100.0")
        print(f"Selection Method:    {result.selection_method}")
        print(f"Primary Reasoning:   {result.reason}")
        print(f"Word Token Range:    #{result.word_start_id} to #{result.word_end_id}")
        print(f"Score Breakdown:")
        print(f"  * Information Value: {sb.information_value:.2f} / 100")
        print(f"  * Self-Contained:    {sb.self_contained:.2f} / 100")
        print(f"  * Opening Hook:      {sb.opening_hook:.2f} / 100")
        print(f"  * Ending Quality:    {sb.ending_quality:.2f} / 100")
        print(f"  * Speech Density:    {sb.speech_density:.2f} / 100")
        print(f"  * ASR Confidence:    {sb.confidence:.2f} / 100")
        if sb.duration_penalty > 0:
            print(f"  * Duration Penalty:  -{sb.duration_penalty:.2f} pts")
        print(f"\nTranscript Excerpt:")
        print(f'"{result.transcript_excerpt}"')
        print(f"\nWall-Clock Time:     {elapsed:.3f}s")
        print(f"Output Highlight:    {saved_path}")
        print("=" * 70 + "\n")
        return 0

    except Exception as e:
        logger.exception("Highlight selection failed: %s", e)
        print(f"\n[ERROR] Highlight selection failed: {e}", file=sys.stderr)
        return 2


def run_crop_planning(
    video_path: str | Path,
    highlight_path: str | Path,
    target_aspect_ratio: str = "9:16",
    analysis_interval_sec: float = 0.5,
    output_path: str | Path | None = None
) -> int:
    """Runs computer vision analysis and intelligent 9:16 crop planning.
    
    Returns:
        0 on success, non-zero on failure.
    """
    from app.services.crop_planner import CropPlannerService

    start_time = time.time()
    v_path = Path(video_path).resolve()
    h_path = Path(highlight_path).resolve()

    print("\n" + "=" * 70)
    print("PS04 REEL STUDIO — PHASE 4 INTELLIGENT CROPPING ENGINE")
    print("=" * 70)
    print(f"Source Video:       {v_path}")
    print(f"Highlight Result:   {h_path}")
    print(f"Target Aspect Ratio:{target_aspect_ratio}")
    print(f"Sample Interval:    {analysis_interval_sec:.2f}s")
    print("=" * 70 + "\n")

    if not v_path.exists():
        logger.error("Source video file does not exist: %s", v_path)
        print(f"\n[ERROR] Source video file not found: {v_path}", file=sys.stderr)
        return 1

    if not h_path.exists():
        logger.error("Highlight JSON file does not exist: %s", h_path)
        print(f"\n[ERROR] Highlight JSON file not found: {h_path}", file=sys.stderr)
        return 1

    try:
        logger.info("Executing frame sampling, face detection, and crop planning...")
        result = CropPlannerService.plan_from_file(
            video_path=v_path,
            highlight_path=h_path,
            target_aspect_ratio=target_aspect_ratio,
            analysis_interval_sec=analysis_interval_sec
        )

        saved_path = CropPlannerService.save_crop_plan(result, output_path=output_path)
        elapsed = time.time() - start_time
        diag = result.diagnostics

        # Breakdown of tracking modes
        mode_counts = {}
        for kf in result.keyframes:
            m = kf.tracking_mode.value if hasattr(kf.tracking_mode, "value") else str(kf.tracking_mode)
            mode_counts[m] = mode_counts.get(m, 0) + 1

        print("\n" + "=" * 70)
        print("CROP PLANNING COMPLETED SUCCESSFULLY")
        print("=" * 70)
        print(f"Highlight Window:    [{result.highlight.start_sec:.2f}s - {result.highlight.end_sec:.2f}s] ({result.highlight.duration_sec:.2f}s)")
        print(f"Source Dimensions:   {result.source_width}x{result.source_height} ({result.source.fps or 30.0:.2f} fps)")
        print(f"Target Aspect Ratio: {result.target_aspect_ratio} ({result.target_aspect_ratio_float:.4f})")
        print(f"Tracking Method:     {result.tracking_method}")
        print(f"Keyframes Generated: {len(result.keyframes)}")
        print(f"Tracking Breakdown:  {mode_counts}")
        print(f"Visual Diagnostics:")
        print(f"  * Frames Analyzed:          {diag.total_frames_analyzed}")
        print(f"  * Face Detected Frames:     {diag.face_detected_frames_count} ({diag.face_detection_ratio * 100:.1f}%)")
        print(f"  * Fallback Frames:          {diag.fallback_frames_count}")
        print(f"  * Interpolated Hold Frames: {diag.interpolated_hold_frames_count}")
        print(f"  * Scene Cuts Detected:      {diag.scene_changes_detected_count} (timestamps: {diag.scene_change_timestamps[:5]})")
        print(f"  * Decode Errors:            {diag.decode_error_count}")
        if result.warnings:
            print(f"Warnings:            {'; '.join(result.warnings)}")
        print(f"\nWall-Clock Time:     {elapsed:.3f}s")
        print(f"Output Crop Plan:    {saved_path}")
        print("=" * 70 + "\n")
        return 0

    except Exception as e:
        logger.exception("Crop planning failed: %s", e)
        print(f"\n[ERROR] Crop planning failed: {e}", file=sys.stderr)
        return 2


def run_video_rendering(
    video_path: str | Path,
    highlight_path: str | Path,
    crop_plan_path: str | Path,
    output_path: str | Path | None = None,
    output_width: int = 720,
    output_height: int = 1280,
    video_bitrate: str = "4M",
    audio_bitrate: str = "128k",
    preset: str = "fast",
    crf: int = 20,
    overwrite: bool = False,
    save_manifest: bool = False,
    composition_mode: str = "adaptive_hybrid",
    sustained_face_loss_sec: float = 1.0,
    transition_duration_sec: float = 0.25,
    bg_darken_factor: float = 0.55,
    bg_blur_sigma: float = 10.0,
    enable_content_tracking: bool = True,
    content_min_score: float = 0.35,
    content_max_width_ratio: float = 0.45,
    content_smoothing_alpha: float = 0.3,
    content_hold_sec: float = 1.0,
    subtitles: bool = False,
    transcript_path: Optional[str] = None,
    caption_style: str = "karaoke",
    subtitles_ass_path: Optional[str] = None,
    caption_font_name: str = "Arial",
    caption_font_size: int = 44,
    caption_margin_v: int = 190,
    brand_profile: Optional[str] = None,
    no_branding: bool = False,
    logo_path: Optional[str] = None,
    logo_anchor: Optional[str] = None,
    logo_scale: Optional[float] = None,
    logo_opacity: Optional[float] = None,
) -> int:
    """Runs the Phase 5/5.1/5.2/6/7 video rendering pipeline to produce vertical 9:16 MP4.
    
    Returns:
        0 on success, non-zero on failure.
    """
    from app.services.video_renderer import VideoRendererService, RenderValidationError, VideoRenderingError
    from app.schemas import RenderOptions

    start_time = time.time()
    v_path = Path(video_path).resolve()
    h_path = Path(highlight_path).resolve()
    c_path = Path(crop_plan_path).resolve()

    print("\n" + "=" * 70)
    print("PS04 REEL STUDIO — PHASE 7 BRAND-AWARE VIDEO RENDERING ENGINE")
    print("=" * 70)
    print(f"Source Video:       {v_path}")
    print(f"Highlight Result:   {h_path}")
    print(f"Crop Plan:          {c_path}")
    print(f"Composition Mode:   {composition_mode}")
    print(f"Content Tracking:   {enable_content_tracking}")
    print(f"Subtitles:          {'Enabled (' + caption_style + ')' if subtitles else 'Disabled'}")
    if not no_branding and brand_profile:
        print(f"Brand Profile:      {brand_profile}")
    else:
        print(f"Branding:           {'Disabled (--no-branding)' if no_branding else 'Default / Unbranded'}")
    print(f"Target Resolution:  {output_width}x{output_height} (9:16)")
    print(f"Overwrite Existing: {overwrite}")
    print("=" * 70 + "\n")

    if not v_path.exists():
        logger.error("Source video file does not exist: %s", v_path)
        print(f"\n[ERROR] Source video file not found: {v_path}", file=sys.stderr)
        return 1

    if not h_path.exists():
        logger.error("Highlight JSON file does not exist: %s", h_path)
        print(f"\n[ERROR] Highlight JSON file not found: {h_path}", file=sys.stderr)
        return 1

    if not c_path.exists():
        logger.error("Crop plan JSON file does not exist: %s", c_path)
        print(f"\n[ERROR] Crop plan JSON file not found: {c_path}", file=sys.stderr)
        return 1

    options = RenderOptions(
        output_width=output_width,
        output_height=output_height,
        video_bitrate=video_bitrate,
        audio_bitrate=audio_bitrate,
        preset=preset,
        crf=crf,
        overwrite=overwrite,
        composition_mode=composition_mode,
        sustained_face_loss_sec=sustained_face_loss_sec,
        transition_duration_sec=transition_duration_sec,
        bg_darken_factor=bg_darken_factor,
        bg_blur_sigma=bg_blur_sigma,
        enable_content_tracking=enable_content_tracking,
        content_min_score=content_min_score,
        content_max_width_ratio=content_max_width_ratio,
        content_smoothing_alpha=content_smoothing_alpha,
        content_hold_sec=content_hold_sec,
        subtitles_enabled=subtitles,
        caption_style=caption_style,
        transcript_path=transcript_path,
        subtitles_ass_path=subtitles_ass_path,
        caption_font_name=caption_font_name,
        caption_font_size=caption_font_size,
        caption_margin_v=caption_margin_v,
        brand_profile_path=brand_profile,
        branding_enabled=not no_branding,
        logo_path_override=logo_path,
        logo_anchor_override=logo_anchor,
        logo_scale_override=logo_scale,
        logo_opacity_override=logo_opacity,
    )

    try:
        logger.info("Executing video rendering with adaptive composition, audio muxing, captions, and branding...")
        result = VideoRendererService.render_video(
            video_path=v_path,
            highlight_input=h_path,
            crop_plan_input=c_path,
            output_path=output_path,
            options=options,
            transcript_input=transcript_path,
            subtitles_ass_input=subtitles_ass_path,
            brand_profile_input=brand_profile,
        )

        manifest_path = None
        if save_manifest:
            manifest_path = VideoRendererService.save_manifest(result)

        elapsed = time.time() - start_time

        print("\n" + "=" * 70)
        print("VIDEO RENDERING COMPLETED SUCCESSFULLY")
        print("=" * 70)
        print(f"Highlight Window:    [{result.highlight_start_sec:.2f}s - {result.highlight_end_sec:.2f}s] ({result.requested_duration_sec:.2f}s)")
        print(f"Rendered Output:     {result.output_path}")
        print(f"Composition Mode:    {result.composition_mode}")
        pct_presenter = (result.presenter_frames_count / result.rendered_frame_count * 100) if result.rendered_frame_count > 0 else 0
        pct_content = (result.content_frames_count / result.rendered_frame_count * 100) if result.rendered_frame_count > 0 else 0
        pct_presentation = (result.presentation_frames_count / result.rendered_frame_count * 100) if result.rendered_frame_count > 0 else 0
        print(f"Presenter Frames:    {result.presenter_frames_count} ({pct_presenter:.1f}%)")
        print(f"Content Frames:      {result.content_frames_count} ({pct_content:.1f}%)")
        print(f"Presentation Frames: {result.presentation_frames_count} ({pct_presentation:.1f}%)")
        print(f"Transitions:         {result.composition_transitions_count} (Scene Cuts: {result.scene_cut_transitions_count}, Sustained Face Loss: {result.sustained_loss_transitions_count}, Content: {result.content_transitions_count})")
        print(f"Resolution & FPS:    {result.output_width}x{result.output_height} @ {result.output_fps:.2f} fps")
        print(f"Video Codec:         {result.output_video_codec}")
        print(f"Audio Codec:         {result.output_audio_codec or 'None (Silent)'}")
        print(f"Audio Included:      {result.audio_included}")
        print(f"Frames Rendered:     {result.rendered_frame_count}")
        print(f"Video Duration:      {result.actual_video_duration_sec:.3f}s")
        if result.actual_audio_duration_sec is not None:
            print(f"Audio Duration:      {result.actual_audio_duration_sec:.3f}s")
        if result.subtitles_enabled:
            print(f"Subtitles:           Burned-in ({result.caption_style})")
            print(f"Subtitle File:       {result.subtitles_ass_path}")
            print(f"Caption Groups:      {result.caption_groups_count}")
        if result.branding and result.branding.get("branding_enabled"):
            b_info = result.branding
            print(f"Brand Identity:      {b_info.get('brand_name')} (ID: {b_info.get('brand_id')})")
            print(f"Logo Watermark:      {'Rendered' if b_info.get('logo_rendered') else 'Hidden / Suppressed'} (Anchor: {b_info.get('logo_anchor')}, Opacity: {b_info.get('logo_opacity')})")
        if manifest_path:
            print(f"Render Manifest:     {manifest_path}")
        if result.warnings:
            print(f"Warnings:            {'; '.join(result.warnings)}")
        print(f"\nWall-Clock Time:     {elapsed:.3f}s")
        print("=" * 70 + "\n")
        return 0

    except FileExistsError as e:
        logger.error("Output file already exists: %s", e)
        print(f"\n[ERROR] {e}", file=sys.stderr)
        return 3
    except RenderValidationError as e:
        logger.error("Validation error: %s", e)
        print(f"\n[ERROR] Validation failed: {e}", file=sys.stderr)
        return 2
    except Exception as e:
        logger.exception("Video rendering failed: %s", e)
        print(f"\n[ERROR] Video rendering failed: {e}", file=sys.stderr)
        return 2


def run_generate_captions(
    transcript_path: str | Path,
    highlight_path: str | Path,
    output_path: str | Path | None = None,
    caption_style: str = "karaoke",
    font_name: str = "Arial",
    font_size: int = 44,
    margin_v: int = 190,
) -> int:
    """Generates synchronized ASS subtitle file from transcript and highlight JSON (Phase 6).
    
    Returns:
        0 on success, non-zero on failure.
    """
    from app.services.video_renderer import VideoRendererService
    from app.services.caption_generator import CaptionGeneratorService
    from app.schemas import CaptionStyle, CaptionOptions

    t_path = Path(transcript_path).resolve()
    h_path = Path(highlight_path).resolve()

    print("\n" + "=" * 70)
    print("PS04 REEL STUDIO — PHASE 6 SYNCHRONIZED CAPTION GENERATOR")
    print("=" * 70)
    print(f"Transcript JSON:    {t_path}")
    print(f"Highlight JSON:     {h_path}")
    print(f"Caption Style:      {caption_style}")
    print(f"Font / Size:        {font_name} / {font_size}pt")
    print(f"Vertical Margin:    {margin_v}px")
    print("=" * 70 + "\n")

    if not t_path.exists():
        logger.error("Transcript file does not exist: %s", t_path)
        print(f"\n[ERROR] Transcript file not found: {t_path}", file=sys.stderr)
        return 1
    if not h_path.exists():
        logger.error("Highlight file does not exist: %s", h_path)
        print(f"\n[ERROR] Highlight file not found: {h_path}", file=sys.stderr)
        return 1

    try:
        transcript = VideoRendererService.load_transcript(t_path)
        highlight = VideoRendererService.load_highlight(h_path)

        words_source = transcript.display_words or transcript.raw_words
        rel_words, stats = CaptionGeneratorService.filter_and_convert_words(
            transcript_words=words_source,
            highlight_start_sec=highlight.start_sec,
            highlight_end_sec=highlight.end_sec,
        )

        cap_opts = CaptionOptions(
            enabled=True,
            style=CaptionStyle(caption_style),
            font_name=font_name,
            font_size=font_size,
            margin_v=margin_v,
        )

        groups = CaptionGeneratorService.group_words_into_captions(
            words=rel_words,
            clip_duration=highlight.duration_sec,
            options=cap_opts,
        )

        if output_path:
            out_file = Path(output_path).resolve()
        else:
            settings.SUBTITLES_DIR.mkdir(parents=True, exist_ok=True)
            out_file = settings.SUBTITLES_DIR / f"{h_path.stem}.ass"

        saved_path = CaptionGeneratorService.save_ass_file(
            caption_groups=groups,
            output_path=out_file,
            options=cap_opts,
        )

        print("\n" + "=" * 70)
        print("CAPTION GENERATION COMPLETED SUCCESSFULLY")
        print("=" * 70)
        print(f"Highlight Interval:  [{highlight.start_sec:.2f}s - {highlight.end_sec:.2f}s] ({highlight.duration_sec:.2f}s)")
        print(f"Words in Highlight:  {stats['filtered_words_count']} (Clamped: {stats['clamped_count']}, Zero Duration: {stats['zero_duration_count']})")
        print(f"Caption Groups:      {len(groups)}")
        print(f"Caption Style:       {caption_style}")
        print(f"Output ASS Subtitle: {saved_path}")
        print("=" * 70 + "\n")
        return 0

    except Exception as e:
        logger.exception("Caption generation failed: %s", e)
        print(f"\n[ERROR] Caption generation failed: {e}", file=sys.stderr)
        return 2


def run_brand_validation(
    profile_path: str,
    no_asset_check: bool = False
) -> int:
    """Validates a brand profile JSON or preset and displays resolved settings (Phase 7).
    
    Returns:
        0 on success, non-zero on failure.
    """
    from app.services.brand_manager import BrandManagerService

    print("\n" + "=" * 70)
    print("PS04 REEL STUDIO — PHASE 7 BRAND PROFILE VALIDATOR")
    print("=" * 70)
    print(f"Profile / Preset:    {profile_path}")
    print(f"Verify Asset Files:  {not no_asset_check}")
    print("=" * 70 + "\n")

    try:
        profile = BrandManagerService.load_profile(
            profile_input=profile_path,
            resolve_assets=not no_asset_check,
        )
        print("BRAND PROFILE VALIDATION SUCCESSFUL")
        print("=" * 70)
        print(f"Brand ID:            {profile.brand_id}")
        print(f"Brand Name:          {profile.brand_name}")
        print(f"Description:         {profile.description or 'N/A'}")
        print(f"Version:             {profile.version}")
        print("\nBrand Palette:")
        print(f"  * Primary:         {profile.palette.primary}")
        print(f"  * Secondary:       {profile.palette.secondary}")
        print(f"  * Accent:          {profile.palette.accent}")
        print(f"  * Text:            {profile.palette.text}")
        if profile.palette.background:
            print(f"  * Background:      {profile.palette.background}")
        print("\nTypography & Captions:")
        print(f"  * Font Family:     {profile.typography.font_family} (Bold: {profile.typography.bold})")
        print(f"  * Font Size:       {profile.typography.font_size}pt")
        print(f"  * Caption Color:   {profile.typography.text_color or profile.palette.text}")
        print(f"  * Karaoke Color:   {profile.typography.highlight_color or profile.palette.accent}")
        print(f"  * Outline:         {profile.typography.outline_color} ({profile.typography.outline_width}px)")
        print(f"  * Margin Bottom:   {profile.typography.margin_v}px")
        print("\nLogo & Watermark:")
        print(f"  * Enabled:         {profile.logo.enabled}")
        print(f"  * Anchor:          {profile.logo.anchor.value}")
        print(f"  * Max Width Scale: {profile.logo.scale:.2f}")
        print(f"  * Opacity:         {profile.logo.opacity:.2f}")
        print(f"  * Padding (H / V): {profile.logo.padding_x}px / {profile.logo.padding_y}px")
        if profile.logo.asset_path:
            print(f"  * Asset Path:      {profile.logo.asset_path}")
        print("=" * 70 + "\n")
        return 0
    except Exception as e:
        logger.exception("Brand profile validation failed: %s", e)
        print(f"\n[ERROR] Brand validation failed: {e}", file=sys.stderr)
        return 2


def main():
    parser = argparse.ArgumentParser(
        description="Reel Studio AI Worker CLI — Transcription, Highlights, Crop Planning & Rendering",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter
    )

    subparsers = parser.add_subparsers(dest="command", required=True, help="Sub-commands")

    # 'transcribe' command
    transcribe_parser = subparsers.add_parser("transcribe", help="Transcribe audio/video to validated transcript JSON")
    transcribe_parser.add_argument(
        "-i", "--input",
        required=True,
        type=str,
        help="Path to the input video (e.g. storage/test_samples/lecture.mp4) or WAV file"
    )
    transcribe_parser.add_argument(
        "-m", "--model",
        type=str,
        default="small",
        help="Whisper model size (tiny, base, small, medium, large-v3)"
    )
    transcribe_parser.add_argument(
        "--device",
        type=str,
        default="cpu",
        help="Device to run inference on (cpu, cuda)"
    )
    transcribe_parser.add_argument(
        "--compute-type",
        type=str,
        default="int8",
        help="Quantization type (int8, float32, float16)"
    )
    transcribe_parser.add_argument(
        "-l", "--language",
        type=str,
        default=None,
        help="Language code (e.g. 'en'). Defaults to auto-detect."
    )
    transcribe_parser.add_argument(
        "-o", "--output",
        type=str,
        default=None,
        help="Custom output file or directory path for transcript JSON"
    )
    transcribe_parser.add_argument(
        "--limit-sec",
        type=float,
        default=None,
        help="Optional duration limit in seconds for fast smoke testing"
    )
    transcribe_parser.add_argument(
        "--force",
        action="store_true",
        help="Force re-extraction and re-transcription, bypassing cache"
    )

    # 'select-highlight' command
    highlight_parser = subparsers.add_parser("select-highlight", help="Select best educational highlight from transcript JSON")
    highlight_parser.add_argument(
        "-i", "--input-transcript",
        required=True,
        type=str,
        help="Path to validated transcript JSON (e.g. storage/transcripts/lecture.json)"
    )
    highlight_parser.add_argument(
        "--min-duration-sec",
        type=float,
        default=30.0,
        help="Minimum clip duration in seconds"
    )
    highlight_parser.add_argument(
        "--max-duration-sec",
        type=float,
        default=60.0,
        help="Maximum clip duration in seconds"
    )
    highlight_parser.add_argument(
        "-o", "--output",
        type=str,
        default=None,
        help="Custom output file path for highlight result JSON"
    )

    # 'plan-crop' command
    crop_parser = subparsers.add_parser("plan-crop", help="Generate intelligent 9:16 crop plan for selected highlight")
    crop_parser.add_argument(
        "-v", "--input-video",
        required=True,
        type=str,
        help="Path to source video file (e.g. path/to/lecture.mp4)"
    )
    crop_parser.add_argument(
        "-H", "--highlight-json",
        required=True,
        type=str,
        help="Path to Phase 3 highlight result JSON (e.g. storage/highlights/lecture_highlight.json)"
    )
    crop_parser.add_argument(
        "-a", "--target-aspect-ratio",
        type=str,
        default="9:16",
        help="Target aspect ratio (e.g. '9:16', '1:1', '4:5', '16:9')"
    )
    crop_parser.add_argument(
        "--analysis-interval-sec",
        type=float,
        default=0.5,
        help="Frame sampling interval in seconds (default: 0.5s)"
    )
    crop_parser.add_argument(
        "-o", "--output",
        type=str,
        default=None,
        help="Custom output file path for crop plan JSON"
    )

    # 'render-video' command
    render_parser = subparsers.add_parser("render-video", help="Render vertical video clip from highlight and crop plan")
    render_parser.add_argument(
        "-v", "--input-video",
        required=True,
        type=str,
        help="Path to source video file (e.g. path/to/lecture.mp4)"
    )
    render_parser.add_argument(
        "-H", "--highlight-json",
        required=True,
        type=str,
        help="Path to Phase 3 highlight result JSON (e.g. storage/highlights/lecture_highlight.json)"
    )
    render_parser.add_argument(
        "-C", "--crop-plan-json",
        required=True,
        type=str,
        help="Path to Phase 4 crop plan JSON (e.g. storage/crop_plans/lecture_crop_plan.json)"
    )
    render_parser.add_argument(
        "-o", "--output",
        type=str,
        default=None,
        help="Custom destination path for rendered MP4 (default: storage/rendered/<stem>_reel.mp4)"
    )
    render_parser.add_argument(
        "-W", "--output-width",
        type=int,
        default=720,
        help="Target output width in pixels (default: 720)"
    )
    render_parser.add_argument(
        "--output-height",
        type=int,
        default=1280,
        help="Target output height in pixels (default: 1280)"
    )
    render_parser.add_argument(
        "--video-bitrate",
        type=str,
        default="4M",
        help="Target video encoding bitrate (default: 4M)"
    )
    render_parser.add_argument(
        "--audio-bitrate",
        type=str,
        default="128k",
        help="Target audio encoding bitrate (default: 128k)"
    )
    render_parser.add_argument(
        "--preset",
        type=str,
        default="fast",
        help="FFmpeg x264 preset (ultrafast, fast, medium, slow)"
    )
    render_parser.add_argument(
        "--crf",
        type=int,
        default=20,
        help="Constant Rate Factor for x264 (default: 20)"
    )
    render_parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite destination MP4 if it already exists"
    )
    render_parser.add_argument(
        "--save-manifest",
        action="store_true",
        help="Save render manifest JSON alongside the output video"
    )
    render_parser.add_argument(
        "--composition-mode",
        type=str,
        default="adaptive_hybrid",
        choices=["adaptive_hybrid", "crop_only", "presentation_fit_blur", "content_only"],
        help="Composition rendering mode (default: adaptive_hybrid)"
    )
    render_parser.add_argument(
        "--sustained-face-loss-sec",
        type=float,
        default=1.0,
        help="Duration of consecutive face absence before switching to presentation mode (default: 1.0s)"
    )
    render_parser.add_argument(
        "--transition-duration-sec",
        type=float,
        default=0.25,
        help="Crossfade transition duration for non-cut layout changes (default: 0.25s)"
    )
    render_parser.add_argument(
        "--bg-darken-factor",
        type=float,
        default=0.55,
        help="Darkening intensity factor for blurred background (default: 0.55)"
    )
    render_parser.add_argument(
        "--bg-blur-sigma",
        type=float,
        default=10.0,
        help="Gaussian blur sigma for portrait background (default: 10.0)"
    )
    render_parser.add_argument(
        "--enable-content-tracking",
        action="store_true",
        default=True,
        help="Enable intelligent screen content detection and tracking (default: True)"
    )
    render_parser.add_argument(
        "--no-content-tracking",
        action="store_false",
        dest="enable_content_tracking",
        help="Disable intelligent screen content detection and tracking"
    )
    render_parser.add_argument(
        "--content-min-score",
        type=float,
        default=0.35,
        help="Minimum heuristic score threshold for screen content candidates (default: 0.35)"
    )
    render_parser.add_argument(
        "--content-max-width-ratio",
        type=float,
        default=0.45,
        help="Maximum candidate width ratio before falling back to presentation mode (default: 0.45)"
    )
    render_parser.add_argument(
        "--content-smoothing-alpha",
        type=float,
        default=0.3,
        help="Exponential moving average alpha for content tracking smoothing (default: 0.3)"
    )
    render_parser.add_argument(
        "--content-hold-sec",
        type=float,
        default=1.0,
        help="Maximum hold duration in seconds during temporary content occlusion (default: 1.0s)"
    )
    render_parser.add_argument(
        "--subtitles",
        action="store_true",
        default=False,
        help="Burn synchronized subtitles into the output video (Phase 6)"
    )
    render_parser.add_argument(
        "-T", "--transcript-json",
        type=str,
        default=None,
        help="Path to validated transcript JSON (default: storage/transcripts/<stem>.json)"
    )
    render_parser.add_argument(
        "--caption-style",
        type=str,
        default="karaoke",
        choices=["standard", "karaoke"],
        help="Caption display style (default: karaoke)"
    )
    render_parser.add_argument(
        "--subtitles-ass",
        type=str,
        default=None,
        help="Path to pre-generated ASS subtitle file"
    )
    render_parser.add_argument(
        "--caption-font-size",
        type=int,
        default=44,
        help="Caption font size in points (default: 44)"
    )
    render_parser.add_argument(
        "--caption-margin-v",
        type=int,
        default=190,
        help="Vertical margin from bottom in pixels (default: 190)"
    )
    render_parser.add_argument(
        "--brand-profile",
        type=str,
        default=None,
        help="Name of built-in preset (educational_default, creator_tech, minimal_clean) or path to brand profile JSON (Phase 7)"
    )
    render_parser.add_argument(
        "--no-branding",
        action="store_true",
        default=False,
        help="Explicitly disable branding kit and logo overlay"
    )
    render_parser.add_argument(
        "--logo-path",
        type=str,
        default=None,
        help="Path to override logo image asset (PNG, JPG, WebP)"
    )
    render_parser.add_argument(
        "--logo-anchor",
        type=str,
        default=None,
        choices=["top_left", "top_right", "bottom_left", "bottom_right"],
        help="Override logo placement anchor position"
    )
    render_parser.add_argument(
        "--logo-scale",
        type=float,
        default=None,
        help="Override logo width scale relative to canvas width (0.05 to 0.50)"
    )
    render_parser.add_argument(
        "--logo-opacity",
        type=float,
        default=None,
        help="Override logo opacity (0.0 to 1.0)"
    )

    # 'generate-captions' command
    captions_parser = subparsers.add_parser("generate-captions", help="Generate synchronized ASS subtitles from transcript and highlight JSON (Phase 6)")
    captions_parser.add_argument(
        "-T", "--transcript-json",
        required=True,
        type=str,
        help="Path to validated transcript JSON (e.g. storage/transcripts/lecture.json)"
    )
    captions_parser.add_argument(
        "-H", "--highlight-json",
        required=True,
        type=str,
        help="Path to Phase 3 highlight result JSON (e.g. storage/highlights/lecture_highlight.json)"
    )
    captions_parser.add_argument(
        "-o", "--output",
        type=str,
        default=None,
        help="Custom output file path for generated ASS subtitles (default: storage/subtitles/<stem>.ass)"
    )
    captions_parser.add_argument(
        "--caption-style",
        type=str,
        default="karaoke",
        choices=["standard", "karaoke"],
        help="Caption display style: standard or karaoke (default: karaoke)"
    )
    captions_parser.add_argument(
        "--font-name",
        type=str,
        default="Arial",
        help="Font family name for subtitles (default: Arial)"
    )
    captions_parser.add_argument(
        "--caption-font-size",
        type=int,
        default=44,
        help="Font size in points (default: 44)"
    )
    captions_parser.add_argument(
        "--caption-margin-v",
        type=int,
        default=190,
        help="Vertical margin from bottom in pixels (default: 190)"
    )

    # 'validate-brand' command
    brand_parser = subparsers.add_parser("validate-brand", help="Validate a brand profile JSON or preset and its visual assets (Phase 7)")
    brand_parser.add_argument(
        "-p", "--profile",
        required=True,
        type=str,
        help="Brand profile preset name (educational_default, creator_tech, minimal_clean) or path to JSON"
    )
    brand_parser.add_argument(
        "--no-asset-check",
        action="store_true",
        default=False,
        help="Skip verifying presence of logo asset files"
    )

    args = parser.parse_args()

    if args.command == "transcribe":
        code = run_transcription_pipeline(
            input_path=args.input,
            model_size=args.model,
            device=args.device,
            compute_type=args.compute_type,
            language=args.language,
            output_path=args.output,
            limit_sec=args.limit_sec,
            force=args.force
        )
        sys.exit(code)
    elif args.command == "select-highlight":
        code = run_highlight_selection(
            transcript_path=args.input_transcript,
            min_duration_sec=args.min_duration_sec,
            max_duration_sec=args.max_duration_sec,
            output_path=args.output
        )
        sys.exit(code)
    elif args.command == "plan-crop":
        code = run_crop_planning(
            video_path=args.input_video,
            highlight_path=args.highlight_json,
            target_aspect_ratio=args.target_aspect_ratio,
            analysis_interval_sec=args.analysis_interval_sec,
            output_path=args.output
        )
        sys.exit(code)
    elif args.command == "render-video":
        code = run_video_rendering(
            video_path=args.input_video,
            highlight_path=args.highlight_json,
            crop_plan_path=args.crop_plan_json,
            output_path=args.output,
            output_width=args.output_width,
            output_height=args.output_height,
            video_bitrate=args.video_bitrate,
            audio_bitrate=args.audio_bitrate,
            preset=args.preset,
            crf=args.crf,
            overwrite=args.overwrite,
            save_manifest=args.save_manifest,
            composition_mode=args.composition_mode,
            sustained_face_loss_sec=args.sustained_face_loss_sec,
            transition_duration_sec=args.transition_duration_sec,
            bg_darken_factor=args.bg_darken_factor,
            bg_blur_sigma=args.bg_blur_sigma,
            enable_content_tracking=args.enable_content_tracking,
            content_min_score=args.content_min_score,
            content_max_width_ratio=args.content_max_width_ratio,
            content_smoothing_alpha=args.content_smoothing_alpha,
            content_hold_sec=args.content_hold_sec,
            subtitles=args.subtitles,
            transcript_path=args.transcript_json,
            caption_style=args.caption_style,
            subtitles_ass_path=args.subtitles_ass,
            caption_font_size=args.caption_font_size,
            caption_margin_v=args.caption_margin_v,
            brand_profile=args.brand_profile,
            no_branding=args.no_branding,
            logo_path=args.logo_path,
            logo_anchor=args.logo_anchor,
            logo_scale=args.logo_scale,
            logo_opacity=args.logo_opacity,
        )
        sys.exit(code)
    elif args.command == "generate-captions":
        code = run_generate_captions(
            transcript_path=args.transcript_json,
            highlight_path=args.highlight_json,
            output_path=args.output,
            caption_style=args.caption_style,
            font_name=args.font_name,
            font_size=args.caption_font_size,
            margin_v=args.caption_margin_v,
        )
        sys.exit(code)
    elif args.command == "validate-brand":
        code = run_brand_validation(
            profile_path=args.profile,
            no_asset_check=args.no_asset_check,
        )
        sys.exit(code)


if __name__ == "__main__":
    main()
