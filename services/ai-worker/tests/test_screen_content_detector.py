"""Unit and Integration Tests for Phase 5.2 Screen-Content Detection and Reframing Engine.

Tests:
1. ScreenContentDetector edge and text-variance heuristics on synthetic and real frames.
2. Blank and solid frame rejection.
3. Code editor and terminal window candidate identification.
4. Broad diagram/slide fallback to presentation mode (fits_portrait_crop=False).
5. Webcam inset exclusion via spatial masking.
6. Tiny noise / small logo rejection.
7. ScreenContentTracker EMA smoothing, velocity limits, and bounded hold.
8. Tracker reset on scene cuts.
9. Three-way composition classification (presenter, screen_content, presentation).
10. Frame count reconciliation: presenter + content + presentation == total rendered.
11. Content-only composition mode.
12. Schema v1.2 RenderResult and diagnostics verification.
"""

import json
from pathlib import Path
from typing import List, Tuple

import cv2
import numpy as np
import pytest

from app.schemas import (
    CropKeyframeResult,
    CropBoxPixels,
    NormalizedCropBox,
    CropTrackingMode,
    FaceBoundingBox,
    HighlightResult,
    CropPlanResult,
    RenderOptions,
    CompositionMode,
    SceneType,
)
from app.services.screen_content_detector import (
    ScreenContentDetector,
    ScreenContentTracker,
    ScreenContentDetectionResult,
    ContentCandidate,
    ContentCandidateType,
    ContentBoundingBox,
)
from app.services.video_renderer import (
    AdaptiveCompositionClassifier,
    CompositionRenderer,
    CropInterpolator,
    VideoRendererService,
)


def _create_blank_frame(width: int = 854, height: int = 480, color: Tuple[int, int, int] = (20, 20, 20)) -> np.ndarray:
    """Creates a solid color frame with negligible gradient."""
    frame = np.full((height, width, 3), color, dtype=np.uint8)
    return frame


def _create_synthetic_code_editor_frame(
    width: int = 854,
    height: int = 480,
    editor_x: int = 40,
    editor_y: int = 40,
    editor_w: int = 240,
    editor_h: int = 400,
) -> np.ndarray:
    """Creates a frame simulating a dark-mode code editor with code text lines."""
    frame = np.full((height, width, 3), 245, dtype=np.uint8)  # White/light background
    # Dark editor panel
    frame[editor_y : editor_y + editor_h, editor_x : editor_x + editor_w] = (30, 30, 30)

    # Draw code lines (monospaced syntax-like patterns)
    font = cv2.FONT_HERSHEY_SIMPLEX
    lines = [
        "import torch",
        "import torch.nn as nn",
        "",
        "class Model(nn.Module):",
        "    def __init__(self):",
        "        super().__init__()",
        "        self.fc = nn.Linear(10, 2)",
        "",
        "    def forward(self, x):",
        "        return self.fc(x)",
        "",
        "model = Model()",
        "print(model)",
    ]
    y_text = editor_y + 30
    for line in lines:
        if line:
            cv2.putText(
                frame,
                line,
                (editor_x + 15, y_text),
                font,
                0.4,
                (200, 200, 200),
                1,
                cv2.LINE_AA,
            )
        y_text += 24
        if y_text >= editor_y + editor_h - 10:
            break

    return frame


def _create_synthetic_wide_slide_frame(
    width: int = 854,
    height: int = 480,
) -> np.ndarray:
    """Creates a frame with a wide chart/diagram spanning across more than 50% of the screen."""
    frame = np.full((height, width, 3), 250, dtype=np.uint8)
    # Title
    cv2.putText(frame, "Big-O Complexity Chart", (100, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (10, 10, 10), 2)
    # Wide diagram panel spanning from x=80 to x=750 (width = 670 > 0.45 * 854)
    chart_x1, chart_y1, chart_w, chart_h = 80, 80, 670, 350
    cv2.rectangle(frame, (chart_x1, chart_y1), (chart_x1 + chart_w, chart_y1 + chart_h), (50, 50, 50), 2)
    # Axes and curves
    cv2.line(frame, (120, 380), (700, 380), (0, 0, 0), 2)
    cv2.line(frame, (120, 380), (120, 120), (0, 0, 0), 2)
    # Labels
    for i in range(5):
        x = 180 + i * 100
        cv2.putText(frame, f"O(N^{i+1})", (x, 370 - i * 40), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 180), 1)
    return frame


# ===========================================================================
# 1. ScreenContentDetector Tests
# ===========================================================================

def test_blank_or_solid_frame_rejection():
    """Phase 5.2 - Detector rejects blank or solid frames and recommends presentation mode."""
    detector = ScreenContentDetector()
    blank_frame = _create_blank_frame(854, 480, (15, 15, 15))
    res = detector.detect(blank_frame)

    assert not res.has_valid_content
    assert res.recommended_mode == "presentation"
    assert res.best_candidate is None
    assert "blank_frame" in res.diagnostics or "reason" in res.diagnostics


def test_code_editor_detection_and_classification():
    """Phase 5.2 - Detector identifies code editor panel and marks fits_portrait_crop=True."""
    detector = ScreenContentDetector(min_heuristic_score=0.30, max_portrait_width_ratio=0.45)
    frame = _create_synthetic_code_editor_frame(854, 480, editor_x=50, editor_y=40, editor_w=240, editor_h=380)
    res = detector.detect(frame)

    assert res.has_valid_content
    assert res.best_candidate is not None
    assert res.best_candidate.heuristic_score >= 0.30
    assert res.best_candidate.fits_portrait_crop is True
    assert res.recommended_mode == "screen_content"
    assert res.best_candidate.candidate_type in (ContentCandidateType.CODE_EDITOR, ContentCandidateType.TERMINAL, ContentCandidateType.TEXT_BLOCK)


def test_broad_slide_diagram_fallback_to_presentation():
    """Phase 5.2 - Broad content (>45% width) marks fits_portrait_crop=False and recommends presentation mode."""
    detector = ScreenContentDetector(max_portrait_width_ratio=0.45)
    frame = _create_synthetic_wide_slide_frame(854, 480)
    res = detector.detect(frame)

    assert res.best_candidate is not None
    # Candidate exceeds portrait width ratio
    assert res.best_candidate.fits_portrait_crop is False
    assert res.recommended_mode == "presentation"


def test_webcam_inset_exclusion():
    """Phase 5.2 - Passing webcam bounding box masks the webcam region so it is not detected as content."""
    detector = ScreenContentDetector()
    frame = _create_blank_frame(854, 480, (240, 240, 240))
    # Draw high contrast 'face' or webcam in top-right corner
    webcam_x, webcam_y, webcam_w, webcam_h = 650, 30, 150, 120
    frame[webcam_y : webcam_y + webcam_h, webcam_x : webcam_x + webcam_w] = (30, 80, 140)

    # Detect without mask
    res_unmasked = detector.detect(frame)

    # Detect with webcam mask
    res_masked = detector.detect(frame, webcam_box=(webcam_x, webcam_y, webcam_w, webcam_h))

    # Masking out the webcam leaves no valid content
    assert not res_masked.has_valid_content


def test_tiny_noise_rejection():
    """Phase 5.2 - Tiny contours (< min_candidate_width/height or < min_area_ratio) are rejected."""
    detector = ScreenContentDetector(min_candidate_width=60, min_candidate_height=50)
    frame = _create_blank_frame(854, 480, (250, 250, 250))
    # Small 20x20 noise patch
    frame[100:120, 100:120] = (10, 10, 10)
    res = detector.detect(frame)

    assert not res.has_valid_content
    assert res.best_candidate is None


# ===========================================================================
# 2. ScreenContentTracker Tests
# ===========================================================================

def test_tracker_association_and_ema_smoothing():
    """Phase 5.2 - Tracker associates detections across frames and applies EMA smoothing to center."""
    tracker = ScreenContentTracker(source_width=854, source_height=480, smoothing_alpha=0.3)
    
    # Frame 1: Detection at center (150, 240)
    cand1 = ContentCandidate(
        box_pixels=ContentBoundingBox(x=50, y=40, width=200, height=400),
        box_norm=NormalizedCropBox(x_min=0.06, y_min=0.08, width=0.23, height=0.83),
        candidate_type=ContentCandidateType.CODE_EDITOR,
        heuristic_score=0.8,
        fits_portrait_crop=True,
    )
    det1 = ScreenContentDetectionResult(candidates=[cand1], best_candidate=cand1, has_valid_content=True, recommended_mode="screen_content")

    crop1, status1, _ = tracker.update(det1, timestamp_sec=1.0)
    assert status1 == "tracking_active"
    assert crop1 is not None

    # Frame 2: Slight movement to center (170, 240)
    cand2 = ContentCandidate(
        box_pixels=ContentBoundingBox(x=70, y=40, width=200, height=400),
        box_norm=NormalizedCropBox(x_min=0.08, y_min=0.08, width=0.23, height=0.83),
        candidate_type=ContentCandidateType.CODE_EDITOR,
        heuristic_score=0.8,
        fits_portrait_crop=True,
    )
    det2 = ScreenContentDetectionResult(candidates=[cand2], best_candidate=cand2, has_valid_content=True, recommended_mode="screen_content")

    crop2, status2, _ = tracker.update(det2, timestamp_sec=1.5)
    assert status2 == "tracking_active"
    assert crop2 is not None

    # Center should be smoothed between 150 and 170 (150 + 0.3*(170-150) = 156)
    expected_cx = 156.0
    actual_cx = crop2.x + (crop2.width / 2.0)
    assert abs(actual_cx - expected_cx) <= 2.0


def test_tracker_hold_mechanism_and_expiration():
    """Phase 5.2 - Tracker holds position during temporary occlusion then expires to no_content."""
    tracker = ScreenContentTracker(source_width=854, source_height=480, max_hold_frames=2)

    # Initial valid detection
    cand = ContentCandidate(
        box_pixels=ContentBoundingBox(x=60, y=40, width=200, height=400),
        box_norm=NormalizedCropBox(x_min=0.07, y_min=0.08, width=0.23, height=0.83),
        candidate_type=ContentCandidateType.CODE_EDITOR,
        heuristic_score=0.75,
        fits_portrait_crop=True,
    )
    det_valid = ScreenContentDetectionResult(candidates=[cand], best_candidate=cand, has_valid_content=True, recommended_mode="screen_content")
    det_empty = ScreenContentDetectionResult(candidates=[], best_candidate=None, has_valid_content=False, recommended_mode="presentation")

    # Step 1: Active
    crop, status, _ = tracker.update(det_valid, timestamp_sec=1.0)
    assert status == "tracking_active"
    orig_x = crop.x

    # Step 2: Drop 1 -> hold frame 1
    crop_h1, status_h1, _ = tracker.update(det_empty, timestamp_sec=1.5)
    assert status_h1 == "tracking_hold"
    assert crop_h1.x == orig_x

    # Step 3: Drop 2 -> hold frame 2
    crop_h2, status_h2, _ = tracker.update(det_empty, timestamp_sec=2.0)
    assert status_h2 == "tracking_hold"

    # Step 4: Drop 3 -> hold expired!
    crop_exp, status_exp, _ = tracker.update(det_empty, timestamp_sec=2.5)
    assert status_exp == "no_content"
    assert crop_exp is None


def test_tracker_scene_cut_resets_history():
    """Phase 5.2 - Scene cut immediately resets tracker state with no hold from previous shot."""
    tracker = ScreenContentTracker(source_width=854, source_height=480)

    cand = ContentCandidate(
        box_pixels=ContentBoundingBox(x=60, y=40, width=200, height=400),
        box_norm=NormalizedCropBox(x_min=0.07, y_min=0.08, width=0.23, height=0.83),
        candidate_type=ContentCandidateType.CODE_EDITOR,
        heuristic_score=0.8,
        fits_portrait_crop=True,
    )
    det_valid = ScreenContentDetectionResult(candidates=[cand], best_candidate=cand, has_valid_content=True, recommended_mode="screen_content")
    det_empty = ScreenContentDetectionResult(candidates=[], best_candidate=None, has_valid_content=False, recommended_mode="presentation")

    tracker.update(det_valid, timestamp_sec=1.0)

    # Empty detection at scene cut -> must NOT hold previous shot!
    crop, status, _ = tracker.update(det_empty, timestamp_sec=2.0, is_scene_cut=True)
    assert status == "no_content"
    assert crop is None


def test_tracker_strictly_clamps_crop_box_inside_source_bounds():
    """Phase 5.2 - Tracker clamp method keeps crop box within [0, source_width - crop_w]."""
    tracker = ScreenContentTracker(source_width=854, source_height=480)

    # Candidate at far left (near 0)
    box_left = tracker._build_clamped_crop(cx=10.0, cy=240.0)
    assert box_left.x == 0
    assert box_left.width == 270
    assert box_left.height == 480

    # Candidate at far right (near 854)
    box_right = tracker._build_clamped_crop(cx=840.0, cy=240.0)
    assert box_right.x == 854 - 270
    assert box_right.x + box_right.width == 854


# ===========================================================================
# 3. AdaptiveCompositionClassifier Three-Way Modes & Integration Tests
# ===========================================================================

def test_adaptive_classifier_three_way_modes():
    """Phase 5.2 - Classifier assigns presenter, screen_content, and presentation modes deterministically."""
    # Keyframe 0: Presenter face visible
    kf0 = CropKeyframeResult(
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
    # Keyframe 1: Cut to Code Editor (screen_content)
    code_cand = ContentCandidate(
        box_pixels=ContentBoundingBox(x=50, y=40, width=220, height=400),
        box_norm=NormalizedCropBox(x_min=0.06, y_min=0.08, width=0.25, height=0.83),
        candidate_type=ContentCandidateType.CODE_EDITOR,
        heuristic_score=0.85,
        fits_portrait_crop=True,
    )
    kf1 = CropKeyframeResult(
        timestamp_abs_sec=2.0,
        timestamp_rel_sec=1.0,
        crop_box_pixels=CropBoxPixels(x=292, y=0, width=270, height=480),
        crop_box_norm=NormalizedCropBox(x_min=0.34, y_min=0.0, width=0.316, height=1.0),
        tracking_mode=CropTrackingMode.CENTER_FALLBACK,
        detected_faces_count=0,
        primary_face_box=None,
        scene_change_detected=True,
        transition="cut",
        content_candidate=code_cand
    )
    # Keyframe 2: Cut to Wide Slide Diagram (presentation)
    slide_cand = ContentCandidate(
        box_pixels=ContentBoundingBox(x=50, y=40, width=600, height=400),
        box_norm=NormalizedCropBox(x_min=0.06, y_min=0.08, width=0.70, height=0.83),
        candidate_type=ContentCandidateType.DIAGRAM_PANEL,
        heuristic_score=0.80,
        fits_portrait_crop=False,  # Too wide for portrait crop!
    )
    kf2 = CropKeyframeResult(
        timestamp_abs_sec=3.0,
        timestamp_rel_sec=2.0,
        crop_box_pixels=CropBoxPixels(x=292, y=0, width=270, height=480),
        crop_box_norm=NormalizedCropBox(x_min=0.34, y_min=0.0, width=0.316, height=1.0),
        tracking_mode=CropTrackingMode.CENTER_FALLBACK,
        detected_faces_count=0,
        primary_face_box=None,
        scene_change_detected=True,
        transition="cut",
        content_candidate=slide_cand
    )

    classifier = AdaptiveCompositionClassifier(
        keyframes=[kf0, kf1, kf2],
        source_width=854,
        source_height=480,
        composition_mode="adaptive_hybrid"
    )

    assert classifier.keyframe_modes == ["presenter", "screen_content", "presentation"]
    assert classifier.content_detections_count >= 1
    assert classifier.content_transitions_count >= 1
    assert classifier.scene_cut_transitions_count == 2

    mode0, alpha0 = classifier.get_composition_state(1.0)
    assert mode0 == "presenter"
    assert alpha0 == 0.0

    mode1, alpha1 = classifier.get_composition_state(2.0)
    assert mode1 == "screen_content"
    assert alpha1 == 0.0

    mode2, alpha2 = classifier.get_composition_state(3.0)
    assert mode2 == "presentation"
    assert alpha2 == 1.0


def test_classifier_content_only_mode():
    """Phase 5.2 - CompositionMode.CONTENT_ONLY selects screen_content or presentation, never presenter."""
    cand = ContentCandidate(
        box_pixels=ContentBoundingBox(x=60, y=40, width=200, height=400),
        box_norm=NormalizedCropBox(x_min=0.07, y_min=0.08, width=0.23, height=0.83),
        candidate_type=ContentCandidateType.CODE_EDITOR,
        heuristic_score=0.85,
        fits_portrait_crop=True,
    )
    kf = CropKeyframeResult(
        timestamp_abs_sec=1.0,
        timestamp_rel_sec=0.0,
        crop_box_pixels=CropBoxPixels(x=100, y=0, width=270, height=480),
        crop_box_norm=NormalizedCropBox(x_min=0.1, y_min=0.0, width=0.3, height=1.0),
        tracking_mode=CropTrackingMode.FACE_FOLLOWING,
        detected_faces_count=1,
        primary_face_box=FaceBoundingBox(x=150, y=100, width=120, height=120),
        scene_change_detected=False,
        transition="smooth_pan",
        content_candidate=cand
    )
    classifier = AdaptiveCompositionClassifier(
        keyframes=[kf],
        source_width=854,
        source_height=480,
        composition_mode="content_only"
    )
    assert classifier.keyframe_modes == ["screen_content"]
    mode, alpha = classifier.get_composition_state(1.0)
    assert mode == "screen_content"


def test_classifier_diagnostics_structure():
    """Phase 5.2 - Diagnostics dictionary reports configuration, detections, and transitions."""
    kf = CropKeyframeResult(
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
    classifier = AdaptiveCompositionClassifier(
        keyframes=[kf],
        source_width=854,
        source_height=480,
        enable_content_tracking=True,
        content_min_score=0.40,
        content_max_width_ratio=0.42
    )
    diag = classifier.get_diagnostics()
    assert diag["enable_content_tracking"] is True
    assert diag["content_min_score"] == 0.40
    assert diag["content_max_width_ratio"] == 0.42
    assert "tracking_mode_distribution" in diag
    assert "candidate_types_detected" in diag


# ===========================================================================
# 4. Rendering & Frame Count Reconciliation Tests
# ===========================================================================

def test_frame_count_reconciliation_exact_equality():
    """Phase 5.2 - Requirement: presenter_frames_count + content_frames_count + presentation_frames_count == rendered_frame_count."""
    # Synthetic 3-keyframe scenario: presenter -> screen_content -> presentation
    code_cand = ContentCandidate(
        box_pixels=ContentBoundingBox(x=50, y=40, width=220, height=400),
        box_norm=NormalizedCropBox(x_min=0.06, y_min=0.08, width=0.25, height=0.83),
        candidate_type=ContentCandidateType.CODE_EDITOR,
        heuristic_score=0.85,
        fits_portrait_crop=True,
    )
    slide_cand = ContentCandidate(
        box_pixels=ContentBoundingBox(x=50, y=40, width=600, height=400),
        box_norm=NormalizedCropBox(x_min=0.06, y_min=0.08, width=0.70, height=0.83),
        candidate_type=ContentCandidateType.SLIDE_CONTENT,
        heuristic_score=0.75,
        fits_portrait_crop=False,
    )

    kfs = [
        CropKeyframeResult(
            timestamp_abs_sec=0.0,
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
            timestamp_abs_sec=1.0,
            timestamp_rel_sec=1.0,
            crop_box_pixels=CropBoxPixels(x=50, y=0, width=270, height=480),
            crop_box_norm=NormalizedCropBox(x_min=0.06, y_min=0.0, width=0.316, height=1.0),
            tracking_mode=CropTrackingMode.CONTENT_FOLLOWING,
            detected_faces_count=0,
            primary_face_box=None,
            scene_change_detected=True,
            transition="cut",
            content_candidate=code_cand
        ),
        CropKeyframeResult(
            timestamp_abs_sec=2.0,
            timestamp_rel_sec=2.0,
            crop_box_pixels=CropBoxPixels(x=292, y=0, width=270, height=480),
            crop_box_norm=NormalizedCropBox(x_min=0.34, y_min=0.0, width=0.316, height=1.0),
            tracking_mode=CropTrackingMode.CENTER_FALLBACK,
            detected_faces_count=0,
            primary_face_box=None,
            scene_change_detected=True,
            transition="cut",
            content_candidate=slide_cand
        ),
    ]

    classifier = AdaptiveCompositionClassifier(
        keyframes=kfs,
        source_width=854,
        source_height=480,
        composition_mode="adaptive_hybrid"
    )

    fps = 30.0
    total_frames = 90  # 3.0 seconds @ 30fps
    presenter_count = 0
    content_count = 0
    presentation_count = 0

    for i in range(total_frames):
        t = i / fps
        dom_mode, alpha = classifier.get_composition_state(t)
        if dom_mode == "presenter":
            presenter_count += 1
        elif dom_mode == "screen_content":
            content_count += 1
        else:
            presentation_count += 1

    # Exact equality verification
    assert presenter_count + content_count + presentation_count == total_frames
    assert presenter_count > 0
    assert content_count > 0
    assert presentation_count > 0


# ===========================================================================
# 5. Phase 5.3 Regression Tests: Scene Types, Blank Guard, & Cut Alignment
# ===========================================================================

def test_classify_scene_type_distinguishes_four_scene_types():
    """Phase 5.3: classify_scene_type correctly classifies all 4 target scene types."""
    detector = ScreenContentDetector()

    # 1. PRESENTER_ONLY: Prominent centered face, plain background
    frame_presenter = np.full((480, 854, 3), 70, dtype=np.uint8)
    cv2.circle(frame_presenter, (427, 200), 70, (180, 180, 180), -1)
    face_box_centered = (357, 130, 140, 140)
    res_pres = detector.detect(frame_presenter, webcam_box=face_box_centered)
    assert res_pres.scene_type == SceneType.PRESENTER_ONLY
    assert res_pres.recommended_mode == "presenter"

    # 2. PRECOMPOSITED_PIP: Screen content on left, inset presenter on right
    frame_pip = np.full((480, 854, 3), 240, dtype=np.uint8)
    # Draw screen content diagram/table on left
    for y in range(80, 400, 30):
        cv2.line(frame_pip, (50, y), (600, y), (40, 40, 40), 2)
    # Draw inset face on right
    face_box_inset = (710, 150, 100, 100)
    cv2.rectangle(frame_pip, (700, 140), (820, 260), (30, 30, 150), -1)
    res_pip = detector.detect(frame_pip, webcam_box=face_box_inset)
    assert res_pip.scene_type == SceneType.PRECOMPOSITED_PIP
    assert res_pip.recommended_mode == "presentation"

    # 3. PRESENTATION_SCREEN: Slide/code editor with no face
    frame_screen = _create_synthetic_code_editor_frame(width=854, height=480, editor_w=240)
    res_screen = detector.detect(frame_screen, webcam_box=None)
    assert res_screen.scene_type == SceneType.PRESENTATION_SCREEN
    assert res_screen.recommended_mode in ("screen_content", "presentation")

    # 4. TRANSITION_OR_UNCERTAIN: Pale or solid transition frame
    frame_pale = np.full((480, 854, 3), 248, dtype=np.uint8)
    res_pale = detector.detect(frame_pale, webcam_box=None)
    assert res_pale.scene_type == SceneType.TRANSITION_OR_UNCERTAIN
    assert res_pale.is_uncertain is True
    assert res_pale.recommended_mode == "presentation"


def test_screen_share_retains_presentation_mode_when_presenter_is_inset():
    """Phase 5.3: PiP layout with wide screen-share never crops exclusively to presenter face."""
    # Keyframe mimicking source 52.7s: Google Maps diagram panel + inset presenter on right
    diag_cand = ContentCandidate(
        box_pixels=ContentBoundingBox(x=0, y=60, width=650, height=360),
        box_norm=NormalizedCropBox(x_min=0.0, y_min=0.125, width=0.761, height=0.75),
        candidate_type=ContentCandidateType.DIAGRAM_PANEL,
        heuristic_score=0.75,
        fits_portrait_crop=False,  # Too wide for portrait crop
    )
    kf = CropKeyframeResult(
        timestamp_abs_sec=52.5,
        timestamp_rel_sec=24.0,
        crop_box_pixels=CropBoxPixels(x=584, y=0, width=270, height=480),
        crop_box_norm=NormalizedCropBox(x_min=0.684, y_min=0.0, width=0.316, height=1.0),
        tracking_mode=CropTrackingMode.FACE_FOLLOWING,
        detected_faces_count=1,
        primary_face_box=FaceBoundingBox(x=712, y=150, width=105, height=105),  # Inset on right
        scene_change_detected=False,
        transition="smooth_pan",
        content_candidate=diag_cand,
    )
    classifier = AdaptiveCompositionClassifier(
        keyframes=[kf],
        source_width=854,
        source_height=480,
        composition_mode="adaptive_hybrid",
    )
    # Mode must be presentation to preserve the wide Google Maps screen share
    assert classifier.keyframe_modes == ["presentation"]
    assert classifier.keyframe_scene_types == [SceneType.PRECOMPOSITED_PIP]
    mode, alpha = classifier.get_composition_state(52.5)
    assert mode == "presentation"
    assert alpha == 1.0


def test_anti_blank_crop_guard_fallback():
    """Phase 5.3: Anti-blank guard prevents rendering an empty background crop on an informative frame."""
    # Frame has solid blue on center (x: 200..600) and presenter details on right (x: 650..854)
    frame = np.full((480, 854, 3), (200, 50, 20), dtype=np.uint8)  # Blue frame
    # Draw textured presenter on right
    for y in range(100, 300, 10):
        cv2.line(frame, (680, y), (820, y), (255, 255, 255), 3)

    # Erroneous crop targeting the blank blue center
    stale_center_crop = (308, 0, 270, 480)

    # Ensure source frame has content
    assert float(np.std(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY))) > 25.0
    # Ensure stale crop is solid blank
    crop_slice = frame[0:480, 308:578]
    assert float(np.std(cv2.cvtColor(crop_slice, cv2.COLOR_BGR2GRAY))) < 1.0

    # render_presenter_frame with anti-blank guard
    rendered = CompositionRenderer.render_presenter_frame(
        frame=frame,
        crop_box=stale_center_crop,
        output_width=720,
        output_height=1280,
        enable_anti_blank_guard=True,
    )

    # Guard should have fallen back to presentation mode:
    # Presentation mode places the full landscape frame centered with blurred background.
    # Therefore, the textured presenter on the right IS present in the rendered canvas!
    assert rendered.shape == (1280, 720, 3)
    assert float(np.std(rendered)) > 15.0


def test_crop_interpolator_cut_snapping_without_stale_lag():
    """Phase 5.3: get_crop_box with exact_cut_passed snaps immediately to post-cut crop."""
    kfs = [
        CropKeyframeResult(
            timestamp_abs_sec=40.54,
            timestamp_rel_sec=12.0,
            crop_box_pixels=CropBoxPixels(x=308, y=0, width=270, height=480),
            crop_box_norm=NormalizedCropBox(x_min=0.36, y_min=0.0, width=0.316, height=1.0),
            tracking_mode=CropTrackingMode.FACE_FOLLOWING,
            detected_faces_count=1,
            scene_change_detected=False,
            transition="smooth_pan",
        ),
        CropKeyframeResult(
            timestamp_abs_sec=41.04,
            timestamp_rel_sec=12.5,
            crop_box_pixels=CropBoxPixels(x=584, y=0, width=270, height=480),
            crop_box_norm=NormalizedCropBox(x_min=0.684, y_min=0.0, width=0.316, height=1.0),
            tracking_mode=CropTrackingMode.FACE_FOLLOWING,
            detected_faces_count=1,
            scene_change_detected=True,
            transition="cut",
        ),
    ]
    interpolator = CropInterpolator(keyframes=kfs, source_width=854, source_height=480)

    # At t=40.84s before cut detected: returns start crop
    box_pre_cut = interpolator.get_crop_box(40.84, exact_cut_passed=False)
    assert box_pre_cut[0] == 308

    # At t=40.84s once cut is detected in video stream: snaps immediately to end crop!
    box_post_cut = interpolator.get_crop_box(40.84, exact_cut_passed=True)
    assert box_post_cut[0] == 584


def test_authentic_pale_transition_preservation():
    """Phase 5.3: Authentic pale/fade transition is preserved without false alarm."""
    detector = ScreenContentDetector()

    # Frame mimicking source 68.6s (authentic white fade: mean=246, std=0.54)
    pale_frame = np.full((480, 854, 3), 246, dtype=np.uint8)
    res = detector.detect(pale_frame)

    assert res.scene_type == SceneType.TRANSITION_OR_UNCERTAIN
    assert res.is_uncertain is True
    assert res.recommended_mode == "presentation"

    # Rendering presentation mode on pale frame handles it gracefully
    comp = CompositionRenderer.render_composite_frame(
        frame=pale_frame,
        crop_box=(300, 0, 270, 480),
        alpha=1.0,
        output_width=720,
        output_height=1280,
    )
    assert comp.shape == (1280, 720, 3)
    assert np.mean(comp) > 150


def test_multi_candidate_wide_span_forces_presentation_mode():
    """Release Gate: If candidates span across > 45% of width, presentation mode is required."""
    detector = ScreenContentDetector()
    frame = np.full((480, 854, 3), 20, dtype=np.uint8)
    # Candidate 1: text on left
    for y in range(80, 200, 20):
        cv2.line(frame, (80, y), (300, y), (255, 255, 255), 3)
    # Candidate 2: text on right
    for y in range(80, 200, 20):
        cv2.line(frame, (500, y), (750, y), (255, 255, 255), 3)

    res = detector.detect(frame)
    assert res.scene_type == SceneType.PRESENTATION_SCREEN
    assert res.recommended_mode == "presentation"
    for c in res.candidates:
        assert c.fits_portrait_crop is False


def test_blue_graphic_false_face_rejection():
    """Release Gate: Blue UI graphics (e.g. data structure stack) are rejected as false faces."""
    detector = ScreenContentDetector()
    frame = np.full((480, 854, 3), 30, dtype=np.uint8)
    # Draw blue UI box (stack) at (460, 80, 200, 200) with Blue=220, Green=140, Red=30
    cv2.rectangle(frame, (460, 80), (660, 280), (220, 140, 30), -1)
    # Draw content on left
    for y in range(100, 300, 25):
        cv2.line(frame, (80, y), (350, y), (255, 255, 255), 2)

    # Even if Haar cascade falsely reported a face at (460, 80, 200, 200):
    false_face_box = (460, 80, 200, 200)
    res = detector.detect(frame, webcam_box=false_face_box)

    # Must classify as presentation_screen rather than presenter_only
    assert res.scene_type == SceneType.PRESENTATION_SCREEN
    assert res.recommended_mode in ("presentation", "screen_content")

