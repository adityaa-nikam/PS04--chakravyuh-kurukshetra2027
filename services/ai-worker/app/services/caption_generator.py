"""Synchronized Caption & Subtitle Generation Service (Phase 6).

Consumes word-level timestamped transcripts (DisplayWord), converts source timestamps
to highlight-relative timelines, groups words into readable 1-2 line captions with
clause and technical-term awareness, and produces compliant Advanced SubStation Alpha
(ASS) subtitle files with optional active-word karaoke highlighting.
"""

import json
import logging
import math
import os
import re
import subprocess
import tempfile
from pathlib import Path
from typing import List, Optional, Tuple, Dict, Any, Union

from app.config import settings
from app.schemas import (
    DisplayWord,
    CaptionWord,
    CaptionGroup,
    CaptionStyle,
    CaptionOptions,
    CaptionDiagnostics,
    CorrectionMetadata,
    SceneType,
)

logger = logging.getLogger(__name__)

# Multi-word technical and code expressions that should avoid being broken across captions
PROTECTED_EXPRESSIONS: List[Tuple[str, ...]] = [
    ("big", "o"),
    ("data", "structure"),
    ("data", "structures"),
    ("time", "complexity"),
    ("space", "complexity"),
    ("miles", "per", "hour"),
    ("o", "of", "1"),
    ("constant", "time"),
    ("linear", "time"),
    ("binary", "search"),
    ("hash", "map"),
    ("hash", "table"),
    ("linked", "list"),
    ("for", "example"),
]


def format_ass_timestamp(sec: float) -> str:
    """Formats floating-point seconds into ASS timestamp format: H:MM:SS.cs (centiseconds).
    
    Correctly handles rounding overflow at frame and second boundaries.
    """
    if sec is None or math.isnan(sec) or math.isinf(sec) or sec < 0:
        sec = 0.0
    sec = max(0.0, float(sec))
    hours = int(sec // 3600)
    minutes = int((sec % 3600) // 60)
    seconds = int(sec % 60)
    centiseconds = int(round((sec - int(sec)) * 100))
    if centiseconds >= 100:
        seconds += 1
        centiseconds -= 100
        if seconds >= 60:
            minutes += 1
            seconds -= 60
            if minutes >= 60:
                hours += 1
                minutes -= 60
    return f"{hours}:{minutes:02d}:{seconds:02d}.{centiseconds:02d}"


def escape_ass_text(text: str) -> str:
    """Escapes special ASS script characters such as curly braces."""
    # In ASS, curly braces enclose style override tags
    t = text.replace("{", "(").replace("}", ")")
    return t


def format_ffmpeg_ass_filter(ass_path: Union[str, Path]) -> str:
    """Constructs a bulletproof FFmpeg -vf filter string for libass on Windows and POSIX.
    
    Handles drive letters, Windows backslashes, spaces, and single quotes.
    """
    p = Path(ass_path)
    # Prefer relative path to current working directory to avoid Windows drive colon escaping issues
    try:
        rel_p = os.path.relpath(p, os.getcwd()).replace("\\", "/")
        return f"ass=filename='{rel_p}'"
    except (ValueError, OSError):
        abs_p = str(p.resolve()).replace("\\", "/").replace(":", r"\:")
        return f"ass=filename='{abs_p}'"


class CaptionGeneratorService:
    """End-to-end caption generation and rendering pipeline."""

    @staticmethod
    def filter_and_convert_words(
        transcript_words: List[Union[DisplayWord, Dict[str, Any]]],
        highlight_start_sec: float,
        highlight_end_sec: float,
    ) -> Tuple[List[CaptionWord], Dict[str, int]]:
        """Filters transcript words to highlight interval and converts to relative time base.
        
        Relative timing convention:
            relative_start = word_source_start - highlight_start
            relative_end = word_source_end - highlight_start
            
        Strictly clamps boundary words to [0.0, clip_duration], sanitizes zero-duration words,
        and preserves normalized technical terminology.
        
        Returns:
            Tuple of (List[CaptionWord], stats_dict)
        """
        clip_duration = max(0.0, highlight_end_sec - highlight_start_sec)
        rel_words: List[CaptionWord] = []
        zero_duration_count = 0
        clamped_count = 0
        dropped_invalid_count = 0

        # Standardize input to list of dicts/DisplayWord
        raw_list = []
        for w in transcript_words:
            if isinstance(w, DisplayWord):
                raw_list.append(w.model_dump())
            elif isinstance(w, dict):
                raw_list.append(dict(w))
            else:
                continue

        # Sort strictly by start_sec to guarantee monotonic order
        sorted_words = sorted(raw_list, key=lambda item: float(item.get("start_sec", 0.0)))

        for w in sorted_words:
            try:
                s_abs = float(w["start_sec"])
                e_abs = float(w["end_sec"])
            except (KeyError, TypeError, ValueError):
                dropped_invalid_count += 1
                continue

            # Reject non-finite timestamps
            if math.isnan(s_abs) or math.isnan(e_abs) or math.isinf(s_abs) or math.isinf(e_abs):
                dropped_invalid_count += 1
                continue

            # Ensure start <= end
            if e_abs < s_abs:
                dropped_invalid_count += 1
                continue

            # Filter words strictly outside the highlight window
            if e_abs <= highlight_start_sec or s_abs >= highlight_end_sec:
                continue

            # Check for clamping at boundary
            was_clamped = (s_abs < highlight_start_sec) or (e_abs > highlight_end_sec)
            if was_clamped:
                clamped_count += 1

            s_rel = max(0.0, s_abs - highlight_start_sec)
            e_rel = min(clip_duration, e_abs - highlight_start_sec)

            # Handle zero-duration or sub-centisecond words
            if e_rel <= s_rel:
                zero_duration_count += 1
                e_rel = min(clip_duration, s_rel + 0.05)

            # Preserve correction metadata if present
            corr_data = w.get("correction")
            corr = CorrectionMetadata(**corr_data) if isinstance(corr_data, dict) else corr_data

            word_obj = CaptionWord(
                id=w.get("id"),
                text=str(w.get("text", "")).strip(),
                start_sec=round(s_rel, 3),
                end_sec=round(e_rel, 3),
                source_word_ids=list(w.get("source_word_ids", [])),
                confidence=w.get("confidence"),
                correction=corr,
            )
            rel_words.append(word_obj)

        stats = {
            "total_input_words": len(transcript_words),
            "filtered_words_count": len(rel_words),
            "zero_duration_count": zero_duration_count,
            "clamped_count": clamped_count,
            "dropped_invalid_count": dropped_invalid_count,
        }
        return rel_words, stats

    @classmethod
    def group_words_into_captions(
        cls,
        words: List[CaptionWord],
        clip_duration: float,
        options: Optional[CaptionOptions] = None,
    ) -> List[CaptionGroup]:
        """Groups relative words into short, coherent, readable caption groups.
        
        Constraints applied:
            - 2 to 6 words per group.
            - Clause and punctuation aware boundaries.
            - Protected technical terminology (e.g. 'Big O', 'time complexity').
            - Balanced 1 or 2 lines per group.
            - Tail display hold reconciliation up to options.tail_hold_sec.
            - Monotonic timestamps with zero overlaps.
        """
        if not words:
            return []

        opts = options or CaptionOptions()

        # Step 1: Partition words into natural clauses using terminal punctuation
        # and substantial speech gaps (pauses)
        clauses: List[List[CaptionWord]] = []
        curr_clause: List[CaptionWord] = []

        for i, w in enumerate(words):
            curr_clause.append(w)
            w_text = w.text
            has_terminal = bool(re.search(r"[.!?]$", w_text))

            is_last = (i == len(words) - 1)
            if is_last:
                clauses.append(curr_clause)
                break

            next_w = words[i + 1]
            speech_gap = next_w.start_sec - w.end_sec

            if has_terminal or speech_gap >= opts.speech_pause_threshold_sec:
                clauses.append(curr_clause)
                curr_clause = []

        # Step 2: Subdivide clauses into balanced caption groups
        raw_groups: List[CaptionGroup] = []
        group_id = 0

        for clause in clauses:
            n = len(clause)
            if n == 0:
                continue

            # If clause is short enough, keep as single group
            if n <= opts.max_words_per_group:
                lines = cls._balance_lines(clause, opts.max_chars_per_line)
                raw_groups.append(
                    CaptionGroup(
                        id=group_id,
                        start_sec=clause[0].start_sec,
                        end_sec=clause[-1].end_sec,
                        text=" ".join(w.text for w in clause),
                        lines=lines,
                        words=clause,
                        is_karaoke=(opts.style == CaptionStyle.KARAOKE),
                    )
                )
                group_id += 1
                continue

            # Greedily subdivide longer clause into 2-5 word groups
            pos = 0
            while pos < n:
                remaining = n - pos
                if remaining <= opts.max_words_per_group:
                    chunk = clause[pos:]
                    lines = cls._balance_lines(chunk, opts.max_chars_per_line)
                    raw_groups.append(
                        CaptionGroup(
                            id=group_id,
                            start_sec=chunk[0].start_sec,
                            end_sec=chunk[-1].end_sec,
                            text=" ".join(w.text for w in chunk),
                            lines=lines,
                            words=chunk,
                            is_karaoke=(opts.style == CaptionStyle.KARAOKE),
                        )
                    )
                    group_id += 1
                    break

                # Evaluate candidate split points
                candidates = []
                for take in [4, 3, 5, 2]:
                    k = pos + take
                    if k < n and (n - k) >= opts.min_words_per_group:
                        candidates.append(k)

                if not candidates:
                    candidates = [pos + 4 if (pos + 4 < n) else pos + 3]

                best_k = candidates[0]
                best_score = -999.0

                for k in candidates:
                    last_w = clause[k - 1]
                    next_w = clause[k]
                    score = 0.0

                    # Penalize splitting protected technical phrases
                    if cls._is_protected_boundary(last_w.text, next_w.text):
                        score -= 50.0

                    # Bonus for punctuation at boundary
                    if re.search(r"[,;:]$", last_w.text):
                        score += 15.0

                    # Bonus for pause
                    gap = next_w.start_sec - last_w.end_sec
                    if gap >= 0.12:
                        score += gap * 12.0

                    # Prefer 3-4 words over extremes
                    w_count = k - pos
                    if w_count in (3, 4):
                        score += 5.0

                    if score > best_score:
                        best_score = score
                        best_k = k

                chunk = clause[pos:best_k]
                lines = cls._balance_lines(chunk, opts.max_chars_per_line)
                raw_groups.append(
                    CaptionGroup(
                        id=group_id,
                        start_sec=chunk[0].start_sec,
                        end_sec=chunk[-1].end_sec,
                        text=" ".join(w.text for w in chunk),
                        lines=lines,
                        words=chunk,
                        is_karaoke=(opts.style == CaptionStyle.KARAOKE),
                    )
                )
                group_id += 1
                pos = best_k

        # Step 3: Reconcile display end times so captions hold comfortably
        for idx in range(len(raw_groups)):
            curr_g = raw_groups[idx]
            actual_speech_end = curr_g.end_sec
            extended_end = actual_speech_end + opts.tail_hold_sec

            if idx < len(raw_groups) - 1:
                next_start = raw_groups[idx + 1].start_sec
                # Leave 0.04s breath before next caption if gap allows
                max_allowed = max(actual_speech_end, next_start - 0.04)
                curr_g.end_sec = min(extended_end, max_allowed)
            else:
                curr_g.end_sec = min(extended_end, clip_duration)

            curr_g.start_sec = round(curr_g.start_sec, 3)
            curr_g.end_sec = round(curr_g.end_sec, 3)

        return raw_groups

    @classmethod
    def _is_protected_boundary(cls, text_before: str, text_after: str) -> bool:
        """Checks if text boundary cuts through a known technical phrase."""
        t1 = re.sub(r"^[^\w]+|[^\w]+$", "", text_before).lower()
        t2 = re.sub(r"^[^\w]+|[^\w]+$", "", text_after).lower()
        for expr in PROTECTED_EXPRESSIONS:
            for idx in range(len(expr) - 1):
                if expr[idx] == t1 and expr[idx + 1] == t2:
                    return True
        return False

    @staticmethod
    def _balance_lines(words: List[CaptionWord], max_chars_per_line: int = 28) -> List[str]:
        """Splits word sequence into 1 or 2 visually balanced lines."""
        word_texts = [w.text for w in words]
        total_text = " ".join(word_texts)

        if len(total_text) <= 22 or len(words) <= 3:
            return [total_text]

        # Find word boundary that balances line lengths closest to 50/50
        best_split = len(words) // 2
        best_diff = float("inf")

        for split_idx in range(1, len(words)):
            l1 = " ".join(word_texts[:split_idx])
            l2 = " ".join(word_texts[split_idx:])
            diff = abs(len(l1) - len(l2))
            if diff < best_diff:
                best_diff = diff
                best_split = split_idx

        line1 = " ".join(word_texts[:best_split])
        line2 = " ".join(word_texts[best_split:])
        return [line1, line2]

    @classmethod
    def generate_ass_script(
        cls,
        caption_groups: List[CaptionGroup],
        options: Optional[CaptionOptions] = None,
        play_res_x: int = 720,
        play_res_y: int = 1280,
    ) -> str:
        """Generates complete ASS v4.00+ subtitle file content."""
        opts = options or CaptionOptions()

        # Styles definition
        # Alignment: 2 = Bottom-Center (\an2)
        # PrimaryColour: base text color
        # OutlineColour: outline color
        # BackColour: shadow color
        header = f"""[Script Info]
Title: PS04 Reel Studio Subtitles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.601
PlayResX: {play_res_x}
PlayResY: {play_res_y}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: CaptionStandard,{opts.font_name},{opts.font_size},{opts.primary_color},&H00000000,{opts.outline_color},{opts.back_color},-1,0,0,0,100,100,0,0,1,{opts.outline_width},{opts.shadow_depth},2,{opts.margin_lr},{opts.margin_lr},{opts.margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
        events: List[str] = []

        for g in caption_groups:
            g_start = g.start_sec
            g_end = g.end_sec
            lines = g.lines
            words_in_g = g.words

            if opts.style == CaptionStyle.STANDARD or not words_in_g:
                # Standard non-karaoke mode: exactly 1 event per group
                text_lines = [escape_ass_text(l) for l in lines]
                text = r" \N ".join(text_lines)
                events.append(
                    f"Dialogue: 0,{format_ass_timestamp(g_start)},{format_ass_timestamp(g_end)},CaptionStandard,,0,0,0,,{text}"
                )
            else:
                # Word-level karaoke highlighting mode:
                # Divide the group duration into temporal slices where active word is highlighted,
                # with zero text reflow and instant highlight transitions.

                # Lead interval before first word (if speech starts >30ms after group display start)
                first_w = words_in_g[0]
                if first_w.start_sec > g_start + 0.03:
                    all_white = r" \N ".join([escape_ass_text(l) for l in lines])
                    events.append(
                        f"Dialogue: 0,{format_ass_timestamp(g_start)},{format_ass_timestamp(first_w.start_sec)},CaptionStandard,,0,0,0,,{all_white}"
                    )

                for i, w in enumerate(words_in_g):
                    w_start = w.start_sec
                    w_end = w.end_sec

                    # Active word slice:
                    # Format lines such that only word token `i` receives highlight color
                    formatted_lines = []
                    w_counter = 0
                    for line in lines:
                        tokens = line.split()
                        out_tokens = []
                        for t in tokens:
                            escaped_t = escape_ass_text(t)
                            if w_counter == i:
                                out_tokens.append(f"{{\\c{opts.highlight_color}&}}{escaped_t}{{\\c{opts.primary_color}&}}")
                            else:
                                out_tokens.append(escaped_t)
                            w_counter += 1
                        formatted_lines.append(" ".join(out_tokens))

                    text_active = r" \N ".join(formatted_lines)
                    events.append(
                        f"Dialogue: 0,{format_ass_timestamp(w_start)},{format_ass_timestamp(w_end)},CaptionStandard,,0,0,0,,{text_active}"
                    )

                    # Inter-word speech gap / pause: highlight returns to neutral white
                    if i < len(words_in_g) - 1:
                        next_w = words_in_g[i + 1]
                        if next_w.start_sec > w_end + 0.03:
                            all_white = r" \N ".join([escape_ass_text(l) for l in lines])
                            events.append(
                                f"Dialogue: 0,{format_ass_timestamp(w_end)},{format_ass_timestamp(next_w.start_sec)},CaptionStandard,,0,0,0,,{all_white}"
                            )

                # Tail interval after last word until group end
                last_w = words_in_g[-1]
                if g_end > last_w.end_sec + 0.03:
                    all_white = r" \N ".join([escape_ass_text(l) for l in lines])
                    events.append(
                        f"Dialogue: 0,{format_ass_timestamp(last_w.end_sec)},{format_ass_timestamp(g_end)},CaptionStandard,,0,0,0,,{all_white}"
                    )

        return header + "\n".join(events) + "\n"

    @classmethod
    def save_ass_file(
        cls,
        caption_groups: List[CaptionGroup],
        output_path: Union[str, Path],
        options: Optional[CaptionOptions] = None,
        play_res_x: int = 720,
        play_res_y: int = 1280,
    ) -> Path:
        """Saves generated ASS script atomically to disk."""
        target = Path(output_path).resolve()
        target.parent.mkdir(parents=True, exist_ok=True)
        script_text = cls.generate_ass_script(
            caption_groups=caption_groups,
            options=options,
            play_res_x=play_res_x,
            play_res_y=play_res_y,
        )

        # Atomic write via temporary file
        temp_file = target.with_suffix(".tmp.ass")
        temp_file.write_text(script_text, encoding="utf-8")
        temp_file.replace(target)

        logger.info("Saved %s ASS subtitle file (%d groups) to %s", (options.style.value if options else "karaoke"), len(caption_groups), target)
        return target

    @classmethod
    def burn_subtitles_to_video(
        cls,
        input_video_path: Union[str, Path],
        ass_path: Union[str, Path],
        output_video_path: Union[str, Path],
        video_bitrate: str = "4M",
        preset: str = "fast",
        crf: int = 20,
    ) -> Path:
        """Burns ASS subtitles into video using FFmpeg libass filter with audio stream preserved."""
        in_p = Path(input_video_path).resolve()
        out_p = Path(output_video_path).resolve()
        ass_p = Path(ass_path).resolve()

        if not in_p.exists():
            raise FileNotFoundError(f"Input video not found: {in_p}")
        if not ass_p.exists():
            raise FileNotFoundError(f"Subtitle file not found: {ass_p}")

        out_p.parent.mkdir(parents=True, exist_ok=True)
        filter_arg = format_ffmpeg_ass_filter(ass_p)

        cmd = [
            "ffmpeg", "-y",
            "-i", str(in_p),
            "-vf", filter_arg,
            "-c:v", "libx264",
            "-preset", preset,
            "-crf", str(crf),
            "-b:v", video_bitrate,
            "-pix_fmt", "yuv420p",
            "-c:a", "copy",
            "-movflags", "+faststart",
            str(out_p),
        ]

        logger.info("Burning subtitles via FFmpeg: %s", " ".join(cmd))
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

        if res.returncode != 0:
            err_msg = res.stderr.strip()
            logger.error("FFmpeg subtitle burn-in failed: %s", err_msg)
            raise RuntimeError(f"FFmpeg subtitle burn-in failed (code {res.returncode}): {err_msg}")

        if not out_p.exists() or out_p.stat().st_size == 0:
            raise RuntimeError(f"Captioned video output file was not created or is empty: {out_p}")

        return out_p
