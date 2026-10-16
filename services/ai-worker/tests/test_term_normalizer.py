"""Unit tests for Technical Terminology Normalizer.

Tests deterministic synthetic benchmarks with known expected outcomes:
- Exact term normalization
- Multi-word aliases
- Token boundary matching
- Context-aware validation for ambiguous terms (e.g., useEffect)
- Raw word preservation vs display word mapping
"""

import pytest
from app.schemas import RawWord, DisplayWord
from app.services.term_normalizer import TermNormalizerService


@pytest.fixture
def normalizer():
    return TermNormalizerService()


def test_single_word_exact_normalization(normalizer):
    """Verifies single-word technical terms are correctly canonicalized."""
    raw = [
        RawWord(id=0, text="We", start_sec=0.0, end_sec=0.2, confidence=0.99),
        RawWord(id=1, text="use", start_sec=0.3, end_sec=0.5, confidence=0.98),
        RawWord(id=2, text="fastapi", start_sec=0.6, end_sec=1.1, confidence=0.94),
        RawWord(id=3, text="here.", start_sec=1.2, end_sec=1.5, confidence=0.97),
    ]

    display = normalizer.normalize(raw)
    assert len(display) == 4
    assert display[2].text == "FastAPI"
    assert display[2].source_word_ids == [2]
    assert display[2].correction is not None
    assert display[2].correction.term_id == "python_fastapi"
    assert display[2].correction.applied is True


def test_multi_word_alias_with_punctuation(normalizer):
    """Verifies multi-word phrases combine timestamps and preserve punctuation."""
    raw = [
        RawWord(id=0, text="Run", start_sec=2.0, end_sec=2.2, confidence=0.99),
        RawWord(id=1, text="cube", start_sec=2.3, end_sec=2.5, confidence=0.91),
        RawWord(id=2, text="ctl,", start_sec=2.6, end_sec=2.9, confidence=0.89),
        RawWord(id=3, text="please.", start_sec=3.0, end_sec=3.3, confidence=0.98),
    ]

    display = normalizer.normalize(raw)
    assert len(display) == 3
    # First token is "Run"
    assert display[0].text == "Run"
    # Second token combines "cube" and "ctl," -> "kubectl,"
    assert display[1].text == "kubectl,"
    assert display[1].start_sec == 2.3
    assert display[1].end_sec == 2.9
    assert display[1].source_word_ids == [1, 2]
    assert display[1].confidence == 0.89  # min confidence
    assert display[1].correction.term_id == "k8s_kubectl"
    assert display[1].correction.matched_alias == "cube ctl"


def test_context_aware_use_effect_with_react_context(normalizer):
    """Verifies 'use effect' converts to 'useEffect' when React context words are present."""
    raw = [
        RawWord(id=0, text="In", start_sec=0.0, end_sec=0.1),
        RawWord(id=1, text="this", start_sec=0.2, end_sec=0.3),
        RawWord(id=2, text="React", start_sec=0.4, end_sec=0.7),
        RawWord(id=3, text="component,", start_sec=0.8, end_sec=1.2),
        RawWord(id=4, text="the", start_sec=1.3, end_sec=1.4),
        RawWord(id=5, text="use", start_sec=1.5, end_sec=1.7),
        RawWord(id=6, text="effect", start_sec=1.8, end_sec=2.1),
        RawWord(id=7, text="hook", start_sec=2.2, end_sec=2.5),
        RawWord(id=8, text="runs.", start_sec=2.6, end_sec=2.9),
    ]

    display = normalizer.normalize(raw)
    # Finding the display token for useEffect
    use_effect_tokens = [d for d in display if d.correction and d.correction.term_id == "react_use_effect"]
    assert len(use_effect_tokens) == 1
    ue = use_effect_tokens[0]
    assert ue.text == "useEffect"
    assert ue.start_sec == 1.5
    assert ue.end_sec == 2.1
    assert ue.source_word_ids == [5, 6]
    assert ue.correction.applied is True


def test_context_aware_use_effect_without_context_remains_unmodified(normalizer):
    """Verifies 'use effect' in everyday non-programming speech is NOT converted to 'useEffect'."""
    raw = [
        RawWord(id=0, text="The", start_sec=0.0, end_sec=0.2),
        RawWord(id=1, text="photographer", start_sec=0.3, end_sec=0.8),
        RawWord(id=2, text="will", start_sec=0.9, end_sec=1.1),
        RawWord(id=3, text="use", start_sec=1.2, end_sec=1.4),
        RawWord(id=4, text="effect", start_sec=1.5, end_sec=1.8),
        RawWord(id=5, text="filters", start_sec=1.9, end_sec=2.3),
        RawWord(id=6, text="for", start_sec=2.4, end_sec=2.5),
        RawWord(id=7, text="lighting.", start_sec=2.6, end_sec=3.0),
    ]

    display = normalizer.normalize(raw)
    # Ensure NO token was converted to useEffect
    use_effect_tokens = [d for d in display if "useEffect" in d.text]
    assert len(use_effect_tokens) == 0

    # Ensure words 'use' and 'effect' remain as separate ordinary words
    words_text = [d.text for d in display]
    assert "use" in words_text
    assert "effect" in words_text


def test_spring_autowired_normalization(normalizer):
    """Verifies '@Autowired' is properly substituted from 'at autowired'."""
    raw = [
        RawWord(id=0, text="Add", start_sec=0.0, end_sec=0.2),
        RawWord(id=1, text="at", start_sec=0.3, end_sec=0.4),
        RawWord(id=2, text="autowired", start_sec=0.5, end_sec=0.9),
        RawWord(id=3, text="for", start_sec=1.0, end_sec=1.1),
        RawWord(id=4, text="dependency", start_sec=1.2, end_sec=1.6),
        RawWord(id=5, text="injection.", start_sec=1.7, end_sec=2.1),
    ]

    display = normalizer.normalize(raw)
    autowired_tokens = [d for d in display if d.correction and d.correction.term_id == "spring_autowired"]
    assert len(autowired_tokens) == 1
    assert autowired_tokens[0].text == "@Autowired"
    assert autowired_tokens[0].source_word_ids == [1, 2]


def test_postgresql_and_rest_api(normalizer):
    """Verifies PostgreSQL and REST API normalizations."""
    raw = [
        RawWord(id=0, text="Connect", start_sec=0.0, end_sec=0.3),
        RawWord(id=1, text="to", start_sec=0.4, end_sec=0.5),
        RawWord(id=2, text="post", start_sec=0.6, end_sec=0.8),
        RawWord(id=3, text="gres", start_sec=0.9, end_sec=1.2),
        RawWord(id=4, text="via", start_sec=1.3, end_sec=1.4),
        RawWord(id=5, text="our", start_sec=1.5, end_sec=1.6),
        RawWord(id=6, text="rest", start_sec=1.7, end_sec=1.9),
        RawWord(id=7, text="api.", start_sec=2.0, end_sec=2.3),
    ]

    display = normalizer.normalize(raw)
    texts = [d.text for d in display]
    assert "PostgreSQL" in texts
    assert "REST API." in texts


def test_raw_word_preservation(normalizer):
    """Verifies raw recognized words are completely unmodified in the output mapping."""
    raw = [
        RawWord(id=0, text="dock", start_sec=0.0, end_sec=0.3),
        RawWord(id=1, text="er", start_sec=0.4, end_sec=0.7),
        RawWord(id=2, text="container", start_sec=0.8, end_sec=1.2),
    ]

    display = normalizer.normalize(raw)
    assert len(display) == 2
    assert display[0].text == "Docker"
    assert display[1].text == "container"
    # Source mapping correctly points to original raw word IDs
    assert display[0].source_word_ids == [0, 1]
    assert display[1].source_word_ids == [2]
    # Original raw words remain unmutated
    assert raw[0].text == "dock"
    assert raw[1].text == "er"
    assert raw[2].text == "container"
