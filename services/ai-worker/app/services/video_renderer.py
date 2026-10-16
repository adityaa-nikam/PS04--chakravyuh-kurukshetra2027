"""Video Rendering Engine (Phase 5).

Consumes original source video, Phase 3 highlight result, and Phase 4 crop plan to
render a vertical (9:16 default) MP4 video with frame-accurate crop interpolation,
clean scene-cut transitions, synchronized audio, and verified media output.
"""

import json
import logging
import math
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import List, Optional, Tuple, Dict, Any, Union

import cv2
import numpy as np

from app.config import settings
from app.schemas import (
    HighlightResult,
    CropPlanResult,
    CropKeyframeResult,
    CropTrackingMode,
    CompositionMode,
    RenderResult,
    RenderOptions,
    MediaMetadata,
    SceneType,
    ValidatedTranscript,
    CaptionStyle,
    CaptionOptions,
    CaptionDiagnostics,
)
from app.services.caption_generator import CaptionGeneratorService, format_ffmpeg_ass_filter
from app.services.media_probe import MediaProbeService
from app.services.screen_content_detector import (
    ScreenContentDetector,
    ScreenContentTracker,
    ScreenContentDetectionResult,
    ContentCandidate,
    ContentCandidateType,
)

logger = logging.getLogger(__name__)


class VideoRenderingError(RuntimeError):
    """Base exception for video rendering failures."""
    pass


class RenderValidationError(ValueError):
    """Raised when input files, metadata, or dimensions fail validation."""
    pass


class FFmpegExecutionError(VideoRenderingError):
    """Raised when an external FFmpeg or FFprobe process exits with an error."""
    pass


class CropInterpolator:
    """Interpolates crop rectangles along the timeline according to crop plan keyframes.
    
    Supports smooth linear interpolation during smooth_pan segments and instantaneous
    crop changes at scene cuts, clamping all coordinates strictly inside source bounds.
    """

    def __init__(
        self,
        keyframes: List[CropKeyframeResult],
        source_width: int,
        source_height: int,
    ):
        if not keyframes:
            raise RenderValidationError("Crop keyframes list cannot be empty.")
        if source_width <= 0 or source_height <= 0:
            raise RenderValidationError(f"Invalid source dimensions: {source_width}x{source_height}")

        # Ensure keyframes are sorted by absolute timestamp
        self.keyframes = sorted(keyframes, key=lambda kf: kf.timestamp_abs_sec)
        self.source_width = source_width
        self.source_height = source_height
        self.timestamps = [kf.timestamp_abs_sec for kf in self.keyframes]

    def get_bounding_keyframes(self, timestamp_abs_sec: float) -> Tuple[CropKeyframeResult, CropKeyframeResult]:
        """Returns the start and end keyframes bounding the given timestamp."""
        import bisect
        idx = bisect.bisect_right(self.timestamps, timestamp_abs_sec) - 1
        idx = max(0, min(idx, len(self.keyframes) - 2))
        return self.keyframes[idx], self.keyframes[idx + 1]

    def get_crop_box(
        self,
        timestamp_abs_sec: float,
        exact_cut_passed: bool = False,
    ) -> Tuple[int, int, int, int]:
        """Calculates interpolated crop rectangle (x, y, width, height) at given timestamp.
        
        Args:
            timestamp_abs_sec: Absolute timestamp in source video timeline.
            exact_cut_passed: Set to True if a scene cut occurred between start and end keyframes,
                              snapping immediately to the post-cut keyframe crop.
            
        Returns:
            Tuple of integer pixel (x, y, width, height) clamped within source dimensions.
        """
        # 1. Before or at first keyframe
        if timestamp_abs_sec <= self.timestamps[0]:
            box = self.keyframes[0].crop_box_pixels
            return self._clamp(box.x, box.y, box.width, box.height)

        # 2. At or after last keyframe
        if timestamp_abs_sec >= self.timestamps[-1]:
            box = self.keyframes[-1].crop_box_pixels
            return self._clamp(box.x, box.y, box.width, box.height)

        # 3. Binary search for bounding interval [T_i, T_{i+1}]
        import bisect
        idx = bisect.bisect_right(self.timestamps, timestamp_abs_sec) - 1
        idx = max(0, min(idx, len(self.keyframes) - 2))

        kf_start = self.keyframes[idx]
        kf_end = self.keyframes[idx + 1]

        t_start = kf_start.timestamp_abs_sec
        t_end = kf_end.timestamp_abs_sec
        span = t_end - t_start

        # If next keyframe is a cut transition:
        if kf_end.transition == "cut" or span <= 1e-6:
            # If the exact cut has already passed (or timestamp reached kf_end), snap to new crop!
            if exact_cut_passed or timestamp_abs_sec >= t_end:
                box = kf_end.crop_box_pixels
            else:
                box = kf_start.crop_box_pixels
            return self._clamp(box.x, box.y, box.width, box.height)

        # Linear interpolation factor tau in [0.0, 1.0]
        tau = max(0.0, min(1.0, (timestamp_abs_sec - t_start) / span))

        b1 = kf_start.crop_box_pixels
        b2 = kf_end.crop_box_pixels

        interp_x = int(round((1.0 - tau) * b1.x + tau * b2.x))
        interp_y = int(round((1.0 - tau) * b1.y + tau * b2.y))
        interp_w = int(round((1.0 - tau) * b1.width + tau * b2.width))
        interp_h = int(round((1.0 - tau) * b1.height + tau * b2.height))

        return self._clamp(interp_x, interp_y, interp_w, interp_h)

    def _clamp(self, x: int, y: int, w: int, h: int) -> Tuple[int, int, int, int]:
        """Clamps crop rectangle strictly inside source frame dimensions."""
        clamped_w = max(1, min(w, self.source_width))
        clamped_h = max(1, min(h, self.source_height))
        clamped_x = max(0, min(x, self.source_width - clamped_w))
        clamped_y = max(0, min(y, self.source_height - clamped_h))
        return clamped_x, clamped_y, clamped_w, clamped_h


class AdaptiveCompositionClassifier:
    """Classifies video frames into presenter, screen-content, or presentation mode.
    
    Adheres strictly to Phase 5.2 deterministic rules:
    1. Confirmed face-following keyframe (with non-tiny face) -> PRESENTER mode.
    2. Scene cuts or sustained face loss with reliably detected screen content
       (fitting portrait crop) -> SCREEN_CONTENT mode.
    3. Broad screen content (charts/diagrams exceeding portrait crop width),
       uncertain detections, or blank frames -> PRESENTATION mode (full landscape fit over blurred bg).
    4. Isolated face loss (< sustained_face_loss_sec or INTERPOLATED_HOLD) -> Hold previous mode.
    5. Face reappearance -> Return to PRESENTER mode.
    6. Non-cut transitions smoothly crossfade over transition_duration_sec.
    7. Scene cut transitions switch instantaneously with no cross-cut bleed.
    """

    def __init__(
        self,
        keyframes: List[CropKeyframeResult],
        source_width: int,
        source_height: int,
        composition_mode: str = "adaptive_hybrid",
        sustained_face_loss_sec: float = 1.0,
        transition_duration_sec: float = 0.25,
        tiny_face_ratio_threshold: float = 0.015,
        video_path: Optional[str | Path] = None,
        enable_content_tracking: bool = True,
        content_min_score: float = 0.35,
        content_max_width_ratio: float = 0.45,
        content_smoothing_alpha: float = 0.3,
        content_hold_sec: float = 1.0,
    ):
        if not keyframes:
            raise RenderValidationError("Crop keyframes list cannot be empty for composition classification.")
        self.keyframes = sorted(keyframes, key=lambda kf: kf.timestamp_abs_sec)
        self.source_width = source_width
        self.source_height = source_height
        self.composition_mode = composition_mode
        self.sustained_face_loss_sec = sustained_face_loss_sec
        self.transition_duration_sec = transition_duration_sec
        self.tiny_face_ratio_threshold = tiny_face_ratio_threshold

        self.video_path = Path(video_path).resolve() if video_path else None
        self.enable_content_tracking = enable_content_tracking
        self.content_min_score = content_min_score
        self.content_max_width_ratio = content_max_width_ratio
        self.content_smoothing_alpha = content_smoothing_alpha
        self.content_hold_sec = content_hold_sec

        self.timestamps = [kf.timestamp_abs_sec for kf in self.keyframes]
        self.keyframe_modes: List[str] = []
        self.is_cut: List[bool] = []

        self.total_transitions_count = 0
        self.scene_cut_transitions_count = 0
        self.sustained_loss_transitions_count = 0
        self.content_transitions_count = 0
        self.content_detections_count = 0
        self.tracking_mode_distribution: Dict[str, int] = {}
        self.candidate_types_detected: List[str] = []
        self.scene_type_distribution: Dict[str, int] = {
            SceneType.PRESENTER_ONLY.value: 0,
            SceneType.PRECOMPOSITED_PIP.value: 0,
            SceneType.PRESENTATION_SCREEN.value: 0,
            SceneType.TRANSITION_OR_UNCERTAIN.value: 0,
        }
        self.keyframe_scene_types: List[SceneType] = []

        self._classify_keyframes()

    def _has_valid_face(self, kf: CropKeyframeResult) -> bool:
        """Determines if a keyframe contains a reliable, non-inset instructor face."""
        if kf.detected_faces_count <= 0 or kf.primary_face_box is None:
            return False
        box = kf.primary_face_box
        face_area = box.width * box.height
        frame_area = self.source_width * self.source_height
        if frame_area <= 0:
            return False
        ratio = face_area / frame_area
        # Tiny face inset rule: if face is tiny (< threshold), it's a webcam inset on a slide
        if ratio < self.tiny_face_ratio_threshold:
            return False
        cx_norm = (box.x + (box.width / 2.0)) / self.source_width
        # Lateral inset rule: if face is pushed to margins, it's a pre-composited PiP layout
        if cx_norm < 0.22 or cx_norm > 0.78:
            return False
        return True

    def _classify_keyframes(self) -> None:
        """Performs forward deterministic classification pass across all keyframes."""
        if self.composition_mode == CompositionMode.CROP_ONLY.value:
            self.keyframe_modes = ["presenter"] * len(self.keyframes)
            self.keyframe_scene_types = [SceneType.PRESENTER_ONLY] * len(self.keyframes)
            self.scene_type_distribution[SceneType.PRESENTER_ONLY.value] = len(self.keyframes)
            self.is_cut = [bool(kf.scene_change_detected or kf.transition == "cut") for kf in self.keyframes]
            return

        if self.composition_mode == CompositionMode.PRESENTATION_FIT_BLUR.value:
            self.keyframe_modes = ["presentation"] * len(self.keyframes)
            self.keyframe_scene_types = [SceneType.PRESENTATION_SCREEN] * len(self.keyframes)
            self.scene_type_distribution[SceneType.PRESENTATION_SCREEN.value] = len(self.keyframes)
            self.is_cut = [bool(kf.scene_change_detected or kf.transition == "cut") for kf in self.keyframes]
            return

        # Prepare screen content detector & tracker
        detector = ScreenContentDetector(
            min_heuristic_score=self.content_min_score,
            max_portrait_width_ratio=self.content_max_width_ratio,
        )
        tracker = ScreenContentTracker(
            source_width=self.source_width,
            source_height=self.source_height,
            smoothing_alpha=self.content_smoothing_alpha,
            min_score_threshold=self.content_min_score,
            max_hold_frames=max(1, int(round(self.content_hold_sec * 2))),
        )

        cap = None
        if self.video_path and self.video_path.exists():
            cap = cv2.VideoCapture(str(self.video_path))

        try:
            last_face_t = -999999.0

            for i, kf in enumerate(self.keyframes):
                t = kf.timestamp_abs_sec
                cut = bool(kf.scene_change_detected or kf.transition == "cut")
                self.is_cut.append(cut)

                det_result: Optional[ScreenContentDetectionResult] = None
                frame_samp = None

                if cap is not None and cap.isOpened():
                    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000.0)
                    ret, samp = cap.read()
                    if ret and samp is not None:
                        frame_samp = samp
                        webcam_box = None
                        if kf.primary_face_box is not None:
                            bx = kf.primary_face_box.x
                            by = kf.primary_face_box.y
                            bw = kf.primary_face_box.width
                            bh = kf.primary_face_box.height
                            is_valid_face = True
                            if frame_samp is not None and frame_samp.ndim == 3 and bw > 0 and bh > 0:
                                roi = frame_samp[max(0, by):min(self.source_height, by + bh), max(0, bx):min(self.source_width, bx + bw)]
                                if roi.size > 0:
                                    m_b, m_g, m_r = np.mean(roi, axis=(0, 1))
                                    if m_b > m_r + 30.0:  # Blue-dominant non-skin element
                                        ycrcb = cv2.cvtColor(roi, cv2.COLOR_BGR2YCrCb)
                                        skin_mask = cv2.inRange(ycrcb, np.array([0, 133, 77]), np.array([255, 173, 127]))
                                        skin_pct = (np.count_nonzero(skin_mask) / float(roi.shape[0] * roi.shape[1])) * 100.0
                                        if skin_pct < 5.0:
                                            is_valid_face = False
                            if is_valid_face:
                                webcam_box = (bx, by, bw, bh)
                            else:
                                kf.detected_faces_count = 0
                                kf.primary_face_box = None
                                kf.tracking_mode = CropTrackingMode.CENTER_FALLBACK
                        det_result = detector.detect(frame_samp, webcam_box=webcam_box)

                if det_result is None:
                    # Synthetic / mocked keyframe fallback
                    scene_type = self._classify_mock_keyframe(kf)
                    det_result = self._build_mock_detection_result(kf, scene_type)
                else:
                    scene_type = det_result.scene_type

                self.keyframe_scene_types.append(scene_type)
                self.scene_type_distribution[scene_type.value] = (
                    self.scene_type_distribution.get(scene_type.value, 0) + 1
                )

                if det_result.best_candidate is not None:
                    kf.content_candidate = det_result.best_candidate

                if self.composition_mode == CompositionMode.CONTENT_ONLY.value:
                    cur_mode = self._evaluate_content_mode_from_result(
                        kf=kf,
                        timestamp_sec=t,
                        is_cut=cut,
                        det_result=det_result,
                        tracker=tracker,
                    )
                else:
                    # Adaptive hybrid mode
                    if scene_type == SceneType.PRESENTER_ONLY:
                        cur_mode = "presenter"
                        last_face_t = t
                        tracker.reset()
                    elif scene_type == SceneType.PRECOMPOSITED_PIP:
                        # Pre-composited PiP layout:
                        # If content fits portrait crop without clipping, reframe it:
                        if (
                            self.enable_content_tracking
                            and det_result.has_valid_content
                            and det_result.best_candidate
                            and det_result.best_candidate.fits_portrait_crop
                        ):
                            cur_mode = self._evaluate_content_mode_from_result(
                                kf=kf,
                                timestamp_sec=t,
                                is_cut=cut,
                                det_result=det_result,
                                tracker=tracker,
                            )
                        else:
                            # Broad screen share (e.g. Google Maps) or PiP with wide background:
                            # Presentation safe fit preserves 100% screen content AND 100% presenter inset!
                            cur_mode = "presentation"
                            tracker.reset()
                    elif scene_type == SceneType.PRESENTATION_SCREEN:
                        time_since_face = t - last_face_t
                        if (
                            not cut
                            and not det_result.has_valid_content
                            and (
                                kf.tracking_mode == CropTrackingMode.INTERPOLATED_HOLD
                                or time_since_face < self.sustained_face_loss_sec
                            )
                            and (i > 0 and self.keyframe_modes[-1] == "presenter")
                        ):
                            cur_mode = "presenter"
                        else:
                            if self.enable_content_tracking and det_result.has_valid_content:
                                cur_mode = self._evaluate_content_mode_from_result(
                                    kf=kf,
                                    timestamp_sec=t,
                                    is_cut=cut,
                                    det_result=det_result,
                                    tracker=tracker,
                                )
                            else:
                                cur_mode = "presentation"
                                tracker.reset()
                    else:  # TRANSITION_OR_UNCERTAIN
                        cur_mode = "presentation"
                        tracker.reset()

                self.keyframe_modes.append(cur_mode)

                # Track transitions
                if i > 0 and self.keyframe_modes[i] != self.keyframe_modes[i - 1]:
                    self.total_transitions_count += 1
                    prev_m = self.keyframe_modes[i - 1]
                    cur_m = self.keyframe_modes[i]
                    if cut:
                        self.scene_cut_transitions_count += 1
                    elif cur_m == "presentation" and prev_m == "presenter":
                        self.sustained_loss_transitions_count += 1
                    if "screen_content" in (cur_m, prev_m):
                        self.content_transitions_count += 1

        finally:
            if cap is not None:
                cap.release()

    def _classify_mock_keyframe(self, kf: CropKeyframeResult) -> SceneType:
        """Determines scene type for mock keyframes in unit tests when video frame is absent."""
        if kf.primary_face_box is not None and kf.detected_faces_count > 0:
            box = kf.primary_face_box
            cx_norm = (box.x + (box.width / 2.0)) / self.source_width
            area_ratio = (box.width * box.height) / (self.source_width * self.source_height)
            if area_ratio < self.tiny_face_ratio_threshold or cx_norm < 0.22 or cx_norm > 0.78:
                return SceneType.PRECOMPOSITED_PIP
            if kf.content_candidate is not None:
                cand = (
                    ContentCandidate(**kf.content_candidate)
                    if isinstance(kf.content_candidate, dict)
                    else kf.content_candidate
                )
                if not cand.fits_portrait_crop and area_ratio < 0.045:
                    return SceneType.PRECOMPOSITED_PIP
            return SceneType.PRESENTER_ONLY
        elif kf.content_candidate is not None:
            return SceneType.PRESENTATION_SCREEN
        return SceneType.PRESENTATION_SCREEN

    def _build_mock_detection_result(
        self,
        kf: CropKeyframeResult,
        scene_type: SceneType
    ) -> ScreenContentDetectionResult:
        """Constructs ScreenContentDetectionResult from mock keyframe candidate."""
        if kf.content_candidate is not None:
            cand = (
                ContentCandidate(**kf.content_candidate)
                if isinstance(kf.content_candidate, dict)
                else kf.content_candidate
            )
            valid = cand.heuristic_score >= self.content_min_score
            return ScreenContentDetectionResult(
                candidates=[cand],
                best_candidate=cand,
                has_valid_content=valid,
                scene_type=scene_type,
                recommended_mode="screen_content" if (valid and cand.fits_portrait_crop) else "presentation",
            )
        return ScreenContentDetectionResult(
            candidates=[],
            best_candidate=None,
            has_valid_content=False,
            scene_type=scene_type,
            recommended_mode="presenter" if scene_type == SceneType.PRESENTER_ONLY else "presentation",
        )

    def _evaluate_content_mode_from_result(
        self,
        kf: CropKeyframeResult,
        timestamp_sec: float,
        is_cut: bool,
        det_result: ScreenContentDetectionResult,
        tracker: ScreenContentTracker,
    ) -> str:
        """Evaluates screen content tracking and updates keyframe metadata."""
        if not self.enable_content_tracking:
            return "presentation"

        box_pixels, status, tracked_cand = tracker.update(
            det_result, timestamp_sec=timestamp_sec, is_scene_cut=is_cut
        )
        self.tracking_mode_distribution[status] = self.tracking_mode_distribution.get(status, 0) + 1
        if tracked_cand is not None:
            cand_type = tracked_cand.candidate_type.value
            if cand_type not in self.candidate_types_detected:
                self.candidate_types_detected.append(cand_type)
            kf.content_candidate = tracked_cand

        kf.content_tracking_mode = status

        if box_pixels is not None and status in ("tracking_active", "tracking_hold"):
            kf.crop_box_pixels = box_pixels
            kf.tracking_mode = (
                CropTrackingMode.CONTENT_FOLLOWING if status == "tracking_active"
                else CropTrackingMode.CONTENT_HOLD
            )
            self.content_detections_count += 1
            return "screen_content"

        return "presentation"

    def _evaluate_content_frame(
        self,
        kf: CropKeyframeResult,
        timestamp_sec: float,
        is_cut: bool,
        detector: ScreenContentDetector,
        tracker: ScreenContentTracker,
        cap: Optional[cv2.VideoCapture],
    ) -> str:
        """Evaluates screen content detection and tracking for a non-presenter keyframe."""
        if not self.enable_content_tracking:
            return "presentation"

        det_result: Optional[ScreenContentDetectionResult] = None

        # 1. Use pre-existing content candidate if attached
        if kf.content_candidate is not None:
            if isinstance(kf.content_candidate, dict):
                cand = ContentCandidate(**kf.content_candidate)
            else:
                cand = kf.content_candidate
            valid = cand.heuristic_score >= self.content_min_score
            det_result = ScreenContentDetectionResult(
                candidates=[cand],
                best_candidate=cand,
                has_valid_content=valid,
                recommended_mode="screen_content" if (valid and cand.fits_portrait_crop) else "presentation",
            )
        # 2. Sample frame from video if available
        elif cap is not None and cap.isOpened():
            cap.set(cv2.CAP_PROP_POS_MSEC, timestamp_sec * 1000.0)
            ret, frame_samp = cap.read()
            if ret and frame_samp is not None:
                webcam_box = None
                if kf.primary_face_box is not None:
                    webcam_box = (
                        kf.primary_face_box.x,
                        kf.primary_face_box.y,
                        kf.primary_face_box.width,
                        kf.primary_face_box.height,
                    )
                det_result = detector.detect(frame_samp, webcam_box=webcam_box)

        if det_result is None:
            return "presentation"

        return self._evaluate_content_mode_from_result(
            kf=kf,
            timestamp_sec=timestamp_sec,
            is_cut=is_cut,
            det_result=det_result,
            tracker=tracker,
        )

    def get_composition_state(self, timestamp_abs_sec: float) -> Tuple[str, float]:
        """Calculates composition mode and presentation blend weight alpha at given timestamp.
        
        Args:
            timestamp_abs_sec: Absolute timestamp in source video.
            
        Returns:
            Tuple of (dominant_mode: str, alpha: float)
            alpha in [0.0, 1.0]: 0.0 = 100% crop (presenter or content), 1.0 = 100% Presentation fit.
        """
        if self.composition_mode == CompositionMode.CROP_ONLY.value:
            return "presenter", 0.0
        if self.composition_mode == CompositionMode.PRESENTATION_FIT_BLUR.value:
            return "presentation", 1.0

        if timestamp_abs_sec <= self.timestamps[0]:
            m = self.keyframe_modes[0]
            return m, 1.0 if m == "presentation" else 0.0

        import bisect
        idx = bisect.bisect_right(self.timestamps, timestamp_abs_sec) - 1
        idx = max(0, min(idx, len(self.keyframes) - 1))

        m_curr = self.keyframe_modes[idx]
        cut_at_curr = self.is_cut[idx]

        # Check if a non-cut transition started at keyframe idx
        if idx > 0 and self.keyframe_modes[idx] != self.keyframe_modes[idx - 1] and not cut_at_curr:
            t_start = self.timestamps[idx]
            d = max(0.001, self.transition_duration_sec)
            if timestamp_abs_sec < t_start + d:
                tau = max(0.0, min(1.0, (timestamp_abs_sec - t_start) / d))
                prev_m = self.keyframe_modes[idx - 1]
                dominant = m_curr if tau >= 0.5 else prev_m

                if m_curr == "presentation":
                    alpha = tau
                elif prev_m == "presentation":
                    alpha = 1.0 - tau
                else:
                    alpha = 0.0
                return dominant, alpha

        alpha = 1.0 if m_curr == "presentation" else 0.0
        return m_curr, alpha

    def get_diagnostics(self) -> Dict[str, Any]:
        """Returns structured diagnostics dictionary for render manifest."""
        return {
            "enable_content_tracking": self.enable_content_tracking,
            "content_min_score": self.content_min_score,
            "content_max_width_ratio": self.content_max_width_ratio,
            "content_smoothing_alpha": self.content_smoothing_alpha,
            "content_hold_sec": self.content_hold_sec,
            "total_detections_count": self.content_detections_count,
            "content_transitions_count": self.content_transitions_count,
            "tracking_mode_distribution": self.tracking_mode_distribution,
            "candidate_types_detected": self.candidate_types_detected,
            "scene_type_distribution": self.scene_type_distribution,
        }


class CompositionRenderer:
    """Renders portrait frames with either presenter crop, presentation fit, or smooth crossfade."""

    @staticmethod
    def render_presentation_frame(
        frame: np.ndarray,
        output_width: int,
        output_height: int,
        blur_sigma: float = 10.0,
        darken_factor: float = 0.55,
    ) -> np.ndarray:
        """Renders presentation-safe composition: full landscape frame fitted over blurred background."""
        src_h, src_w = frame.shape[:2]
        canvas_ratio = output_width / output_height
        src_ratio = src_w / src_h

        # 1. Background generation: center slice covering target portrait aspect ratio
        if src_ratio > canvas_ratio:
            slice_w = max(1, int(round(src_h * canvas_ratio)))
            slice_h = src_h
            slice_x = max(0, (src_w - slice_w) // 2)
            slice_y = 0
        else:
            slice_w = src_w
            slice_h = max(1, int(round(src_w / canvas_ratio)))
            slice_x = 0
            slice_y = max(0, (src_h - slice_h) // 2)

        bg_slice = frame[slice_y : slice_y + slice_h, slice_x : slice_x + slice_w]

        # Downscale slice to small resolution for ultra-fast Gaussian blur
        small_w = max(32, min(120, output_width // 8))
        small_h = max(32, min(213, output_height // 8))
        bg_small = cv2.resize(bg_slice, (small_w, small_h), interpolation=cv2.INTER_AREA)

        ksize = int(round(blur_sigma * 2)) | 1
        ksize = max(3, min(51, ksize))
        bg_blurred = cv2.GaussianBlur(bg_small, (ksize, ksize), blur_sigma)

        darken_factor = max(0.0, min(1.0, darken_factor))
        bg_dark = (bg_blurred.astype(np.float32) * darken_factor).astype(np.uint8)

        canvas = cv2.resize(bg_dark, (output_width, output_height), interpolation=cv2.INTER_LINEAR)

        # 2. Foreground composition: scale entire source frame to fit inside canvas without cropping
        s = min(output_width / src_w, output_height / src_h)
        fg_w = max(1, int(round(src_w * s)))
        fg_h = max(1, int(round(src_h * s)))

        interp = cv2.INTER_AREA if s <= 1.0 else cv2.INTER_LANCZOS4
        fg = cv2.resize(frame, (fg_w, fg_h), interpolation=interp)

        x_off = max(0, (output_width - fg_w) // 2)
        y_off = max(0, (output_height - fg_h) // 2)

        canvas[y_off : y_off + fg_h, x_off : x_off + fg_w] = fg
        return canvas

    @classmethod
    def render_presenter_frame(
        cls,
        frame: np.ndarray,
        crop_box: Tuple[int, int, int, int],
        output_width: int,
        output_height: int,
        enable_anti_blank_guard: bool = True,
        blur_sigma: float = 10.0,
        darken_factor: float = 0.55,
        alt_crop_box: Optional[Tuple[int, int, int, int]] = None,
    ) -> np.ndarray:
        """Renders presenter-focused portrait crop with anti-blank fallback protection (Phase 5.3)."""
        x, y, w, h = crop_box
        crop = frame[y : y + h, x : x + w]
        if crop.size == 0 or crop.shape[0] == 0 or crop.shape[1] == 0:
            return cls.render_presentation_frame(frame, output_width, output_height, blur_sigma, darken_factor)

        if enable_anti_blank_guard:
            # Check for blank-crop failure:
            # If crop is uniform/blank (e.g. solid blue background) while full frame has content:
            crop_gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
            std_crop = float(np.std(crop_gray))
            frame_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            std_frame = float(np.std(frame_gray))

            if std_crop < 8.0 and std_frame > 25.0:
                # Anti-blank crop failure detected!
                # 1. Try alt_crop_box if provided (e.g. keyframe after a cut)
                if alt_crop_box is not None:
                    ax, ay, aw, ah = alt_crop_box
                    alt_crop = frame[ay : ay + ah, ax : ax + aw]
                    if alt_crop.size > 0:
                        alt_std = float(np.std(cv2.cvtColor(alt_crop, cv2.COLOR_BGR2GRAY)))
                        if alt_std >= 15.0:
                            crop = alt_crop
                            w, h = aw, ah
                            std_crop = alt_std

                # 2. If still blank, fall back safely to presentation mode
                if std_crop < 8.0:
                    return cls.render_presentation_frame(frame, output_width, output_height, blur_sigma, darken_factor)

        if crop.shape[1] != output_width or crop.shape[0] != output_height:
            interp = cv2.INTER_LANCZOS4 if output_width > w else cv2.INTER_AREA
            return cv2.resize(crop, (output_width, output_height), interpolation=interp)
        return crop

    @classmethod
    def render_content_frame(
        cls,
        frame: np.ndarray,
        crop_box: Tuple[int, int, int, int],
        output_width: int,
        output_height: int,
    ) -> np.ndarray:
        """Renders screen-content-focused portrait crop."""
        return cls.render_presenter_frame(frame, crop_box, output_width, output_height)

    @classmethod
    def render_composite_frame(
        cls,
        frame: np.ndarray,
        crop_box: Tuple[int, int, int, int],
        alpha: float,
        output_width: int,
        output_height: int,
        blur_sigma: float = 10.0,
        darken_factor: float = 0.55,
        alt_crop_box: Optional[Tuple[int, int, int, int]] = None,
    ) -> np.ndarray:
        """Renders final frame based on alpha blend factor (0.0=presenter, 1.0=presentation)."""
        if alpha <= 0.001:
            return cls.render_presenter_frame(
                frame, crop_box, output_width, output_height,
                blur_sigma=blur_sigma, darken_factor=darken_factor, alt_crop_box=alt_crop_box
            )
        if alpha >= 0.999:
            return cls.render_presentation_frame(frame, output_width, output_height, blur_sigma, darken_factor)

        frame_presenter = cls.render_presenter_frame(
            frame, crop_box, output_width, output_height,
            blur_sigma=blur_sigma, darken_factor=darken_factor, alt_crop_box=alt_crop_box
        )
        frame_presentation = cls.render_presentation_frame(frame, output_width, output_height, blur_sigma, darken_factor)
        return cv2.addWeighted(frame_presenter, 1.0 - alpha, frame_presentation, alpha, 0.0)


class VideoRendererService:
    """Renders vertical highlight clips using source video, highlight JSON, and crop plan."""

    @staticmethod
    def load_highlight(highlight_input: str | Path | HighlightResult) -> HighlightResult:
        """Loads and validates a HighlightResult from file path or object."""
        if isinstance(highlight_input, HighlightResult):
            return highlight_input
        path = Path(highlight_input).resolve()
        if not path.exists():
            raise FileNotFoundError(f"Highlight JSON file not found: {path}")
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return HighlightResult(**data)
        except Exception as e:
            raise RenderValidationError(f"Failed to parse HighlightResult from '{path}': {e}") from e

    @staticmethod
    def load_crop_plan(crop_plan_input: str | Path | CropPlanResult) -> CropPlanResult:
        """Loads and validates a CropPlanResult from file path or object."""
        if isinstance(crop_plan_input, CropPlanResult):
            return crop_plan_input
        path = Path(crop_plan_input).resolve()
        if not path.exists():
            raise FileNotFoundError(f"Crop plan JSON file not found: {path}")
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return CropPlanResult(**data)
        except Exception as e:
            raise RenderValidationError(f"Failed to parse CropPlanResult from '{path}': {e}") from e

    @staticmethod
    def load_transcript(transcript_input: Union[str, Path, ValidatedTranscript]) -> ValidatedTranscript:
        """Loads and validates a ValidatedTranscript from file path or object."""
        if isinstance(transcript_input, ValidatedTranscript):
            return transcript_input
        path = Path(transcript_input).resolve()
        if not path.exists():
            raise FileNotFoundError(f"Transcript JSON file not found: {path}")
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return ValidatedTranscript(**data)
        except Exception as e:
            raise RenderValidationError(f"Failed to parse ValidatedTranscript from '{path}': {e}") from e

    @classmethod
    def validate_inputs(
        cls,
        video_path: str | Path,
        highlight: HighlightResult,
        crop_plan: CropPlanResult,
        options: RenderOptions,
    ) -> MediaMetadata:
        """Validates all inputs, metadata compatibility, and tool availability before rendering.
        
        Returns:
            Probed MediaMetadata for the source video.
            
        Raises:
            FileNotFoundError: If source video does not exist.
            RenderValidationError: On any metadata, interval, or dimensional mismatch.
        """
        # 1. FFmpeg tool availability
        if not shutil.which("ffmpeg"):
            raise RenderValidationError("FFmpeg binary not found in system PATH. FFmpeg is required for video rendering.")
        if not shutil.which("ffprobe"):
            raise RenderValidationError("FFprobe binary not found in system PATH. FFprobe is required for media inspection.")

        # 2. Source video existence & probing
        v_path = Path(video_path).resolve()
        if not v_path.exists():
            raise FileNotFoundError(f"Source video file not found: {v_path}")
        if not v_path.is_file():
            raise RenderValidationError(f"Source video path is not a regular file: {v_path}")

        probe_meta = MediaProbeService.inspect(v_path)
        if not probe_meta.has_video:
            raise RenderValidationError(f"Source file contains no video streams: {v_path}")
        if probe_meta.width <= 0 or probe_meta.height <= 0:
            raise RenderValidationError(f"Invalid source video dimensions: {probe_meta.width}x{probe_meta.height}")

        # 3. Highlight interval validation
        start_sec = highlight.start_sec
        end_sec = highlight.end_sec
        duration_sec = highlight.duration_sec

        if math.isnan(start_sec) or math.isnan(end_sec) or math.isinf(start_sec) or math.isinf(end_sec):
            raise RenderValidationError("Highlight start and end timestamps must be finite numbers.")
        if start_sec < 0.0:
            raise RenderValidationError(f"Highlight start time cannot be negative: {start_sec}s")
        if end_sec <= start_sec:
            raise RenderValidationError(f"Highlight end time ({end_sec}s) must be greater than start time ({start_sec}s)")
        if start_sec > probe_meta.duration_sec + 0.5:
            raise RenderValidationError(
                f"Highlight start time ({start_sec:.2f}s) exceeds source video duration ({probe_meta.duration_sec:.2f}s)"
            )
        if abs((end_sec - start_sec) - duration_sec) > 0.1:
            raise RenderValidationError(
                f"Highlight duration ({duration_sec}s) inconsistent with end - start ({end_sec - start_sec}s)"
            )

        # 4. Highlight & Crop Plan correspondence
        cp_hl = crop_plan.highlight
        if abs(cp_hl.start_sec - start_sec) > 0.05 or abs(cp_hl.end_sec - end_sec) > 0.05:
            raise RenderValidationError(
                f"Crop plan highlight interval [{cp_hl.start_sec:.2f}s, {cp_hl.end_sec:.2f}s] does not match "
                f"supplied highlight [{start_sec:.2f}s, {end_sec:.2f}s]"
            )

        # 5. Source dimensions compatibility
        if crop_plan.source_width != probe_meta.width or crop_plan.source_height != probe_meta.height:
            raise RenderValidationError(
                f"Crop plan source dimensions ({crop_plan.source_width}x{crop_plan.source_height}) do not match "
                f"actual video dimensions ({probe_meta.width}x{probe_meta.height})"
            )

        # 6. Crop plan keyframes validation
        if not crop_plan.keyframes:
            raise RenderValidationError("Crop plan contains no keyframes.")

        for i, kf in enumerate(crop_plan.keyframes):
            box = kf.crop_box_pixels
            if box.width <= 0 or box.height <= 0:
                raise RenderValidationError(f"Keyframe #{i} has non-positive crop dimensions: {box.width}x{box.height}")
            if box.x < 0 or box.y < 0:
                raise RenderValidationError(f"Keyframe #{i} has negative coordinates: ({box.x}, {box.y})")
            if box.x + box.width > probe_meta.width or box.y + box.height > probe_meta.height:
                raise RenderValidationError(
                    f"Keyframe #{i} crop box [{box.x}, {box.y}, {box.width}, {box.height}] exceeds "
                    f"source frame bounds ({probe_meta.width}x{probe_meta.height})"
                )

        # 7. Output dimensions and aspect ratio validation
        out_w = options.output_width
        out_h = options.output_height
        if out_w <= 0 or out_h <= 0:
            raise RenderValidationError(f"Target output dimensions must be positive, got {out_w}x{out_h}")

        out_ratio = out_w / out_h
        target_ratio = crop_plan.target_aspect_ratio_float
        if abs(out_ratio - target_ratio) > 0.02:
            raise RenderValidationError(
                f"Output dimensions ({out_w}x{out_h}, ratio={out_ratio:.4f}) do not match "
                f"target aspect ratio {crop_plan.target_aspect_ratio} ({target_ratio:.4f})"
            )

        # 8. Phase 5.1 composition options validation
        valid_modes = [m.value for m in CompositionMode]
        if options.composition_mode not in valid_modes:
            raise RenderValidationError(
                f"Unknown composition_mode '{options.composition_mode}'. Must be one of: {valid_modes}"
            )
        if options.sustained_face_loss_sec <= 0.0:
            raise RenderValidationError(f"sustained_face_loss_sec must be positive, got {options.sustained_face_loss_sec}")
        if options.transition_duration_sec < 0.0:
            raise RenderValidationError(f"transition_duration_sec must be non-negative, got {options.transition_duration_sec}")
        if not (0.0 <= options.bg_darken_factor <= 1.0):
            raise RenderValidationError(f"bg_darken_factor must be between 0.0 and 1.0, got {options.bg_darken_factor}")
        if options.bg_blur_sigma <= 0.0:
            raise RenderValidationError(f"bg_blur_sigma must be positive, got {options.bg_blur_sigma}")

        return probe_meta

    @classmethod
    def render_video(
        cls,
        video_path: str | Path,
        highlight_input: str | Path | HighlightResult,
        crop_plan_input: str | Path | CropPlanResult,
        output_path: Optional[str | Path] = None,
        options: Optional[RenderOptions] = None,
        transcript_input: Optional[Union[str, Path, ValidatedTranscript]] = None,
        subtitles_ass_input: Optional[Union[str, Path]] = None,
    ) -> RenderResult:
        """Executes full video rendering pipeline, producing a verified vertical MP4 video.
        
        Args:
            video_path: Path to the original source video.
            highlight_input: Validated HighlightResult object or path to JSON file.
            crop_plan_input: Validated CropPlanResult object or path to JSON file.
            output_path: Destination path for rendered MP4. Defaults to `storage/rendered/<stem>_reel.mp4`.
            options: Optional RenderOptions for dimensions, bitrate, overwrite policy.
            transcript_input: Optional ValidatedTranscript object or path to transcript JSON.
            subtitles_ass_input: Optional path to pre-generated ASS subtitle file.
            
        Returns:
            RenderResult adhering to Phase 5 / Phase 6 master contract.
            
        Raises:
            FileExistsError: If output exists and overwrite is False.
            RenderValidationError: On input verification failure.
            VideoRenderingError: On decoding, encoding, or muxing failure.
        """
        start_wall_clock = time.time()
        options = options or RenderOptions()

        # 1. Load and parse artifacts
        highlight = cls.load_highlight(highlight_input)
        crop_plan = cls.load_crop_plan(crop_plan_input)

        # 2. Validate inputs
        probe_meta = cls.validate_inputs(video_path, highlight, crop_plan, options)
        v_path = Path(video_path).resolve()

        # 3. Determine output destination
        if output_path is None:
            dest_dir = settings.RENDERED_DIR
            dest_dir.mkdir(parents=True, exist_ok=True)
            final_out = dest_dir / f"{v_path.stem}_reel.mp4"
        else:
            final_out = Path(output_path).resolve()
            final_out.parent.mkdir(parents=True, exist_ok=True)

        if final_out.exists() and not options.overwrite:
            raise FileExistsError(
                f"Output video already exists at '{final_out}'. Set overwrite=True or use --overwrite flag to replace it."
            )

        warnings: List[str] = []

        # Warn if significant upscaling is required
        crop_w = getattr(crop_plan, "crop_width", None) or (crop_plan.keyframes[0].crop_box_pixels.width if crop_plan.keyframes else None)
        crop_h = getattr(crop_plan, "crop_height", None) or (crop_plan.keyframes[0].crop_box_pixels.height if crop_plan.keyframes else None)
        if crop_w and crop_h and (options.output_width > crop_w or options.output_height > crop_h):
            scale_factor = round(options.output_height / crop_h, 2)
            warnings.append(
                f"Upscaling applied from crop resolution {crop_w}x{crop_h} to output {options.output_width}x{options.output_height} "
                f"({scale_factor}x factor). Note that upscaling does not recover detail absent from the source footage."
            )

        start_sec = highlight.start_sec
        end_sec = highlight.end_sec
        clip_duration = highlight.duration_sec
        fps = probe_meta.fps or 29.97
        total_frames = int(round(clip_duration * fps))

        # Phase 6: Subtitle generation and verification
        subtitles_enabled = (
            options.subtitles_enabled
            or (transcript_input is not None)
            or (subtitles_ass_input is not None)
            or (options.subtitles_ass_path is not None)
        )
        ass_file_path: Optional[Path] = None
        caption_diagnostics: Optional[CaptionDiagnostics] = None
        caption_groups_count = 0

        if subtitles_enabled:
            ass_candidate = subtitles_ass_input or options.subtitles_ass_path
            if ass_candidate:
                ass_file_path = Path(ass_candidate).resolve()
                if not ass_file_path.exists():
                    raise FileNotFoundError(f"Specified subtitle ASS file not found: {ass_file_path}")
            else:
                t_candidate = transcript_input or options.transcript_path
                if not t_candidate:
                    default_t = settings.TRANSCRIPTS_DIR / f"{v_path.stem}.json"
                    if default_t.exists():
                        t_candidate = default_t
                    else:
                        raise RenderValidationError(
                            f"Subtitles requested, but no transcript provided and default '{default_t}' does not exist."
                        )

                transcript_obj = cls.load_transcript(t_candidate)
                words_source = transcript_obj.display_words or transcript_obj.raw_words
                rel_words, filter_stats = CaptionGeneratorService.filter_and_convert_words(
                    transcript_words=words_source,
                    highlight_start_sec=start_sec,
                    highlight_end_sec=end_sec,
                )

                cap_opts = CaptionOptions(
                    enabled=True,
                    style=CaptionStyle(options.caption_style),
                    font_name=options.caption_font_name,
                    font_size=options.caption_font_size,
                    margin_v=options.caption_margin_v,
                )

                caption_groups = CaptionGeneratorService.group_words_into_captions(
                    words=rel_words,
                    clip_duration=clip_duration,
                    options=cap_opts,
                )
                caption_groups_count = len(caption_groups)

                dest_sub_dir = settings.SUBTITLES_DIR
                dest_sub_dir.mkdir(parents=True, exist_ok=True)
                ass_file_path = dest_sub_dir / f"{final_out.stem}.ass"

                CaptionGeneratorService.save_ass_file(
                    caption_groups=caption_groups,
                    output_path=ass_file_path,
                    options=cap_opts,
                    play_res_x=options.output_width,
                    play_res_y=options.output_height,
                )

                first_start = caption_groups[0].start_sec if caption_groups else None
                last_end = caption_groups[-1].end_sec if caption_groups else None
                total_events = sum(len(g.words) for g in caption_groups) if cap_opts.style == CaptionStyle.KARAOKE else len(caption_groups)

                caption_diagnostics = CaptionDiagnostics(
                    total_source_words=filter_stats["total_input_words"],
                    highlight_words_count=filter_stats["filtered_words_count"],
                    caption_groups_count=len(caption_groups),
                    total_ass_events=total_events,
                    style=options.caption_style,
                    first_caption_start_sec=first_start,
                    last_caption_end_sec=last_end,
                    zero_duration_words_count=filter_stats["zero_duration_count"],
                    clamped_words_count=filter_stats["clamped_count"],
                    time_conversion_convention="relative_to_highlight_start",
                    ass_file_path=str(ass_file_path),
                )

        logger.info(
            "Rendering vertical video [%.2fs - %.2fs] (%d frames @ %.2f fps) -> %dx%d: %s%s",
            start_sec,
            end_sec,
            total_frames,
            fps,
            options.output_width,
            options.output_height,
            final_out.name,
            f" [with {options.caption_style} subtitles: {ass_file_path.name}]" if subtitles_enabled and ass_file_path else "",
        )

        # 4. Use temporary workspace for intermediate audio/video rendering
        with tempfile.TemporaryDirectory(prefix="reel_render_") as tmp_dir:
            tmp_path = Path(tmp_dir)
            temp_video = tmp_path / "temp_video.mp4"
            temp_audio = tmp_path / "temp_audio.m4a"

            # Step A: Adaptive Classifier & Interpolator
            classifier = AdaptiveCompositionClassifier(
                keyframes=crop_plan.keyframes,
                source_width=probe_meta.width,
                source_height=probe_meta.height,
                composition_mode=options.composition_mode,
                sustained_face_loss_sec=options.sustained_face_loss_sec,
                transition_duration_sec=options.transition_duration_sec,
                tiny_face_ratio_threshold=options.tiny_face_ratio_threshold,
                video_path=v_path,
                enable_content_tracking=options.enable_content_tracking,
                content_min_score=options.content_min_score,
                content_max_width_ratio=options.content_max_width_ratio,
                content_smoothing_alpha=options.content_smoothing_alpha,
                content_hold_sec=options.content_hold_sec,
            )
            interpolator = CropInterpolator(
                keyframes=crop_plan.keyframes,
                source_width=probe_meta.width,
                source_height=probe_meta.height
            )

            # Step B: Open OpenCV reader and seek
            cap = cv2.VideoCapture(str(v_path))
            if not cap.isOpened():
                raise VideoRenderingError(f"OpenCV failed to open video file: {v_path}")

            start_frame_idx = int(round(start_sec * fps))
            cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame_idx)

            # Step C: Spawn FFmpeg rawvideo encoder pipe
            encode_cmd = [
                "ffmpeg", "-y",
                "-f", "rawvideo",
                "-vcodec", "rawvideo",
                "-s", f"{options.output_width}x{options.output_height}",
                "-pix_fmt", "bgr24",
                "-r", str(fps),
                "-i", "-",
                "-c:v", "libx264",
                "-preset", options.preset,
                "-crf", str(options.crf),
                "-b:v", options.video_bitrate,
                "-pix_fmt", "yuv420p",
                str(temp_video)
            ]

            logger.debug("Starting FFmpeg video encode pipe: %s", " ".join(encode_cmd))
            proc = subprocess.Popen(
                encode_cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )

            rendered_frames = 0
            presenter_frames_count = 0
            content_frames_count = 0
            presentation_frames_count = 0
            fallback_events_count = 0
            last_valid_frame = None
            hist_prev = None
            exact_cut_detected = False
            frame_diagnostics_sample = []
            sample_interval = max(1, int(round(fps)))

            try:
                for k in range(total_frames):
                    t_abs = start_sec + (k / fps)
                    ret, frame = cap.read()

                    if not ret or frame is None:
                        if last_valid_frame is not None:
                            frame = last_valid_frame
                            warnings.append(f"Frame #{k} (timestamp {t_abs:.2f}s) failed decoding; repeated previous frame.")
                        else:
                            # Frame failure before any valid frame: fallback black frame
                            frame = np.zeros((probe_meta.height, probe_meta.width, 3), dtype=np.uint8)
                            warnings.append(f"Initial frame #{k} failed decoding; generated black frame.")
                    else:
                        last_valid_frame = frame

                    # 1. Frame-to-frame cut detection
                    is_cut_frame = False
                    if frame is not None and frame.size > 0:
                        hist_curr = cv2.calcHist([frame], [0, 1, 2], None, [8, 8, 8], [0, 256, 0, 256, 0, 256])
                        cv2.normalize(hist_curr, hist_curr, 0, 1, cv2.NORM_MINMAX)
                        if hist_prev is not None:
                            sim = float(cv2.compareHist(hist_prev, hist_curr, cv2.HISTCMP_CORREL))
                            if sim < 0.45:
                                is_cut_frame = True
                                exact_cut_detected = True
                        hist_prev = hist_curr

                    # Check keyframe boundary for cut state reset
                    kf_curr, kf_next = interpolator.get_bounding_keyframes(t_abs)
                    if t_abs >= kf_next.timestamp_abs_sec:
                        exact_cut_detected = False

                    # 2. Lookup crop box and composition blend factor
                    crop_box = interpolator.get_crop_box(t_abs, exact_cut_passed=exact_cut_detected)
                    dominant_mode, alpha = classifier.get_composition_state(t_abs)

                    alt_box = (
                        kf_next.crop_box_pixels.x,
                        kf_next.crop_box_pixels.y,
                        kf_next.crop_box_pixels.width,
                        kf_next.crop_box_pixels.height,
                    ) if (kf_next.transition == "cut" and not exact_cut_detected) else None

                    if dominant_mode == "presenter":
                        presenter_frames_count += 1
                    elif dominant_mode == "screen_content":
                        content_frames_count += 1
                    else:
                        presentation_frames_count += 1

                    # Evaluate blank-crop guard trigger condition for diagnostics
                    cx, cy, cw, ch = crop_box
                    crop_slice = frame[cy : cy + ch, cx : cx + cw]
                    crop_gray = cv2.cvtColor(crop_slice, cv2.COLOR_BGR2GRAY) if crop_slice.size > 0 else None
                    std_crop = float(np.std(crop_gray)) if crop_gray is not None else 0.0
                    frame_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                    std_frame = float(np.std(frame_gray))
                    fallback_triggered = (dominant_mode in ("presenter", "screen_content") and std_crop < 8.0 and std_frame > 25.0)
                    if fallback_triggered:
                        fallback_events_count += 1

                    # Render composition (presenter crop, presentation fit + blur, or crossfade)
                    composite_frame = CompositionRenderer.render_composite_frame(
                        frame=frame,
                        crop_box=crop_box,
                        alpha=alpha,
                        output_width=options.output_width,
                        output_height=options.output_height,
                        blur_sigma=options.bg_blur_sigma,
                        darken_factor=options.bg_darken_factor,
                        alt_crop_box=alt_box,
                    )

                    # Diagnostic sample capture
                    if (k % sample_interval == 0) or is_cut_frame or fallback_triggered or k == total_frames - 1:
                        frame_diagnostics_sample.append({
                            "frame_index": k,
                            "source_timestamp_sec": round(t_abs, 3),
                            "dominant_mode": dominant_mode,
                            "alpha": round(alpha, 3),
                            "frame_contrast_std": round(std_frame, 1),
                            "crop_contrast_std": round(std_crop, 1),
                            "fallback_triggered": fallback_triggered,
                            "scene_cut_detected": is_cut_frame,
                        })

                    try:
                        proc.stdin.write(composite_frame.tobytes())
                        rendered_frames += 1
                    except (IOError, BrokenPipeError) as e:
                        stderr_out = proc.stderr.read().decode("utf-8", errors="replace") if proc.stderr else ""
                        raise FFmpegExecutionError(f"FFmpeg video encoding pipe broken during frame #{k}: {stderr_out}") from e

            finally:
                cap.release()
                if proc.stdin:
                    proc.stdin.close()
                stdout_data, stderr_data = proc.communicate()

            if proc.returncode != 0:
                err_msg = stderr_data.decode("utf-8", errors="replace") if stderr_data else ""
                raise FFmpegExecutionError(f"FFmpeg video encoding failed (exit code {proc.returncode}): {err_msg}")

            # Step D: Audio extraction & trimming
            audio_included = False
            output_audio_codec = None

            if probe_meta.has_audio:
                audio_cmd = [
                    "ffmpeg", "-y",
                    "-ss", str(round(start_sec, 4)),
                    "-to", str(round(end_sec, 4)),
                    "-i", str(v_path),
                    "-vn",
                    "-c:a", "aac",
                    "-b:a", options.audio_bitrate,
                    str(temp_audio)
                ]
                logger.debug("Extracting audio: %s", " ".join(audio_cmd))
                res_audio = subprocess.run(
                    audio_cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True
                )
                if res_audio.returncode != 0:
                    warnings.append(f"Audio extraction failed ({res_audio.stderr.strip()}); output will be silent.")
                elif temp_audio.exists() and temp_audio.stat().st_size > 512:
                    audio_included = True
                    output_audio_codec = "aac"
                else:
                    warnings.append("Extracted audio file is empty; output will be silent.")
            else:
                warnings.append("Source media has no audio stream; rendered clip is silent.")

            # Step E: Final Muxing into output container with optional subtitle burn-in
            mux_cmd = ["ffmpeg", "-y", "-i", str(temp_video)]
            if audio_included:
                mux_cmd.extend(["-i", str(temp_audio)])

            if subtitles_enabled and ass_file_path and ass_file_path.exists():
                ass_filter_arg = format_ffmpeg_ass_filter(ass_file_path)
                mux_cmd.extend([
                    "-vf", ass_filter_arg,
                    "-c:v", "libx264",
                    "-preset", options.preset,
                    "-crf", str(options.crf),
                    "-b:v", options.video_bitrate,
                    "-pix_fmt", "yuv420p",
                ])
            else:
                mux_cmd.extend(["-c:v", "copy"])

            if audio_included:
                mux_cmd.extend(["-c:a", "copy"])

            mux_cmd.extend(["-movflags", "+faststart", str(final_out)])

            logger.debug("Muxing final container: %s", " ".join(mux_cmd))
            res_mux = subprocess.run(
                mux_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )
            if res_mux.returncode != 0:
                raise FFmpegExecutionError(f"FFmpeg muxing failed (exit code {res_mux.returncode}): {res_mux.stderr.strip()}")

        # 5. Media Validation of Final Output MP4
        if not final_out.exists() or final_out.stat().st_size == 0:
            raise VideoRenderingError(f"Rendered output file was not created or is empty: {final_out}")

        final_meta = MediaProbeService.inspect(final_out)
        if not final_meta.has_video:
            raise VideoRenderingError("Final rendered file does not contain a valid video stream.")
        if final_meta.width != options.output_width or final_meta.height != options.output_height:
            raise VideoRenderingError(
                f"Output dimensions mismatch: expected {options.output_width}x{options.output_height}, got {final_meta.width}x{final_meta.height}"
            )
        if abs(final_meta.duration_sec - clip_duration) > 1.0:
            warnings.append(
                f"Rendered duration ({final_meta.duration_sec:.2f}s) differs slightly from requested ({clip_duration:.2f}s)."
            )

        actual_audio_duration = None
        if audio_included and final_meta.has_audio:
            actual_audio_duration = final_meta.duration_sec

        wall_clock = round(time.time() - start_wall_clock, 3)

        background_style = {
            "type": "gaussian_blur_darkened",
            "blur_sigma": options.bg_blur_sigma,
            "darken_factor": options.bg_darken_factor,
            "canvas_aspect": f"{options.output_width}:{options.output_height}",
        }

        result = RenderResult(
            schema_version="1.4" if subtitles_enabled else "1.3",
            source_video=v_path.name,
            highlight_start_sec=round(start_sec, 3),
            highlight_end_sec=round(end_sec, 3),
            requested_duration_sec=round(clip_duration, 3),
            output_path=str(final_out),
            output_width=final_meta.width,
            output_height=final_meta.height,
            output_fps=final_meta.fps or fps,
            output_video_codec=final_meta.video_codec or "h264",
            output_audio_codec=output_audio_codec,
            audio_included=audio_included,
            rendered_frame_count=rendered_frames,
            actual_video_duration_sec=final_meta.duration_sec,
            actual_audio_duration_sec=actual_audio_duration,
            render_duration_sec=wall_clock,
            crop_plan_reference=str(crop_plan_input) if isinstance(crop_plan_input, (str, Path)) else None,
            highlight_reference=str(highlight_input) if isinstance(highlight_input, (str, Path)) else None,
            composition_mode=options.composition_mode,
            presenter_frames_count=presenter_frames_count,
            presentation_frames_count=presentation_frames_count,
            content_frames_count=content_frames_count,
            content_detections_count=classifier.content_detections_count,
            composition_transitions_count=classifier.total_transitions_count,
            scene_cut_transitions_count=classifier.scene_cut_transitions_count,
            sustained_loss_transitions_count=classifier.sustained_loss_transitions_count,
            content_transitions_count=classifier.content_transitions_count,
            scene_type_distribution=classifier.scene_type_distribution,
            fallback_events_count=fallback_events_count,
            frame_diagnostics_sample=frame_diagnostics_sample,
            background_style=background_style,
            content_tracking_diagnostics=classifier.get_diagnostics(),
            subtitles_enabled=subtitles_enabled,
            caption_style=options.caption_style if subtitles_enabled else None,
            subtitles_ass_path=str(ass_file_path) if (subtitles_enabled and ass_file_path) else None,
            caption_groups_count=caption_groups_count if subtitles_enabled else None,
            caption_diagnostics=caption_diagnostics.model_dump() if caption_diagnostics else None,
            warnings=warnings,
            success=True
        )

        logger.info(
            "Video rendering complete: %s (%dx%d, %.2fs, %d frames in %.2fs)",
            final_out.name,
            result.output_width,
            result.output_height,
            result.actual_video_duration_sec,
            result.rendered_frame_count,
            result.render_duration_sec
        )
        return result

    @staticmethod
    def save_manifest(
        result: RenderResult,
        manifest_path: Optional[str | Path] = None
    ) -> Path:
        """Saves RenderResult manifest JSON to disk."""
        if manifest_path is None:
            out_p = Path(result.output_path)
            target = out_p.parent / f"{out_p.stem}_render_manifest.json"
        else:
            target = Path(manifest_path).resolve()
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(result.model_dump_json(indent=2), encoding="utf-8")
        logger.info("Saved render manifest to: %s", target)
        return target
