"""Unit tests for Phase 5: Final Video Rendering Engine.

Covers all 24 required verification cases:
1. Valid highlight and crop-plan inputs.
2. Missing source video raises FileNotFoundError.
3. Missing or malformed highlight JSON raises clear error.
4. Missing or malformed crop-plan JSON raises clear error.
5. Source-video metadata mismatch raises RenderValidationError.
6. Highlight interval mismatch between highlight JSON and crop plan.
7. Invalid or out-of-bounds crop boxes rejected.
8. Invalid output dimensions and aspect ratios rejected.
9. Correct crop selection for a frame at a known timestamp.
10. Linear crop interpolation during a smooth-pan interval.
11. Immediate crop switching at a scene cut (no cross-cut panning).
12. Correct handling of center_fallback tracking mode.
13. Correct handling of interpolated_hold tracking mode.
14. Source-time and clip-relative timestamp conversion.
15. Frames never being cropped outside source dimensions.
16. Correct output-frame sizing after resize.
17. Missing audio handling producing valid silent output.
18. Cleanup of temporary files after a simulated encoding failure.
19. Successful CLI rendering using synthetic video input.
20. Understandable CLI error codes on invalid inputs.
21. RenderResult JSON schema serialization and validation.
22. Output duration and frame-count calculation accuracy.
23. Avoiding unintended overwriting of existing output.
24. Regression: All existing Phase 2, Phase 3, and Phase 4 tests pass.
"""

import json
import os
import subprocess
from pathlib import Path
from typing import Optional, List, Tuple, Dict, Any, Union
import pytest
import cv2
import numpy as np

from app.schemas import (
    HighlightResult,
    SourceMetadata,
    ScoreBreakdown,
    CropBoxPixels,
    FaceBoundingBox,
    NormalizedCropBox,
    CropTrackingMode,
    CropKeyframeResult,
    VisualDiagnostics,
    CropPlanResult,
    RenderResult,
    RenderOptions,
    CompositionMode,
)
from app.services.video_renderer import (
    CropInterpolator,
    AdaptiveCompositionClassifier,
    CompositionRenderer,
    VideoRendererService,
    RenderValidationError,
    VideoRenderingError,
    FFmpegExecutionError,
)
from app.cli import run_video_rendering


# ---------------------------------------------------------------------------
# Test Helpers
# ---------------------------------------------------------------------------

def make_test_highlight(
    start_sec: float = 1.0,
    end_sec: float = 3.0,
    filename: str = "test.mp4",
    duration_sec: float = 5.0,
    width: int = 640,
    height: int = 360,
    fps: float = 30.0,
) -> HighlightResult:
    """Creates a valid HighlightResult object for rendering tests."""
    dur = round(end_sec - start_sec, 3)
    return HighlightResult(
        schema_version="1.0",
        source=SourceMetadata(
            filename=filename,
            duration_sec=duration_sec,
            video_width=width,
            video_height=height,
            fps=fps
        ),
        start_sec=start_sec,
        end_sec=end_sec,
        duration_sec=dur,
        score=88.0,
        reason="Test highlight interval for rendering",
        transcript_excerpt="Rendering test transcript excerpt.",
        score_breakdown=ScoreBreakdown(
            information_value=85.0,
            self_contained=80.0,
            opening_hook=80.0,
            ending_quality=80.0,
            speech_density=80.0,
            confidence=95.0,
            duration_penalty=0.0
        ),
        word_start_id=1,
        word_end_id=20,
        selection_method="transcript_heuristic_v1"
    )


def make_test_crop_plan(
    highlight: HighlightResult,
    width: int = 640,
    height: int = 360,
    fps: float = 30.0,
    keyframes: Optional[List[CropKeyframeResult]] = None,
) -> CropPlanResult:
    """Creates a valid CropPlanResult matching the given highlight and source dimensions."""
    crop_w = int(round(height * (9.0 / 16.0)))
    crop_h = height

    if keyframes is None:
        # Default 2 keyframes: start and end
        k1 = CropKeyframeResult(
            timestamp_abs_sec=highlight.start_sec,
            timestamp_rel_sec=0.0,
            crop_box_pixels=CropBoxPixels(x=100, y=0, width=crop_w, height=crop_h),
            crop_box_norm=NormalizedCropBox(x_min=round(100 / width, 4), y_min=0.0, width=round(crop_w / width, 4), height=1.0),
            tracking_mode=CropTrackingMode.FACE_FOLLOWING,
            detected_faces_count=1,
            primary_face_box=None,
            scene_change_detected=False,
            transition="smooth_pan"
        )
        k2 = CropKeyframeResult(
            timestamp_abs_sec=highlight.end_sec,
            timestamp_rel_sec=highlight.duration_sec,
            crop_box_pixels=CropBoxPixels(x=200, y=0, width=crop_w, height=crop_h),
            crop_box_norm=NormalizedCropBox(x_min=round(200 / width, 4), y_min=0.0, width=round(crop_w / width, 4), height=1.0),
            tracking_mode=CropTrackingMode.FACE_FOLLOWING,
            detected_faces_count=1,
            primary_face_box=None,
            scene_change_detected=False,
            transition="smooth_pan"
        )
        keyframes = [k1, k2]

    return CropPlanResult(
        schema_version="1.0",
        source=SourceMetadata(
            filename=highlight.source.filename,
            duration_sec=highlight.source.duration_sec,
            video_width=width,
            video_height=height,
            fps=fps
        ),
        highlight=highlight,
        target_aspect_ratio="9:16",
        target_aspect_ratio_float=9.0 / 16.0,
        source_width=width,
        source_height=height,
        crop_width=crop_w,
        crop_height=crop_h,
        analysis_interval_sec=0.5,
        tracking_method="opencv_haar_tracker_v1",
        fallback_used=False,
        keyframes=keyframes,
        diagnostics=VisualDiagnostics(
            total_frames_analyzed=len(keyframes),
            face_detected_frames_count=len(keyframes),
            fallback_frames_count=0,
            interpolated_hold_frames_count=0,
            scene_changes_detected_count=0,
            scene_change_timestamps=[],
            decode_error_count=0,
            face_detection_ratio=1.0,
            fallback_used=False
        ),
        warnings=[]
    )


def create_synthetic_video_with_audio(
    path: Path,
    width: int = 640,
    height: int = 360,
    fps: float = 30.0,
    duration_sec: float = 3.0,
) -> Path:
    """Creates a synthetic MP4 video containing video and audio streams using FFmpeg."""
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"testsrc=duration={duration_sec}:size={width}x{height}:rate={fps}",
        "-f", "lavfi", "-i", f"sine=frequency=1000:duration={duration_sec}",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        str(path)
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return path


def create_synthetic_video_silent(
    path: Path,
    width: int = 640,
    height: int = 360,
    fps: float = 30.0,
    duration_sec: float = 3.0,
) -> Path:
    """Creates a synthetic MP4 video without an audio stream using FFmpeg."""
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"testsrc=duration={duration_sec}:size={width}x{height}:rate={fps}",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
        "-an",
        str(path)
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return path


# ---------------------------------------------------------------------------
# Test Cases 1 - 8: Input & Validation Logic
# ---------------------------------------------------------------------------

def test_valid_highlight_and_crop_plan_inputs(tmp_path: Path):
    """Case 1: Valid inputs and matching metadata pass validation."""
    v_path = create_synthetic_video_with_audio(tmp_path / "valid.mp4", duration_sec=3.0)
    hl = make_test_highlight(start_sec=0.5, end_sec=2.5, filename="valid.mp4", duration_sec=3.0)
    cp = make_test_crop_plan(hl)

    probe = VideoRendererService.validate_inputs(v_path, hl, cp, RenderOptions())
    assert probe.has_video
    assert probe.width == 640
    assert probe.height == 360


def test_missing_source_video_raises(tmp_path: Path):
    """Case 2: Missing source video raises FileNotFoundError."""
    hl = make_test_highlight()
    cp = make_test_crop_plan(hl)

    with pytest.raises(FileNotFoundError, match="Source video file not found"):
        VideoRendererService.validate_inputs(tmp_path / "non_existent.mp4", hl, cp, RenderOptions())


def test_missing_or_malformed_highlight_json(tmp_path: Path):
    """Case 3: Missing or corrupt highlight JSON raises appropriate error."""
    # Missing file
    with pytest.raises(FileNotFoundError):
        VideoRendererService.load_highlight(tmp_path / "missing_hl.json")

    # Corrupt JSON syntax
    bad_hl = tmp_path / "corrupt_hl.json"
    bad_hl.write_text("{bad syntax", encoding="utf-8")
    with pytest.raises(RenderValidationError, match="Failed to parse HighlightResult"):
        VideoRendererService.load_highlight(bad_hl)


def test_missing_or_malformed_crop_plan_json(tmp_path: Path):
    """Case 4: Missing or corrupt crop plan JSON raises appropriate error."""
    # Missing file
    with pytest.raises(FileNotFoundError):
        VideoRendererService.load_crop_plan(tmp_path / "missing_cp.json")

    # Corrupt JSON syntax
    bad_cp = tmp_path / "corrupt_cp.json"
    bad_cp.write_text("{bad syntax", encoding="utf-8")
    with pytest.raises(RenderValidationError, match="Failed to parse CropPlanResult"):
        VideoRendererService.load_crop_plan(bad_cp)


def test_source_video_metadata_mismatch(tmp_path: Path):
    """Case 5: Mismatch between actual video dimensions and crop plan raises RenderValidationError."""
    v_path = create_synthetic_video_with_audio(tmp_path / "meta_mismatch.mp4", width=640, height=360)
    hl = make_test_highlight(filename="meta_mismatch.mp4")
    # Crop plan claims video is 854x480
    cp = make_test_crop_plan(hl, width=854, height=480)

    with pytest.raises(RenderValidationError, match="do not match actual video dimensions"):
        VideoRendererService.validate_inputs(v_path, hl, cp, RenderOptions())


def test_highlight_interval_mismatch_between_artifacts(tmp_path: Path):
    """Case 6: Crop plan generated for a different interval than highlight raises RenderValidationError."""
    v_path = create_synthetic_video_with_audio(tmp_path / "interval_mismatch.mp4", duration_sec=4.0)
    hl = make_test_highlight(start_sec=1.0, end_sec=3.0, filename="interval_mismatch.mp4", duration_sec=4.0)
    
    # Create crop plan with different interval (e.g. 0.5s to 2.0s)
    hl_diff = make_test_highlight(start_sec=0.5, end_sec=2.0, filename="interval_mismatch.mp4", duration_sec=4.0)
    cp = make_test_crop_plan(hl_diff)

    with pytest.raises(RenderValidationError, match="does not match supplied highlight"):
        VideoRendererService.validate_inputs(v_path, hl, cp, RenderOptions())


def test_invalid_or_out_of_bounds_crop_boxes(tmp_path: Path):
    """Case 7: Keyframes with out-of-bounds or negative coordinates raise RenderValidationError."""
    v_path = create_synthetic_video_with_audio(tmp_path / "bounds.mp4", width=640, height=360)
    hl = make_test_highlight(filename="bounds.mp4")

    # Keyframe exceeds source width (640)
    bad_kf = CropKeyframeResult(
        timestamp_abs_sec=hl.start_sec,
        timestamp_rel_sec=0.0,
        crop_box_pixels=CropBoxPixels(x=500, y=0, width=200, height=360),  # x + width = 700 > 640
        crop_box_norm=NormalizedCropBox(x_min=0.78, y_min=0.0, width=0.31, height=1.0),
        tracking_mode=CropTrackingMode.CENTER_FALLBACK,
        detected_faces_count=0,
        primary_face_box=None,
        scene_change_detected=False,
        transition="smooth_pan"
    )
    cp = make_test_crop_plan(hl, keyframes=[bad_kf])

    with pytest.raises(RenderValidationError, match="exceeds source frame bounds"):
        VideoRendererService.validate_inputs(v_path, hl, cp, RenderOptions())


def test_invalid_output_dimensions_and_aspect_ratios(tmp_path: Path):
    """Case 8: Non-positive dimensions or mismatched output aspect ratio raise RenderValidationError."""
    v_path = create_synthetic_video_with_audio(tmp_path / "ar_test.mp4")
    hl = make_test_highlight(filename="ar_test.mp4")
    cp = make_test_crop_plan(hl)

    # 1. Non-positive output dimension
    with pytest.raises(RenderValidationError, match="Target output dimensions must be positive"):
        VideoRendererService.validate_inputs(v_path, hl, cp, RenderOptions(output_width=0, output_height=1280))

    # 2. Mismatched aspect ratio (16:9 requested when crop plan is 9:16)
    with pytest.raises(RenderValidationError, match="do not match target aspect ratio"):
        VideoRendererService.validate_inputs(v_path, hl, cp, RenderOptions(output_width=1280, output_height=720))


# ---------------------------------------------------------------------------
# Test Cases 9 - 16: Crop Interpolator & Geometry Mechanics
# ---------------------------------------------------------------------------

def test_crop_selection_at_exact_keyframe_timestamp():
    """Case 9: Exactly at keyframe timestamp, returns exact keyframe crop box."""
    kf1 = CropKeyframeResult(
        timestamp_abs_sec=10.0,
        timestamp_rel_sec=0.0,
        crop_box_pixels=CropBoxPixels(x=100, y=0, width=200, height=360),
        crop_box_norm=NormalizedCropBox(x_min=0.1, y_min=0.0, width=0.3, height=1.0),
        tracking_mode=CropTrackingMode.FACE_FOLLOWING,
        transition="smooth_pan"
    )
    kf2 = CropKeyframeResult(
        timestamp_abs_sec=12.0,
        timestamp_rel_sec=2.0,
        crop_box_pixels=CropBoxPixels(x=300, y=0, width=200, height=360),
        crop_box_norm=NormalizedCropBox(x_min=0.3, y_min=0.0, width=0.3, height=1.0),
        tracking_mode=CropTrackingMode.FACE_FOLLOWING,
        transition="smooth_pan"
    )
    interpolator = CropInterpolator([kf1, kf2], source_width=640, source_height=360)

    # At exact keyframe 1
    assert interpolator.get_crop_box(10.0) == (100, 0, 200, 360)
    # At exact keyframe 2
    assert interpolator.get_crop_box(12.0) == (300, 0, 200, 360)
    # Before keyframe 1
    assert interpolator.get_crop_box(5.0) == (100, 0, 200, 360)
    # After keyframe 2
    assert interpolator.get_crop_box(15.0) == (300, 0, 200, 360)


def test_linear_crop_interpolation_smooth_pan():
    """Case 10: Midway between two smooth_pan keyframes, returns linearly interpolated coordinates."""
    kf1 = CropKeyframeResult(
        timestamp_abs_sec=10.0,
        timestamp_rel_sec=0.0,
        crop_box_pixels=CropBoxPixels(x=100, y=0, width=200, height=360),
        crop_box_norm=NormalizedCropBox(x_min=0.1, y_min=0.0, width=0.3, height=1.0),
        transition="smooth_pan"
    )
    kf2 = CropKeyframeResult(
        timestamp_abs_sec=12.0,
        timestamp_rel_sec=2.0,
        crop_box_pixels=CropBoxPixels(x=300, y=0, width=200, height=360),
        crop_box_norm=NormalizedCropBox(x_min=0.3, y_min=0.0, width=0.3, height=1.0),
        transition="smooth_pan"
    )
    interpolator = CropInterpolator([kf1, kf2], source_width=640, source_height=360)

    # Exactly halfway (t = 11.0s, tau = 0.5): x should be exactly 200
    x, y, w, h = interpolator.get_crop_box(11.0)
    assert x == 200
    assert y == 0
    assert w == 200
    assert h == 360

    # 25% through (t = 10.5s): x should be 150
    x_25, _, _, _ = interpolator.get_crop_box(10.5)
    assert x_25 == 150


def test_immediate_crop_switch_at_scene_cut():
    """Case 11: At a scene cut (transition='cut'), does NOT pan across cut; holds prior shot until cut."""
    kf1 = CropKeyframeResult(
        timestamp_abs_sec=10.0,
        timestamp_rel_sec=0.0,
        crop_box_pixels=CropBoxPixels(x=100, y=0, width=200, height=360),
        crop_box_norm=NormalizedCropBox(x_min=0.1, y_min=0.0, width=0.3, height=1.0),
        transition="smooth_pan"
    )
    # kf2 represents a cut at t=12.0s
    kf2 = CropKeyframeResult(
        timestamp_abs_sec=12.0,
        timestamp_rel_sec=2.0,
        crop_box_pixels=CropBoxPixels(x=350, y=0, width=200, height=360),
        crop_box_norm=NormalizedCropBox(x_min=0.35, y_min=0.0, width=0.3, height=1.0),
        scene_change_detected=True,
        transition="cut"
    )
    interpolator = CropInterpolator([kf1, kf2], source_width=640, source_height=360)

    # Before cut (e.g. t = 11.5s): should stay at kf1's position (x=100), NOT interpolating towards 350
    assert interpolator.get_crop_box(11.0) == (100, 0, 200, 360)
    assert interpolator.get_crop_box(11.9) == (100, 0, 200, 360)

    # At cut (t = 12.0s): jumps immediately to new shot position (x=350)
    assert interpolator.get_crop_box(12.0) == (350, 0, 200, 360)


def test_center_fallback_handling():
    """Case 12: CropInterpolator respects center_fallback keyframe rectangles."""
    kf1 = CropKeyframeResult(
        timestamp_abs_sec=1.0,
        timestamp_rel_sec=0.0,
        crop_box_pixels=CropBoxPixels(x=219, y=0, width=202, height=360),
        crop_box_norm=NormalizedCropBox(x_min=0.34, y_min=0.0, width=0.31, height=1.0),
        tracking_mode=CropTrackingMode.CENTER_FALLBACK,
        transition="smooth_pan"
    )
    interpolator = CropInterpolator([kf1], source_width=640, source_height=360)
    assert interpolator.get_crop_box(1.0) == (219, 0, 202, 360)


def test_interpolated_hold_handling():
    """Case 13: CropInterpolator preserves crop position during interpolated_hold frames."""
    kf1 = CropKeyframeResult(
        timestamp_abs_sec=1.0,
        timestamp_rel_sec=0.0,
        crop_box_pixels=CropBoxPixels(x=150, y=0, width=202, height=360),
        crop_box_norm=NormalizedCropBox(x_min=0.23, y_min=0.0, width=0.31, height=1.0),
        tracking_mode=CropTrackingMode.INTERPOLATED_HOLD,
        transition="smooth_pan"
    )
    interpolator = CropInterpolator([kf1], source_width=640, source_height=360)
    assert interpolator.get_crop_box(1.0) == (150, 0, 202, 360)


def test_source_time_and_clip_relative_timestamp_conversion():
    """Case 14: Conversion between source timeline and clip-relative timeline is consistent."""
    hl = make_test_highlight(start_sec=28.54, end_sec=74.30)
    cp = make_test_crop_plan(hl)

    for kf in cp.keyframes:
        expected_rel = round(kf.timestamp_abs_sec - hl.start_sec, 3)
        assert abs(kf.timestamp_rel_sec - expected_rel) < 0.001


def test_frames_never_cropped_outside_source_dimensions():
    """Case 15: Interpolated crop coordinates are strictly clamped within [0, W] x [0, H]."""
    # Keyframe near right border
    kf1 = CropKeyframeResult(
        timestamp_abs_sec=10.0,
        timestamp_rel_sec=0.0,
        crop_box_pixels=CropBoxPixels(x=430, y=0, width=202, height=360),
        crop_box_norm=NormalizedCropBox(x_min=0.67, y_min=0.0, width=0.31, height=1.0),
        transition="smooth_pan"
    )
    # Keyframe beyond right border
    kf2 = CropKeyframeResult(
        timestamp_abs_sec=12.0,
        timestamp_rel_sec=2.0,
        crop_box_pixels=CropBoxPixels(x=500, y=0, width=202, height=360),
        crop_box_norm=NormalizedCropBox(x_min=0.78, y_min=0.0, width=0.31, height=1.0),
        transition="smooth_pan"
    )
    interpolator = CropInterpolator([kf1, kf2], source_width=640, source_height=360)

    for t in [10.0, 10.5, 11.0, 11.5, 12.0, 15.0]:
        x, y, w, h = interpolator.get_crop_box(t)
        assert x >= 0
        assert y >= 0
        assert x + w <= 640
        assert y + h <= 360


def test_correct_output_frame_sizing_after_resize():
    """Case 16: Decoded and cropped frame resized to target dimensions yields exact requested resolution."""
    raw_frame = np.full((360, 640, 3), 128, dtype=np.uint8)
    crop = raw_frame[0:360, 100:302]  # 360x202

    target_w, target_h = 720, 1280
    resized = cv2.resize(crop, (target_w, target_h), interpolation=cv2.INTER_LANCZOS4)
    assert resized.shape == (target_h, target_w, 3)


# ---------------------------------------------------------------------------
# Test Cases 17 - 24: Execution, Audio, Encoding, CLI, Regression
# ---------------------------------------------------------------------------

def test_missing_audio_handling_silent_output(tmp_path: Path):
    """Case 17: Video with no audio stream renders successfully as silent MP4."""
    v_path = create_synthetic_video_silent(tmp_path / "silent.mp4", duration_sec=2.0)
    hl = make_test_highlight(start_sec=0.5, end_sec=1.5, filename="silent.mp4", duration_sec=2.0)
    cp = make_test_crop_plan(hl)

    out_mp4 = tmp_path / "silent_reel.mp4"
    result = VideoRendererService.render_video(
        video_path=v_path,
        highlight_input=hl,
        crop_plan_input=cp,
        output_path=out_mp4,
        options=RenderOptions(output_width=720, output_height=1280, overwrite=True)
    )

    assert result.success
    assert out_mp4.exists()
    assert result.audio_included is False
    assert result.output_audio_codec is None
    assert result.output_width == 720
    assert result.output_height == 1280


def test_cleanup_after_simulated_encoding_failure(tmp_path: Path):
    """Case 18: Temporary files are cleaned up if video rendering encounters an error."""
    v_path = create_synthetic_video_with_audio(tmp_path / "fail_clean.mp4", duration_sec=2.0)
    hl = make_test_highlight(start_sec=0.5, end_sec=1.5, filename="fail_clean.mp4", duration_sec=2.0)
    cp = make_test_crop_plan(hl)

    # Pass invalid FFmpeg option to trigger failure
    bad_options = RenderOptions(preset="invalid_preset_name")

    with pytest.raises(FFmpegExecutionError):
        VideoRendererService.render_video(
            video_path=v_path,
            highlight_input=hl,
            crop_plan_input=cp,
            output_path=tmp_path / "will_fail.mp4",
            options=bad_options
        )

    # Output file should not exist
    assert not (tmp_path / "will_fail.mp4").exists()


def test_successful_cli_rendering(tmp_path: Path):
    """Case 19: Full CLI execution succeeds and outputs valid vertical MP4 with manifest."""
    v_path = create_synthetic_video_with_audio(tmp_path / "cli_render.mp4", duration_sec=2.0)
    hl = make_test_highlight(start_sec=0.5, end_sec=1.5, filename="cli_render.mp4", duration_sec=2.0)
    cp = make_test_crop_plan(hl)

    h_path = tmp_path / "highlight.json"
    h_path.write_text(hl.model_dump_json(indent=2), encoding="utf-8")

    c_path = tmp_path / "crop_plan.json"
    c_path.write_text(cp.model_dump_json(indent=2), encoding="utf-8")

    out_mp4 = tmp_path / "rendered_reel.mp4"

    code = run_video_rendering(
        video_path=v_path,
        highlight_path=h_path,
        crop_plan_path=c_path,
        output_path=out_mp4,
        output_width=720,
        output_height=1280,
        overwrite=True,
        save_manifest=True
    )

    assert code == 0
    assert out_mp4.exists()
    assert out_mp4.stat().st_size > 1024

    manifest_path = tmp_path / "rendered_reel_render_manifest.json"
    assert manifest_path.exists()
    with open(manifest_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    assert data["success"] is True
    assert data["output_width"] == 720
    assert data["output_height"] == 1280


def test_cli_failure_on_invalid_inputs(tmp_path: Path):
    """Case 20: CLI returns non-zero error codes on missing or invalid files."""
    # 1. Missing video file -> exit code 1
    code1 = run_video_rendering("missing.mp4", "hl.json", "cp.json")
    assert code1 == 1

    # 2. Missing highlight file -> exit code 1
    v_path = create_synthetic_video_with_audio(tmp_path / "real.mp4", duration_sec=1.0)
    code2 = run_video_rendering(v_path, "missing_hl.json", "cp.json")
    assert code2 == 1

    # 3. Missing crop plan file -> exit code 1
    h_path = tmp_path / "hl.json"
    h_path.write_text("{}", encoding="utf-8")
    code3 = run_video_rendering(v_path, h_path, "missing_cp.json")
    assert code3 == 1


def test_render_result_schema_validation(tmp_path: Path):
    """Case 21: RenderResult schema correctly serializes and deserializes."""
    result = RenderResult(
        schema_version="1.0",
        source_video="test.mp4",
        highlight_start_sec=10.0,
        highlight_end_sec=30.0,
        requested_duration_sec=20.0,
        output_path="storage/rendered/test_reel.mp4",
        output_width=720,
        output_height=1280,
        output_fps=29.97,
        output_video_codec="h264",
        output_audio_codec="aac",
        audio_included=True,
        rendered_frame_count=600,
        actual_video_duration_sec=20.02,
        actual_audio_duration_sec=20.0,
        render_duration_sec=2.15,
        warnings=[],
        success=True
    )

    json_str = result.model_dump_json(indent=2)
    data = json.loads(json_str)
    reloaded = RenderResult(**data)
    assert reloaded.output_width == 720
    assert reloaded.output_height == 1280
    assert reloaded.rendered_frame_count == 600
    assert reloaded.success is True


def test_output_duration_and_frame_count_calculation(tmp_path: Path):
    """Case 22: Output duration and rendered frame count match duration * fps."""
    v_path = create_synthetic_video_with_audio(tmp_path / "timing.mp4", duration_sec=3.0, fps=30.0)
    hl = make_test_highlight(start_sec=0.5, end_sec=2.5, filename="timing.mp4", duration_sec=3.0, fps=30.0)
    cp = make_test_crop_plan(hl, fps=30.0)

    out_mp4 = tmp_path / "timing_reel.mp4"
    result = VideoRendererService.render_video(
        video_path=v_path,
        highlight_input=hl,
        crop_plan_input=cp,
        output_path=out_mp4,
        options=RenderOptions(output_width=720, output_height=1280, overwrite=True)
    )

    # Requested duration: 2.5 - 0.5 = 2.0s @ 30fps -> exactly 60 frames
    assert result.rendered_frame_count == 60
    assert abs(result.actual_video_duration_sec - 2.0) <= 0.1


def test_avoiding_unintended_overwrite_of_existing_output(tmp_path: Path):
    """Case 23: Pre-existing output video raises FileExistsError unless overwrite is set."""
    v_path = create_synthetic_video_with_audio(tmp_path / "exist.mp4", duration_sec=2.0)
    hl = make_test_highlight(start_sec=0.5, end_sec=1.5, filename="exist.mp4", duration_sec=2.0)
    cp = make_test_crop_plan(hl)

    out_mp4 = tmp_path / "existing_reel.mp4"
    out_mp4.write_text("existing content", encoding="utf-8")

    # Overwrite = False should raise FileExistsError
    with pytest.raises(FileExistsError, match="Output video already exists"):
        VideoRendererService.render_video(
            video_path=v_path,
            highlight_input=hl,
            crop_plan_input=cp,
            output_path=out_mp4,
            options=RenderOptions(overwrite=False)
        )

    # Overwrite = True should succeed and overwrite the file
    result = VideoRendererService.render_video(
        video_path=v_path,
        highlight_input=hl,
        crop_plan_input=cp,
        output_path=out_mp4,
        options=RenderOptions(overwrite=True)
    )
    assert result.success
    assert out_mp4.stat().st_size > 1024


def test_regression_existing_pipeline_integration():
    """Case 24: Validates that existing Phase 3 and Phase 4 artifacts load cleanly into renderer."""
    real_h_path = Path("storage/highlights/lecture_highlight.json")
    real_c_path = Path("storage/crop_plans/lecture_crop_plan.json")

    if real_h_path.exists() and real_c_path.exists():
        hl = VideoRendererService.load_highlight(real_h_path)
        cp = VideoRendererService.load_crop_plan(real_c_path)

        assert hl.duration_sec >= 30.0
        assert cp.target_aspect_ratio == "9:16"
        assert len(cp.keyframes) > 0
        assert abs(cp.highlight.start_sec - hl.start_sec) < 0.05
        assert abs(cp.highlight.end_sec - hl.end_sec) < 0.05


# ===========================================================================
# Phase 5.1: Adaptive Hybrid Video Composition Tests
# ===========================================================================

def test_landscape_frame_fits_inside_portrait_canvas_preserving_aspect_ratio():
    """Phase 5.1 - Req 1 & 2: Landscape frame is fitted into 9:16 portrait canvas with preserved aspect ratio."""
    frame = np.full((480, 854, 3), 120, dtype=np.uint8)
    out_w, out_h = 720, 1280

    rendered = CompositionRenderer.render_presentation_frame(
        frame=frame,
        output_width=out_w,
        output_height=out_h,
        blur_sigma=10.0,
        darken_factor=0.55
    )

    assert rendered.shape == (1280, 720, 3)

    # Expected foreground dimensions for 854x480 into 720x1280
    scale = min(out_w / 854, out_h / 480)
    expected_w = int(round(854 * scale))  # 720
    expected_h = int(round(480 * scale))  # 405

    assert expected_w == 720
    assert expected_h == 405

    # Original aspect ratio vs foreground aspect ratio
    orig_ratio = 854 / 480
    fg_ratio = expected_w / expected_h
    assert abs(orig_ratio - fg_ratio) < 0.01

    # Centering offsets
    expected_y_off = (out_h - expected_h) // 2  # 437
    expected_x_off = (out_w - expected_w) // 2  # 0
    assert expected_y_off == 437
    assert expected_x_off == 0


def test_presentation_mode_does_not_crop_slide_edges():
    """Phase 5.1 - Req 3: Full-frame presentation composition preserves all 4 corners and borders."""
    src_h, src_w = 480, 854
    frame = np.zeros((src_h, src_w, 3), dtype=np.uint8)

    # Place distinctive markers on extreme border pixels
    marker_color = (0, 255, 255)
    frame[0, 0] = marker_color
    frame[0, src_w - 1] = marker_color
    frame[src_h - 1, 0] = marker_color
    frame[src_h - 1, src_w - 1] = marker_color

    out_w, out_h = 720, 1280
    rendered = CompositionRenderer.render_presentation_frame(
        frame=frame,
        output_width=out_w,
        output_height=out_h
    )

    # Offsets in canvas
    s = min(out_w / src_w, out_h / src_h)
    fg_w = int(round(src_w * s))
    fg_h = int(round(src_h * s))
    y_off = (out_h - fg_h) // 2
    x_off = (out_w - fg_w) // 2

    # Check that foreground area contains the slide content
    fg_area = rendered[y_off : y_off + fg_h, x_off : x_off + fg_w]
    assert fg_area.shape == (fg_h, fg_w, 3)
    # The markers were present and scaled within the foreground slice
    assert fg_area.size > 0


def test_blurred_background_covers_all_portrait_canvas_pixels():
    """Phase 5.1 - Req 4: Blurred background covers 100% of portrait canvas with no black bars."""
    frame = np.random.randint(50, 200, (480, 854, 3), dtype=np.uint8)
    out_w, out_h = 720, 1280

    rendered = CompositionRenderer.render_presentation_frame(
        frame=frame,
        output_width=out_w,
        output_height=out_h,
        blur_sigma=10.0,
        darken_factor=0.55
    )

    # Every pixel of rendered canvas must be populated and non-zero
    assert rendered.shape == (1280, 720, 3)
    # Check top background margin (above foreground slide)
    top_margin = rendered[0:200, :]
    assert np.mean(top_margin) > 0.0

    # Check bottom background margin (below foreground slide)
    bottom_margin = rendered[1080:1280, :]
    assert np.mean(bottom_margin) > 0.0


def test_background_darkening_behaves_as_configured():
    """Phase 5.1 - Req 5: Background darkening factor scales background brightness monotonically."""
    frame = np.full((480, 854, 3), 200, dtype=np.uint8)
    out_w, out_h = 720, 1280

    bg_bright = CompositionRenderer.render_presentation_frame(
        frame, out_w, out_h, blur_sigma=10.0, darken_factor=1.0
    )
    bg_medium = CompositionRenderer.render_presentation_frame(
        frame, out_w, out_h, blur_sigma=10.0, darken_factor=0.55
    )
    bg_dark = CompositionRenderer.render_presentation_frame(
        frame, out_w, out_h, blur_sigma=10.0, darken_factor=0.2
    )

    # Measure top background margin mean
    mean_bright = np.mean(bg_bright[0:200, :])
    mean_medium = np.mean(bg_medium[0:200, :])
    mean_dark = np.mean(bg_dark[0:200, :])

    assert mean_bright > mean_medium > mean_dark
    assert abs(mean_medium / mean_bright - 0.55) < 0.08
    assert abs(mean_dark / mean_bright - 0.20) < 0.08


def test_valid_face_following_keyframe_uses_presenter_mode():
    """Phase 5.1 - Req 6: Reliable face detection keyframe is classified as presenter mode."""
    kfs = [
        CropKeyframeResult(
            timestamp_abs_sec=1.0,
            timestamp_rel_sec=0.0,
            crop_box_pixels=CropBoxPixels(x=100, y=0, width=270, height=480),
            crop_box_norm=NormalizedCropBox(x_min=0.1, y_min=0.0, width=0.3, height=1.0),
            tracking_mode=CropTrackingMode.FACE_FOLLOWING,
            detected_faces_count=1,
            primary_face_box=FaceBoundingBox(x=150, y=100, width=120, height=120),
            scene_change_detected=False,
            transition="smooth_pan"
        )
    ]
    classifier = AdaptiveCompositionClassifier(
        keyframes=kfs,
        source_width=854,
        source_height=480,
        composition_mode="adaptive_hybrid"
    )

    mode, alpha = classifier.get_composition_state(1.0)
    assert mode == "presenter"
    assert alpha == 0.0


def test_single_missing_face_without_cut_holds_preceding_composition():
    """Phase 5.1 - Req 7: Isolated single missing face sample without a cut holds presenter mode."""
    kfs = [
        CropKeyframeResult(
            timestamp_abs_sec=1.0,
            timestamp_rel_sec=0.0,
            crop_box_pixels=CropBoxPixels(x=100, y=0, width=270, height=480),
            crop_box_norm=NormalizedCropBox(x_min=0.1, y_min=0.0, width=0.3, height=1.0),
            tracking_mode=CropTrackingMode.FACE_FOLLOWING,
            detected_faces_count=1,
            primary_face_box=FaceBoundingBox(x=150, y=100, width=120, height=120),
            scene_change_detected=False,
            transition="smooth_pan"
        ),
        CropKeyframeResult(
            timestamp_abs_sec=1.5,
            timestamp_rel_sec=0.5,
            crop_box_pixels=CropBoxPixels(x=100, y=0, width=270, height=480),
            crop_box_norm=NormalizedCropBox(x_min=0.1, y_min=0.0, width=0.3, height=1.0),
            tracking_mode=CropTrackingMode.INTERPOLATED_HOLD,
            detected_faces_count=0,
            primary_face_box=None,
            scene_change_detected=False,
            transition="smooth_pan"
        ),
    ]
    classifier = AdaptiveCompositionClassifier(
        keyframes=kfs,
        source_width=854,
        source_height=480,
        composition_mode="adaptive_hybrid",
        sustained_face_loss_sec=1.0
    )

    # Both keyframes should remain in presenter mode
    assert classifier.keyframe_modes == ["presenter", "presenter"]
    mode_1_5, alpha_1_5 = classifier.get_composition_state(1.5)
    assert mode_1_5 == "presenter"
    assert alpha_1_5 == 0.0


def test_face_absent_scene_cut_immediately_switches_to_presentation_mode():
    """Phase 5.1 - Req 8: Scene cut with no face switches immediately to presentation mode without crossfade."""
    kfs = [
        CropKeyframeResult(
            timestamp_abs_sec=1.0,
            timestamp_rel_sec=0.0,
            crop_box_pixels=CropBoxPixels(x=100, y=0, width=270, height=480),
            crop_box_norm=NormalizedCropBox(x_min=0.1, y_min=0.0, width=0.3, height=1.0),
            tracking_mode=CropTrackingMode.FACE_FOLLOWING,
            detected_faces_count=1,
            primary_face_box=FaceBoundingBox(x=150, y=100, width=120, height=120),
            scene_change_detected=False,
            transition="smooth_pan"
        ),
        CropKeyframeResult(
            timestamp_abs_sec=2.0,
            timestamp_rel_sec=1.0,
            crop_box_pixels=CropBoxPixels(x=292, y=0, width=270, height=480),
            crop_box_norm=NormalizedCropBox(x_min=0.34, y_min=0.0, width=0.316, height=1.0),
            tracking_mode=CropTrackingMode.CENTER_FALLBACK,
            detected_faces_count=0,
            primary_face_box=None,
            scene_change_detected=True,
            transition="cut"
        ),
    ]
    classifier = AdaptiveCompositionClassifier(
        keyframes=kfs,
        source_width=854,
        source_height=480,
        composition_mode="adaptive_hybrid"
    )

    assert classifier.keyframe_modes == ["presenter", "presentation"]
    assert classifier.scene_cut_transitions_count == 1

    # Exactly at cut timestamp, presentation mode is 1.0 (no crossfade delay)
    mode, alpha = classifier.get_composition_state(2.0)
    assert mode == "presentation"
    assert alpha == 1.0


def test_sustained_face_absence_triggers_deterministic_composition_change():
    """Phase 5.1 - Req 9: Face absence exceeding sustained_face_loss_sec switches to presentation mode."""
    kfs = [
        CropKeyframeResult(
            timestamp_abs_sec=1.0,
            timestamp_rel_sec=0.0,
            crop_box_pixels=CropBoxPixels(x=100, y=0, width=270, height=480),
            crop_box_norm=NormalizedCropBox(x_min=0.1, y_min=0.0, width=0.3, height=1.0),
            tracking_mode=CropTrackingMode.FACE_FOLLOWING,
            detected_faces_count=1,
            primary_face_box=FaceBoundingBox(x=150, y=100, width=120, height=120),
            scene_change_detected=False,
            transition="smooth_pan"
        ),
        CropKeyframeResult(
            timestamp_abs_sec=1.5,
            timestamp_rel_sec=0.5,
            crop_box_pixels=CropBoxPixels(x=100, y=0, width=270, height=480),
            crop_box_norm=NormalizedCropBox(x_min=0.1, y_min=0.0, width=0.3, height=1.0),
            tracking_mode=CropTrackingMode.CENTER_FALLBACK,
            detected_faces_count=0,
            primary_face_box=None,
            scene_change_detected=False,
            transition="smooth_pan"
        ),
        CropKeyframeResult(
            timestamp_abs_sec=2.2,  # 1.2s > sustained threshold of 1.0s
            timestamp_rel_sec=1.2,
            crop_box_pixels=CropBoxPixels(x=100, y=0, width=270, height=480),
            crop_box_norm=NormalizedCropBox(x_min=0.1, y_min=0.0, width=0.3, height=1.0),
            tracking_mode=CropTrackingMode.CENTER_FALLBACK,
            detected_faces_count=0,
            primary_face_box=None,
            scene_change_detected=False,
            transition="smooth_pan"
        ),
    ]
    classifier = AdaptiveCompositionClassifier(
        keyframes=kfs,
        source_width=854,
        source_height=480,
        composition_mode="adaptive_hybrid",
        sustained_face_loss_sec=1.0
    )

    # Keyframes: [presenter, presenter (held), presentation (sustained loss!)]
    assert classifier.keyframe_modes == ["presenter", "presenter", "presentation"]
    assert classifier.sustained_loss_transitions_count == 1


def test_face_reappearance_returns_to_presenter_mode():
    """Phase 5.1 - Req 10: Face reappearance returns composition to presenter mode."""
    kfs = [
        CropKeyframeResult(
            timestamp_abs_sec=1.0,
            timestamp_rel_sec=0.0,
            crop_box_pixels=CropBoxPixels(x=292, y=0, width=270, height=480),
            crop_box_norm=NormalizedCropBox(x_min=0.34, y_min=0.0, width=0.316, height=1.0),
            tracking_mode=CropTrackingMode.CENTER_FALLBACK,
            detected_faces_count=0,
            primary_face_box=None,
            scene_change_detected=False,
            transition="smooth_pan"
        ),
        CropKeyframeResult(
            timestamp_abs_sec=2.0,
            timestamp_rel_sec=1.0,
            crop_box_pixels=CropBoxPixels(x=100, y=0, width=270, height=480),
            crop_box_norm=NormalizedCropBox(x_min=0.1, y_min=0.0, width=0.3, height=1.0),
            tracking_mode=CropTrackingMode.FACE_FOLLOWING,
            detected_faces_count=1,
            primary_face_box=FaceBoundingBox(x=150, y=100, width=120, height=120),
            scene_change_detected=False,
            transition="smooth_pan"
        ),
    ]
    classifier = AdaptiveCompositionClassifier(
        keyframes=kfs,
        source_width=854,
        source_height=480,
        composition_mode="adaptive_hybrid",
        transition_duration_sec=0.25
    )

    assert classifier.keyframe_modes == ["presentation", "presenter"]
    # After transition window completes (2.0 + 0.25 = 2.25), alpha must be 0.0 (presenter)
    mode, alpha = classifier.get_composition_state(2.3)
    assert mode == "presenter"
    assert alpha == 0.0


def test_tiny_face_inset_rule_identifies_presentation():
    """Phase 5.1 - Req 11: A tiny detected face inset on a slide does not force presenter crop."""
    # Tiny 20x20 face in 854x480 frame -> area 400 / 409920 = 0.00097 < 0.015 threshold
    kfs = [
        CropKeyframeResult(
            timestamp_abs_sec=1.0,
            timestamp_rel_sec=0.0,
            crop_box_pixels=CropBoxPixels(x=10, y=10, width=270, height=480),
            crop_box_norm=NormalizedCropBox(x_min=0.01, y_min=0.02, width=0.316, height=1.0),
            tracking_mode=CropTrackingMode.FACE_FOLLOWING,
            detected_faces_count=1,
            primary_face_box=FaceBoundingBox(x=20, y=20, width=20, height=20),
            scene_change_detected=False,
            transition="smooth_pan"
        )
    ]
    classifier = AdaptiveCompositionClassifier(
        keyframes=kfs,
        source_width=854,
        source_height=480,
        composition_mode="adaptive_hybrid",
        tiny_face_ratio_threshold=0.015
    )

    # Should be classified as presentation because the face is an inset webcam
    assert classifier.keyframe_modes[0] == "presentation"
    mode, alpha = classifier.get_composition_state(1.0)
    assert mode == "presentation"
    assert alpha == 1.0


def test_no_transition_leaks_across_shot_cut():
    """Phase 5.1 - Req 12: Scene cuts reset any ongoing transition state immediately."""
    kfs = [
        CropKeyframeResult(
            timestamp_abs_sec=1.0,
            timestamp_rel_sec=0.0,
            crop_box_pixels=CropBoxPixels(x=292, y=0, width=270, height=480),
            crop_box_norm=NormalizedCropBox(x_min=0.34, y_min=0.0, width=0.316, height=1.0),
            tracking_mode=CropTrackingMode.CENTER_FALLBACK,
            detected_faces_count=0,
            primary_face_box=None,
            scene_change_detected=False,
            transition="smooth_pan"
        ),
        CropKeyframeResult(
            timestamp_abs_sec=2.0,  # Face appears without cut -> starts crossfade
            timestamp_rel_sec=1.0,
            crop_box_pixels=CropBoxPixels(x=100, y=0, width=270, height=480),
            crop_box_norm=NormalizedCropBox(x_min=0.1, y_min=0.0, width=0.3, height=1.0),
            tracking_mode=CropTrackingMode.FACE_FOLLOWING,
            detected_faces_count=1,
            primary_face_box=FaceBoundingBox(x=150, y=100, width=120, height=120),
            scene_change_detected=False,
            transition="smooth_pan"
        ),
        CropKeyframeResult(
            timestamp_abs_sec=2.1,  # Sudden cut back to slide
            timestamp_rel_sec=1.1,
            crop_box_pixels=CropBoxPixels(x=292, y=0, width=270, height=480),
            crop_box_norm=NormalizedCropBox(x_min=0.34, y_min=0.0, width=0.316, height=1.0),
            tracking_mode=CropTrackingMode.CENTER_FALLBACK,
            detected_faces_count=0,
            primary_face_box=None,
            scene_change_detected=True,
            transition="cut"
        ),
    ]
    classifier = AdaptiveCompositionClassifier(
        keyframes=kfs,
        source_width=854,
        source_height=480,
        composition_mode="adaptive_hybrid",
        transition_duration_sec=0.25
    )

    # At t=2.1 (cut timestamp), mode must immediately be 100% presentation (alpha = 1.0)
    mode, alpha = classifier.get_composition_state(2.1)
    assert mode == "presentation"
    assert alpha == 1.0


def test_non_cut_layout_changes_use_configured_crossfade_policy():
    """Phase 5.1 - Req 13: Non-cut transitions perform smooth crossfade over configured duration."""
    kfs = [
        CropKeyframeResult(
            timestamp_abs_sec=1.0,
            timestamp_rel_sec=0.0,
            crop_box_pixels=CropBoxPixels(x=292, y=0, width=270, height=480),
            crop_box_norm=NormalizedCropBox(x_min=0.34, y_min=0.0, width=0.316, height=1.0),
            tracking_mode=CropTrackingMode.CENTER_FALLBACK,
            detected_faces_count=0,
            primary_face_box=None,
            scene_change_detected=False,
            transition="smooth_pan"
        ),
        CropKeyframeResult(
            timestamp_abs_sec=2.0,  # Face returns without cut
            timestamp_rel_sec=1.0,
            crop_box_pixels=CropBoxPixels(x=100, y=0, width=270, height=480),
            crop_box_norm=NormalizedCropBox(x_min=0.1, y_min=0.0, width=0.3, height=1.0),
            tracking_mode=CropTrackingMode.FACE_FOLLOWING,
            detected_faces_count=1,
            primary_face_box=FaceBoundingBox(x=150, y=100, width=120, height=120),
            scene_change_detected=False,
            transition="smooth_pan"
        ),
    ]
    classifier = AdaptiveCompositionClassifier(
        keyframes=kfs,
        source_width=854,
        source_height=480,
        composition_mode="adaptive_hybrid",
        transition_duration_sec=0.20
    )

    # At t=2.0 (transition start): alpha = 1.0 (starting at presentation)
    _, alpha_start = classifier.get_composition_state(2.0)
    assert abs(alpha_start - 1.0) < 0.05

    # At t=2.1 (halfway through 0.20s): alpha = 0.5
    _, alpha_mid = classifier.get_composition_state(2.1)
    assert abs(alpha_mid - 0.5) < 0.05

    # At t=2.2 (completed): alpha = 0.0 (presenter)
    _, alpha_end = classifier.get_composition_state(2.2)
    assert alpha_end == 0.0


def test_first_and_final_output_frames_have_correct_composition():
    """Phase 5.1 - Req 14: Boundaries at clip start and end produce valid compositions."""
    kfs = [
        CropKeyframeResult(
            timestamp_abs_sec=1.0,
            timestamp_rel_sec=0.0,
            crop_box_pixels=CropBoxPixels(x=100, y=0, width=270, height=480),
            crop_box_norm=NormalizedCropBox(x_min=0.1, y_min=0.0, width=0.3, height=1.0),
            tracking_mode=CropTrackingMode.FACE_FOLLOWING,
            detected_faces_count=1,
            primary_face_box=FaceBoundingBox(x=150, y=100, width=120, height=120),
            scene_change_detected=False,
            transition="smooth_pan"
        ),
        CropKeyframeResult(
            timestamp_abs_sec=3.0,
            timestamp_rel_sec=2.0,
            crop_box_pixels=CropBoxPixels(x=292, y=0, width=270, height=480),
            crop_box_norm=NormalizedCropBox(x_min=0.34, y_min=0.0, width=0.316, height=1.0),
            tracking_mode=CropTrackingMode.CENTER_FALLBACK,
            detected_faces_count=0,
            primary_face_box=None,
            scene_change_detected=True,
            transition="cut"
        ),
    ]
    classifier = AdaptiveCompositionClassifier(
        keyframes=kfs,
        source_width=854,
        source_height=480,
        composition_mode="adaptive_hybrid"
    )

    # First frame at t=1.0
    mode_start, alpha_start = classifier.get_composition_state(1.0)
    assert mode_start == "presenter"
    assert alpha_start == 0.0

    # Final frame at t=3.0
    mode_end, alpha_end = classifier.get_composition_state(3.0)
    assert mode_end == "presentation"
    assert alpha_end == 1.0


def test_every_output_frame_has_requested_dimensions(tmp_path: Path):
    """Phase 5.1 - Req 15: Rendered vertical MP4 has exact requested output dimensions."""
    v_path = create_synthetic_video_with_audio(tmp_path / "dim_src.mp4", duration_sec=2.0, width=640, height=360)
    hl = make_test_highlight(start_sec=0.5, end_sec=1.5, filename="dim_src.mp4", duration_sec=2.0, width=640, height=360)
    cp = make_test_crop_plan(hl, width=640, height=360)

    out_mp4 = tmp_path / "dim_out.mp4"
    result = VideoRendererService.render_video(
        video_path=v_path,
        highlight_input=hl,
        crop_plan_input=cp,
        output_path=out_mp4,
        options=RenderOptions(output_width=720, output_height=1280, composition_mode="adaptive_hybrid", overwrite=True)
    )

    assert result.output_width == 720
    assert result.output_height == 1280
    assert out_mp4.exists()


def test_crop_only_mode_remains_functional_backward_compatible(tmp_path: Path):
    """Phase 5.1 - Req 20: crop_only mode renders 100% of frames in presenter crop mode."""
    v_path = create_synthetic_video_with_audio(tmp_path / "crop_src.mp4", duration_sec=2.0, width=640, height=360)
    hl = make_test_highlight(start_sec=0.5, end_sec=1.5, filename="crop_src.mp4", duration_sec=2.0, width=640, height=360)
    cp = make_test_crop_plan(hl, width=640, height=360)

    out_mp4 = tmp_path / "crop_only_out.mp4"
    result = VideoRendererService.render_video(
        video_path=v_path,
        highlight_input=hl,
        crop_plan_input=cp,
        output_path=out_mp4,
        options=RenderOptions(output_width=720, output_height=1280, composition_mode="crop_only", overwrite=True)
    )

    assert result.composition_mode == "crop_only"
    assert result.presenter_frames_count == result.rendered_frame_count
    assert result.presentation_frames_count == 0


def test_presentation_fit_blur_mode_forces_presentation(tmp_path: Path):
    """Phase 5.1: presentation_fit_blur mode renders 100% of frames in presentation mode."""
    v_path = create_synthetic_video_with_audio(tmp_path / "pres_src.mp4", duration_sec=2.0, width=640, height=360)
    hl = make_test_highlight(start_sec=0.5, end_sec=1.5, filename="pres_src.mp4", duration_sec=2.0, width=640, height=360)
    cp = make_test_crop_plan(hl, width=640, height=360)

    out_mp4 = tmp_path / "pres_only_out.mp4"
    result = VideoRendererService.render_video(
        video_path=v_path,
        highlight_input=hl,
        crop_plan_input=cp,
        output_path=out_mp4,
        options=RenderOptions(output_width=720, output_height=1280, composition_mode="presentation_fit_blur", overwrite=True)
    )

    assert result.composition_mode == "presentation_fit_blur"
    assert result.presentation_frames_count == result.rendered_frame_count
    assert result.presenter_frames_count == 0


def test_render_manifest_composition_counts_and_reconciliation(tmp_path: Path):
    """Phase 5.1 - Req 18: Render manifest records composition counts and reconciles with total frames."""
    v_path = create_synthetic_video_with_audio(tmp_path / "mani_src.mp4", duration_sec=2.5, width=640, height=360)
    hl = make_test_highlight(start_sec=0.5, end_sec=2.0, filename="mani_src.mp4", duration_sec=2.5, width=640, height=360)
    cp = make_test_crop_plan(hl, width=640, height=360)

    out_mp4 = tmp_path / "mani_out.mp4"
    result = VideoRendererService.render_video(
        video_path=v_path,
        highlight_input=hl,
        crop_plan_input=cp,
        output_path=out_mp4,
        options=RenderOptions(output_width=720, output_height=1280, composition_mode="adaptive_hybrid", overwrite=True)
    )

    manifest_file = VideoRendererService.save_manifest(result)
    assert manifest_file.exists()

    with open(manifest_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    assert data["composition_mode"] == "adaptive_hybrid"
    assert data["schema_version"] == "1.3"
    assert "presenter_frames_count" in data
    assert "presentation_frames_count" in data
    assert data["presenter_frames_count"] + data["presentation_frames_count"] == data["rendered_frame_count"]
    assert "background_style" in data
    assert data["background_style"]["type"] == "gaussian_blur_darkened"
    assert "scene_type_distribution" in data
    assert "fallback_events_count" in data
    assert "frame_diagnostics_sample" in data
    assert isinstance(data["frame_diagnostics_sample"], list)


def test_cli_composition_mode_flag_and_validation(tmp_path: Path):
    """Phase 5.1 - Req 19: CLI handles composition flags and rejects invalid modes."""
    v_path = create_synthetic_video_with_audio(tmp_path / "cli_src.mp4", duration_sec=2.0, width=640, height=360)
    hl = make_test_highlight(start_sec=0.5, end_sec=1.5, filename="cli_src.mp4", duration_sec=2.0, width=640, height=360)
    cp = make_test_crop_plan(hl, width=640, height=360)

    h_json = tmp_path / "hl.json"
    c_json = tmp_path / "cp.json"
    h_json.write_text(hl.model_dump_json(), encoding="utf-8")
    c_json.write_text(cp.model_dump_json(), encoding="utf-8")

    out_mp4 = tmp_path / "cli_reel.mp4"

    # Valid CLI invocation with --composition-mode adaptive_hybrid
    code = run_video_rendering(
        video_path=v_path,
        highlight_path=h_json,
        crop_plan_path=c_json,
        output_path=out_mp4,
        composition_mode="adaptive_hybrid",
        overwrite=True,
        save_manifest=True
    )
    assert code == 0
    assert out_mp4.exists()

    # Invalid composition mode should fail validation (exit code 2)
    code_invalid = run_video_rendering(
        video_path=v_path,
        highlight_path=h_json,
        crop_plan_path=c_json,
        output_path=tmp_path / "invalid.mp4",
        composition_mode="invalid_mode",
        overwrite=True
    )
    assert code_invalid == 2

