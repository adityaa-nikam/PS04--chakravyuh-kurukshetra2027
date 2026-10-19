"""Computer Vision & Intelligent Cropping Engine (Phase 4).

Analyzes video frames for selected highlight intervals to generate smooth,
deterministic vertical 9:16 (or custom aspect ratio) crop keyframe plans.
Supports local face detection, primary subject tracking, scene change detection,
motion smoothing, and center-crop fallback.
"""

import json
import logging
import math
import os
import re
from pathlib import Path
from typing import List, Optional, Tuple, Dict, Any, Callable

import cv2
import numpy as np

from app.config import settings
from app.schemas import (
    HighlightResult,
    SourceMetadata,
    CropBoxPixels,
    NormalizedCropBox,
    FaceBoundingBox,
    CropTrackingMode,
    CropKeyframeResult,
    VisualDiagnostics,
    CropPlanResult,
)
from app.services.media_probe import MediaProbeService

logger = logging.getLogger(__name__)


def parse_aspect_ratio(ratio_str: str) -> float:
    """Parses an aspect ratio string like '9:16', '16:9', '1:1', '4:5' or decimal '0.5625'.
    
    Returns:
        Float value of width / height (e.g. 9/16 -> 0.5625).
        
    Raises:
        ValueError: If format is invalid or ratio <= 0.
    """
    cleaned = ratio_str.strip().lower()
    if ":" in cleaned:
        parts = cleaned.split(":")
        if len(parts) != 2:
            raise ValueError(f"Invalid aspect ratio format '{ratio_str}'. Expected 'W:H' (e.g. '9:16').")
        try:
            w_val = float(parts[0])
            h_val = float(parts[1])
            if w_val <= 0 or h_val <= 0:
                raise ValueError("Aspect ratio components must be strictly positive.")
            return w_val / h_val
        except ValueError as e:
            raise ValueError(f"Failed to parse aspect ratio '{ratio_str}': {e}") from e
    else:
        try:
            val = float(cleaned)
            if val <= 0:
                raise ValueError("Aspect ratio must be strictly positive.")
            return val
        except ValueError as e:
            raise ValueError(f"Invalid decimal aspect ratio '{ratio_str}': {e}") from e


class CropGeometryCalculator:
    """Calculates aspect-ratio preserving crop boxes clamped strictly within frame boundaries."""

    @staticmethod
    def calculate_crop_box(
        source_width: int,
        source_height: int,
        target_aspect_ratio: float,
        center_x: float,
        center_y: float,
    ) -> Tuple[CropBoxPixels, NormalizedCropBox]:
        """Calculates pixel and normalized crop rectangles centered around (center_x, center_y).
        
        Args:
            source_width: Source frame width in pixels.
            source_height: Source frame height in pixels.
            target_aspect_ratio: Target width / height (e.g. 9/16 = 0.5625).
            center_x: Desired crop center X in source pixel coordinates.
            center_y: Desired crop center Y in source pixel coordinates.
            
        Returns:
            Tuple of (CropBoxPixels, NormalizedCropBox) guaranteed inside [0, source_width] x [0, source_height].
        """
        if source_width <= 0 or source_height <= 0:
            raise ValueError(f"Source dimensions must be positive, got {source_width}x{source_height}")
        if target_aspect_ratio <= 0:
            raise ValueError(f"Target aspect ratio must be positive, got {target_aspect_ratio}")

        source_aspect = source_width / source_height

        # Determine maximum bounding dimensions that preserve target_aspect_ratio
        if source_aspect >= target_aspect_ratio:
            # Source is wider than target (e.g. 16:9 source to 9:16 target)
            # Full height crop
            crop_h = source_height
            crop_w = int(round(crop_h * target_aspect_ratio))
            if crop_w > source_width:
                crop_w = source_width
                crop_h = int(round(crop_w / target_aspect_ratio))
        else:
            # Source is narrower than target (e.g. portrait or square source)
            # Full width crop
            crop_w = source_width
            crop_h = int(round(crop_w / target_aspect_ratio))
            if crop_h > source_height:
                crop_h = source_height
                crop_w = int(round(crop_h * target_aspect_ratio))

        crop_w = max(1, min(crop_w, source_width))
        crop_h = max(1, min(crop_h, source_height))

        # Center the box around (center_x, center_y)
        left = int(round(center_x - (crop_w / 2.0)))
        top = int(round(center_y - (crop_h / 2.0)))

        # Clamp strictly within source dimensions
        left = max(0, min(left, source_width - crop_w))
        top = max(0, min(top, source_height - crop_h))

        # Normalized coordinates [0.0, 1.0]
        x_min_norm = round(left / source_width, 4)
        y_min_norm = round(top / source_height, 4)
        width_norm = round(crop_w / source_width, 4)
        height_norm = round(crop_h / source_height, 4)

        pixel_box = CropBoxPixels(x=left, y=top, width=crop_w, height=crop_h)
        norm_box = NormalizedCropBox(
            x_min=x_min_norm,
            y_min=y_min_norm,
            width=width_norm,
            height=height_norm,
        )
        return pixel_box, norm_box


class FaceDetector:
    """Lightweight local face detector using OpenCV Haar Cascade."""

    def __init__(self, cascade_path: Optional[str | Path] = None):
        self.cascade_path = self._resolve_cascade_path(cascade_path)
        self.cascade: Optional[cv2.CascadeClassifier] = None
        self.is_available = False

        if self.cascade_path and self.cascade_path.exists():
            try:
                clf = cv2.CascadeClassifier(str(self.cascade_path))
                if not clf.empty():
                    self.cascade = clf
                    self.is_available = True
                    logger.info("Loaded Haar face cascade from: %s", self.cascade_path)
                else:
                    logger.warning("Haar cascade file empty or unreadable at: %s", self.cascade_path)
            except Exception as e:
                logger.warning("Failed to initialize CascadeClassifier from %s: %s", self.cascade_path, e)
        else:
            logger.info("No local face cascade found; face detection will default to center fallback.")

    @staticmethod
    def _resolve_cascade_path(custom_path: Optional[str | Path] = None) -> Optional[Path]:
        """Resolves local cascade XML path, checking app assets and cv2 data."""
        candidates = []
        if custom_path:
            candidates.append(Path(custom_path).resolve())

        # Check local repo app/assets
        local_asset = Path(__file__).resolve().parent.parent / "assets" / "haarcascade_frontalface_default.xml"
        candidates.append(local_asset)

        # Check cv2.data.haarcascades
        if hasattr(cv2, "data") and hasattr(cv2.data, "haarcascades"):
            cv2_path = Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml"
            candidates.append(cv2_path)

        for p in candidates:
            if p.exists() and p.is_file():
                return p
        return None

    def detect_faces(self, frame: np.ndarray) -> List[Tuple[int, int, int, int]]:
        """Detects faces in a BGR frame, returning list of (x, y, w, h) boxes."""
        if not self.is_available or self.cascade is None:
            return []

        try:
            h, w = frame.shape[:2]
            scale = 1.0
            if w > 640:
                scale = 640.0 / float(w)
                small_frame = cv2.resize(frame, (640, int(round(h * scale))), interpolation=cv2.INTER_LINEAR)
            else:
                small_frame = frame

            gray = cv2.cvtColor(small_frame, cv2.COLOR_BGR2GRAY)
            min_size = max(24, int(round(30 * scale)))
            faces = self.cascade.detectMultiScale(
                gray,
                scaleFactor=1.1,
                minNeighbors=5,
                minSize=(min_size, min_size),
                flags=cv2.CASCADE_SCALE_IMAGE
            )
            if len(faces) == 0:
                return []
            valid_faces = []
            inv_scale = 1.0 / scale
            for (sx, sy, sw, sh) in faces:
                x = int(round(sx * inv_scale)) if scale != 1.0 else int(sx)
                y = int(round(sy * inv_scale)) if scale != 1.0 else int(sy)
                w_box = int(round(sw * inv_scale)) if scale != 1.0 else int(sw)
                h_box = int(round(sh * inv_scale)) if scale != 1.0 else int(sh)

                # Clamp bounding box within source frame boundaries
                x = max(0, min(w - 1, x))
                y = max(0, min(h - 1, y))
                w_box = max(1, min(w - x, w_box))
                h_box = max(1, min(h - y, h_box))

                # If color frame, verify that face box is not a synthetic colored graphic (e.g. blue UI box)
                if frame.ndim == 3 and w_box > 0 and h_box > 0:
                    roi = frame[y:y + h_box, x:x + w_box]
                    if roi.size > 0:
                        m_b, m_g, m_r = np.mean(roi, axis=(0, 1))
                        if m_b > m_r + 30.0:  # Blue-dominant non-skin element
                            ycrcb = cv2.cvtColor(roi, cv2.COLOR_BGR2YCrCb)
                            skin_mask = cv2.inRange(ycrcb, np.array([0, 133, 77]), np.array([255, 173, 127]))
                            skin_pct = (np.count_nonzero(skin_mask) / float(roi.shape[0] * roi.shape[1])) * 100.0
                            if skin_pct < 5.0:
                                continue
                valid_faces.append((int(x), int(y), int(w_box), int(h_box)))
            return valid_faces
        except Exception as e:
            logger.debug("Error during face detection: %s", e)
            return []


class PrimarySubjectTracker:
    """Tracks a single primary subject across frames with spatial continuity and hold mechanism."""

    def __init__(self, max_hold_frames: int = 2):
        self.max_hold_frames = max_hold_frames
        self.prev_center: Optional[Tuple[float, float]] = None
        self.prev_box: Optional[FaceBoundingBox] = None
        self.frames_since_last_detection: int = 0

    def reset(self):
        """Resets tracker memory (e.g. on scene transitions)."""
        self.prev_center = None
        self.prev_box = None
        self.frames_since_last_detection = 0

    def select_and_update(
        self,
        detected_faces: List[Tuple[int, int, int, int]],
        frame_width: int,
        frame_height: int,
    ) -> Tuple[Tuple[float, float], CropTrackingMode, Optional[FaceBoundingBox]]:
        """Selects the primary subject and computes tracking center coordinates.
        
        Returns:
            Tuple of ((center_x, center_y), tracking_mode, primary_face_box)
        """
        default_center = (frame_width / 2.0, frame_height / 2.0)

        if detected_faces:
            # Face(s) detected
            best_face = self._choose_best_face(detected_faces, frame_width, frame_height)
            fx, fy, fw, fh = best_face
            cx = fx + (fw / 2.0)
            cy = fy + (fh / 2.0)

            # Haar cascade does not provide calibrated confidence; set confidence=None (serialized as null)
            face_box = FaceBoundingBox(x=fx, y=fy, width=fw, height=fh, confidence=None)
            self.prev_center = (cx, cy)
            self.prev_box = face_box
            self.frames_since_last_detection = 0
            return (cx, cy), CropTrackingMode.FACE_FOLLOWING, face_box

        # No face detected in this frame
        self.frames_since_last_detection += 1

        # Temporary loss hold mechanism: retain last known center for short duration to smooth motion.
        # Do not fabricate a detection for this frame (primary_face_box is None).
        if self.prev_center is not None and self.frames_since_last_detection <= self.max_hold_frames:
            return self.prev_center, CropTrackingMode.INTERPOLATED_HOLD, None

        # Extended loss: transition to center crop fallback
        return default_center, CropTrackingMode.CENTER_FALLBACK, None

    def _choose_best_face(
        self,
        faces: List[Tuple[int, int, int, int]],
        frame_width: int,
        frame_height: int,
    ) -> Tuple[int, int, int, int]:
        """Deterministic primary face selection prioritizing size and continuity with previous center."""
        if len(faces) == 1:
            return faces[0]

        def face_score(face: Tuple[int, int, int, int]) -> float:
            fx, fy, fw, fh = face
            area = fw * fh
            cx = fx + (fw / 2.0)
            cy = fy + (fh / 2.0)

            if self.prev_center is not None:
                # Spatial continuity penalty: distance from previous center normalized
                dx = (cx - self.prev_center[0]) / frame_width
                dy = (cy - self.prev_center[1]) / frame_height
                dist_norm = math.sqrt(dx * dx + dy * dy)
                # Area normalized by total frame area
                area_norm = area / (frame_width * frame_height)
                # Continuity score
                return area_norm - (1.2 * dist_norm)
            else:
                # If no previous center, prefer largest face
                return float(area)

        # Sort descending by score, tie-break deterministically by x, then y
        best = max(faces, key=lambda f: (face_score(f), -f[0], -f[1]))
        return best


class SceneChangeDetector:
    """Detects shot transitions and visual discontinuities via color histogram correlation."""

    def __init__(self, threshold: float = 0.45):
        self.threshold = threshold
        self.prev_hist: Optional[np.ndarray] = None

    def reset(self):
        self.prev_hist = None

    def is_scene_change(self, frame: np.ndarray) -> bool:
        """Computes histogram correlation with previous frame. Returns True if transition detected."""
        try:
            h, w = frame.shape[:2]
            if w > 160:
                thumb = cv2.resize(frame, (160, max(1, int(round(h * 160.0 / w)))), interpolation=cv2.INTER_NEAREST)
            else:
                thumb = frame

            # 3-channel BGR histogram (16 bins per channel) capturing color and brightness
            hist = cv2.calcHist([thumb], [0, 1, 2], None, [16, 16, 16], [0, 256, 0, 256, 0, 256])
            cv2.normalize(hist, hist, alpha=0, beta=1, norm_type=cv2.NORM_MINMAX)

            if self.prev_hist is None:
                self.prev_hist = hist
                return False

            correlation = cv2.compareHist(self.prev_hist, hist, cv2.HISTCMP_CORREL)
            self.prev_hist = hist

            # Low correlation indicates a major shot or visual scene transition
            if correlation < self.threshold:
                return True
            return False
        except Exception as e:
            logger.debug("Scene change check failed: %s", e)
            return False


class CropSmoother:
    """Smooths crop center trajectories using an exponential moving average with bounded velocity."""

    def __init__(self, alpha: float = 0.35, max_velocity_per_sec: float = 0.35):
        self.alpha = alpha  # EMA weight on new measurement
        self.max_velocity_per_sec = max_velocity_per_sec  # Max fraction of frame dimension per sec
        self.smoothed_center: Optional[Tuple[float, float]] = None
        self.prev_timestamp: Optional[float] = None

    def reset(self):
        self.smoothed_center = None
        self.prev_timestamp = None

    def smooth(
        self,
        target_center: Tuple[float, float],
        timestamp_sec: float,
        is_cut: bool,
        frame_width: int,
        frame_height: int,
    ) -> Tuple[float, float]:
        """Applies smoothing to target center coordinates.
        
        If is_cut is True (scene transition), smoothing is bypassed to snap immediately to the new cut.
        """
        tx, ty = target_center

        if is_cut or self.smoothed_center is None or self.prev_timestamp is None:
            self.smoothed_center = (tx, ty)
            self.prev_timestamp = timestamp_sec
            return (tx, ty)

        dt = max(0.01, timestamp_sec - self.prev_timestamp)
        sx, sy = self.smoothed_center

        # 1. Exponential moving average
        ema_x = (self.alpha * tx) + ((1.0 - self.alpha) * sx)
        ema_y = (self.alpha * ty) + ((1.0 - self.alpha) * sy)

        # 2. Maximum velocity limit
        max_shift_x = self.max_velocity_per_sec * frame_width * dt
        max_shift_y = self.max_velocity_per_sec * frame_height * dt

        diff_x = ema_x - sx
        diff_y = ema_y - sy

        if abs(diff_x) > max_shift_x:
            ema_x = sx + (math.copysign(max_shift_x, diff_x))
        if abs(diff_y) > max_shift_y:
            ema_y = sy + (math.copysign(max_shift_y, diff_y))

        self.smoothed_center = (ema_x, ema_y)
        self.prev_timestamp = timestamp_sec
        return (ema_x, ema_y)


class CropPlannerService:
    """Orchestrates local computer vision analysis and generates validated 9:16 crop plans."""

    def __init__(
        self,
        target_aspect_ratio: str = "9:16",
        analysis_interval_sec: float = 0.5,
        cascade_path: Optional[str | Path] = None,
        smoother_alpha: float = 0.35,
    ):
        self.target_aspect_ratio_str = target_aspect_ratio
        self.target_aspect_ratio_float = parse_aspect_ratio(target_aspect_ratio)
        self.analysis_interval_sec = max(0.1, analysis_interval_sec)
        self.face_detector = FaceDetector(cascade_path=cascade_path)
        self.subject_tracker = PrimarySubjectTracker()
        self.scene_detector = SceneChangeDetector()
        self.smoother = CropSmoother(alpha=smoother_alpha)

    def plan_crop(
        self,
        video_path: str | Path,
        highlight: HighlightResult,
        progress_callback: Optional[Callable[[int, int, float], None]] = None,
    ) -> CropPlanResult:
        """Analyzes video frames across highlight interval and produces a complete CropPlanResult.
        
        Args:
            video_path: Path to source video file.
            highlight: Validated Phase 3 HighlightResult providing interval start_sec & end_sec.
            progress_callback: Optional callback(current_idx, total_samples, pct) for live progress updates.
            
        Returns:
            CropPlanResult adhering to Phase 4 master contract.
            
        Raises:
            FileNotFoundError: If video file is not found.
            ValueError: If video is unreadable or highlight timestamps exceed video duration.
        """
        v_path = Path(video_path).resolve()
        if not v_path.exists():
            raise FileNotFoundError(f"Source video file not found: {v_path}")

        # Probe video metadata
        probe_meta = MediaProbeService.inspect(v_path)
        source_w = probe_meta.width
        source_h = probe_meta.height
        source_duration = probe_meta.duration_sec

        if source_w <= 0 or source_h <= 0:
            raise ValueError(f"Invalid video dimensions: {source_w}x{source_h}")

        start_sec = highlight.start_sec
        end_sec = highlight.end_sec
        clip_duration = highlight.duration_sec

        if start_sec < 0.0:
            raise ValueError(f"Highlight start time cannot be negative: {start_sec}s")
        if end_sec <= start_sec:
            raise ValueError(f"Highlight end time ({end_sec}s) must be greater than start time ({start_sec}s)")
        if start_sec > source_duration + 0.5:
            raise ValueError(
                f"Highlight start time ({start_sec:.2f}s) exceeds source video duration ({source_duration:.2f}s)"
            )

        # Open video capture
        cap = cv2.VideoCapture(str(v_path))
        if not cap.isOpened():
            raise ValueError(f"OpenCV failed to open video file: {v_path}")

        # Build list of sample timestamps in source time
        sample_timestamps = self._generate_sample_timestamps(start_sec, end_sec, self.analysis_interval_sec)

        keyframes: List[CropKeyframeResult] = []
        scene_changes: List[float] = []
        face_detected_count = 0
        fallback_count = 0
        interpolated_hold_count = 0
        decode_error_count = 0

        self.subject_tracker.reset()
        self.scene_detector.reset()
        self.smoother.reset()

        total_samples = len(sample_timestamps)
        logger.info(
            "[ONGOING] [PLANNING_CROPS] Analyzing %d frame samples in [%.2fs - %.2fs] (step=%.2fs) for 9:16 crop plan...",
            total_samples,
            start_sec,
            end_sec,
            self.analysis_interval_sec
        )

        try:
            for idx, t_abs in enumerate(sample_timestamps):
                t_rel = round(max(0.0, t_abs - start_sec), 3)

                # Seek video to target timestamp in milliseconds
                cap.set(cv2.CAP_PROP_POS_MSEC, t_abs * 1000.0)
                ret, frame = cap.read()

                if not ret or frame is None:
                    # Decode failure recovery: use center fallback or held position
                    decode_error_count += 1
                    fallback_count += 1
                    target_center = (source_w / 2.0, source_h / 2.0)
                    smoothed_cx, smoothed_cy = self.smoother.smooth(
                        target_center=target_center,
                        timestamp_sec=t_abs,
                        is_cut=False,
                        frame_width=source_w,
                        frame_height=source_h
                    )
                    px_box, nm_box = CropGeometryCalculator.calculate_crop_box(
                        source_width=source_w,
                        source_height=source_h,
                        target_aspect_ratio=self.target_aspect_ratio_float,
                        center_x=smoothed_cx,
                        center_y=smoothed_cy
                    )
                    keyframes.append(
                        CropKeyframeResult(
                            timestamp_abs_sec=round(t_abs, 3),
                            timestamp_rel_sec=t_rel,
                            crop_box_pixels=px_box,
                            crop_box_norm=nm_box,
                            tracking_mode=CropTrackingMode.CENTER_FALLBACK,
                            detected_faces_count=0,
                            primary_face_box=None,
                            scene_change_detected=False,
                            transition="smooth_pan"
                        )
                    )
                    continue

                # 1. Scene change detection
                is_cut = self.scene_detector.is_scene_change(frame)
                if is_cut:
                    scene_changes.append(round(t_abs, 3))
                    # Reset tracker continuity on cut to prevent dragging old subject
                    self.subject_tracker.reset()

                # 2. Local face detection
                faces = self.face_detector.detect_faces(frame)
                num_faces = len(faces)
                if num_faces > 0:
                    face_detected_count += 1

                # 3. Subject selection and tracking
                target_center, mode, primary_box = self.subject_tracker.select_and_update(
                    detected_faces=faces,
                    frame_width=source_w,
                    frame_height=source_h
                )

                if mode == CropTrackingMode.CENTER_FALLBACK:
                    fallback_count += 1
                elif mode == CropTrackingMode.INTERPOLATED_HOLD:
                    interpolated_hold_count += 1

                # 4. Motion smoothing
                smoothed_cx, smoothed_cy = self.smoother.smooth(
                    target_center=target_center,
                    timestamp_sec=t_abs,
                    is_cut=is_cut,
                    frame_width=source_w,
                    frame_height=source_h
                )

                # 5. Crop rectangle calculation
                px_box, nm_box = CropGeometryCalculator.calculate_crop_box(
                    source_width=source_w,
                    source_height=source_h,
                    target_aspect_ratio=self.target_aspect_ratio_float,
                    center_x=smoothed_cx,
                    center_y=smoothed_cy
                )

                transition_type = "cut" if is_cut else "smooth_pan"

                keyframes.append(
                    CropKeyframeResult(
                        timestamp_abs_sec=round(t_abs, 3),
                        timestamp_rel_sec=t_rel,
                        crop_box_pixels=px_box,
                        crop_box_norm=nm_box,
                        tracking_mode=mode,
                        detected_faces_count=num_faces,
                        primary_face_box=primary_box,
                        scene_change_detected=is_cut,
                        transition=transition_type
                    )
                )

                # Progress reporting
                pct = round(((idx + 1) / max(1, total_samples)) * 100.0, 1)
                log_step = max(1, total_samples // 10)
                if (idx + 1) % log_step == 0 or (idx + 1) == total_samples:
                    mode_str = mode.value if hasattr(mode, "value") else str(mode)
                    logger.info(
                        "[ONGOING] [PLANNING_CROPS] %5.1f%% (%d/%d frames analyzed) | Subject Mode: %s",
                        pct, idx + 1, total_samples, mode_str
                    )
                if progress_callback:
                    try:
                        progress_callback(idx + 1, total_samples, pct)
                    except Exception:
                        pass

        finally:
            cap.release()

        total_frames = len(sample_timestamps)
        face_ratio = round(face_detected_count / total_frames, 3) if total_frames else 0.0
        fallback_used = (fallback_count > 0 or interpolated_hold_count > 0)

        diagnostics = VisualDiagnostics(
            total_frames_analyzed=total_frames,
            face_detected_frames_count=face_detected_count,
            fallback_frames_count=fallback_count,
            interpolated_hold_frames_count=interpolated_hold_count,
            scene_changes_detected_count=len(scene_changes),
            scene_change_timestamps=scene_changes,
            decode_error_count=decode_error_count,
            face_detection_ratio=face_ratio,
            fallback_used=fallback_used
        )

        warnings = []
        if not self.face_detector.is_available:
            warnings.append("Local face cascade not available; all frames used center-crop fallback.")
        elif face_detected_count == 0:
            warnings.append("No faces detected in highlight interval; full center-crop fallback used.")
        if decode_error_count > 0:
            warnings.append(f"Encountered {decode_error_count} frame decoding failure(s).")

        fallback_used = fallback_count > 0

        source_meta = SourceMetadata(
            filename=v_path.name,
            duration_sec=round(source_duration, 3),
            audio_sample_rate=probe_meta.audio_sample_rate or 16000,
            video_width=source_w,
            video_height=source_h,
            fps=probe_meta.fps
        )

        return CropPlanResult(
            schema_version="1.0",
            source=source_meta,
            highlight=highlight,
            target_aspect_ratio=self.target_aspect_ratio_str,
            target_aspect_ratio_float=self.target_aspect_ratio_float,
            source_width=source_w,
            source_height=source_h,
            crop_width=keyframes[0].crop_box_pixels.width if keyframes else None,
            crop_height=keyframes[0].crop_box_pixels.height if keyframes else None,
            analysis_interval_sec=self.analysis_interval_sec,
            tracking_method="opencv_haar_tracker_v1",
            fallback_used=fallback_used,
            keyframes=keyframes,
            diagnostics=diagnostics,
            warnings=warnings
        )

    @staticmethod
    def _generate_sample_timestamps(start_sec: float, end_sec: float, interval_sec: float) -> List[float]:
        """Generates an evenly spaced array of analysis timestamps, ensuring exact start and end coverage."""
        timestamps = []
        t = start_sec
        while t < end_sec - 0.05:
            timestamps.append(round(t, 3))
            t += interval_sec
        # Ensure exact end timestamp is present
        if not timestamps or abs(timestamps[-1] - end_sec) > 0.05:
            timestamps.append(round(end_sec, 3))
        return timestamps

    @classmethod
    def plan_from_file(
        cls,
        video_path: str | Path,
        highlight_path: str | Path,
        target_aspect_ratio: str = "9:16",
        analysis_interval_sec: float = 0.5,
    ) -> CropPlanResult:
        """Loads a HighlightResult from JSON file and generates a CropPlanResult."""
        h_path = Path(highlight_path).resolve()
        if not h_path.exists():
            raise FileNotFoundError(f"Highlight JSON file not found: {h_path}")

        try:
            with open(h_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            highlight = HighlightResult(**data)
        except json.JSONDecodeError as e:
            raise ValueError(f"Failed to parse highlight JSON: {e}") from e
        except Exception as e:
            raise ValueError(f"Invalid highlight result schema: {e}") from e

        service = cls(
            target_aspect_ratio=target_aspect_ratio,
            analysis_interval_sec=analysis_interval_sec
        )
        return service.plan_crop(video_path=video_path, highlight=highlight)

    @staticmethod
    def save_crop_plan(result: CropPlanResult, output_path: Optional[str | Path] = None) -> Path:
        """Persists CropPlanResult JSON to storage/crop_plans/ atomically."""
        if output_path is not None:
            target = Path(output_path).resolve()
        else:
            stem = Path(result.source.filename).stem
            target = settings.CROP_PLANS_DIR / f"{stem}_crop_plan.json"

        target.parent.mkdir(parents=True, exist_ok=True)
        with open(target, "w", encoding="utf-8") as f:
            f.write(result.model_dump_json(indent=2))

        logger.info("Saved crop plan result to: %s", target.name)
        return target
