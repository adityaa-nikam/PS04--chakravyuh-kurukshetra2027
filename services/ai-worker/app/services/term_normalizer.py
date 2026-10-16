"""Technical Terminology Normalization Service.

Corrects recognizable technical terminology (e.g. useEffect, @Autowired, kubectl, FastAPI, PostgreSQL)
without changing the instructor's intended meaning, preserving the original ASR words in raw_words
and producing clean, context-validated display_words.
"""

import json
import logging
import re
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional, Set

from app.config import settings
from app.schemas import RawWord, DisplayWord, CorrectionMetadata, TranscriptWord

logger = logging.getLogger(__name__)


class TermNormalizerService:
    """Normalizes spoken technical terminology into canonical code representations."""

    def __init__(self, vocabulary_path: Optional[str | Path] = None):
        self.vocab_path = Path(vocabulary_path or settings.VOCABULARY_FILE).resolve()
        self.terms: List[Dict[str, Any]] = []
        # Index: cleaned spoken variant -> term definition dict
        self.variant_index: Dict[str, Dict[str, Any]] = {}
        # Maximum words in any spoken variant for n-gram windowing
        self.max_ngram_len: int = 1
        self._load_vocabulary()

    def _load_vocabulary(self) -> None:
        """Loads and indexes technical terms from vocabulary JSON."""
        if not self.vocab_path.exists():
            logger.warning("Vocabulary file not found at %s. Running without normalizations.", self.vocab_path)
            return

        try:
            with open(self.vocab_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            self.terms = data.get("terms", [])

            for item in self.terms:
                variants = item.get("spoken_variants", [])
                for v in variants:
                    cleaned_v = self._clean_token(v).lower()
                    if cleaned_v:
                        self.variant_index[cleaned_v] = item
                        ngram_len = len(cleaned_v.split())
                        if ngram_len > self.max_ngram_len:
                            self.max_ngram_len = ngram_len

            logger.info(
                "Loaded %d technical terms with %d spoken variants (max n-gram %d) from %s",
                len(self.terms),
                len(self.variant_index),
                self.max_ngram_len,
                self.vocab_path.name
            )
        except Exception as e:
            logger.error("Failed to load technical terms vocabulary: %s", e)
            raise

    @staticmethod
    def _clean_token(text: str) -> str:
        """Strips surrounding punctuation and normalizes internal whitespace."""
        # Strip leading/trailing non-alphanumeric except '@'
        cleaned = re.sub(r"^[^\w@]+|[^\w]+$", "", text)
        return re.sub(r"\s+", " ", cleaned).strip()

    def normalize(
        self,
        raw_words: List[RawWord],
        context_window_size: int = 30
    ) -> List[DisplayWord]:
        """Normalizes a stream of RawWord tokens into DisplayWord tokens.
        
        Evaluates sliding n-gram windows up to max_ngram_len, checks contextual keywords
        for ambiguous terms, and preserves source word IDs and timestamps.
        
        Args:
            raw_words: List of RawWord tokens from ASR.
            context_window_size: Number of words before/after to check for context keywords.
            
        Returns:
            List of DisplayWord tokens with canonical technical terms substituted.
        """
        if not raw_words or not self.variant_index:
            return [
                DisplayWord(
                    id=w.id,
                    text=w.text,
                    start_sec=w.start_sec,
                    end_sec=w.end_sec,
                    source_word_ids=[w.id],
                    confidence=w.confidence
                )
                for w in raw_words
            ]

        # Pre-build a lowercased word list for fast context matching
        all_cleaned_tokens = [self._clean_token(w.text).lower() for w in raw_words]
        global_token_set = set(all_cleaned_tokens)

        display_words: List[DisplayWord] = []
        i = 0
        n = len(raw_words)
        next_display_id = 0

        while i < n:
            matched = False

            # Try longest n-gram first (greedy)
            for window_size in range(min(self.max_ngram_len, n - i), 0, -1):
                sub_slice = raw_words[i : i + window_size]
                joined_clean = " ".join(all_cleaned_tokens[i : i + window_size])

                if joined_clean in self.variant_index:
                    term_def = self.variant_index[joined_clean]
                    canonical = term_def["canonical"]
                    term_id = term_def["id"]
                    context_req = term_def.get("context_required", [])
                    requires_review = term_def.get("requires_review_if_ambiguous", False)

                    # Context-Aware Verification:
                    # Check if any required context keyword appears within +/- context_window_size
                    has_valid_context = True
                    if context_req:
                        ctx_start = max(0, i - context_window_size)
                        ctx_end = min(n, i + window_size + context_window_size)
                        local_tokens = set(all_cleaned_tokens[ctx_start:ctx_end])
                        context_req_set = set(k.lower() for k in context_req)

                        # Match in local window or document
                        local_match = bool(local_tokens.intersection(context_req_set))
                        global_match = bool(global_token_set.intersection(context_req_set))
                        has_valid_context = local_match or global_match

                    if not has_valid_context:
                        # Ambiguous match without required context:
                        # DO NOT convert ordinary words into code terms!
                        # Keep original words, but flag for review if requested
                        logger.debug(
                            "Term candidate '%s' at [%.2f-%.2f] skipped: missing context %s",
                            joined_clean,
                            sub_slice[0].start_sec,
                            sub_slice[-1].end_sec,
                            context_req
                        )
                        # We do not apply the substitution
                        matched = False
                        break

                    # Preserve trailing punctuation from the last word in the matched phrase
                    trailing_punct_match = re.search(r"([.,!?;:]+)$", sub_slice[-1].text)
                    trailing_punct = trailing_punct_match.group(1) if trailing_punct_match else ""
                    canonical_with_punct = canonical + trailing_punct

                    # Aggregate timestamps and source word IDs
                    start_sec = sub_slice[0].start_sec
                    end_sec = sub_slice[-1].end_sec
                    source_ids = [w.id for w in sub_slice]

                    # Minimum confidence score across merged words if present
                    confidences = [w.confidence for w in sub_slice if w.confidence is not None]
                    min_conf = min(confidences) if confidences else None

                    correction = CorrectionMetadata(
                        term_id=term_id,
                        matched_alias=joined_clean,
                        applied=True,
                        requires_review=requires_review and not has_valid_context,
                        reason=None
                    )

                    display_words.append(
                        DisplayWord(
                            id=next_display_id,
                            text=canonical_with_punct,
                            start_sec=start_sec,
                            end_sec=end_sec,
                            source_word_ids=source_ids,
                            confidence=min_conf,
                            correction=correction
                        )
                    )
                    next_display_id += 1
                    i += window_size
                    matched = True
                    break

            if not matched:
                w = raw_words[i]
                display_words.append(
                    DisplayWord(
                        id=next_display_id,
                        text=w.text,
                        start_sec=w.start_sec,
                        end_sec=w.end_sec,
                        source_word_ids=[w.id],
                        confidence=w.confidence,
                        correction=None
                    )
                )
                next_display_id += 1
                i += 1

        return display_words

    # Compatibility method for legacy TranscriptWord interface
    def normalize_words(self, words: List[TranscriptWord]) -> List[TranscriptWord]:
        """Bridges legacy TranscriptWord tokens through the normalizer."""
        raw_words = [
            RawWord(
                id=idx,
                text=w.word,
                start_sec=w.start_abs_sec,
                end_sec=w.end_abs_sec,
                confidence=w.confidence
            )
            for idx, w in enumerate(words)
        ]
        display = self.normalize(raw_words)
        result: List[TranscriptWord] = []
        for d in display:
            is_tech = d.correction is not None and d.correction.applied
            term_id = d.correction.term_id if is_tech else None
            raw_phrase = " ".join(raw_words[wid].text for wid in d.source_word_ids)
            result.append(
                TranscriptWord(
                    word=d.text,
                    raw_asr_word=raw_phrase,
                    start_abs_sec=d.start_sec,
                    end_abs_sec=d.end_sec,
                    confidence=d.confidence or 1.0,
                    is_technical_term=is_tech,
                    term_id=term_id
                )
            )
        return result
