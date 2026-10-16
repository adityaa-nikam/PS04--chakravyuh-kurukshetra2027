"""Screen-Content Detection and Tracking Engine (Phase 5.2).

Detects and tracks informative visual screen content (code editors, terminal windows,
diagrams, slides) in educational video recordings. Evaluates whether content can be
tightly framed in a 9:16 portrait crop without clipping essential context, or if a
wider presentation-safe view is required.
"""

import logging
import math
from enum import Enum
from typing import List, Optional, Tuple, Dict, Any

import cv2
import numpy as np
from pydantic import BaseModel, Field

from app.schemas import NormalizedCropBox, CropBoxPixels, SceneType

logger = logging.getLogger(__name__)


class ContentCandidateType(str, Enum):
    """Types of visual screen content identified by heuristic detectors."""
    CODE_EDITOR = "code_editor"
    TERMINAL = "terminal"
    DIAGRAM_PANEL = "diagram_panel"
    SLIDE_CONTENT = "slide_content"
    TEXT_BLOCK = "text_block"
    UNKNOWN = "unknown"


class ContentBoundingBox(BaseModel):
    """Pixel coordinates of a detected content candidate [x, y, width, height]."""
    x: int = Field(..., ge=0)
    y: int = Field(..., ge=0)
    width: int = Field(..., gt=0)
    height: int = Field(..., gt=0)


class ContentCandidate(BaseModel):
    """A detected screen content candidate region with supporting heuristic signals."""
    box_pixels: ContentBoundingBox
    box_norm: NormalizedCropBox
    candidate_type: ContentCandidateType = ContentCandidateType.UNKNOWN
    detection_method: str = "edge_contour_analysis_v1"
    heuristic_score: float = Field(..., ge=0.0, le=1.0)
    edge_density: float = Field(default=0.0, ge=0.0)
    line_structure_score: float = Field(default=0.0, ge=0.0, le=1.0)
    contrast: float = Field(default=0.0, ge=0.0)
    aspect_ratio: float = Field(default=1.0, gt=0.0)
    area_ratio: float = Field(default=0.0, ge=0.0, le=1.0)
    fits_portrait_crop: bool = False
    supporting_signals: Dict[str, Any] = Field(default_factory=dict)


class ScreenContentDetectionResult(BaseModel):
    """Aggregate result from screen content detection on a single frame."""
    candidates: List[ContentCandidate] = Field(default_factory=list)
    best_candidate: Optional[ContentCandidate] = None
    has_valid_content: bool = False
    recommended_mode: str = "presentation"  # "presenter" | "screen_content" | "presentation"
    scene_type: SceneType = SceneType.PRESENTATION_SCREEN
    scene_diagnostics: Dict[str, Any] = Field(default_factory=dict)
    is_uncertain: bool = False
    fallback_reason: Optional[str] = None
    method: str = "opencv_visual_heuristics_v1"
    diagnostics: Dict[str, Any] = Field(default_factory=dict)


class ScreenContentDetector:
    """Detects text-like structures, code editors, terminals, and diagram panels using OpenCV."""

    def __init__(
        self,
        min_candidate_width: int = 60,
        min_candidate_height: int = 50,
        min_area_ratio: float = 0.03,
        max_area_ratio: float = 0.95,
        min_heuristic_score: float = 0.35,
        target_aspect_ratio: float = 9.0 / 16.0,
        max_portrait_width_ratio: float = 0.45,
    ):
        self.min_candidate_width = min_candidate_width
        self.min_candidate_height = min_candidate_height
        self.min_area_ratio = min_area_ratio
        self.max_area_ratio = max_area_ratio
        self.min_heuristic_score = min_heuristic_score
        self.target_aspect_ratio = target_aspect_ratio
        self.max_portrait_width_ratio = max_portrait_width_ratio

    @classmethod
    def classify_scene_type(
        cls,
        frame: np.ndarray,
        face_box: Optional[Tuple[int, int, int, int]],
        content_candidates: List[ContentCandidate],
        source_w: int,
        source_h: int,
    ) -> Tuple[SceneType, Dict[str, Any]]:
        """Classifies the frame into one of four distinct scene types (Phase 5.3).
        
        Scene Types:
        - PRESENTER_ONLY: Prominent, centered instructor talking-head shot.
        - PRECOMPOSITED_PIP: Pre-composited layout with presenter inset alongside screen share or background.
        - PRESENTATION_SCREEN: Slide, diagram, map, code editor, or terminal with no primary presenter.
        - TRANSITION_OR_UNCERTAIN: Low-contrast, blank, or pale transition frames.
        """
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if frame.ndim == 3 else frame
        std_dev = float(np.std(gray))
        if std_dev < 10.0:
            return SceneType.TRANSITION_OR_UNCERTAIN, {
                "reason": "low_contrast_or_blank_transition",
                "contrast_std": round(std_dev, 2),
            }

        valid_content = [c for c in content_candidates if c.heuristic_score >= 0.35]
        has_wide_content = any(
            (c.box_pixels.width / float(source_w)) >= 0.35 or not c.fits_portrait_crop
            for c in valid_content
        )

        if face_box is not None:
            fx, fy, fw, fh = face_box
            # If color frame, verify that face box is not a synthetic colored graphic (e.g. blue UI box):
            if frame.ndim == 3 and fw > 0 and fh > 0:
                roi = frame[max(0, fy):min(source_h, fy + fh), max(0, fx):min(source_w, fx + fw)]
                if roi.size > 0:
                    m_b, m_g, m_r = np.mean(roi, axis=(0, 1))
                    if m_b > m_r + 30.0:  # Blue-dominant non-skin element
                        ycrcb = cv2.cvtColor(roi, cv2.COLOR_BGR2YCrCb)
                        skin_mask = cv2.inRange(ycrcb, np.array([0, 133, 77]), np.array([255, 173, 127]))
                        skin_pct = (np.count_nonzero(skin_mask) / float(roi.shape[0] * roi.shape[1])) * 100.0
                        if skin_pct < 5.0:
                            face_box = None

        if face_box is not None:
            fx, fy, fw, fh = face_box
            cx_norm = (fx + (fw / 2.0)) / float(source_w)
            area_ratio = (fw * fh) / float(source_w * source_h)
            height_ratio = fh / float(source_h)

            # Inset detection: presenter pushed to lateral margins
            is_lateral_inset = (cx_norm < 0.25 or cx_norm > 0.75)
            # Small face detection: presenter takes up <= 3.5% of total frame area
            is_small_face = (area_ratio < 0.035 or height_ratio < 0.22)

            if is_lateral_inset:
                return SceneType.PRECOMPOSITED_PIP, {
                    "reason": "lateral_inset_presenter",
                    "cx_norm": round(cx_norm, 3),
                    "area_ratio": round(area_ratio, 4),
                    "height_ratio": round(height_ratio, 3),
                    "has_wide_content": has_wide_content,
                }
            elif is_small_face and (has_wide_content or len(valid_content) > 0):
                return SceneType.PRECOMPOSITED_PIP, {
                    "reason": "small_face_with_screen_content",
                    "cx_norm": round(cx_norm, 3),
                    "area_ratio": round(area_ratio, 4),
                    "has_wide_content": has_wide_content,
                }
            elif has_wide_content and max([c.heuristic_score for c in valid_content], default=0.0) >= 0.70 and area_ratio < 0.045:
                return SceneType.PRECOMPOSITED_PIP, {
                    "reason": "content_dominates_over_face",
                    "cx_norm": round(cx_norm, 3),
                    "area_ratio": round(area_ratio, 4),
                }
            else:
                return SceneType.PRESENTER_ONLY, {
                    "reason": "centered_prominent_presenter",
                    "cx_norm": round(cx_norm, 3),
                    "area_ratio": round(area_ratio, 4),
                    "height_ratio": round(height_ratio, 3),
                }

        # No face detected
        if valid_content:
            return SceneType.PRESENTATION_SCREEN, {
                "reason": "screen_content_without_face",
                "candidates_count": len(valid_content),
                "best_type": valid_content[0].candidate_type.value,
            }
        else:
            return SceneType.PRESENTATION_SCREEN, {
                "reason": "presentation_frame_fallback",
                "contrast_std": round(std_dev, 2),
            }

    def detect(
        self,
        frame: np.ndarray,
        webcam_box: Optional[Tuple[int, int, int, int]] = None,
    ) -> ScreenContentDetectionResult:
        """Analyzes a single video frame for screen content regions.
        
        Args:
            frame: BGR image array (H, W, 3).
            webcam_box: Optional (x, y, w, h) of detected instructor/webcam face to mask out.
            
        Returns:
            ScreenContentDetectionResult containing ranked candidates and recommendation.
        """
        if frame is None or frame.size == 0 or frame.ndim != 3:
            return ScreenContentDetectionResult(
                has_valid_content=False,
                recommended_mode="presentation",
                scene_type=SceneType.TRANSITION_OR_UNCERTAIN,
                is_uncertain=True,
                diagnostics={"error": "Empty or invalid frame"}
            )

        src_h, src_w = frame.shape[:2]
        frame_area = src_w * src_h

        # 1. Grayscale & Contrast verification
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        std_dev = float(np.std(gray))
        if std_dev < 10.0:
            # Blank, pale, or near-uniform frame (e.g. solid color transition or white fade)
            return ScreenContentDetectionResult(
                has_valid_content=False,
                recommended_mode="presentation",
                scene_type=SceneType.TRANSITION_OR_UNCERTAIN,
                is_uncertain=True,
                scene_diagnostics={"reason": "low_contrast_or_blank_transition", "contrast_std": round(std_dev, 2)},
                diagnostics={"blank_frame": True, "contrast_std": round(std_dev, 2)}
            )

        # Mask webcam inset if present
        analysis_gray = gray.copy()
        if webcam_box is not None:
            wx, wy, ww, wh = webcam_box
            pad = 10
            x1 = max(0, wx - pad)
            y1 = max(0, wy - pad)
            x2 = min(src_w, wx + ww + pad)
            y2 = min(src_h, wy + wh + pad)
            analysis_gray[y1:y2, x1:x2] = 0

        # 2. Multi-scale edge & gradient analysis
        # Sobel horizontal gradients emphasize text and code lines
        grad_x = cv2.Sobel(analysis_gray, cv2.CV_16S, 1, 0, ksize=3)
        grad_y = cv2.Sobel(analysis_gray, cv2.CV_16S, 0, 1, ksize=3)
        abs_grad_x = cv2.convertScaleAbs(grad_x)
        abs_grad_y = cv2.convertScaleAbs(grad_y)
        edge_map = cv2.addWeighted(abs_grad_x, 0.7, abs_grad_y, 0.3, 0)

        # 3. Morphological grouping for text/code blocks and panels
        # Horizontal structuring element connects adjacent words on the same code/text line
        kernel_h = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 3))
        dilated_h = cv2.dilate(edge_map, kernel_h, iterations=1)
        _, thresh = cv2.threshold(dilated_h, 35, 255, cv2.THRESH_BINARY)

        # Vertical connect for paragraphs/code blocks
        kernel_v = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 9))
        connected = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel_v)

        # Also find rectangular panels / containers
        panel_thresh = cv2.adaptiveThreshold(
            analysis_gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 25, 4
        )
        kernel_panel = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
        panel_closed = cv2.morphologyEx(panel_thresh, cv2.MORPH_CLOSE, kernel_panel)

        combined_mask = cv2.bitwise_or(connected, panel_closed)

        # 4. Contour detection and candidate extraction
        contours, _ = cv2.findContours(combined_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        candidates: List[ContentCandidate] = []
        max_crop_w = int(round(src_h * self.target_aspect_ratio))

        for cnt in contours:
            x, y, w, h = cv2.boundingRect(cnt)
            area = w * h
            area_ratio = area / frame_area

            # Filter out tiny noise and full-frame encompassing containers
            if w < self.min_candidate_width or h < self.min_candidate_height:
                continue
            if area_ratio < self.min_area_ratio or area_ratio > self.max_area_ratio:
                continue

            # Check overlap with webcam box
            if webcam_box is not None:
                wx, wy, ww, wh = webcam_box
                # Overlap test
                ix1 = max(x, wx)
                iy1 = max(y, wy)
                ix2 = min(x + w, wx + ww)
                iy2 = min(y + h, wy + wh)
                if ix2 > ix1 and iy2 > iy1:
                    inter_area = (ix2 - ix1) * (iy2 - iy1)
                    if inter_area / area > 0.4:
                        continue

            # Extract features for candidate ROI
            roi_gray = analysis_gray[y : y + h, x : x + w]
            roi_edges = edge_map[y : y + h, x : x + w]

            # A. Edge density: proportion of active edge pixels in ROI
            edge_count = float(np.count_nonzero(roi_edges > 40))
            edge_density = edge_count / max(1, area)
            norm_edge_density = min(1.0, edge_density * 8.0)

            # B. Line structure score (horizontal projection variance)
            # Text and code produce periodic horizontal row sum peaks
            row_sums = np.sum(roi_edges > 40, axis=1, dtype=np.float32)
            if len(row_sums) > 5 and np.mean(row_sums) > 0.5:
                line_variance = float(np.std(row_sums) / (np.mean(row_sums) + 1e-5))
                line_score = min(1.0, line_variance / 2.5)
            else:
                line_score = 0.0

            # C. Contrast score in ROI
            roi_contrast = float(np.std(roi_gray))
            norm_contrast = min(1.0, roi_contrast / 60.0)

            # D. Area balance score (supports both sub-panels 8%-70% and full presentation screens 70%-95%)
            if 0.08 <= area_ratio <= 0.95:
                area_score = 1.0
            elif area_ratio < 0.08:
                area_score = area_ratio / 0.08
            else:
                area_score = 0.5

            # Heuristic score combination
            heuristic_score = round(
                0.35 * norm_edge_density + 0.35 * line_score + 0.15 * norm_contrast + 0.15 * area_score,
                3
            )

            # Candidate classification
            aspect = round(w / float(h), 3)
            mean_intensity = float(np.mean(roi_gray))

            if line_score > 0.45 and norm_edge_density > 0.30:
                if mean_intensity < 70.0:
                    cand_type = ContentCandidateType.TERMINAL
                else:
                    cand_type = ContentCandidateType.CODE_EDITOR
            elif aspect > 0.8 and norm_contrast > 0.35:
                cand_type = ContentCandidateType.DIAGRAM_PANEL
            elif norm_edge_density > 0.20:
                cand_type = ContentCandidateType.SLIDE_CONTENT
            else:
                cand_type = ContentCandidateType.TEXT_BLOCK

            # Portrait framing feasibility:
            # Does the region fit in a 9:16 portrait crop without cutting off its sides?
            # A 9:16 portrait crop has max width of src_h * (9/16) (e.g. 270px in 854x480).
            # If w <= max_crop_w * 1.15 (with padding leeway), it can be reframed into 9:16.
            # If w > max_crop_w * 1.15 or w / src_w > self.max_portrait_width_ratio,
            # it is too broad and requires presentation-safe mode.
            fits_portrait = (
                w <= int(round(max_crop_w * 1.15))
                and (w / float(src_w)) <= self.max_portrait_width_ratio
            )

            cand = ContentCandidate(
                box_pixels=ContentBoundingBox(x=x, y=y, width=w, height=h),
                box_norm=NormalizedCropBox(
                    x_min=round(x / src_w, 4),
                    y_min=round(y / src_h, 4),
                    width=round(w / src_w, 4),
                    height=round(h / src_h, 4),
                ),
                candidate_type=cand_type,
                detection_method="edge_contour_analysis_v1",
                heuristic_score=heuristic_score,
                edge_density=round(edge_density, 4),
                line_structure_score=round(line_score, 3),
                contrast=round(roi_contrast, 2),
                aspect_ratio=aspect,
                area_ratio=round(area_ratio, 4),
                fits_portrait_crop=fits_portrait,
                supporting_signals={
                    "norm_edge_density": round(norm_edge_density, 3),
                    "mean_intensity": round(mean_intensity, 1),
                    "contrast_std": round(roi_contrast, 1),
                }
            )
            candidates.append(cand)

        # Check overall horizontal span across all valid candidates:
        # If content elements are spread across a wide presentation slide,
        # no single 9:16 portrait crop can frame them without amputating content.
        valid_cands = [c for c in candidates if c.heuristic_score >= self.min_heuristic_score]
        if len(valid_cands) >= 2:
            span_x1 = min(c.box_pixels.x for c in valid_cands)
            span_x2 = max(c.box_pixels.x + c.box_pixels.width for c in valid_cands)
            total_content_span = span_x2 - span_x1
            if total_content_span > max_crop_w * 1.15:
                for c in candidates:
                    c.fits_portrait_crop = False

        scene_type, scene_diag = self.classify_scene_type(
            frame=frame,
            face_box=webcam_box,
            content_candidates=candidates,
            source_w=src_w,
            source_h=src_h,
        )

        if not candidates:
            rec_mode = "presenter" if scene_type == SceneType.PRESENTER_ONLY else "presentation"
            return ScreenContentDetectionResult(
                candidates=[],
                best_candidate=None,
                has_valid_content=False,
                recommended_mode=rec_mode,
                scene_type=scene_type,
                scene_diagnostics=scene_diag,
                diagnostics={"candidates_found": 0, "reason": "No valid contours meeting minimum size/density"}
            )

        # Sort candidates by heuristic score descending
        candidates.sort(key=lambda c: c.heuristic_score, reverse=True)
        best = candidates[0]

        has_valid = best.heuristic_score >= self.min_heuristic_score

        # Recommended mode mapping:
        if scene_type == SceneType.PRESENTER_ONLY:
            recommended = "presenter"
        elif scene_type == SceneType.PRECOMPOSITED_PIP:
            recommended = "screen_content" if (has_valid and best.fits_portrait_crop) else "presentation"
        elif scene_type == SceneType.PRESENTATION_SCREEN:
            recommended = "screen_content" if (has_valid and best.fits_portrait_crop) else "presentation"
        else:
            recommended = "presentation"

        return ScreenContentDetectionResult(
            candidates=candidates,
            best_candidate=best,
            has_valid_content=has_valid,
            recommended_mode=recommended,
            scene_type=scene_type,
            scene_diagnostics=scene_diag,
            diagnostics={
                "candidates_count": len(candidates),
                "best_score": best.heuristic_score,
                "best_type": best.candidate_type.value,
                "fits_portrait": best.fits_portrait_crop,
            }
        )


class ScreenContentTracker:
    """Tracks a primary screen-content region across frames with spatial smoothing and bounded hold."""

    def __init__(
        self,
        source_width: int,
        source_height: int,
        target_aspect_ratio: float = 9.0 / 16.0,
        smoothing_alpha: float = 0.3,
        max_hold_frames: int = 4,
        max_velocity_pixels_per_sec: float = 250.0,
        min_score_threshold: float = 0.35,
    ):
        self.source_width = source_width
        self.source_height = source_height
        self.target_aspect_ratio = target_aspect_ratio
        self.smoothing_alpha = smoothing_alpha
        self.max_hold_frames = max_hold_frames
        self.max_velocity_pixels_per_sec = max_velocity_pixels_per_sec
        self.min_score_threshold = min_score_threshold

        self.crop_width = int(round(source_height * target_aspect_ratio))
        self.crop_height = source_height

        self.prev_center: Optional[Tuple[float, float]] = None
        self.prev_candidate: Optional[ContentCandidate] = None
        self.frames_since_last_detection: int = 0
        self.last_timestamp: float = 0.0

    def reset(self) -> None:
        """Resets tracker state (e.g. at scene cuts or shot boundaries)."""
        self.prev_center = None
        self.prev_candidate = None
        self.frames_since_last_detection = 0
        self.last_timestamp = 0.0

    def update(
        self,
        detection_result: ScreenContentDetectionResult,
        timestamp_sec: float = 0.0,
        is_scene_cut: bool = False,
    ) -> Tuple[Optional[CropBoxPixels], str, Optional[ContentCandidate]]:
        """Updates tracking state with frame detection results.
        
        Args:
            detection_result: ScreenContentDetectionResult from detector.
            timestamp_sec: Timestamp in seconds.
            is_scene_cut: Whether a scene cut occurred at this frame.
            
        Returns:
            Tuple of (CropBoxPixels or None, tracking_status: str, tracked_candidate: Optional[ContentCandidate])
            tracking_status is one of: 'tracking_active', 'tracking_hold', 'too_broad', 'no_content'
        """
        if is_scene_cut:
            self.reset()

        dt = max(0.001, timestamp_sec - self.last_timestamp) if self.last_timestamp > 0 else 0.5
        self.last_timestamp = timestamp_sec

        best = detection_result.best_candidate

        if best and detection_result.has_valid_content:
            # If candidate is too broad to frame in 9:16 portrait crop without clipping
            if not best.fits_portrait_crop:
                self.prev_candidate = best
                return None, "too_broad", best

            # Calculate detected center
            box = best.box_pixels
            det_cx = box.x + (box.width / 2.0)
            det_cy = box.y + (box.height / 2.0)

            if self.prev_center is not None and not is_scene_cut:
                # Associate with previous tracking position
                prev_cx, prev_cy = self.prev_center
                # Apply velocity limit
                max_delta = self.max_velocity_pixels_per_sec * dt
                delta_x = det_cx - prev_cx
                delta_y = det_cy - prev_cy
                dist = math.hypot(delta_x, delta_y)
                if dist > max_delta and dist > 0:
                    scale = max_delta / dist
                    target_cx = prev_cx + (delta_x * scale)
                    target_cy = prev_cy + (delta_y * scale)
                else:
                    target_cx = det_cx
                    target_cy = det_cy

                # EMA smoothing
                smooth_cx = (self.smoothing_alpha * target_cx) + ((1.0 - self.smoothing_alpha) * prev_cx)
                smooth_cy = (self.smoothing_alpha * target_cy) + ((1.0 - self.smoothing_alpha) * prev_cy)
            else:
                smooth_cx = det_cx
                smooth_cy = det_cy

            self.prev_center = (smooth_cx, smooth_cy)
            self.prev_candidate = best
            self.frames_since_last_detection = 0

            crop_box = self._build_clamped_crop(smooth_cx, smooth_cy)
            return crop_box, "tracking_active", best

        # No valid candidate on this frame: check hold mechanism
        if self.prev_center is not None and self.frames_since_last_detection < self.max_hold_frames:
            self.frames_since_last_detection += 1
            smooth_cx, smooth_cy = self.prev_center
            crop_box = self._build_clamped_crop(smooth_cx, smooth_cy)
            return crop_box, "tracking_hold", self.prev_candidate

        # Hold expired or no prior track
        self.prev_center = None
        self.prev_candidate = None
        return None, "no_content", None

    def _build_clamped_crop(self, cx: float, cy: float) -> CropBoxPixels:
        """Constructs a 9:16 CropBoxPixels strictly clamped inside source dimensions."""
        crop_w = self.crop_width
        crop_h = self.crop_height

        x = int(round(cx - (crop_w / 2.0)))
        y = int(round(cy - (crop_h / 2.0)))

        # Clamp strictly inside frame bounds
        clamped_x = max(0, min(x, self.source_width - crop_w))
        clamped_y = max(0, min(y, self.source_height - crop_h))

        return CropBoxPixels(
            x=clamped_x,
            y=clamped_y,
            width=crop_w,
            height=crop_h
        )
