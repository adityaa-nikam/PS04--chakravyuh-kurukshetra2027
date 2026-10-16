"""Unit tests for Phase 3: Intelligent Highlight Selection Engine.

Covers all 15 required verification cases:
1. Informative segment beats generic introduction.
2. Self-contained segment beats dangling/incomplete thought.
3. Duration boundaries respect min/max constraints.
4. Natural sentence endings are preserved without truncation.
5. Word-boundary alignment of start_sec and end_sec.
6. Candidate generation spans entire long transcript (not just beginning).
7. Short transcript follows documented fallback policy.
8. Empty transcript raises clear ValueError.
9. Malformed input/missing fields handled gracefully.
10. Repeated execution is 100% deterministic.
11. Duration equals (end_sec - start_sec) within float tolerance.
12. Output excerpt accurately corresponds to selected word tokens.
13. CLI execution succeeds and outputs valid JSON.
14. CLI failure modes handle missing or corrupt input.
15. Existing Phase 2 models and output schemas are fully compatible.
"""

import json
from pathlib import Path
import pytest

from app.schemas import (
    ValidatedTranscript,
    SourceMetadata,
    TranscriptionMetadata,
    RawWord,
    DisplayWord,
    CorrectionMetadata,
    HighlightResult,
)
from app.services.highlight_selector import HighlightSelectorService, Sentence
from app.cli import run_highlight_selection
from app.config import settings


# ---------------------------------------------------------------------------
# Test Helpers
# ---------------------------------------------------------------------------

def create_word_sequence(
    words_data: list[tuple[str, float, float]],
    start_id: int = 1,
    default_conf: float = 0.95,
    tech_indices: set[int] | None = None
) -> tuple[list[RawWord], list[DisplayWord]]:
    """Helper to generate aligned RawWord and DisplayWord lists."""
    tech_indices = tech_indices or set()
    raw_words = []
    display_words = []

    for i, (text, start, end) in enumerate(words_data):
        w_id = start_id + i
        raw_words.append(
            RawWord(
                id=w_id,
                text=text.strip(".,!?:;"),
                start_sec=round(start, 3),
                end_sec=round(end, 3),
                confidence=default_conf
            )
        )
        correction = None
        if i in tech_indices:
            correction = CorrectionMetadata(
                term_id="tech_concept",
                matched_alias="concept",
                applied=True,
                requires_review=False,
                reason="Normalized terminology"
            )
        display_words.append(
            DisplayWord(
                id=w_id,
                text=text,
                start_sec=round(start, 3),
                end_sec=round(end, 3),
                source_word_ids=[w_id],
                confidence=default_conf,
                correction=correction
            )
        )

    return raw_words, display_words


def build_transcript_from_text(
    speech_blocks: list[tuple[str, float, float]],
    filename: str = "sample_lecture.mp4",
    tech_words: set[str] | None = None
) -> ValidatedTranscript:
    """Builds a ValidatedTranscript from a list of (sentence_text, start_sec, end_sec) tuples."""
    tech_words = tech_words or set()
    all_raw: list[RawWord] = []
    all_display: list[DisplayWord] = []
    curr_id = 1

    for block_text, b_start, b_end in speech_blocks:
        tokens = block_text.split()
        if not tokens:
            continue
        n_tok = len(tokens)
        dt = (b_end - b_start) / n_tok

        for idx, tok in enumerate(tokens):
            w_start = round(b_start + (idx * dt), 3)
            w_end = round(b_start + ((idx + 1) * dt) - 0.04, 3)
            is_tech = tok.lower().strip(".,!?:;") in tech_words

            raw_w, disp_w = create_word_sequence(
                [(tok, w_start, w_end)],
                start_id=curr_id,
                tech_indices={0} if is_tech else set()
            )
            all_raw.extend(raw_w)
            all_display.extend(disp_w)
            curr_id += 1

    total_dur = all_display[-1].end_sec if all_display else 0.0
    return ValidatedTranscript(
        schema_version="1.0",
        source=SourceMetadata(
            filename=filename,
            duration_sec=round(total_dur, 3),
            audio_sample_rate=16000
        ),
        transcription=TranscriptionMetadata(
            model="small",
            detected_language="en",
            timestamp_origin="original_source_start"
        ),
        raw_words=all_raw,
        display_words=all_display
    )


# ---------------------------------------------------------------------------
# Test Cases 1 & 2: Educational Value and Self-Containedness
# ---------------------------------------------------------------------------

def test_informative_segment_wins():
    """Case 1: An educational explanation with an analogy/example beats a generic speaker intro."""
    # Intro: 0.0s - 34.0s (34 seconds of channel fluff)
    intro_sentences = [
        ("Hi my name is John and welcome back to my coding channel.", 0.0, 5.0),
        ("If you are new here please make sure to subscribe and leave a comment.", 5.5, 11.0),
        ("Every single day I help students learn programming online.", 11.5, 17.0),
        ("I have a bachelor and a master degree in engineering.", 17.5, 23.0),
        ("Today we are going to talk about various software engineering topics.", 23.5, 29.0),
        ("So let us see what we have on the agenda for this session.", 29.5, 34.0),
    ]

    # Educational explanation: 35.0s - 72.0s (37 seconds of deep explanation + analogy)
    edu_sentences = [
        ("Before we get into any particular data structure, we do need to understand one big concept called Big O.", 35.0, 43.0),
        ("Big O is how we measure how our code performs in different scenarios.", 43.5, 49.0),
        ("For example, imagine driving a car from New York to California versus taking a jet airplane.", 49.5, 57.0),
        ("The reason this matters is because time complexity scales drastically as input size grows.", 57.5, 65.0),
        ("This is why asymptotic analysis is super important to know.", 65.5, 71.5),
    ]

    transcript = build_transcript_from_text(
        intro_sentences + edu_sentences,
        tech_words={"big", "o"}
    )

    selector = HighlightSelectorService(min_duration_sec=30.0, max_duration_sec=60.0)
    winner = selector.select_best_highlight(transcript)

    assert winner.start_sec >= 34.0, f"Expected educational segment start (>= 34.0s), got {winner.start_sec}s"
    assert "big concept called big o" in winner.transcript_excerpt.lower()
    assert winner.score_breakdown.information_value > 70.0
    assert winner.score > 75.0


def test_self_contained_segment_wins():
    """Case 2: A self-contained explanation beats an incomplete fragment with dangling referents."""
    # Fragment with unresolved backward & forward references: 0.0s - 33.0s
    dangling_sentences = [
        ("As I mentioned earlier in the previous video, we also have this other method.", 0.0, 6.0),
        ("And so if we do this, it behaves in a certain way.", 6.5, 12.0),
        ("And then we will see more on that later in the next video.", 12.5, 18.0),
        ("Like I said before, that is basically how it goes.", 18.5, 24.0),
        ("And also there are several other things we need to examine.", 24.5, 32.0),
    ]

    # Coherent self-contained concept: 34.0s - 72.0s
    self_contained_sentences = [
        ("In computer science, a binary search tree is defined as an ordered node-based tree.", 34.0, 42.0),
        ("The reason we use it is because search operations take logarithmic time.", 42.5, 50.0),
        ("For instance, searching ten thousand sorted items requires only fourteen comparisons.", 50.5, 58.0),
        ("Keep in mind that balanced trees guarantee this logarithmic trade-off.", 58.5, 66.0),
        ("That is the key takeaway for tree performance.", 66.5, 71.5),
    ]

    transcript = build_transcript_from_text(dangling_sentences + self_contained_sentences)

    selector = HighlightSelectorService(min_duration_sec=30.0, max_duration_sec=60.0)
    winner = selector.select_best_highlight(transcript)

    assert winner.start_sec >= 33.0, f"Expected self-contained segment start (>= 33.0s), got {winner.start_sec}s"
    assert "binary search tree is defined" in winner.transcript_excerpt.lower()
    assert winner.score_breakdown.self_contained > 65.0


# ---------------------------------------------------------------------------
# Test Cases 3, 4, 5: Duration and Boundary Alignment
# ---------------------------------------------------------------------------

def test_duration_boundaries_respected():
    """Case 3: Selected segment duration strictly respects configured min and max."""
    sentences = [
        (f"Sentence number {i} provides insightful technical details about software systems.", i * 6.0, (i + 1) * 6.0 - 0.5)
        for i in range(25)  # 150 seconds total
    ]
    transcript = build_transcript_from_text(sentences)

    # Test [30.0, 45.0]
    selector = HighlightSelectorService(min_duration_sec=30.0, max_duration_sec=45.0)
    result = selector.select_best_highlight(transcript)
    assert 30.0 <= result.duration_sec <= 45.0, f"Duration {result.duration_sec}s outside [30.0, 45.0]"

    # Test [40.0, 60.0]
    selector2 = HighlightSelectorService(min_duration_sec=40.0, max_duration_sec=60.0)
    result2 = selector2.select_best_highlight(transcript)
    assert 40.0 <= result2.duration_sec <= 60.0, f"Duration {result2.duration_sec}s outside [40.0, 60.0]"


def test_natural_sentence_endings_preserved():
    """Case 4: Winner boundary does not truncate mid-sentence; ends cleanly on terminal punctuation."""
    sentences = [
        ("We define an algorithm as a finite sequence of rigorous instructions.", 0.0, 8.0),
        ("It operates step by step to solve a specific computational problem.", 8.5, 17.0),
        ("For example, sorting an array of numbers requires multiple comparison operations.", 17.5, 27.0),
        ("Optimized algorithms reduce redundant work and maximize CPU throughput.", 27.5, 37.0),
        ("This is why asymptotic analysis remains a fundamental best practice.", 37.5, 46.0),
    ]
    transcript = build_transcript_from_text(sentences)

    selector = HighlightSelectorService(min_duration_sec=30.0, max_duration_sec=60.0)
    winner = selector.select_best_highlight(transcript)

    assert winner.transcript_excerpt.endswith((".", "!", "?"))
    assert winner.score_breakdown.ending_quality >= 80.0


def test_word_boundary_alignment():
    """Case 5: start_sec and end_sec align with actual word timestamps."""
    sentences = [
        ("Understanding memory allocation is essential for systems programming.", 10.125, 17.340),
        ("Because stack allocation is fast, local variables reside in stack frames.", 17.800, 25.450),
        ("Heap allocation on the other hand requires dynamic memory management.", 25.900, 34.200),
        ("In summary, understanding these trade-offs prevents memory leaks.", 34.800, 43.150),
    ]
    transcript = build_transcript_from_text(sentences)

    selector = HighlightSelectorService(min_duration_sec=30.0, max_duration_sec=60.0)
    winner = selector.select_best_highlight(transcript)

    # Lookup start and end words
    start_word = next(w for w in transcript.display_words if w.id == winner.word_start_id)
    end_word = next(w for w in transcript.display_words if w.id == winner.word_end_id)

    assert abs(winner.start_sec - start_word.start_sec) < 1e-3
    # end_sec may include trailing post-speech padding, but must be >= end_word.end_sec
    assert winner.end_sec >= end_word.end_sec
    assert winner.end_sec <= end_word.end_sec + 0.35 + 1e-3


# ---------------------------------------------------------------------------
# Test Cases 6, 7, 8, 9: Long, Short, Empty, and Malformed Transcripts
# ---------------------------------------------------------------------------

def test_long_transcript_candidate_generation():
    """Case 6: Candidate evaluation spans the entire transcript, selecting a highlight deep into a 10-minute video."""
    long_sentences = []
    # 0 to 400s: Low-information routine remarks
    for i in range(50):
        t0 = i * 8.0
        long_sentences.append((f"We are continuing through slide number {i} in this lecture session.", t0, t0 + 7.5))

    # 400s to 445s: High-value breakthrough insight
    long_sentences.extend([
        ("Notice how this one big concept called dynamic programming completely alters time complexity.", 401.0, 409.0),
        ("Because we store overlapping subproblem solutions, exponential time becomes polynomial.", 409.5, 417.0),
        ("For example, computing Fibonacci numbers drops from billions of operations to merely forty.", 417.5, 426.0),
        ("This is why memoization is super important to know.", 426.5, 434.0),
        ("Remember that trade-off whenever you design recursive algorithms.", 434.5, 442.0),
    ])

    # 445s to 600s: Routine closing
    for i in range(55, 75):
        t0 = i * 8.0
        long_sentences.append((f"Next we examine routine reference slide number {i} for review.", t0, t0 + 7.5))

    transcript = build_transcript_from_text(long_sentences)
    assert transcript.source.duration_sec >= 590.0

    selector = HighlightSelectorService(min_duration_sec=30.0, max_duration_sec=60.0)
    winner = selector.select_best_highlight(transcript)

    assert 395.0 <= winner.start_sec <= 410.0, f"Expected deep highlight near 401s, got {winner.start_sec}s"
    assert "dynamic programming" in winner.transcript_excerpt.lower()


def test_short_transcript_fallback_policy():
    """Case 7: Transcript shorter than min_duration uses documented fallback policy without crashing."""
    short_sentences = [
        ("This is a short clip.", 0.0, 3.5),
        ("It explains a quick concept in ten seconds.", 4.0, 11.2),
    ]
    transcript = build_transcript_from_text(short_sentences)
    assert transcript.source.duration_sec < 30.0

    selector = HighlightSelectorService(min_duration_sec=30.0, max_duration_sec=60.0)
    winner = selector.select_best_highlight(transcript)

    assert winner.start_sec == 0.0
    assert winner.duration_sec < 30.0
    assert winner.selection_method == "short_transcript_fallback" or "fallback" in winner.reason.lower()
    assert "quick concept in ten seconds" in winner.transcript_excerpt


def test_empty_transcript_raises_value_error():
    """Case 8: Empty transcript with zero words raises clear actionable ValueError."""
    empty_transcript = ValidatedTranscript(
        schema_version="1.0",
        source=SourceMetadata(filename="empty.mp4", duration_sec=0.0),
        transcription=TranscriptionMetadata(model="small", detected_language="en"),
        raw_words=[],
        display_words=[]
    )

    selector = HighlightSelectorService()
    with pytest.raises(ValueError, match="Transcript contains zero words"):
        selector.select_best_highlight(empty_transcript)


def test_malformed_transcript_handling(tmp_path: Path):
    """Case 9: Malformed JSON or invalid schema raises ValueError / ValidationError."""
    # Test 1: Invalid JSON syntax
    bad_json_file = tmp_path / "corrupt.json"
    bad_json_file.write_text("{bad:json", encoding="utf-8")

    with pytest.raises(ValueError, match="Failed to parse transcript JSON"):
        HighlightSelectorService.select_from_file(bad_json_file)

    # Test 2: Missing required schema fields
    invalid_schema_file = tmp_path / "invalid_schema.json"
    invalid_schema_file.write_text(json.dumps({"some_key": 123}), encoding="utf-8")

    with pytest.raises(ValueError, match="Invalid transcript schema"):
        HighlightSelectorService.select_from_file(invalid_schema_file)

    # Test 3: None confidence words are handled without crashing
    raw_w, disp_w = create_word_sequence([("Hello", 0.0, 1.0), ("world.", 1.1, 2.0)])
    for w in disp_w:
        w.confidence = None
    transcript = ValidatedTranscript(
        schema_version="1.0",
        source=SourceMetadata(filename="none_conf.mp4", duration_sec=2.0),
        transcription=TranscriptionMetadata(model="small", detected_language="en"),
        raw_words=raw_w,
        display_words=disp_w
    )
    selector = HighlightSelectorService()
    winner = selector.select_best_highlight(transcript)
    assert winner.score_breakdown.confidence >= 90.0  # Uses fallback confidence


# ---------------------------------------------------------------------------
# Test Cases 10, 11, 12: Determinism, Duration Math, Excerpt Validity
# ---------------------------------------------------------------------------

def test_deterministic_repeat_execution():
    """Case 10: Repeated execution on identical input produces identical winner and score."""
    sentences = [
        ("We define recursion as a method where the solution depends on smaller instances.", 0.0, 8.0),
        ("The base case is critical because it terminates the recursive step.", 8.5, 16.0),
        ("For example, calculating factorial of n calls factorial of n minus one.", 16.5, 25.0),
        ("This is why stack overflow occurs when the base case is missing.", 25.5, 33.0),
        ("In summary, always verify your termination condition first.", 33.5, 41.0),
    ]
    transcript = build_transcript_from_text(sentences)
    selector = HighlightSelectorService(min_duration_sec=30.0, max_duration_sec=60.0)

    res1 = selector.select_best_highlight(transcript)
    res2 = selector.select_best_highlight(transcript)

    assert res1.start_sec == res2.start_sec
    assert res1.end_sec == res2.end_sec
    assert res1.score == res2.score
    assert res1.duration_sec == res2.duration_sec
    assert res1.transcript_excerpt == res2.transcript_excerpt
    assert res1.word_start_id == res2.word_start_id
    assert res1.word_end_id == res2.word_end_id


def test_duration_calculation_accuracy():
    """Case 11: duration_sec matches end_sec - start_sec within float precision."""
    sentences = [
        ("Here is a sentence that explains basic programming.", 0.0, 10.0),
        ("Here is another sentence explaining algorithms.", 10.5, 22.0),
        ("And here is a concluding sentence with a key takeaway.", 22.5, 35.0),
    ]
    transcript = build_transcript_from_text(sentences)
    selector = HighlightSelectorService(min_duration_sec=30.0, max_duration_sec=60.0)
    result = selector.select_best_highlight(transcript)

    computed_dur = round(result.end_sec - result.start_sec, 3)
    assert abs(result.duration_sec - computed_dur) < 1e-3


def test_valid_excerpt_matches_word_range():
    """Case 12: transcript_excerpt strictly matches the joined words from word_start_id to word_end_id."""
    sentences = [
        ("Notice how memory layout affects CPU cache locality.", 0.0, 8.0),
        ("Because sequential array access is continuous, cache lines stay hot.", 8.5, 17.0),
        ("For instance, iterating through linked lists incurs frequent cache misses.", 17.5, 26.0),
        ("This is why contiguous vectors outperform linked lists in real benchmarks.", 26.5, 36.0),
        ("Keep in mind this trade-off for performance critical code.", 36.5, 44.0),
    ]
    transcript = build_transcript_from_text(sentences)
    selector = HighlightSelectorService(min_duration_sec=30.0, max_duration_sec=60.0)
    result = selector.select_best_highlight(transcript)

    # Slice words from start to end
    word_map = {w.id: w for w in transcript.display_words}
    assert result.word_start_id in word_map
    assert result.word_end_id in word_map

    selected_words = [
        w for w in transcript.display_words
        if result.word_start_id <= w.id <= result.word_end_id
    ]
    expected_text = " ".join(w.text for w in selected_words)
    assert result.transcript_excerpt == expected_text


# ---------------------------------------------------------------------------
# Test Cases 13 & 14: CLI Integration
# ---------------------------------------------------------------------------

def test_cli_highlight_selection_success(tmp_path: Path):
    """Case 13: CLI command succeeds and persists valid HighlightResult JSON."""
    sentences = [
        ("One big concept called Big O measures algorithmic scalability.", 0.0, 10.0),
        ("For example, imagine driving across the country versus flying.", 10.5, 20.0),
        ("Because flying is independent of road traffic, it scales better.", 20.5, 31.0),
        ("This is why asymptotic time complexity is super important to know.", 31.5, 42.0),
    ]
    transcript = build_transcript_from_text(sentences, filename="cli_test.mp4")

    input_json = tmp_path / "cli_input.json"
    input_json.write_text(transcript.model_dump_json(indent=2), encoding="utf-8")

    output_json = tmp_path / "cli_output.json"

    exit_code = run_highlight_selection(
        transcript_path=input_json,
        min_duration_sec=30.0,
        max_duration_sec=60.0,
        output_path=output_json
    )

    assert exit_code == 0
    assert output_json.exists()

    with open(output_json, "r", encoding="utf-8") as f:
        data = json.load(f)

    result = HighlightResult(**data)
    assert result.schema_version == "1.0"
    assert result.duration_sec >= 30.0
    assert "big o" in result.transcript_excerpt.lower()


def test_cli_highlight_selection_failure(tmp_path: Path):
    """Case 14: CLI returns non-zero exit codes on missing or invalid files."""
    # Non-existent file
    assert run_highlight_selection("non_existent_file_xyz.json") == 1

    # Corrupted file
    corrupt_file = tmp_path / "broken.json"
    corrupt_file.write_text("not json", encoding="utf-8")
    assert run_highlight_selection(corrupt_file) == 2


# ---------------------------------------------------------------------------
# Test Case 15: Backward Compatibility & Real Transcript Compatibility
# ---------------------------------------------------------------------------

def test_phase2_regression_and_model_compatibility():
    """Case 15: ValidatedTranscript produced by Phase 2 loads seamlessly into HighlightSelector."""
    # Test that ValidatedTranscript schema works end-to-end with HighlightResult
    real_transcript_path = settings.TRANSCRIPTS_DIR / "lecture.json"
    if real_transcript_path.exists():
        result = HighlightSelectorService.select_from_file(real_transcript_path)
        assert isinstance(result, HighlightResult)
        assert result.duration_sec >= 30.0
        assert result.score > 0
        assert len(result.transcript_excerpt) > 0


# ---------------------------------------------------------------------------
# Timestamp Edge-Case Hardening Regression Tests
# ---------------------------------------------------------------------------

def test_zero_duration_word_inside_candidate():
    """Verifies that a zero-duration word inside a candidate is preserved in excerpt and does not crash."""
    sentences = [
        ("Before we get into any particular data structure, we do need to understand one big concept called Big O.", 0.0, 10.0),
        ("Because it operates in different scenarios, it bubbles up smaller values.", 10.5, 22.0),
        ("For example, imagine driving a car from New York to California versus taking a plane.", 22.5, 34.0),
        ("This is why asymptotic time complexity is super important to know.", 34.5, 45.0),
    ]
    transcript = build_transcript_from_text(sentences)

    # Convert word #18 ('it') into a zero-duration word (start == end)
    zero_word = transcript.display_words[18]
    zero_word.start_sec = 16.5
    zero_word.end_sec = 16.5
    assert zero_word.start_sec == zero_word.end_sec

    selector = HighlightSelectorService(min_duration_sec=30.0, max_duration_sec=60.0)
    result = selector.select_best_highlight(transcript)

    assert result.start_sec >= 0.0
    assert result.end_sec > result.start_sec
    assert 30.0 <= result.duration_sec <= 60.0
    # Zero-duration word text is preserved in excerpt
    assert zero_word.text in result.transcript_excerpt
    # Word range encompasses the zero-duration word
    assert result.word_start_id <= zero_word.id <= result.word_end_id


def test_zero_duration_word_at_candidate_boundary():
    """Verifies that zero-duration words at potential candidate boundaries are not used as sole anchors."""
    sentences = [
        ("We define one big concept called Big O notation in computer science.", 0.0, 10.0),
        ("For example, imagine driving across the country versus taking a flight.", 10.5, 22.0),
        ("Because airplanes are fast, travel time is minimized for long trips.", 22.5, 34.0),
        ("This is why asymptotic efficiency is super important to know.", 34.5, 44.0),
    ]
    transcript = build_transcript_from_text(sentences)

    # Set word #0 to zero-duration at 0.0s
    w0 = transcript.display_words[0]
    w0.start_sec = 0.0
    w0.end_sec = 0.0

    # Set last word to zero-duration at 44.0s
    w_last = transcript.display_words[-1]
    w_last.start_sec = 44.0
    w_last.end_sec = 44.0

    selector = HighlightSelectorService(min_duration_sec=30.0, max_duration_sec=60.0)
    result = selector.select_best_highlight(transcript)

    # Segment boundaries are positively timed and valid
    assert result.start_sec >= 0.0
    assert result.end_sec > result.start_sec
    assert result.duration_sec >= 30.0
    # Positively timed words exist inside the segment
    included_words = [
        w for w in transcript.display_words
        if result.word_start_id <= w.id <= result.word_end_id
    ]
    assert any(w.end_sec > w.start_sec for w in included_words)


def test_fatal_timestamp_errors_rejected():
    """Verifies that negative, reversed, NaN, and non-numeric timestamps are strictly rejected."""
    # 1. Negative start_sec
    with pytest.raises(Exception):
        DisplayWord(id=1, text="hello", start_sec=-2.0, end_sec=1.0)

    # 2. Reversed timestamps (end_sec < start_sec)
    with pytest.raises(Exception):
        DisplayWord(id=2, text="world", start_sec=10.0, end_sec=8.0)

    # 3. NaN timestamps
    with pytest.raises(Exception):
        DisplayWord(id=3, text="nan_word", start_sec=float("nan"), end_sec=5.0)

    # 4. Infinite timestamps
    with pytest.raises(Exception):
        DisplayWord(id=4, text="inf_word", start_sec=float("inf"), end_sec=5.0)

    # 5. Non-numeric timestamps
    with pytest.raises(Exception):
        DisplayWord(id=5, text="str_time", start_sec="invalid", end_sec=5.0)  # type: ignore


def test_zero_duration_diagnostics_reporting():
    """Verifies that diagnose_timestamps accurately distinguishes zero-duration words from fatal errors."""
    raw_w, disp_w = create_word_sequence([
        ("first", 0.0, 1.0),
        ("it", 1.0, 1.0),       # zero-duration anomaly #1
        ("second", 1.0, 2.5),
        ("oh,", 3.0, 3.0),      # zero-duration anomaly #2
        ("third", 3.0, 4.5),
        ("to", 4.5, 4.5),       # zero-duration anomaly #3
        ("fourth.", 4.5, 6.0),
    ])

    transcript = ValidatedTranscript(
        schema_version="1.0",
        source=SourceMetadata(filename="diag_test.mp4", duration_sec=6.0),
        transcription=TranscriptionMetadata(model="small", detected_language="en"),
        raw_words=raw_w,
        display_words=disp_w
    )

    diag = transcript.diagnose_timestamps()
    assert diag.is_structurally_valid is True
    assert diag.has_zero_duration_anomalies is True
    assert diag.zero_duration_count == 3
    assert diag.zero_duration_word_ids == [disp_w[1].id, disp_w[3].id, disp_w[5].id]
    assert diag.valid_words_count == 4
    assert len(diag.fatal_errors) == 0


def test_full_lecture_transcript_robustness():
    """Verifies end-to-end highlight selection on the 3,486-word lecture.json containing 3 zero-duration words."""
    real_path = settings.TRANSCRIPTS_DIR / "lecture.json"
    if not real_path.exists():
        pytest.skip("storage/transcripts/lecture.json not present in workspace")

    with open(real_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    transcript = ValidatedTranscript(**data)
    diag = transcript.diagnose_timestamps()

    assert diag.is_structurally_valid is True
    assert diag.has_zero_duration_anomalies is True
    assert diag.zero_duration_count == 3
    assert diag.zero_duration_word_ids == [2307, 2424, 3262]

    selector = HighlightSelectorService(min_duration_sec=30.0, max_duration_sec=60.0)
    res1 = selector.select_best_highlight(transcript)
    res2 = selector.select_best_highlight(transcript)

    # Determinism
    assert res1.start_sec == res2.start_sec
    assert res1.end_sec == res2.end_sec
    assert res1.score == res2.score
    assert res1.duration_sec == res2.duration_sec
    assert res1.transcript_excerpt == res2.transcript_excerpt

    # Duration and bounds
    assert 30.0 <= res1.duration_sec <= 60.0
    assert res1.end_sec > res1.start_sec
    assert abs(res1.duration_sec - (res1.end_sec - res1.start_sec)) < 1e-3
    assert len(res1.transcript_excerpt) > 50

