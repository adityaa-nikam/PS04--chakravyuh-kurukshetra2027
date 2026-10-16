"""Brand Profile & Watermark Manager (Phase 7).

Manages reusable brand profiles, color conversions (Hex -> ASS/BGR),
transparent logo asset preparation, safe-placement collision avoidance,
and temporal stability for vertical educational reel exports.
"""

import json
import logging
from pathlib import Path
from typing import Dict, Any, Optional, Tuple, List, Union

import cv2
import numpy as np

from app.config import settings
from app.schemas import (
    BrandProfile,
    BrandPalette,
    BrandTypography,
    BrandLogoConfig,
    BrandDiagnostics,
    LogoAnchor,
)

logger = logging.getLogger(__name__)


# ============================================================================
# Color Conversion Utilities
# ============================================================================

def normalize_hex_color(hex_str: str) -> str:
    """Normalizes '#RGB', '#RGBA', '#RRGGBB', or '#RRGGBBAA' to standardized uppercase hex.
    
    Raises:
        ValueError if hex string is invalid.
    """
    if not hex_str or not isinstance(hex_str, str):
        raise ValueError(f"Invalid color value: {hex_str}")
    
    s = hex_str.strip()
    if s.startswith("#"):
        s = s[1:]
    
    # Check valid hex characters
    try:
        int(s, 16)
    except ValueError as e:
        raise ValueError(f"Invalid hex color string: '{hex_str}'") from e

    if len(s) == 3:  # #RGB -> #RRGGBB
        s = "".join([c * 2 for c in s])
    elif len(s) == 4:  # #RGBA -> #RRGGBBAA
        s = "".join([c * 2 for c in s])
    elif len(s) not in (6, 8):
        raise ValueError(f"Hex color must be 3, 4, 6, or 8 characters: '{hex_str}'")

    return s.upper()


def hex_to_ass_color(hex_str: str, default_alpha: int = 0) -> str:
    """Converts a CSS hex color (#RRGGBB or #RRGGBBAA) to ASS color format (&HAABBGGRR&).
    
    ASS Color Representation:
    - Byte 1: Alpha channel (&HAA...). Note that 00 = fully opaque, FF = fully transparent.
    - Byte 2: Blue channel (BB)
    - Byte 3: Green channel (GG)
    - Byte 4: Red channel (RR)
    
    Examples:
        #FFFFFF   -> &H00FFFFFF& (Opaque White)
        #FFFF00   -> &H0000FFFF& (Opaque Yellow: R=FF, G=FF, B=00)
        #00FFFF   -> &H00FFFF00& (Opaque Cyan: R=00, G=FF, B=FF)
        #00000080 -> &H7F000000& (~50% Translucent Black)
    """
    s = normalize_hex_color(hex_str)
    if len(s) == 6:
        r = int(s[0:2], 16)
        g = int(s[2:4], 16)
        b = int(s[4:6], 16)
        a = default_alpha  # 0 = fully opaque in ASS
    elif len(s) == 8:
        r = int(s[0:2], 16)
        g = int(s[2:4], 16)
        b = int(s[4:6], 16)
        css_alpha = int(s[6:8], 16)
        # Convert CSS alpha (255=opaque, 0=transparent) to ASS alpha (0=opaque, 255=transparent)
        a = max(0, min(255, 255 - css_alpha))
    else:
        raise ValueError(f"Invalid hex string for ASS: '{hex_str}'")

    return f"&H{a:02X}{b:02X}{g:02X}{r:02X}&"


def hex_to_bgr(hex_str: str) -> Tuple[int, int, int]:
    """Converts a CSS hex color (#RRGGBB) to OpenCV BGR integer tuple (B, G, R)."""
    s = normalize_hex_color(hex_str)
    r = int(s[0:2], 16)
    g = int(s[2:4], 16)
    b = int(s[4:6], 16)
    return (b, g, r)


# ============================================================================
# Brand Manager Service
# ============================================================================

class BrandManager:
    """Loads, validates, and applies brand profiles to video rendering and subtitles."""

    def __init__(self, profile: Optional[BrandProfile] = None):
        self.profile: Optional[BrandProfile] = profile
        self._cached_logo: Optional[np.ndarray] = None
        self._cached_logo_dims: Optional[Tuple[int, int]] = None
        self._cached_canvas_dims: Optional[Tuple[int, int]] = None

    # ------------------------------------------------------------------------
    # Profile Resolution & Loading
    # ------------------------------------------------------------------------

    @classmethod
    def list_presets(cls) -> List[str]:
        """Returns the names of all available starter brand presets."""
        presets_dir = settings.BRANDS_DIR
        if not presets_dir.exists():
            return []
        return sorted([f.stem for f in presets_dir.glob("*.json")])

    @classmethod
    def resolve_profile_path(cls, path_or_preset: Union[str, Path]) -> Path:
        """Resolves a file path or preset identifier to an existing brand profile JSON file."""
        target = Path(path_or_preset)
        
        # 1. Direct path check
        if target.exists() and target.is_file():
            return target.resolve()

        # 2. Check if it's a preset name in BRANDS_DIR
        preset_stem = target.stem if target.suffix == ".json" else str(path_or_preset)
        preset_file = settings.BRANDS_DIR / f"{preset_stem}.json"
        if preset_file.exists():
            return preset_file.resolve()

        # 3. Check relative to workspace root
        ws_file = settings.ROOT_DIR / target
        if ws_file.exists():
            return ws_file.resolve()

        raise FileNotFoundError(
            f"Brand profile '{path_or_preset}' not found. "
            f"Checked direct path, workspace root, and presets dir: {settings.BRANDS_DIR}"
        )

    @classmethod
    def load_profile(
        cls,
        path_or_preset: Optional[Union[str, Path]] = None,
        resolve_assets: bool = False,
        profile_input: Optional[Union[str, Path]] = None,
    ) -> BrandProfile:
        """Loads and validates a brand profile from a file path or preset name.
        
        Args:
            path_or_preset: Path to profile JSON or built-in preset stem name.
            resolve_assets: If True, also validates that configured logo assets exist and are valid.
            profile_input: Alternative keyword argument alias for path_or_preset.
            
        Raises:
            FileNotFoundError if the profile file or logo asset does not exist.
            ValueError if the JSON schema is invalid or colors fail validation.
        """
        target = path_or_preset if path_or_preset is not None else profile_input
        if target is None:
            raise ValueError("No brand profile path or preset identifier provided.")
        resolved_path = cls.resolve_profile_path(target)
        try:
            with open(resolved_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except json.JSONDecodeError as e:
            raise ValueError(f"Brand profile '{resolved_path.name}' contains invalid JSON: {e}") from e

        # Validate with Pydantic
        profile = BrandProfile.model_validate(data)

        # Validate color formats early
        cls._validate_profile_colors(profile)

        # Optionally resolve and check assets
        if resolve_assets and profile.logo.enabled and profile.logo.asset_path:
            resolved_asset = cls.resolve_logo_asset_path(
                asset_path_str=profile.logo.asset_path,
                profile_dir=resolved_path.parent
            )
            # Update asset_path to resolved absolute string for downstream convenience
            profile.logo.asset_path = str(resolved_asset)

        return profile

    @classmethod
    def _validate_profile_colors(cls, profile: BrandProfile) -> None:
        """Validates all color fields in palette and typography."""
        normalize_hex_color(profile.palette.primary)
        normalize_hex_color(profile.palette.secondary)
        normalize_hex_color(profile.palette.accent)
        normalize_hex_color(profile.palette.text)

        if profile.typography.text_color:
            normalize_hex_color(profile.typography.text_color)
        if profile.typography.highlight_color:
            normalize_hex_color(profile.typography.highlight_color)
        if profile.typography.outline_color:
            normalize_hex_color(profile.typography.outline_color)
        if profile.typography.shadow_color:
            normalize_hex_color(profile.typography.shadow_color)

    # ------------------------------------------------------------------------
    # Logo Asset Resolution & Preparation
    # ------------------------------------------------------------------------

    @classmethod
    def resolve_logo_asset_path(
        cls,
        asset_path_str: str,
        profile_dir: Optional[Path] = None
    ) -> Path:
        """Resolves relative or absolute logo asset paths cleanly without hardcoding."""
        path = Path(asset_path_str)
        if path.suffix.lower() == ".svg":
            raise ValueError(
                f"SVG logo '{asset_path_str}' is not supported directly in the local OpenCV pipeline. "
                "Please provide a high-resolution transparent PNG or JPEG asset."
            )

        # 1. Absolute path check
        if path.is_absolute() and path.exists():
            return path.resolve()

        # 2. Check relative to profile directory
        if profile_dir and (profile_dir / path).exists():
            return (profile_dir / path).resolve()

        # 3. Check in app/assets/
        asset_in_app = settings.ROOT_DIR / "services" / "ai-worker" / "app" / "assets" / path.name
        if asset_in_app.exists():
            return asset_in_app.resolve()

        # 4. Check relative to ai-worker root
        worker_root = settings.ROOT_DIR / "services" / "ai-worker"
        if (worker_root / path).exists():
            return (worker_root / path).resolve()

        # 5. Check relative to workspace root
        if (settings.ROOT_DIR / path).exists():
            return (settings.ROOT_DIR / path).resolve()

        raise FileNotFoundError(
            f"Brand logo asset '{asset_path_str}' not found. "
            f"Checked profile directory, app/assets, and workspace root."
        )

    def prepare_logo(
        self,
        canvas_width: int,
        canvas_height: int,
        logo_path_override: Optional[Path] = None,
        scale_override: Optional[float] = None,
        opacity_override: Optional[float] = None,
    ) -> Optional[np.ndarray]:
        """Decodes, scales, and pre-renders the logo asset with transparency and opacity.
        
        Returns:
            Pre-scaled BGRA numpy array (H, W, 4) ready for frame compositing, or None if disabled.
        """
        if not self.profile or not self.profile.logo.enabled:
            return None

        # Check in-memory cache
        current_canvas = (canvas_width, canvas_height)
        if self._cached_logo is not None and self._cached_canvas_dims == current_canvas:
            return self._cached_logo

        logo_config = self.profile.logo
        asset_str = str(logo_path_override) if logo_path_override else logo_config.asset_path
        if not asset_str:
            logger.warning("Brand logo is enabled but no asset_path is specified.")
            return None

        logo_path = self.resolve_logo_asset_path(asset_str)
        
        # Read image with alpha channel
        img = cv2.imread(str(logo_path), cv2.IMREAD_UNCHANGED)
        if img is None or img.size == 0:
            raise ValueError(f"Failed to decode brand logo image at: {logo_path}")

        # Ensure 4-channel BGRA
        if len(img.shape) == 2:  # Grayscale
            img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGRA)
        elif img.shape[2] == 3:  # BGR
            # Convert to BGRA with fully opaque alpha
            b, g, r = cv2.split(img)
            a = np.full(b.shape, 255, dtype=np.uint8)
            img = cv2.merge([b, g, r, a])

        orig_h, orig_w = img.shape[:2]
        if orig_w <= 0 or orig_h <= 0:
            raise ValueError(f"Invalid logo dimensions: {orig_w}x{orig_h}")

        # Scale determination
        scale = scale_override if scale_override is not None else logo_config.scale
        target_w = max(24, int(round(canvas_width * scale)))
        aspect = orig_h / orig_w
        target_h = max(12, int(round(target_w * aspect)))

        # Respect max_height constraint if specified
        max_h = logo_config.max_height
        if max_h and target_h > max_h:
            target_h = max_h
            target_w = max(24, int(round(target_h / aspect)))

        # Clamp strictly inside canvas safe bounds
        target_w = min(target_w, canvas_width - 64)
        target_h = min(target_h, canvas_height - 64)

        # High-quality resize
        interpolation = cv2.INTER_AREA if (target_w < orig_w) else cv2.INTER_LANCZOS4
        resized = cv2.resize(img, (target_w, target_h), interpolation=interpolation)

        # Apply opacity to alpha channel
        opacity = opacity_override if opacity_override is not None else logo_config.opacity
        opacity = max(0.0, min(1.0, float(opacity)))
        if opacity < 1.0:
            alpha = (resized[:, :, 3].astype(np.float32) * opacity).astype(np.uint8)
            resized[:, :, 3] = alpha

        self._cached_logo = resized
        self._cached_logo_dims = (target_w, target_h)
        self._cached_canvas_dims = current_canvas

        logger.debug(
            "Prepared brand logo '%s': %dx%d (scaled from %dx%d @ opacity %.2f)",
            logo_path.name, target_w, target_h, orig_w, orig_h, opacity
        )
        return resized

    # ------------------------------------------------------------------------
    # Safe Positioning & Collision Avoidance
    # ------------------------------------------------------------------------

    @classmethod
    def calculate_anchor_coordinates(
        cls,
        anchor: LogoAnchor,
        canvas_width: int,
        canvas_height: int,
        logo_w: int,
        logo_h: int,
        padding_x: int = 32,
        padding_y: int = 36,
    ) -> Tuple[int, int]:
        """Calculates top-left pixel (x, y) coordinates for a given anchor within canvas boundaries."""
        if anchor == LogoAnchor.TOP_LEFT:
            x = padding_x
            y = padding_y
        elif anchor == LogoAnchor.TOP_RIGHT:
            x = canvas_width - logo_w - padding_x
            y = padding_y
        elif anchor == LogoAnchor.BOTTOM_LEFT:
            x = padding_x
            y = canvas_height - logo_h - padding_y
        elif anchor == LogoAnchor.BOTTOM_RIGHT:
            x = canvas_width - logo_w - padding_x
            y = canvas_height - logo_h - padding_y
        else:
            # Fallback to top-left
            x = padding_x
            y = padding_y

        # Strict clamping within canvas boundaries
        x = max(0, min(canvas_width - logo_w, x))
        y = max(0, min(canvas_height - logo_h, y))
        return (x, y)

    @classmethod
    def evaluate_safe_placement(
        cls,
        preferred_anchor: LogoAnchor,
        canvas_width: int,
        canvas_height: int,
        logo_w: int,
        logo_h: int,
        padding_x: int = 32,
        padding_y: int = 36,
        scene_type: Optional[str] = None,
        face_box_pixels: Optional[Tuple[int, int, int, int]] = None,
        caption_margin_v: int = 190,
    ) -> Tuple[int, int, str, bool]:
        """Evaluates candidate anchors and selects the safest collision-free anchor.
        
        Safety Rules:
        1. Avoid Caption Danger Zone:
           Captions centered at bottom (margin_v ~ 190) span y in [canvas_height - 250, canvas_height - 120].
           Bottom anchors that overlap this are heavily penalized.
        2. Avoid Presenter Inset (PiP):
           In precomposited_pip scenes, speaker camera insets reside in the top-right quadrant.
           Top-right receives a conflict penalty; top-left is preferred.
        3. Avoid Presenter Face:
           If a detected face box intersects a candidate anchor, switch to alternative anchor.
        4. In presentation scenes, top letterbox (y in [0, 438]) is 100% free of slide content.
        
        Returns:
            Tuple of (x, y, selected_anchor_name, is_hidden)
        """
        candidate_anchors = [
            LogoAnchor.TOP_LEFT,
            LogoAnchor.TOP_RIGHT,
            LogoAnchor.BOTTOM_LEFT,
            LogoAnchor.BOTTOM_RIGHT,
        ]

        # Prioritize candidate anchors: preferred anchor first, then top alternatives, then bottom
        if preferred_anchor in candidate_anchors:
            candidate_anchors.remove(preferred_anchor)
            candidate_anchors.insert(0, preferred_anchor)

        caption_zone = (
            40,
            canvas_height - caption_margin_v - 60,
            canvas_width - 80,
            120,
        )

        # In pre-composited PiP, webcam inset sits in top-right area
        pip_inset_zone = (
            int(canvas_width * 0.60),
            30,
            int(canvas_width * 0.38),
            int(canvas_height * 0.25),
        ) if scene_type in ("pip", "precomposited_pip") else None

        best_anchor = preferred_anchor
        best_coords = cls.calculate_anchor_coordinates(
            preferred_anchor, canvas_width, canvas_height, logo_w, logo_h, padding_x, padding_y
        )
        best_penalty = 999999.0

        for cand in candidate_anchors:
            cx, cy = cls.calculate_anchor_coordinates(
                cand, canvas_width, canvas_height, logo_w, logo_h, padding_x, padding_y
            )
            logo_rect = (cx, cy, logo_w, logo_h)
            penalty = 0.0

            # 1. Caption collision penalty (extreme)
            if cls._rects_intersect(logo_rect, caption_zone):
                penalty += 500.0

            # 2. Presenter inset collision penalty (high)
            if pip_inset_zone and cls._rects_intersect(logo_rect, pip_inset_zone):
                penalty += 300.0

            # 3. Presenter face collision penalty
            if face_box_pixels and cls._rects_intersect(logo_rect, face_box_pixels):
                penalty += 400.0

            # 4. Mild preference for top anchors over bottom on vertical reels
            if cand in (LogoAnchor.BOTTOM_LEFT, LogoAnchor.BOTTOM_RIGHT):
                penalty += 40.0

            # 5. Favor user's preferred anchor when penalties are tied
            if cand == preferred_anchor:
                penalty -= 10.0

            if penalty < best_penalty:
                best_penalty = penalty
                best_anchor = cand
                best_coords = (cx, cy)

        is_hidden = (best_penalty >= 650.0)
        return (best_coords[0], best_coords[1], best_anchor.value, is_hidden)

    def compute_safe_logo_placement(
        self,
        canvas_w: int,
        canvas_h: int,
        logo_w: int,
        logo_h: int,
        padding_x: int = 32,
        padding_y: int = 36,
        scene_type: Optional[str] = None,
        face_box_pixels: Optional[Tuple[int, int, int, int]] = None,
        caption_margin_v: int = 190,
    ) -> Tuple[int, int, str, bool, str]:
        """Calculates safe placement and returns (x, y, anchor_name, is_hidden, reason)."""
        pref = self.profile.logo.anchor if self.profile else LogoAnchor.TOP_LEFT
        x, y, anchor_name, is_hidden = self.evaluate_safe_placement(
            preferred_anchor=pref,
            canvas_width=canvas_w,
            canvas_height=canvas_h,
            logo_w=logo_w,
            logo_h=logo_h,
            padding_x=padding_x,
            padding_y=padding_y,
            scene_type=scene_type,
            face_box_pixels=face_box_pixels,
            caption_margin_v=caption_margin_v,
        )
        if is_hidden:
            reason = "Logo hidden due to collisions with all candidate regions"
        elif anchor_name != pref.value:
            reason = f"Switched from {pref.value} to {anchor_name} to avoid occlusion"
        else:
            reason = f"Placement clear at {anchor_name}"
        return (x, y, anchor_name, is_hidden, reason)

    @staticmethod
    def _rects_intersect(
        r1: Tuple[int, int, int, int],
        r2: Tuple[int, int, int, int]
    ) -> bool:
        """Determines if two rectangles (x, y, w, h) overlap by non-zero area."""
        x1, y1, w1, h1 = r1
        x2, y2, w2, h2 = r2
        return not (x1 + w1 <= x2 or x2 + w2 <= x1 or y1 + h1 <= y2 or y2 + h2 <= y1)

    # ------------------------------------------------------------------------
    # Frame Compositing
    # ------------------------------------------------------------------------

    @classmethod
    def composite_logo_onto_frame(
        cls,
        frame: np.ndarray,
        logo_bgra: np.ndarray,
        x: int,
        y: int,
    ) -> np.ndarray:
        """Fast, vectorized alpha-blends pre-scaled BGRA logo onto a BGR canvas frame.
        
        Args:
            frame: Mutable BGR frame (H, W, 3).
            logo_bgra: Pre-scaled BGRA logo (h, w, 4).
            x: Left coordinate.
            y: Top coordinate.
            
        Returns:
            Frame with logo composited.
        """
        if logo_bgra is None or logo_bgra.size == 0:
            return frame

        lh, lw = logo_bgra.shape[:2]
        fh, fw = frame.shape[:2]

        # Calculate bounded overlapping region
        y1 = max(0, y)
        y2 = min(fh, y + lh)
        x1 = max(0, x)
        x2 = min(fw, x + lw)

        if y2 <= y1 or x2 <= x1:
            return frame

        logo_crop = logo_bgra[y1 - y : y2 - y, x1 - x : x2 - x]
        alpha = logo_crop[:, :, 3:4].astype(np.float32) / 255.0

        # In-place blending on the frame slice
        frame_slice = frame[y1:y2, x1:x2].astype(np.float32)
        blended = alpha * logo_crop[:, :, :3].astype(np.float32) + (1.0 - alpha) * frame_slice
        frame[y1:y2, x1:x2] = blended.astype(np.uint8)
        return frame


# ============================================================================
# Temporal Stability & Scene Tracker
# ============================================================================

class BrandSceneTracker:
    """Maintains temporally stable logo anchor placement across scene cuts and shots.
    
    Prevents noisy frame-to-frame jumping while re-evaluating placement at real scene boundaries.
    """

    def __init__(
        self,
        manager: BrandManager,
        canvas_width: int,
        canvas_height: int,
        logo_bgra: Optional[np.ndarray],
        caption_margin_v: int = 190,
    ):
        self.manager = manager
        self.canvas_width = canvas_width
        self.canvas_height = canvas_height
        self.logo_bgra = logo_bgra
        self.caption_margin_v = caption_margin_v

        self.current_x: int = 32
        self.current_y: int = 36
        self.current_anchor: str = "top_left"
        self.is_hidden: bool = False
        
        self.anchor_switches_count: int = 0
        self.logo_hidden_scenes_count: int = 0

        # Initialize default position
        if self.logo_bgra is not None and self.manager.profile:
            lw, lh = self.logo_bgra.shape[1], self.logo_bgra.shape[0]
            pref = self.manager.profile.logo.anchor
            pad_x = self.manager.profile.logo.padding_x
            pad_y = self.manager.profile.logo.padding_y

            if self.manager.profile.logo.safe_placement:
                x, y, anchor_name, hidden = self.manager.evaluate_safe_placement(
                    preferred_anchor=pref,
                    canvas_width=canvas_width,
                    canvas_height=canvas_height,
                    logo_w=lw,
                    logo_h=lh,
                    padding_x=pad_x,
                    padding_y=pad_y,
                    caption_margin_v=caption_margin_v,
                )
            else:
                x, y = self.manager.calculate_anchor_coordinates(
                    pref, canvas_width, canvas_height, lw, lh, pad_x, pad_y
                )
                anchor_name = pref.value
                hidden = False

            self.current_x = x
            self.current_y = y
            self.current_anchor = anchor_name
            self.is_hidden = hidden

    def update_for_frame(
        self,
        frame_idx: int,
        time_sec: float,
        is_cut_frame: bool,
        scene_type: Optional[str] = None,
        face_box_pixels: Optional[Tuple[int, int, int, int]] = None,
    ) -> None:
        """Updates tracker state for the current frame, re-evaluating placement only at cuts."""
        if is_cut_frame:
            self.on_scene_cut(scene_type=scene_type, face_box_pixels=face_box_pixels)

    def on_scene_cut(
        self,
        scene_type: Optional[str] = None,
        face_box_pixels: Optional[Tuple[int, int, int, int]] = None,
    ) -> None:
        """Re-evaluates safe placement at a deliberate scene cut boundary."""
        if self.logo_bgra is None or self.manager.profile is None:
            return

        lw, lh = self.logo_bgra.shape[1], self.logo_bgra.shape[0]
        pref = self.manager.profile.logo.anchor
        pad_x = self.manager.profile.logo.padding_x
        pad_y = self.manager.profile.logo.padding_y

        if self.manager.profile.logo.safe_placement:
            x, y, anchor_name, hidden = self.manager.evaluate_safe_placement(
                preferred_anchor=pref,
                canvas_width=self.canvas_width,
                canvas_height=self.canvas_height,
                logo_w=lw,
                logo_h=lh,
                padding_x=pad_x,
                padding_y=pad_y,
                scene_type=scene_type,
                face_box_pixels=face_box_pixels,
                caption_margin_v=self.caption_margin_v,
            )
            if anchor_name != self.current_anchor:
                self.anchor_switches_count += 1
                logger.debug(
                    "Scene cut safe placement: switched logo anchor from %s to %s",
                    self.current_anchor, anchor_name
                )
            if hidden and not self.is_hidden:
                self.logo_hidden_scenes_count += 1

            self.current_x = x
            self.current_y = y
            self.current_anchor = anchor_name
            self.is_hidden = hidden

    def apply_to_frame(self, frame: np.ndarray) -> np.ndarray:
        """Composites the logo onto the given frame if active and not hidden."""
        if self.is_hidden or self.logo_bgra is None:
            return frame
        return self.manager.composite_logo_onto_frame(
            frame=frame,
            logo_bgra=self.logo_bgra,
            x=self.current_x,
            y=self.current_y,
        )


# Backward-compatible service alias conforming to Reel Studio convention
BrandManagerService = BrandManager
