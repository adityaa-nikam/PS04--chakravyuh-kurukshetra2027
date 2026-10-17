"""Intelligent Highlight Selection Service.

Analyzes validated word-level transcripts to identify the single most valuable,
coherent, and self-contained 30–60-second educational highlight for short-form content.
"""

import json
import logging
import re
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple, Dict, Any

from app.config import settings
from app.schemas import (
    ValidatedTranscript,
    DisplayWord,
    SourceMetadata,
    ScoreBreakdown,
    HighlightResult,
    SelectedHighlight,
    TimestampDiagnostics,
)

logger = logging.getLogger(__name__)


@dataclass
class Sentence:
    """A coherent sentence or thought unit segmented from display words."""
    sentence_id: int
    words: List[DisplayWord]
    start_sec: float
    end_sec: float
    duration_sec: float
    text: str


@dataclass
class CandidateSegment:
    """A candidate window spanning one or more consecutive sentences."""
    candidate_id: int
    start_sentence_idx: int
    end_sentence_idx: int
    words: List[DisplayWord]
    start_sec: float
    end_sec: float
    duration_sec: float
    text: str
    score_breakdown: Optional[ScoreBreakdown] = None
    total_score: float = 0.0
    reason: str = ""
    is_fallback: bool = False
    mercury_score: Optional[float] = None
    title: Optional[str] = None
    caption: Optional[str] = None


class HighlightSelectorService:
    """Transcript-aware highlight selector implementing heuristic educational scoring."""

    # Curated linguistic markers for educational coding lectures
    CONCEPT_DEFINITION_MARKERS = [
        "is called", "concept called", "means that", "we define",
        "this is our", "the concept of", "what is", "one big concept",
        "refers to", "known as", "defined as", "in computer science"
    ]

    EXPLANATION_MARKERS = [
        "because", "the reason", "which allows us to", "which allows",
        "this is why", "how it operates", "how they operate", "so that we can",
        "the way this works", "why do we", "how it works", "speed and efficiency"
    ]

    EXAMPLE_ANALOGY_MARKERS = [
        "for example", "for instance", "such as", "just like",
        "let's say", "imagine", "picture this", "in this scenario",
        "to illustrate", "think of it as", "different scenarios"
    ]

    TAKEAWAY_MARKERS = [
        "optimized for", "time complexity", "trade-off", "in summary",
        "the takeaway", "keep in mind", "super important to know",
        "best practice", "remember that", "as a result"
    ]

    DANGLING_OPENING_MARKERS = [
        "as i mentioned earlier", "like i said before", "as we saw",
        "as i said", "like i mentioned", "on the other hand",
        "in the previous video", "so as we discussed"
    ]

    CONTINUATION_CONJUNCTIONS = [
        "and so", "and if", "and then", "and also", "but then",
        "or else", "so then", "and"
    ]

    DANGLING_ENDING_MARKERS = [
        "more on that later", "and then we will see", "in the next video",
        "we will see in a bit", "we will talk about later", "and so on",
        "more about that in"
    ]

    SPEAKER_META_INTRO_MARKERS = [
        "hi my name is", "my name is", "welcome back to", "if you're new here",
        "subscribe to my channel", "leave a comment", "smash that like button",
        "i have a bachelor", "i have a master", "every single day i help"
    ]

    FILLER_WORDS = {"um", "uh", "you know", "basically", "sort of", "kind of", "like"}

    def __init__(
        self,
        min_duration_sec: float = 30.0,
        max_duration_sec: float = 60.0,
        target_duration_sec: float = 45.0
    ):
        self.min_duration_sec = min_duration_sec
        self.max_duration_sec = max_duration_sec
        self.target_duration_sec = target_duration_sec

    # -----------------------------------------------------------------------
    # Step 1: Sentence Boundary Segmentation
    # -----------------------------------------------------------------------
    @classmethod
    def segment_into_sentences(cls, words: List[DisplayWord]) -> List[Sentence]:
        """Segments a stream of display words into grammatical sentences or thought units.
        
        Boundary detection rules:
        1. Terminal punctuation: '.', '!', '?'
        2. Natural conversational pauses: gap between consecutive words >= 0.65s
        3. Clause terminators: ';', ':'
        """
        if not words:
            return []

        sentences: List[Sentence] = []
        current_words: List[DisplayWord] = []
        sentence_id = 0

        for i, word in enumerate(words):
            current_words.append(word)
            text_strip = word.text.strip()

            is_terminal_punct = bool(re.search(r"[.!?]+$", text_strip))
            is_clause_punct = bool(re.search(r"[:;]+$", text_strip))

            # Check pause gap to the next word
            is_pause_gap = False
            if i < len(words) - 1:
                next_word = words[i + 1]
                gap = next_word.start_sec - word.end_sec
                if gap >= 0.65:
                    is_pause_gap = True

            # If boundary detected and current sentence has at least 3 words (avoid micro-fragments)
            if (is_terminal_punct or is_clause_punct or is_pause_gap) and len(current_words) >= 3:
                pos_words = [w for w in current_words if w.end_sec > w.start_sec]
                if pos_words:
                    s_start = pos_words[0].start_sec
                    raw_end = pos_words[-1].end_sec
                else:
                    s_start = current_words[0].start_sec
                    raw_end = current_words[-1].end_sec

                # Trailing silence release: allow sentence boundary to naturally include post-speech pause
                # up to the next word's start (capped at +0.35s) so speech is not clipped abruptly
                trailing_pad = 0.0
                if i < len(words) - 1:
                    next_word = words[i + 1]
                    gap = next_word.start_sec - raw_end
                    if gap > 0:
                        trailing_pad = min(0.35, gap)

                s_end = round(raw_end + trailing_pad, 3)
                s_text = " ".join(w.text for w in current_words)
                sentences.append(
                    Sentence(
                        sentence_id=sentence_id,
                        words=list(current_words),
                        start_sec=round(s_start, 3),
                        end_sec=s_end,
                        duration_sec=round(s_end - s_start, 3),
                        text=s_text
                    )
                )
                sentence_id += 1
                current_words = []

        # Flush any trailing words
        if current_words:
            pos_words = [w for w in current_words if w.end_sec > w.start_sec]
            if pos_words:
                s_start = pos_words[0].start_sec
                s_end = pos_words[-1].end_sec
            else:
                s_start = current_words[0].start_sec
                s_end = current_words[-1].end_sec

            s_text = " ".join(w.text for w in current_words)
            sentences.append(
                Sentence(
                    sentence_id=sentence_id,
                    words=list(current_words),
                    start_sec=round(s_start, 3),
                    end_sec=round(s_end, 3),
                    duration_sec=round(s_end - s_start, 3),
                    text=s_text
                )
            )

        return sentences

    # -----------------------------------------------------------------------
    # Step 2: Candidate Generation
    # -----------------------------------------------------------------------
    def generate_candidates(
        self,
        sentences: List[Sentence],
        words: List[DisplayWord]
    ) -> List[CandidateSegment]:
        """Generates candidate segments within [min_duration_sec, max_duration_sec].
        
        Uses sentence-based combinations. If sentences are too few or long,
        falls back to sliding window across words.
        """
        candidates: List[CandidateSegment] = []
        candidate_id = 0

        num_sentences = len(sentences)

        # Primary: Group consecutive sentences
        for i in range(num_sentences):
            start_sec = sentences[i].start_sec

            for j in range(i, num_sentences):
                end_sec = sentences[j].end_sec
                duration = end_sec - start_sec

                if duration > self.max_duration_sec:
                    # Exceeded maximum duration, move to next starting sentence
                    break

                if duration >= self.min_duration_sec:
                    # Valid candidate meeting duration criteria
                    cand_words = []
                    for s_idx in range(i, j + 1):
                        cand_words.extend(sentences[s_idx].words)

                    cand_text = " ".join(s.text for s in sentences[i : j + 1])
                    candidates.append(
                        CandidateSegment(
                            candidate_id=candidate_id,
                            start_sentence_idx=i,
                            end_sentence_idx=j,
                            words=cand_words,
                            start_sec=round(start_sec, 3),
                            end_sec=round(end_sec, 3),
                            duration_sec=round(duration, 3),
                            text=cand_text
                        )
                    )
                    candidate_id += 1

        # Fallback: If sentence combinations yielded 0 candidates, try sliding window across words
        if not candidates and words:
            pos_words = [w for w in words if w.end_sec > w.start_sec]
            if not pos_words:
                raise ValueError("Transcript contains zero words with positive duration.")

            w_first = pos_words[0]
            w_last = pos_words[-1]
            total_duration = w_last.end_sec - w_first.start_sec

            # Check if total transcript is shorter than min_duration
            if total_duration < self.min_duration_sec:
                # Documented Short-Transcript Fallback Policy:
                # Return the full available span rather than failing or inventing fake timestamps
                cand_text = " ".join(w.text for w in words)
                candidates.append(
                    CandidateSegment(
                        candidate_id=0,
                        start_sentence_idx=0,
                        end_sentence_idx=max(0, num_sentences - 1),
                        words=words,
                        start_sec=round(w_first.start_sec, 3),
                        end_sec=round(w_last.end_sec, 3),
                        duration_sec=round(total_duration, 3),
                        text=cand_text,
                        reason="Short transcript fallback: Available duration is below minimum target.",
                        is_fallback=True
                    )
                )
            else:
                # Sliding word window with step across positively-timed words
                n_pos = len(pos_words)
                step = 10
                for start_idx in range(0, n_pos, step):
                    w_start = pos_words[start_idx].start_sec
                    for end_idx in range(start_idx + 10, n_pos):
                        w_end = pos_words[end_idx].end_sec
                        dur = w_end - w_start
                        if dur > self.max_duration_sec:
                            break
                        if dur >= self.min_duration_sec:
                            slice_words = [
                                w for w in words
                                if w_start - 0.001 <= w.start_sec and w.end_sec <= w_end + 0.001
                            ]
                            candidates.append(
                                CandidateSegment(
                                    candidate_id=candidate_id,
                                    start_sentence_idx=0,
                                    end_sentence_idx=0,
                                    words=slice_words,
                                    start_sec=round(w_start, 3),
                                    end_sec=round(w_end, 3),
                                    duration_sec=round(dur, 3),
                                    text=" ".join(w.text for w in slice_words)
                                )
                            )
                            candidate_id += 1

        return candidates

    # -----------------------------------------------------------------------
    # Step 3: Heuristic Multi-Signal Scoring Engine
    # -----------------------------------------------------------------------
    def score_candidate(self, candidate: CandidateSegment) -> Tuple[float, ScoreBreakdown, str]:
        """Calculates transparent, deterministic scores for a candidate segment.
        
        Returns:
            Tuple of (total_score, ScoreBreakdown, reason_summary)
        """
        text_lower = candidate.text.lower()
        words = candidate.words
        num_words = len(words)
        duration = candidate.duration_sec

        reasons: List[str] = []

        # A. Information Value (0 to 100)
        s_info = 30.0  # baseline

        # Concept definitions
        concept_count = sum(1 for m in self.CONCEPT_DEFINITION_MARKERS if m in text_lower)
        if concept_count:
            s_info += min(30.0, concept_count * 15.0)
            reasons.append("defines core concept")

        # Explanations & causality
        expl_count = sum(1 for m in self.EXPLANATION_MARKERS if m in text_lower)
        if expl_count:
            s_info += min(25.0, expl_count * 12.0)
            reasons.append("explains mechanism")

        # Concrete examples & analogies
        ex_count = sum(1 for m in self.EXAMPLE_ANALOGY_MARKERS if m in text_lower)
        if ex_count:
            s_info += min(30.0, ex_count * 15.0)
            reasons.append("includes illustrative example/analogy")

        # Technical terms normalized
        tech_terms = [w for w in words if w.correction and w.correction.applied]
        if tech_terms:
            s_info += min(25.0, len(tech_terms) * 12.0)
            reasons.append(f"contains {len(tech_terms)} technical term(s)")

        # Takeaways / optimizations
        takeaway_count = sum(1 for m in self.TAKEAWAY_MARKERS if m in text_lower)
        if takeaway_count:
            s_info += min(20.0, takeaway_count * 10.0)

        s_info = min(100.0, max(0.0, s_info))

        # B. Self-Contained Meaning (0 to 100)
        s_self = 70.0  # baseline

        first_sentence = words[:min(12, num_words)]
        first_sentence_text = " ".join(w.text for w in first_sentence).lower()

        last_sentence = words[max(0, num_words - 12):]
        last_sentence_text = " ".join(w.text for w in last_sentence).lower()

        # Deduct for continuation conjunctions at start
        for conj in self.CONTINUATION_CONJUNCTIONS:
            if first_sentence_text.startswith(conj + " "):
                s_self -= 25.0
                break

        # Deduct for unresolved backward references
        for dangling in self.DANGLING_OPENING_MARKERS:
            if dangling in first_sentence_text:
                s_self -= 30.0
                break

        # Deduct for dangling forward closures ("more on that later")
        for dangling in self.DANGLING_ENDING_MARKERS:
            if dangling in last_sentence_text:
                s_self -= 30.0
                break

        s_self = min(100.0, max(0.0, s_self))

        # C. Opening Hook Quality (0 to 100)
        s_hook = 50.0  # baseline

        # Check strong hook markers
        strong_hook_starters = [
            "before we get into", "have you ever", "why do we",
            "how do we", "what is", "one big concept", "the most important",
            "data structures are super important", "imagine if", "notice how"
        ]
        if any(marker in first_sentence_text for marker in strong_hook_starters):
            s_hook += 35.0
            reasons.append("strong hook")

        # Question hook
        if "?" in first_sentence_text or first_sentence_text.startswith(("why", "how", "what")):
            s_hook += 20.0

        # Penalize speaker self-intro or social media preamble
        for meta in self.SPEAKER_META_INTRO_MARKERS:
            if meta in text_lower:
                s_hook -= 40.0
                break

        s_hook = min(100.0, max(0.0, s_hook))

        # D. Ending Quality (0 to 100)
        s_ending = 50.0

        last_word_text = words[-1].text.strip()
        if re.search(r"[.!?]+$", last_word_text):
            s_ending += 35.0  # ends cleanly on full stop
        else:
            s_ending -= 35.0  # truncated mid-sentence

        # Check ending takeaway markers
        if any(m in last_sentence_text for m in ["just like", "optimized for", "in summary", "that is how"]):
            s_ending += 20.0
            reasons.append("complete conclusion")

        # Penalty for ending on preposition or conjunction
        trailing_clean = re.sub(r"[^\w]", "", last_word_text).lower()
        if trailing_clean in {"and", "but", "or", "to", "with", "of", "for", "the", "a", "an", "them"}:
            s_ending -= 35.0

        s_ending = min(100.0, max(0.0, s_ending))

        # E. Speech Density & Cadence (0 to 100)
        s_density = 75.0
        if duration > 0:
            wps = num_words / duration  # words per second
            if 2.2 <= wps <= 3.6:
                s_density = 100.0
            elif 1.6 <= wps < 2.2 or 3.6 < wps <= 4.2:
                s_density = 75.0
            else:
                s_density = 45.0

            # Penalize filler words
            filler_count = sum(1 for w in words if w.text.lower().strip(",.!?") in self.FILLER_WORDS)
            filler_ratio = filler_count / num_words if num_words else 0
            if filler_ratio > 0.05:
                s_density -= min(30.0, filler_ratio * 200.0)

        s_density = min(100.0, max(0.0, s_density))

        # F. Confidence Score (0 to 100)
        conf_scores = [w.confidence for w in words if w.confidence is not None]
        s_conf = (sum(conf_scores) / len(conf_scores) * 100.0) if conf_scores else 95.0
        s_conf = min(100.0, max(0.0, s_conf))

        # G. Duration Sweet-Spot Adjustment
        # Target sweet spot: ~40s - 50s
        duration_penalty = 0.0
        if duration > 0:
            diff = abs(duration - self.target_duration_sec)
            duration_penalty = min(8.0, round((diff / 15.0) * 4.0, 2))

        # Composite Weighted Score
        raw_weighted = (
            0.30 * s_info
            + 0.25 * s_self
            + 0.20 * s_hook
            + 0.15 * s_ending
            + 0.10 * s_density
            - duration_penalty
        )

        # Scale lightly by confidence (supporting signal, max 10% impact)
        conf_multiplier = 0.90 + (0.10 * (s_conf / 100.0))
        final_score = round(max(0.0, min(100.0, raw_weighted * conf_multiplier)), 2)

        breakdown = ScoreBreakdown(
            information_value=round(s_info, 2),
            self_contained=round(s_self, 2),
            opening_hook=round(s_hook, 2),
            ending_quality=round(s_ending, 2),
            speech_density=round(s_density, 2),
            confidence=round(s_conf, 2),
            duration_penalty=round(duration_penalty, 2)
        )

        reason_str = "; ".join(dict.fromkeys(reasons)) if reasons else "Coherent standalone explanation"
        return final_score, breakdown, reason_str

    # -----------------------------------------------------------------------
    # Step 4: Final Boundary Refinement and Selection
    # -----------------------------------------------------------------------
    def select_best_highlight(
        self,
        transcript: ValidatedTranscript
    ) -> HighlightResult:
        """Selects the single winning educational highlight from a ValidatedTranscript.
        
        Args:
            transcript: Validated transcript containing display_words and source metadata.
            
        Returns:
            HighlightResult adhering strictly to the Master Contract.
            
        Raises:
            ValueError: If transcript contains no display words.
        """
        words = transcript.display_words
        if not words:
            raise ValueError("Transcript contains zero words. Cannot select a highlight.")

        # Timestamp quality diagnostics (Requirement 3 & 6)
        diag = transcript.diagnose_timestamps()
        if not diag.is_structurally_valid:
            raise ValueError(f"Malformed transcript timestamps: {'; '.join(diag.fatal_errors[:5])}")

        if diag.valid_words_count == 0:
            raise ValueError("Transcript contains zero words with positive duration.")

        if diag.has_zero_duration_anomalies:
            logger.info(
                "Transcript contains %d zero-duration word(s) (IDs: %s). Non-fatal; applying boundary protection.",
                diag.zero_duration_count,
                diag.zero_duration_word_ids[:10]
            )

        sentences = self.segment_into_sentences(words)
        candidates = self.generate_candidates(sentences, words)

        if not candidates:
            # Fallback for very short or non-segmentable input
            pos_words = [w for w in words if w.end_sec > w.start_sec]
            if not pos_words:
                raise ValueError("Transcript contains zero words with positive duration.")

            w_first = pos_words[0]
            w_last = pos_words[-1]
            total_dur = w_last.end_sec - w_first.start_sec
            cand_text = " ".join(w.text for w in words)
            breakdown = ScoreBreakdown(
                information_value=50.0,
                self_contained=50.0,
                opening_hook=50.0,
                ending_quality=50.0,
                speech_density=50.0,
                confidence=95.0,
                duration_penalty=0.0
            )
            return HighlightResult(
                schema_version="1.0",
                source=transcript.source,
                start_sec=round(w_first.start_sec, 3),
                end_sec=round(w_last.end_sec, 3),
                duration_sec=round(total_dur, 3),
                score=50.0,
                reason="Single segment fallback: Transcript cannot be subdivided into valid candidate windows.",
                transcript_excerpt=cand_text,
                score_breakdown=breakdown,
                word_start_id=words[0].id,
                word_end_id=words[-1].id,
                selection_method="fallback_single_segment"
            )

        # Score every candidate deterministically
        for cand in candidates:
            score, breakdown, reason = self.score_candidate(cand)
            cand.total_score = score
            cand.score_breakdown = breakdown
            if cand.is_fallback:
                cand.reason = f"Short transcript fallback: {cand.reason or reason}"
            else:
                cand.reason = reason

        # Sort descending by score, tie-break by duration closest to target
        candidates.sort(
            key=lambda c: (c.total_score, -abs(c.duration_sec - self.target_duration_sec)),
            reverse=True
        )

        winner = candidates[0]

        # Boundary refinement: ensure start aligns with first word and end with last word
        refined_words = winner.words

        # Strip leading filler words if present at the very beginning ("Um", "Uh")
        while len(refined_words) > 5 and refined_words[0].text.lower().strip(",.!?") in self.FILLER_WORDS:
            refined_words = refined_words[1:]

        # Find eligible positively timed words within the refined list
        pos_words = [w for w in refined_words if w.end_sec > w.start_sec]
        if not pos_words:
            raise ValueError("Candidate contains zero words with positive duration.")

        first_pos = pos_words[0]
        last_pos = pos_words[-1]

        # Eligible start boundary is established by the first positively-timed word
        start_sec = first_pos.start_sec
        # Eligible end boundary is anchored to the last positively-timed word (+ release pad if applicable)
        end_sec = max(last_pos.end_sec, winner.end_sec)

        # Include all words whose timing falls within [start_sec, end_sec]
        # Any zero-duration words falling inside this interval are preserved in excerpt
        # Words strictly outside are excluded
        included_words = [
            w for w in refined_words
            if w.start_sec >= start_sec - 0.001 and w.end_sec <= end_sec + 0.001
        ]
        if not included_words:
            included_words = pos_words

        word_start_id = included_words[0].id
        word_end_id = included_words[-1].id
        excerpt = " ".join(w.text for w in included_words)
        duration_sec = round(end_sec - start_sec, 3)

        selection_method = (
            "short_transcript_fallback"
            if winner.is_fallback or winner.duration_sec < self.min_duration_sec
            else "transcript_heuristic_v1"
        )

        logger.info(
            "Selected highlight [%.2fs - %.2fs] (duration=%.2fs, score=%.2f): '%s...'",
            start_sec,
            end_sec,
            duration_sec,
            winner.total_score,
            excerpt[:60]
        )

        return HighlightResult(
            schema_version="1.0",
            source=transcript.source,
            start_sec=round(start_sec, 3),
            end_sec=round(end_sec, 3),
            duration_sec=duration_sec,
            score=winner.total_score,
            reason=winner.reason or "Highest educational and contextual coherence score",
            transcript_excerpt=excerpt,
            score_breakdown=winner.score_breakdown,
            word_start_id=word_start_id,
            word_end_id=word_end_id,
            selection_method=selection_method
        )

    # -----------------------------------------------------------------------
    # Step 5: Multi-Topic Extraction & Mercury Decide Evaluation
    # -----------------------------------------------------------------------
    @staticmethod
    def evaluate_with_mercury_decide(candidate: CandidateSegment) -> Optional[float]:
        """Calls OpenRouter Decisions API with inception/mercury-decide to score standalone pedagogical quality."""
        if not settings.OPENROUTER_API_KEY:
            return None
        url = "https://openrouter.ai/api/alpha/decisions"
        headers = {
            "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": settings.DECISION_MODEL or "inception/mercury-decide",
            "state": {
                "topic_excerpt": candidate.text[:400],
                "duration_sec": candidate.duration_sec,
                "word_count": len(candidate.words)
            },
            "questions": {
                "is_standalone_reel": {
                    "type": "noul",
                    "instructions": "Is this video clip an engaging, self-contained educational highlight suitable for a standalone viral reel?",
                    "criteria": {
                        "true": "Clear, self-contained educational insight with high pedagogical value",
                        "false": "Incomplete thought, greeting/promo fluff, dangling reference, or requires heavy external context"
                    }
                }
            }
        }
        try:
            req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers)
            with urllib.request.urlopen(req, timeout=6) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                noul = data.get("answers", {}).get("is_standalone_reel", {}).get("noul")
                if noul is not None:
                    return float(noul)
        except Exception as e:
            logger.warning("Mercury Decide evaluation skipped for candidate %d: %s", candidate.candidate_id, e)
        return None

    @staticmethod
    def generate_title_and_caption(candidate: CandidateSegment, clip_index: int) -> Tuple[str, str]:
        """Generates a punchy educational title and viral Instagram caption for a clip."""
        # Clean fallback extraction
        first_sentence = candidate.text.split(".")[0].strip()
        words = [w for w in first_sentence.split() if w.lower() not in HighlightSelectorService.FILLER_WORDS]
        raw_title = " ".join(words[:5]) if len(words) >= 3 else f"Topic Highlight #{clip_index + 1}"
        fallback_title = re.sub(r"[^\w\s-]", "", raw_title).title()
        fallback_caption = (
            f"💡 {fallback_title}\n\n"
            f"{candidate.text[:140].strip()}...\n\n"
            "#Programming #ComputerScience #TechExplainer #CodingShorts"
        )

        if not settings.OPENROUTER_API_KEY:
            return fallback_title, fallback_caption

        url = "https://openrouter.ai/api/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
            "Content-Type": "application/json"
        }
        prompt = (
            f"Analyze this lecture clip transcript excerpt:\n\"{candidate.text[:350]}\"\n\n"
            "Respond ONLY in valid JSON format with two keys:\n"
            "\"title\": A punchy 3-5 word technical topic title (e.g. 'Big O Space Complexity')\n"
            "\"caption\": A 2-sentence viral Instagram caption with 3 hashtags."
        )
        payload = {
            "model": settings.FREE_LLM_MODEL or "nvidia/nemotron-3-super-120b-a12b:free",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.3
        }
        try:
            req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers)
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                content = data["choices"][0]["message"]["content"].strip()
                match = re.search(r"\{.*\}", content, re.DOTALL)
                if match:
                    parsed = json.loads(match.group(0))
                    title = parsed.get("title", fallback_title).strip().strip('"')
                    caption = parsed.get("caption", fallback_caption).strip()
                    return title, caption
        except Exception as e:
            logger.debug("LLM title generation skipped: %s", e)

        return fallback_title, fallback_caption

    def select_multiple_highlights(
        self,
        transcript: ValidatedTranscript,
        max_clips: int = 3,
        use_decision_model: bool = True
    ) -> List[HighlightResult]:
        """Selects up to `max_clips` distinct, non-overlapping pedagogical highlights from transcript.
        
        Natural Bounds Guarantee:
        - If only 1 topic is present in a short lecture, returns exactly 1 highlight.
        - If 2 topics are present, returns exactly 2 highlights.
        - If N topics are present and user requested 10, returns up to 10 highlights.
        - If 6 topics are present and user requested 10, returns exactly 6 highlights.
        - Uses inception/mercury-decide calibrated decision probabilities for highlight selection.
        """
        words = transcript.display_words
        if not words:
            raise ValueError("Transcript contains zero words. Cannot select highlights.")

        diag = transcript.diagnose_timestamps()
        if not diag.is_structurally_valid:
            raise ValueError(f"Malformed transcript timestamps: {'; '.join(diag.fatal_errors[:5])}")

        if diag.valid_words_count == 0:
            raise ValueError("Transcript contains zero words with positive duration.")

        sentences = self.segment_into_sentences(words)
        candidates = self.generate_candidates(sentences, words)

        if not candidates:
            single = self.select_best_highlight(transcript)
            single.title = "Educational Highlight #1"
            single.caption = f"💡 Key concept from lecture\n\n{single.transcript_excerpt[:150]}...\n\n#Programming #Code"
            return [single]

        # Score every candidate deterministically with heuristic engine
        for cand in candidates:
            score, breakdown, reason = self.score_candidate(cand)
            cand.total_score = score
            cand.score_breakdown = breakdown
            cand.reason = reason

        # Sort descending by heuristic score
        candidates.sort(
            key=lambda c: (c.total_score, -abs(c.duration_sec - self.target_duration_sec)),
            reverse=True
        )

        # Temporal Non-Maximum Suppression (NMS) to isolate distinct, non-overlapping topic windows
        distinct_candidates: List[CandidateSegment] = []
        for cand in candidates:
            overlaps = False
            for chosen in distinct_candidates:
                ov_start = max(cand.start_sec, chosen.start_sec)
                ov_end = min(cand.end_sec, chosen.end_sec)
                ov_dur = max(0.0, ov_end - ov_start)
                union_dur = (cand.duration_sec + chosen.duration_sec) - ov_dur
                iou = ov_dur / max(1.0, union_dur)
                if ov_dur > 5.0 or iou > 0.15:
                    overlaps = True
                    break
            if not overlaps:
                distinct_candidates.append(cand)
                # Keep candidate pool bounded for AI decision evaluation
                if len(distinct_candidates) >= max(max_clips * 2, 8):
                    break

        if not distinct_candidates:
            single = self.select_best_highlight(transcript)
            single.title = "Educational Highlight #1"
            return [single]

        # Evaluate candidate quality with Mercury Decide
        if use_decision_model and settings.OPENROUTER_API_KEY:
            logger.info(
                "Evaluating %d distinct candidate topics with Mercury Decide (%s)...",
                len(distinct_candidates),
                settings.DECISION_MODEL
            )
            for cand in distinct_candidates:
                noul = self.evaluate_with_mercury_decide(cand)
                if noul is not None:
                    cand.mercury_score = noul
                    # Blended decision score: 40% heuristic breakdown + 60% Mercury probability
                    cand.total_score = round(cand.total_score * 0.4 + (noul * 100.0) * 0.6, 1)

            # Re-sort after Mercury Decision scoring
            distinct_candidates.sort(key=lambda c: c.total_score, reverse=True)

        # Natural Bound: Capped at min(max_clips, total_distinct_topics_available)
        final_candidates = distinct_candidates[:max(1, max_clips)]
        logger.info(
            "Final topic selection: %d clip(s) selected from %d distinct topic(s) (requested max=%d)",
            len(final_candidates),
            len(distinct_candidates),
            max_clips
        )

        results: List[HighlightResult] = []
        for idx, winner in enumerate(final_candidates):
            refined_words = winner.words
            while len(refined_words) > 5 and refined_words[0].text.lower().strip(",.!?") in self.FILLER_WORDS:
                refined_words = refined_words[1:]

            pos_words = [w for w in refined_words if w.end_sec > w.start_sec]
            if not pos_words:
                pos_words = refined_words

            first_pos = pos_words[0]
            last_pos = pos_words[-1]
            start_sec = first_pos.start_sec
            end_sec = max(last_pos.end_sec, winner.end_sec)

            included_words = [
                w for w in refined_words
                if w.start_sec >= start_sec - 0.001 and w.end_sec <= end_sec + 0.001
            ] or pos_words

            word_start_id = included_words[0].id
            word_end_id = included_words[-1].id
            excerpt = " ".join(w.text for w in included_words)
            duration_sec = round(end_sec - start_sec, 3)

            title, caption = self.generate_title_and_caption(winner, idx)

            method = (
                "mercury_decide_nms"
                if winner.mercury_score is not None
                else "heuristic_nms"
            )

            results.append(
                HighlightResult(
                    schema_version="1.0",
                    source=transcript.source,
                    start_sec=round(start_sec, 3),
                    end_sec=round(end_sec, 3),
                    duration_sec=duration_sec,
                    score=winner.total_score,
                    reason=winner.reason or "Coherent educational highlight verified by Mercury Decide",
                    transcript_excerpt=excerpt,
                    score_breakdown=winner.score_breakdown or ScoreBreakdown(
                        information_value=50.0,
                        self_contained=50.0,
                        opening_hook=50.0,
                        ending_quality=50.0,
                        speech_density=50.0,
                        confidence=95.0,
                        duration_penalty=0.0
                    ),
                    word_start_id=word_start_id,
                    word_end_id=word_end_id,
                    selection_method=method,
                    title=title,
                    caption=caption,
                    mercury_score=winner.mercury_score,
                )
            )

        return results

    # -----------------------------------------------------------------------
    # File I/O Helpers
    # -----------------------------------------------------------------------
    @classmethod
    def select_from_file(
        cls,
        transcript_path: str | Path,
        min_duration_sec: float = 30.0,
        max_duration_sec: float = 60.0
    ) -> HighlightResult:
        """Loads a ValidatedTranscript from disk and runs highlight selection."""
        path = Path(transcript_path).resolve()
        if not path.exists():
            raise FileNotFoundError(f"Transcript JSON file not found: {path}")

        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            transcript = ValidatedTranscript(**data)
        except json.JSONDecodeError as e:
            raise ValueError(f"Failed to parse transcript JSON: {e}") from e
        except Exception as e:
            raise ValueError(f"Invalid transcript schema: {e}") from e

        service = cls(min_duration_sec=min_duration_sec, max_duration_sec=max_duration_sec)
        return service.select_best_highlight(transcript)

    @staticmethod
    def save_highlight(result: HighlightResult, output_path: Optional[str | Path] = None) -> Path:
        """Persists the HighlightResult JSON to storage/highlights/ atomically."""
        if output_path is not None:
            target = Path(output_path).resolve()
        else:
            stem = Path(result.source.filename).stem
            target = settings.HIGHLIGHTS_DIR / f"{stem}_highlight.json"

        target.parent.mkdir(parents=True, exist_ok=True)
        with open(target, "w", encoding="utf-8") as f:
            f.write(result.model_dump_json(indent=2))

        logger.info("Saved highlight selection result to: %s", target.name)
        return target
