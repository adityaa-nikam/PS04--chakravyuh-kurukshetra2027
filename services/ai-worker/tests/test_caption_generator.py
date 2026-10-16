"""Comprehensive Automated Test Suite for Phase 6: Captions & Karaoke Highlighting."""

import json
import math
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import List, Dict, Any

import pytest

from app.config import settings
from app.schemas import (
    DisplayWord,
    CaptionWord,
    CaptionGroup,
    CaptionStyle,
    CaptionOptions,
    CaptionDiagnostics,
    CorrectionMetadata,
    RenderOptions,
    RenderResult,
    HighlightResult,
    CropPlanResult,
    CropKeyframeResult,
)
from app.services.caption_generator import (
    CaptionGeneratorService,
    format_ass_timestamp,
    format_ffmpeg_ass_filter,
    escape_ass_text,
)
from app.services.video_renderer import VideoRendererService, RenderValidationError


# ---------------------------------------------------------------------------
# Test Fixtures & Synthetic Data Generators
# ---------------------------------------------------------------------------

def make_test_words() -> List[DisplayWord]:
    """Generates synthetic word stream covering standard, technical, code-mixed, and boundary words."""
    words = [
        DisplayWord(id=0, text="Intro", start_sec=20.0, end_sec=22.0),
        DisplayWord(id=1, text="Before", start_sec=28.54, end_sec=29.02),
        DisplayWord(id=2, text="we", start_sec=29.02, end_sec=29.24),
        DisplayWord(id=3, text="get", start_sec=29.24, end_sec=29.38),
        DisplayWord(id=4, text="into", start_sec=29.38, end_sec=29.54),
        DisplayWord(id=5, text="data", start_sec=29.54, end_sec=29.80),
        DisplayWord(id=6, text="structures,", start_sec=29.80, end_sec=30.20),
        # Natural pause 30.20 to 30.60 (0.40s)
        DisplayWord(id=7, text="we", start_sec=30.60, end_sec=30.80),
        DisplayWord(id=8, text="need", start_sec=30.80, end_sec=31.10),
        DisplayWord(id=9, text="Big", start_sec=31.10, end_sec=31.35),
        DisplayWord(
            id=10,
            text="O.",
            start_sec=31.35,
            end_sec=31.80,
            correction=CorrectionMetadata(term_id="big_o", matched_alias="big oh", applied=True)
        ),
        # Another sentence
        DisplayWord(id=11, text="First", start_sec=32.20, end_sec=32.50),
        DisplayWord(id=12, text="one,", start_sec=32.50, end_sec=32.70),
        DisplayWord(id=13, text="we", start_sec=32.70, end_sec=32.85),
        DisplayWord(id=14, text="got", start_sec=32.85, end_sec=33.00),
        DisplayWord(id=15, text="O", start_sec=33.00, end_sec=33.20),
        DisplayWord(id=16, text="of", start_sec=33.20, end_sec=33.35),
        DisplayWord(id=17, text="1", start_sec=33.35, end_sec=33.55),
        DisplayWord(id=18, text="constant", start_sec=33.55, end_sec=33.90),
        DisplayWord(id=19, text="time.", start_sec=33.90, end_sec=34.30),
        # Outside highlight
        DisplayWord(id=20, text="After", start_sec=75.0, end_sec=77.0),
    ]
    return words


# ---------------------------------------------------------------------------
# Unit Tests: Transcript & Timing (Phase 6B)
# ---------------------------------------------------------------------------

def test_source_to_highlight_relative_time_conversion():
    """Validates accurate conversion from source timestamps to highlight-relative timeline."""
    words = make_test_words()
    h_start = 28.54
    h_end = 34.30
    clip_dur = h_end - h_start

    rel_words, stats = CaptionGeneratorService.filter_and_convert_words(
        transcript_words=words,
        highlight_start_sec=h_start,
        highlight_end_sec=h_end,
    )

    assert stats["filtered_words_count"] == 19
    assert rel_words[0].text == "Before"
    assert rel_words[0].start_sec == 0.0
    assert rel_words[0].end_sec == pytest.approx(29.02 - h_start, abs=1e-3)
    assert rel_words[-1].text == "time."
    assert rel_words[-1].end_sec == pytest.approx(clip_dur, abs=1e-3)


def test_word_filtering_at_highlight_boundaries():
    """Ensures words entirely outside the highlight are excluded and boundary-overlapping words are clamped."""
    words = [
        {"id": 1, "text": "BeforeHighlight", "start_sec": 10.0, "end_sec": 15.0},
        {"id": 2, "text": "StraddleStart", "start_sec": 19.5, "end_sec": 21.0},
        {"id": 3, "text": "Inside", "start_sec": 22.0, "end_sec": 23.0},
        {"id": 4, "text": "StraddleEnd", "start_sec": 29.0, "end_sec": 31.0},
        {"id": 5, "text": "AfterHighlight", "start_sec": 35.0, "end_sec": 40.0},
    ]
    h_start = 20.0
    h_end = 30.0

    rel_words, stats = CaptionGeneratorService.filter_and_convert_words(
        transcript_words=words,
        highlight_start_sec=h_start,
        highlight_end_sec=h_end,
    )

    texts = [w.text for w in rel_words]
    assert "BeforeHighlight" not in texts
    assert "AfterHighlight" not in texts
    assert "StraddleStart" in texts
    assert "Inside" in texts
    assert "StraddleEnd" in texts

    # StraddleStart should be clamped at relative 0.0
    w_start = next(w for w in rel_words if w.text == "StraddleStart")
    assert w_start.start_sec == 0.0
    assert w_start.end_sec == 1.0

    # StraddleEnd should be clamped at relative duration 10.0
    w_end = next(w for w in rel_words if w.text == "StraddleEnd")
    assert w_end.start_sec == 9.0
    assert w_end.end_sec == 10.0
    assert stats["clamped_count"] == 2


def test_invalid_negative_nan_inf_timestamps_handled_safely():
    """Verifies that negative, NaN, Inf, and zero-duration timestamps are handled gracefully."""
    words = [
        {"id": 1, "text": "ValidOne", "start_sec": 10.0, "end_sec": 11.0},
        {"id": 2, "text": "ZeroDuration", "start_sec": 11.0, "end_sec": 11.0},
        {"id": 3, "text": "Inverted", "start_sec": 13.0, "end_sec": 12.0},  # invalid
        {"id": 4, "text": "NanWord", "start_sec": float("nan"), "end_sec": 14.0},
        {"id": 5, "text": "InfWord", "start_sec": 14.0, "end_sec": float("inf")},
        {"id": 6, "text": "ValidTwo", "start_sec": 15.0, "end_sec": 16.0},
    ]

    rel_words, stats = CaptionGeneratorService.filter_and_convert_words(
        transcript_words=words,
        highlight_start_sec=10.0,
        highlight_end_sec=20.0,
    )

    texts = [w.text for w in rel_words]
    assert "ValidOne" in texts
    assert "ZeroDuration" in texts
    assert "ValidTwo" in texts
    assert "Inverted" not in texts
    assert "NanWord" not in texts
    assert "InfWord" not in texts

    # Zero duration should be assigned a safe non-zero display slice
    w_zero = next(w for w in rel_words if w.text == "ZeroDuration")
    assert w_zero.end_sec > w_zero.start_sec
    assert stats["zero_duration_count"] == 1


def test_out_of_order_transcript_words_are_sorted():
    """Verifies that unsorted transcript words are sorted monotonically."""
    words = [
        {"id": 3, "text": "three", "start_sec": 12.0, "end_sec": 13.0},
        {"id": 1, "text": "one", "start_sec": 10.0, "end_sec": 11.0},
        {"id": 2, "text": "two", "start_sec": 11.0, "end_sec": 12.0},
    ]
    rel_words, _ = CaptionGeneratorService.filter_and_convert_words(words, 10.0, 15.0)
    assert [w.text for w in rel_words] == ["one", "two", "three"]


def test_ass_timestamp_formatting_precision():
    """Checks centisecond precision formatting and overflow handling."""
    assert format_ass_timestamp(0.0) == "0:00:00.00"
    assert format_ass_timestamp(1.234) == "0:00:01.23"
    assert format_ass_timestamp(59.996) == "0:01:00.00"
    assert format_ass_timestamp(3661.05) == "1:01:01.05"
    assert format_ass_timestamp(-5.0) == "0:00:00.00"
    assert format_ass_timestamp(float("nan")) == "0:00:00.00"


# ---------------------------------------------------------------------------
# Unit Tests: Caption Grouping (Phase 6C)
# ---------------------------------------------------------------------------

def test_caption_grouping_respects_sentence_and_pause_boundaries():
    """Verifies that terminal punctuation and speech pauses trigger natural group breaks."""
    words = make_test_words()
    rel_words, _ = CaptionGeneratorService.filter_and_convert_words(words, 28.54, 34.30)
    groups = CaptionGeneratorService.group_words_into_captions(rel_words, clip_duration=5.76)

    assert len(groups) >= 3
    # Group 1 should end at comma or pause
    assert "data structure," in groups[0].text or "Before we get into" in groups[0].text
    # Sentence ending in "Big O." should flush before "First one,"
    big_o_group = next(g for g in groups if "Big O." in g.text)
    first_one_group = next(g for g in groups if "First one," in g.text)
    assert big_o_group.id < first_one_group.id
    assert big_o_group.end_sec <= first_one_group.start_sec


def test_protected_technical_expressions_not_split():
    """Verifies multi-word technical units ('Big O', 'time complexity') are kept intact."""
    words = [
        CaptionWord(text="understanding", start_sec=0.0, end_sec=0.5),
        CaptionWord(text="this,", start_sec=0.5, end_sec=0.8),
        CaptionWord(text="we", start_sec=0.8, end_sec=1.0),
        CaptionWord(text="use", start_sec=1.0, end_sec=1.2),
        CaptionWord(text="Big", start_sec=1.2, end_sec=1.5),
        CaptionWord(text="O", start_sec=1.5, end_sec=1.8),
        CaptionWord(text="notation.", start_sec=1.8, end_sec=2.2),
    ]
    groups = CaptionGeneratorService.group_words_into_captions(words, clip_duration=2.5)
    for g in groups:
        words_in_g = [w.text for w in g.words]
        if "Big" in words_in_g:
            assert "O" in words_in_g, "Big and O must not be split across groups!"


def test_balance_lines_produces_max_two_lines_and_safe_lengths():
    """Verifies two-line balancing does not exceed line limits."""
    words = [
        CaptionWord(text="Different", start_sec=0.0, end_sec=0.4),
        CaptionWord(text="vehicles", start_sec=0.4, end_sec=0.8),
        CaptionWord(text="are", start_sec=0.8, end_sec=1.0),
        CaptionWord(text="optimized", start_sec=1.0, end_sec=1.5),
        CaptionWord(text="for", start_sec=1.5, end_sec=1.7),
        CaptionWord(text="different", start_sec=1.7, end_sec=2.1),
        CaptionWord(text="scenarios.", start_sec=2.1, end_sec=2.6),
    ]
    lines = CaptionGeneratorService._balance_lines(words, max_chars_per_line=28)
    assert len(lines) <= 2
    for l in lines:
        assert len(l) <= 35


def test_code_mixed_and_normalized_terminology_preserved():
    """Ensures technical terms and normalized spelling (e.g. O of 1, @Autowired) are preserved."""
    words = [
        CaptionWord(
            text="useEffect",
            start_sec=0.0,
            end_sec=0.5,
            correction=CorrectionMetadata(term_id="use_effect", matched_alias="use effect", applied=True)
        ),
        CaptionWord(text="hook", start_sec=0.5, end_sec=0.8),
        CaptionWord(text="chahiye", start_sec=0.8, end_sec=1.2),  # Hinglish token
    ]
    groups = CaptionGeneratorService.group_words_into_captions(words, clip_duration=1.5)
    assert len(groups) == 1
    assert "useEffect" in groups[0].text
    assert "chahiye" in groups[0].text


# ---------------------------------------------------------------------------
# Unit Tests: Subtitle Generation & Karaoke Styling (Phase 6D & 6E)
# ---------------------------------------------------------------------------

def test_ass_script_generation_standard_style():
    """Validates valid ASS v4.00+ generation in standard style."""
    words = [
        CaptionWord(text="Hello", start_sec=0.0, end_sec=0.5),
        CaptionWord(text="world", start_sec=0.5, end_sec=1.0),
    ]
    groups = [
        CaptionGroup(
            id=0,
            start_sec=0.0,
            end_sec=1.0,
            text="Hello world",
            lines=["Hello world"],
            words=words,
            is_karaoke=False,
        )
    ]
    script = CaptionGeneratorService.generate_ass_script(
        caption_groups=groups,
        options=CaptionOptions(style=CaptionStyle.STANDARD),
    )

    assert "[Script Info]" in script
    assert "ScriptType: v4.00+" in script
    assert "[V4+ Styles]" in script
    assert "[Events]" in script
    assert "Dialogue: 0,0:00:00.00,0:00:01.00,CaptionStandard,,0,0,0,,Hello world" in script


def test_ass_script_generation_karaoke_style():
    """Validates synchronized active-word highlighting events with zero reflow."""
    words = [
        CaptionWord(text="First", start_sec=0.10, end_sec=0.50),
        CaptionWord(text="second", start_sec=0.60, end_sec=1.00),
    ]
    groups = [
        CaptionGroup(
            id=0,
            start_sec=0.0,
            end_sec=1.20,
            text="First second",
            lines=["First second"],
            words=words,
            is_karaoke=True,
        )
    ]
    script = CaptionGeneratorService.generate_ass_script(
        caption_groups=groups,
        options=CaptionOptions(style=CaptionStyle.KARAOKE),
    )

    # Lead interval before first word (0.00 to 0.10)
    assert "Dialogue: 0,0:00:00.00,0:00:00.10,CaptionStandard,,0,0,0,,First second" in script
    # First active word (0.10 to 0.50)
    assert r"Dialogue: 0,0:00:00.10,0:00:00.50,CaptionStandard,,0,0,0,,{\c&H0000FFFF&}First{\c&H00FFFFFF&} second" in script
    # Gap between words (0.50 to 0.60)
    assert "Dialogue: 0,0:00:00.50,0:00:00.60,CaptionStandard,,0,0,0,,First second" in script
    # Second active word (0.60 to 1.00)
    assert r"Dialogue: 0,0:00:00.60,0:00:01.00,CaptionStandard,,0,0,0,,First {\c&H0000FFFF&}second{\c&H00FFFFFF&}" in script
    # Tail hold (1.00 to 1.20)
    assert "Dialogue: 0,0:00:01.00,0:00:01.20,CaptionStandard,,0,0,0,,First second" in script


def test_special_characters_and_unicode_escaping():
    """Checks that curly braces and non-ASCII glyphs do not break ASS syntax."""
    assert escape_ass_text("Array{index}") == "Array(index)"
    assert escape_ass_text("Hello {world}") == "Hello (world)"


# ---------------------------------------------------------------------------
# Integration Tests: Video Renderer & Subtitle Burn-In (Phase 6F & 6H)
# ---------------------------------------------------------------------------

def test_full_lecture_caption_generation(tmp_path: Path):
    """Generates captions from the real lecture transcript and highlight JSON."""
    transcript_file = settings.TRANSCRIPTS_DIR / "lecture.json"
    highlight_file = settings.HIGHLIGHTS_DIR / "lecture_highlight.json"

    if not transcript_file.exists() or not highlight_file.exists():
        pytest.skip("Full lecture artifacts not found in workspace.")

    transcript = VideoRendererService.load_transcript(transcript_file)
    highlight = VideoRendererService.load_highlight(highlight_file)

    rel_words, stats = CaptionGeneratorService.filter_and_convert_words(
        transcript_words=transcript.display_words,
        highlight_start_sec=highlight.start_sec,
        highlight_end_sec=highlight.end_sec,
    )

    assert stats["filtered_words_count"] == 160
    assert stats["zero_duration_count"] == 0
    assert stats["clamped_count"] == 0

    groups = CaptionGeneratorService.group_words_into_captions(
        words=rel_words,
        clip_duration=highlight.duration_sec,
        options=CaptionOptions(style=CaptionStyle.KARAOKE),
    )

    assert len(groups) >= 35
    assert groups[0].start_sec >= 0.0
    assert groups[-1].end_sec <= highlight.duration_sec

    # Ensure no 1-word groups exist in this lecture excerpt
    one_word_groups = [g for g in groups if len(g.words) == 1]
    assert len(one_word_groups) == 0

    # Save ASS file
    target_ass = tmp_path / "lecture_test.ass"
    CaptionGeneratorService.save_ass_file(
        caption_groups=groups,
        output_path=target_ass,
        options=CaptionOptions(style=CaptionStyle.KARAOKE),
    )
    assert target_ass.exists()
    assert target_ass.stat().st_size > 5000


def test_ffmpeg_ass_filter_path_formatting():
    """Verifies that format_ffmpeg_ass_filter generates a safe filter string on Windows/POSIX."""
    test_path = Path("storage/subtitles/test.ass")
    filter_str = format_ffmpeg_ass_filter(test_path)
    assert filter_str.startswith("ass=filename=")
    assert "\\" not in filter_str or r"\:" in filter_str


def test_cli_generate_captions_command(tmp_path: Path):
    """Tests CLI generate-captions subcommand execution."""
    transcript_file = settings.TRANSCRIPTS_DIR / "lecture.json"
    highlight_file = settings.HIGHLIGHTS_DIR / "lecture_highlight.json"

    if not transcript_file.exists() or not highlight_file.exists():
        pytest.skip("Full lecture artifacts not found.")

    out_ass = tmp_path / "cli_captions.ass"
    cmd = [
        "python", "app/cli.py", "generate-captions",
        "-T", str(transcript_file),
        "-H", str(highlight_file),
        "-o", str(out_ass),
        "--caption-style", "karaoke",
    ]
    env = dict(os.environ, PYTHONPATH=".")
    res = subprocess.run(cmd, capture_output=True, text=True, env=env)
    assert res.returncode == 0
    assert out_ass.exists()
    assert "CAPTION GENERATION COMPLETED SUCCESSFULLY" in res.stdout


def test_renderer_with_subtitles_burn_in_success(tmp_path: Path):
    """Verifies that VideoRendererService renders vertical video with burned-in subtitles."""
    from test_video_renderer import create_synthetic_video_with_audio, make_test_highlight, make_test_crop_plan

    v_path = create_synthetic_video_with_audio(tmp_path / "sub_src.mp4", duration_sec=2.0, width=640, height=360)
    hl = make_test_highlight(start_sec=0.2, end_sec=1.8, filename="sub_src.mp4", duration_sec=2.0, width=640, height=360)
    cp = make_test_crop_plan(hl, width=640, height=360)

    # Synthetic transcript
    t_data = {
        "schema_version": "1.0",
        "source": {"filename": "sub_src.mp4", "duration_sec": 2.0},
        "transcription": {"model": "small", "detected_language": "en"},
        "display_words": [
            {"id": 1, "text": "Hello", "start_sec": 0.3, "end_sec": 0.7, "source_word_ids": [1]},
            {"id": 2, "text": "world", "start_sec": 0.8, "end_sec": 1.2, "source_word_ids": [2]},
            {"id": 3, "text": "captions.", "start_sec": 1.3, "end_sec": 1.7, "source_word_ids": [3]},
        ],
    }
    t_file = tmp_path / "sub_transcript.json"
    t_file.write_text(json.dumps(t_data), encoding="utf-8")

    out_mp4 = tmp_path / "sub_out.mp4"
    options = RenderOptions(
        preset="ultrafast",
        subtitles_enabled=True,
        caption_style="karaoke",
        overwrite=True,
    )

    result = VideoRendererService.render_video(
        video_path=v_path,
        highlight_input=hl,
        crop_plan_input=cp,
        output_path=out_mp4,
        options=options,
        transcript_input=t_file,
    )

    assert result.success is True
    assert result.schema_version == "1.4"
    assert result.subtitles_enabled is True
    assert result.caption_style == "karaoke"
    assert result.subtitles_ass_path is not None
    assert Path(result.subtitles_ass_path).exists()
    assert result.caption_groups_count >= 1
    assert result.audio_included is True
    assert out_mp4.exists()
    assert out_mp4.stat().st_size > 1024


def test_renderer_with_custom_ass_file(tmp_path: Path):
    """Verifies that an explicitly provided ASS file is burned in directly."""
    from test_video_renderer import create_synthetic_video_with_audio, make_test_highlight, make_test_crop_plan

    v_path = create_synthetic_video_with_audio(tmp_path / "custom_sub_src.mp4", duration_sec=2.0, width=640, height=360)
    hl = make_test_highlight(start_sec=0.2, end_sec=1.8, filename="custom_sub_src.mp4", duration_sec=2.0, width=640, height=360)
    cp = make_test_crop_plan(hl, width=640, height=360)

    # Custom ASS file
    custom_ass = tmp_path / "custom.ass"
    custom_ass.write_text("""[Script Info]
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1280
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,40,&H00FFFFFF,&H00000000,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,2,10,10,100,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:01.50,Default,,0,0,0,,Custom Subtitle Test
""", encoding="utf-8")

    out_mp4 = tmp_path / "custom_sub_out.mp4"
    options = RenderOptions(preset="ultrafast", overwrite=True)

    result = VideoRendererService.render_video(
        video_path=v_path,
        highlight_input=hl,
        crop_plan_input=cp,
        output_path=out_mp4,
        options=options,
        subtitles_ass_input=custom_ass,
    )

    assert result.success is True
    assert result.subtitles_enabled is True
    assert result.subtitles_ass_path == str(custom_ass.resolve())
    assert out_mp4.exists()


def test_renderer_missing_transcript_raises_when_subtitles_requested(tmp_path: Path):
    """Verifies that requesting subtitles without a transcript or ASS raises RenderValidationError."""
    from test_video_renderer import create_synthetic_video_with_audio, make_test_highlight, make_test_crop_plan

    v_path = create_synthetic_video_with_audio(tmp_path / "no_sub_src.mp4", duration_sec=2.0, width=640, height=360)
    hl = make_test_highlight(start_sec=0.2, end_sec=1.8, filename="no_sub_src.mp4", duration_sec=2.0, width=640, height=360)
    cp = make_test_crop_plan(hl, width=640, height=360)

    out_mp4 = tmp_path / "no_sub_out.mp4"
    options = RenderOptions(subtitles_enabled=True, overwrite=True)

    with pytest.raises(RenderValidationError, match="Subtitles requested, but no transcript provided"):
        VideoRendererService.render_video(
            video_path=v_path,
            highlight_input=hl,
            crop_plan_input=cp,
            output_path=out_mp4,
            options=options,
        )


def test_manifest_contains_caption_metadata(tmp_path: Path):
    """Verifies that the saved render manifest JSON contains schema v1.4 subtitle diagnostics."""
    from test_video_renderer import create_synthetic_video_with_audio, make_test_highlight, make_test_crop_plan

    v_path = create_synthetic_video_with_audio(tmp_path / "mani_src.mp4", duration_sec=2.0, width=640, height=360)
    hl = make_test_highlight(start_sec=0.2, end_sec=1.8, filename="mani_src.mp4", duration_sec=2.0, width=640, height=360)
    cp = make_test_crop_plan(hl, width=640, height=360)

    t_data = {
        "schema_version": "1.0",
        "source": {"filename": "mani_src.mp4", "duration_sec": 2.0},
        "transcription": {"model": "small", "detected_language": "en"},
        "display_words": [
            {"id": 1, "text": "Manifest", "start_sec": 0.3, "end_sec": 0.8, "source_word_ids": [1]},
            {"id": 2, "text": "test.", "start_sec": 0.9, "end_sec": 1.5, "source_word_ids": [2]},
        ],
    }
    t_file = tmp_path / "mani_transcript.json"
    t_file.write_text(json.dumps(t_data), encoding="utf-8")

    out_mp4 = tmp_path / "mani_out.mp4"
    options = RenderOptions(preset="ultrafast", subtitles_enabled=True, caption_style="standard", overwrite=True)

    result = VideoRendererService.render_video(
        video_path=v_path,
        highlight_input=hl,
        crop_plan_input=cp,
        output_path=out_mp4,
        options=options,
        transcript_input=t_file,
    )

    manifest_file = VideoRendererService.save_manifest(result)
    assert manifest_file.exists()

    with open(manifest_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    assert data["schema_version"] == "1.4"
    assert data["subtitles_enabled"] is True
    assert data["caption_style"] == "standard"
    assert data["subtitles_ass_path"] is not None
    assert data["caption_groups_count"] >= 1
    assert "caption_diagnostics" in data
    assert data["caption_diagnostics"]["time_conversion_convention"] == "relative_to_highlight_start"

