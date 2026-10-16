"""Tests for Phase 7 Reusable Brand Profiles, Watermark Manager & Brand-Aware Video Rendering."""

import json
from pathlib import Path
import cv2
import numpy as np
import pytest
from pydantic import ValidationError

from app.schemas import (
    BrandProfile,
    BrandPalette,
    BrandTypography,
    BrandLogoConfig,
    LogoAnchor,
    CaptionOptions,
    CaptionStyle,
    CaptionWord,
    CaptionGroup,
    RenderOptions,
)
from app.services.brand_manager import (
    BrandManager,
    BrandManagerService,
    BrandSceneTracker,
    normalize_hex_color,
    hex_to_ass_color,
    hex_to_bgr,
)
from app.services.caption_generator import CaptionGeneratorService


# ============================================================================
# 1. Color Conversion & Validation Tests
# ============================================================================

def test_normalize_hex_color_valid():
    assert normalize_hex_color("#fff") == "FFFFFF"
    assert normalize_hex_color("fff") == "FFFFFF"
    assert normalize_hex_color("#1234") == "11223344"
    assert normalize_hex_color("#2563EB") == "2563EB"
    assert normalize_hex_color("#FACC1580") == "FACC1580"
    assert normalize_hex_color("  #00f0ff  ") == "00F0FF"


def test_normalize_hex_color_invalid():
    with pytest.raises(ValueError, match="Invalid hex color"):
        normalize_hex_color("#ZZZZZZ")
    with pytest.raises(ValueError, match="Hex color must be 3, 4, 6, or 8 characters"):
        normalize_hex_color("#12345")
    with pytest.raises(ValueError, match="Invalid color value"):
        normalize_hex_color("")


def test_hex_to_ass_color():
    # Full opaque white #FFFFFF -> Alpha 00, B=FF, G=FF, R=FF -> &H00FFFFFF&
    assert hex_to_ass_color("#FFFFFF") == "&H00FFFFFF&"
    # Full opaque pure red #FF0000 -> Alpha 00, B=00, G=00, R=FF -> &H000000FF&
    assert hex_to_ass_color("#FF0000") == "&H000000FF&"
    # Full opaque pure blue #0000FF -> Alpha 00, B=FF, G=00, R=00 -> &H00FF0000&
    assert hex_to_ass_color("#0000FF") == "&H00FF0000&"
    # Translucent #00000080 -> CSS alpha 0x80 (128) -> ASS alpha 255 - 128 = 127 (0x7F)
    assert hex_to_ass_color("#00000080") == "&H7F000000&"


def test_hex_to_bgr():
    # Pure red #FF0000 -> B=0, G=0, R=255
    assert hex_to_bgr("#FF0000") == (0, 0, 255)
    # Pure green #00FF00 -> B=0, G=255, R=0
    assert hex_to_bgr("#00FF00") == (0, 255, 0)
    # Royal blue #2563EB -> R=37, G=99, B=235 -> (235, 99, 37)
    assert hex_to_bgr("#2563EB") == (235, 99, 37)


# ============================================================================
# 2. Brand Profile Loading & Validation Tests
# ============================================================================

def test_load_builtin_presets():
    presets = BrandManager.list_presets()
    assert "educational_default" in presets
    assert "creator_tech" in presets
    assert "minimal_clean" in presets

    for preset_name in presets:
        profile = BrandManager.load_profile(preset_name, resolve_assets=True)
        assert profile.brand_id == preset_name
        assert profile.palette.primary.startswith("#")
        assert profile.palette.accent.startswith("#")
        assert profile.typography.font_family
        assert profile.logo.enabled is True
        assert Path(profile.logo.asset_path).exists()


def test_custom_profile_json(tmp_path):
    custom_data = {
        "brand_id": "custom_academy",
        "brand_name": "Custom Data Science Academy",
        "description": "Custom verified profile for testing",
        "version": "1.0",
        "palette": {
            "primary": "#10B981",
            "secondary": "#064E3B",
            "accent": "#F59E0B",
            "text": "#FFFFFF",
            "background": "#022C22"
        },
        "typography": {
            "font_family": "Arial",
            "bold": True,
            "font_size": 38,
            "text_color": "#FFFFFF",
            "highlight_color": "#F59E0B",
            "outline_color": "#064E3B",
            "outline_width": 3.0,
            "margin_v": 200
        },
        "logo": {
            "enabled": True,
            "asset_path": "brand_logo_sample.png",
            "anchor": "top_right",
            "scale": 0.20,
            "opacity": 0.90,
            "padding_x": 40,
            "padding_y": 40
        }
    }
    p_file = tmp_path / "custom_brand.json"
    p_file.write_text(json.dumps(custom_data), encoding="utf-8")

    loaded = BrandManager.load_profile(p_file, resolve_assets=True)
    assert loaded.brand_id == "custom_academy"
    assert loaded.palette.primary == "#10B981"
    assert loaded.typography.margin_v == 200
    assert loaded.logo.anchor == LogoAnchor.TOP_RIGHT


def test_invalid_json_profile(tmp_path):
    bad_file = tmp_path / "bad.json"
    bad_file.write_text("{ this is not valid json }", encoding="utf-8")
    with pytest.raises(ValueError, match="invalid JSON"):
        BrandManager.load_profile(bad_file)


def test_missing_profile_raises():
    with pytest.raises(FileNotFoundError, match="not found"):
        BrandManager.load_profile("non_existent_preset_xyz")


def test_invalid_color_in_profile(tmp_path):
    bad_color_data = {
        "brand_id": "bad_color",
        "brand_name": "Bad Color Brand",
        "palette": {
            "primary": "#NOT_A_HEX",
            "secondary": "#000000",
            "accent": "#FFFFFF",
            "text": "#FFFFFF"
        }
    }
    p_file = tmp_path / "bad_color.json"
    p_file.write_text(json.dumps(bad_color_data), encoding="utf-8")
    with pytest.raises(ValueError, match="Invalid hex color"):
        BrandManager.load_profile(p_file)


def test_invalid_logo_scale_bounds():
    with pytest.raises(ValidationError):
        BrandLogoConfig(scale=0.01)  # below 0.04 minimum
    with pytest.raises(ValidationError):
        BrandLogoConfig(scale=0.80)  # above 0.60 maximum
    with pytest.raises(ValidationError):
        BrandLogoConfig(opacity=1.5)  # above 1.0


def test_svg_logo_rejection():
    with pytest.raises(ValueError, match="SVG logo .* is not supported"):
        BrandManager.resolve_logo_asset_path("logo.svg")


# ============================================================================
# 3. Logo Asset Preparation & Compositing Tests
# ============================================================================

def test_prepare_logo_dimensions_and_transparency(tmp_path):
    # Create synthetic RGBA 4-channel logo (100h x 200w)
    logo_img = np.zeros((100, 200, 4), dtype=np.uint8)
    logo_img[:, :, 0] = 255  # Blue
    logo_img[:, :, 1] = 100  # Green
    logo_img[:, :, 2] = 50   # Red
    logo_img[:, :, 3] = 200  # Alpha
    logo_path = tmp_path / "test_logo.png"
    cv2.imwrite(str(logo_path), logo_img)

    profile = BrandProfile(
        brand_id="test",
        brand_name="Test Brand",
        logo=BrandLogoConfig(
            enabled=True,
            asset_path=str(logo_path),
            scale=0.20,
            opacity=0.80,
            max_height=80
        )
    )
    bm = BrandManager(profile)
    # Prepare logo for 720 x 1280 canvas
    # Target width = 720 * 0.20 = 144px. Aspect ratio 2:1 -> height = 72px (<= max_height 80)
    bgra = bm.prepare_logo(canvas_width=720, canvas_height=1280)
    assert bgra is not None
    assert bgra.shape[1] == 144
    assert bgra.shape[0] == 72
    assert bgra.shape[2] == 4
    # Check opacity scale factor applied to alpha: 200 * 0.80 = 160
    assert abs(int(bgra[36, 72, 3]) - 160) <= 2


def test_prepare_logo_rgb_fallback(tmp_path):
    # Create synthetic 3-channel RGB logo (no alpha)
    rgb_img = np.ones((50, 100, 3), dtype=np.uint8) * 128
    rgb_path = tmp_path / "test_rgb.jpg"
    cv2.imwrite(str(rgb_path), rgb_img)

    profile = BrandProfile(
        brand_id="test_rgb",
        brand_name="RGB Test",
        logo=BrandLogoConfig(
            enabled=True,
            asset_path=str(rgb_path),
            scale=0.25,
            opacity=1.0
        )
    )
    bm = BrandManager(profile)
    bgra = bm.prepare_logo(canvas_width=720, canvas_height=1280)
    assert bgra is not None
    assert bgra.shape[2] == 4
    # Alpha should be added and set to 255
    assert bgra[:, :, 3].min() == 255


def test_composite_logo_onto_frame():
    bm = BrandManager()
    frame = np.zeros((200, 200, 3), dtype=np.uint8)  # Black frame
    # Create 50x50 pure green logo with 50% alpha
    logo = np.zeros((50, 50, 4), dtype=np.uint8)
    logo[:, :, 1] = 200  # Green
    logo[:, :, 3] = 128  # 50% Alpha

    composited = bm.composite_logo_onto_frame(frame, logo, x=20, y=30)
    # In composited region, green channel should be blended: 0 * 0.5 + 200 * 0.5 = 100
    assert abs(int(composited[35, 25, 1]) - 100) <= 2
    # Outside composited region remains black
    assert composited[0, 0, 1] == 0


def test_clamped_boundary_compositing():
    bm = BrandManager()
    frame = np.zeros((100, 100, 3), dtype=np.uint8)
    logo = np.ones((60, 60, 4), dtype=np.uint8) * 255

    # Coordinates partially outside frame (x=80, width=60 -> extends to 140)
    composited = bm.composite_logo_onto_frame(frame, logo, x=80, y=80)
    assert composited.shape == (100, 100, 3)
    assert composited[90, 90, 0] == 255


# ============================================================================
# 4. Safe Placement & Collision Avoidance Tests
# ============================================================================

def test_safe_placement_clear_screen():
    profile = BrandProfile(
        brand_id="test",
        brand_name="Test",
        logo=BrandLogoConfig(
            enabled=True,
            anchor=LogoAnchor.TOP_LEFT,
            padding_x=30,
            padding_y=30
        )
    )
    bm = BrandManager(profile)
    # Clear presenter scene with face in center (y=400..600, x=200..400)
    x, y, anchor, hidden, reason = bm.compute_safe_logo_placement(
        canvas_w=720,
        canvas_h=1280,
        logo_w=150,
        logo_h=50,
        padding_x=30,
        padding_y=30,
        scene_type="presenter",
        face_box_pixels=(200, 400, 200, 200),
        caption_margin_v=190
    )
    assert hidden is False
    assert anchor == "top_left"
    assert x == 30
    assert y == 30
    assert "clear" in reason.lower()


def test_safe_placement_avoids_top_left_face_collision():
    profile = BrandProfile(
        brand_id="test",
        brand_name="Test",
        logo=BrandLogoConfig(
            enabled=True,
            anchor=LogoAnchor.TOP_LEFT,
            padding_x=20,
            padding_y=20
        )
    )
    bm = BrandManager(profile)
    # Face is in top-left (e.g. x=10, y=10, w=200, h=200) -> overlaps top_left
    x, y, anchor, hidden, reason = bm.compute_safe_logo_placement(
        canvas_w=720,
        canvas_h=1280,
        logo_w=160,
        logo_h=60,
        padding_x=20,
        padding_y=20,
        scene_type="presenter",
        face_box_pixels=(10, 10, 200, 200),
        caption_margin_v=190
    )
    assert hidden is False
    # Should safely switch to top_right
    assert anchor == "top_right"
    assert x == 720 - 160 - 20
    assert y == 20


def test_safe_placement_avoids_caption_zone():
    profile = BrandProfile(
        brand_id="test",
        brand_name="Test",
        logo=BrandLogoConfig(
            enabled=True,
            anchor=LogoAnchor.BOTTOM_LEFT,
            padding_x=20,
            padding_y=20
        )
    )
    bm = BrandManager(profile)
    # Bottom margin 190 means captions occupy y around 1050..1150
    # Candidate bottom_left would sit at y = 1280 - 60 - 20 = 1200
    # Safe placement should prioritize top_left to avoid caption area entirely
    x, y, anchor, hidden, reason = bm.compute_safe_logo_placement(
        canvas_w=720,
        canvas_h=1280,
        logo_w=160,
        logo_h=60,
        padding_x=20,
        padding_y=20,
        scene_type="presentation",
        face_box_pixels=None,
        caption_margin_v=190
    )
    assert hidden is False
    assert y < 1000  # Well away from bottom caption zone


def test_safe_placement_avoids_google_maps_pip_inset():
    profile = BrandProfile(
        brand_id="test",
        brand_name="Test",
        logo=BrandLogoConfig(
            enabled=True,
            anchor=LogoAnchor.TOP_RIGHT,  # requested top_right
            padding_x=20,
            padding_y=20
        )
    )
    bm = BrandManager(profile)
    # In PiP mode, webcam inset is at top_right (x >= 450, y <= 250)
    x, y, anchor, hidden, reason = bm.compute_safe_logo_placement(
        canvas_w=720,
        canvas_h=1280,
        logo_w=160,
        logo_h=60,
        padding_x=20,
        padding_y=20,
        scene_type="pip",
        face_box_pixels=None,
        caption_margin_v=190
    )
    assert hidden is False
    # Should avoid the top_right inset and switch to top_left
    assert anchor == "top_left"
    assert x == 20
    assert y == 20


def test_brand_scene_tracker_temporal_stability():
    profile = BrandManager.load_profile("educational_default")
    tracker = BrandSceneTracker(profile, canvas_width=720, canvas_height=1280)

    # Frame 0 (scene cut): Initial placement computed
    tracker.update_for_frame(
        frame_idx=0,
        time_sec=0.0,
        is_cut_frame=True,
        scene_type="presenter",
        face_box_pixels=(250, 400, 200, 200)
    )
    initial_anchor = tracker.current_anchor
    initial_x = tracker.current_x
    initial_y = tracker.current_y

    # Consecutive frames without cuts should NEVER change anchor or x/y
    for i in range(1, 30):
        tracker.update_for_frame(
            frame_idx=i,
            time_sec=i / 30.0,
            is_cut_frame=False,
            scene_type="presenter",
            face_box_pixels=(260 + i, 410, 200, 200)  # slightly moving face
        )
        assert tracker.current_anchor == initial_anchor
        assert tracker.current_x == initial_x
        assert tracker.current_y == initial_y
    assert tracker.anchor_switches_count == 0


# ============================================================================
# 5. Caption Style Integration & Karaoke Compatibility Tests
# ============================================================================

def test_apply_brand_profile_to_caption_options():
    profile = BrandManager.load_profile("creator_tech")
    opts = CaptionOptions(enabled=True, style=CaptionStyle.KARAOKE)
    opts.apply_brand_profile(profile)

    assert opts.font_name == profile.typography.font_family
    assert opts.font_size == profile.typography.font_size
    assert opts.bold == profile.typography.bold
    assert opts.primary_color == hex_to_ass_color(profile.typography.text_color)
    assert opts.highlight_color == hex_to_ass_color(profile.typography.highlight_color)
    assert opts.outline_color == hex_to_ass_color(profile.typography.outline_color)


def test_brand_aware_ass_generation():
    profile = BrandManager.load_profile("educational_default")
    opts = CaptionOptions(enabled=True, style=CaptionStyle.KARAOKE)
    opts.apply_brand_profile(profile)

    words = [
        CaptionWord(original_id=1, text="Hello", start_sec=1.0, end_sec=1.5, duration_sec=0.5),
        CaptionWord(original_id=2, text="world", start_sec=1.6, end_sec=2.0, duration_sec=0.4),
    ]
    groups = CaptionGeneratorService.group_words_into_captions(
        words=words,
        clip_duration=3.0,
        options=opts
    )
    ass_content = CaptionGeneratorService.build_ass_content(
        caption_groups=groups,
        clip_duration=3.0,
        options=opts
    )

    # Verify ASS Style header contains the brand font and converted colors
    assert "Style: ReelDefault,Arial,36" in ass_content
    # Primary color #FFFFFF -> &H00FFFFFF&
    assert "&H00FFFFFF&" in ass_content
    # Highlight color #FACC15 -> B=15, G=CC, R=FA -> &H0015CCFA&
    expected_hl = hex_to_ass_color("#FACC15")
    assert expected_hl in ass_content

    # Verify Karaoke dialogue line contains brand highlight color tag \1c
    assert r"{\1c" in ass_content
    # Ensure dialogue timing is preserved: 1.0s to 2.0s
    assert "Dialogue: 0,0:00:01.00,0:00:02.00" in ass_content


def test_standard_style_with_brand_colors():
    profile = BrandManager.load_profile("minimal_clean")
    opts = CaptionOptions(enabled=True, style=CaptionStyle.STANDARD)
    opts.apply_brand_profile(profile)

    words = [
        CaptionWord(original_id=1, text="Architecture", start_sec=0.5, end_sec=1.5, duration_sec=1.0),
    ]
    groups = CaptionGeneratorService.group_words_into_captions(
        words=words,
        clip_duration=2.0,
        options=opts
    )
    ass_content = CaptionGeneratorService.build_ass_content(
        caption_groups=groups,
        clip_duration=2.0,
        options=opts
    )
    assert "Style: ReelDefault,Arial,34" in ass_content
    assert "Dialogue: 0,0:00:00.50,0:00:01.50" in ass_content


# ============================================================================
# 6. Override Precedence Tests
# ============================================================================

def test_cli_overrides_precedence():
    profile = BrandManager.load_profile("educational_default")
    bm = BrandManager(profile)

    # In educational_default: anchor is top_left, opacity is 0.90, scale is 0.22
    assert profile.logo.anchor == LogoAnchor.TOP_LEFT
    assert profile.logo.opacity == 0.90

    # Overrides: scale=0.30, opacity=0.50
    bgra = bm.prepare_logo(
        canvas_width=720,
        canvas_height=1280,
        scale_override=0.30,
        opacity_override=0.50
    )
    assert bgra is not None
    # 720 * 0.30 = 216 width
    assert bgra.shape[1] == 216
    # Opacity 0.50 applied to alpha (max alpha around 255 * 0.50 = 127)
    assert bgra[:, :, 3].max() <= 130
