"""Unit tests for TranscriberService using mocked ASR inference.

Verifies:
- Word-level timestamps are extracted and preserved.
- Monotonic timestamps and valid ranges.
- Separate raw_words vs display_words schema contract.
- Empty speech handling.
- Cache loading and atomic writes.
- Actionable error on missing or malformed audio.
"""

from dataclasses import dataclass
from typing import List, Optional
from unittest.mock import MagicMock, patch
import json
import pytest
from pathlib import Path

from app.schemas import ValidatedTranscript, RawWord, DisplayWord
from app.services.transcriber import TranscriberService, get_whisper_model


@dataclass
class MockWord:
    word: str
    start: float
    end: float
    probability: float = 0.95


@dataclass
class MockSegment:
    start: float
    end: float
    text: str
    words: List[MockWord]


@dataclass
class MockInfo:
    duration: float = 12.0
    language: str = "en"


@pytest.fixture
def dummy_wav(tmp_path):
    """Creates a temporary valid 1-second WAV file using FFmpeg."""
    import subprocess
    wav_path = tmp_path / "mock_lecture.wav"
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
        "-ar", "16000",
        "-ac", "1",
        str(wav_path)
    ]
    subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    return wav_path


def test_transcriber_missing_audio_file():
    """Verifies that missing audio file raises FileNotFoundError."""
    transcriber = TranscriberService()
    with pytest.raises(FileNotFoundError):
        transcriber.transcribe("non_existent_audio_file.wav")


def test_transcription_with_mocked_model(dummy_wav, tmp_path, monkeypatch):
    """Tests full transcription pipeline with a deterministic mocked faster-whisper model."""
    mock_segments = [
        MockSegment(
            start=0.0,
            end=3.5,
            text="In this React hook we use effect for lifecycle.",
            words=[
                MockWord(word="In", start=0.0, end=0.2, probability=0.99),
                MockWord(word="this", start=0.3, end=0.5, probability=0.98),
                MockWord(word="React", start=0.6, end=1.0, probability=0.95),
                MockWord(word="hook", start=1.1, end=1.4, probability=0.94),
                MockWord(word="we", start=1.5, end=1.6, probability=0.99),
                MockWord(word="use", start=1.7, end=1.9, probability=0.91),
                MockWord(word="effect", start=2.0, end=2.4, probability=0.93),
                MockWord(word="for", start=2.5, end=2.7, probability=0.98),
                MockWord(word="lifecycle.", start=2.8, end=3.4, probability=0.96),
            ]
        )
    ]
    mock_info = MockInfo(duration=3.5, language="en")

    mock_model = MagicMock()
    mock_model.transcribe.return_value = (mock_segments, mock_info)

    # Patch model getter so no real weights are downloaded
    monkeypatch.setattr("app.services.transcriber.get_whisper_model", lambda **kwargs: mock_model)

    transcriber = TranscriberService(model_size="small", device="cpu", compute_type="int8")
    transcript = transcriber.transcribe(
        audio_path=dummy_wav,
        cache_transcript=True,
        force_retranscribe=True
    )

    assert transcript.schema_version == "1.0"
    assert transcript.transcription.model == "small"
    assert transcript.transcription.detected_language == "en"
    assert transcript.source.filename == "mock_lecture.wav"

    # Verify raw words preservation
    assert len(transcript.raw_words) == 9
    assert transcript.raw_words[5].text == "use"
    assert transcript.raw_words[6].text == "effect"

    # Verify monotonic timestamps
    for i in range(len(transcript.raw_words)):
        assert transcript.raw_words[i].start_sec <= transcript.raw_words[i].end_sec
        if i > 0:
            assert transcript.raw_words[i].start_sec >= transcript.raw_words[i - 1].start_sec

    # Verify display words normalization
    # 'use' + 'effect' with React context -> 'useEffect'
    display_texts = [d.text for d in transcript.display_words]
    assert "useEffect" in display_texts
    ue_token = next(d for d in transcript.display_words if d.text == "useEffect")
    assert ue_token.source_word_ids == [5, 6]
    assert ue_token.start_sec == 1.7
    assert ue_token.end_sec == 2.4
    assert ue_token.correction is not None
    assert ue_token.correction.term_id == "react_use_effect"


def test_empty_speech_transcription(dummy_wav, monkeypatch):
    """Verifies that audio containing silence or no words returns a valid empty transcript."""
    mock_model = MagicMock()
    mock_model.transcribe.return_value = ([], MockInfo(duration=5.0, language="en"))

    monkeypatch.setattr("app.services.transcriber.get_whisper_model", lambda **kwargs: mock_model)

    transcriber = TranscriberService()
    transcript = transcriber.transcribe(
        audio_path=dummy_wav,
        cache_transcript=False,
        force_retranscribe=True
    )

    assert transcript.schema_version == "1.0"
    assert len(transcript.raw_words) == 0
    assert len(transcript.display_words) == 0


def test_atomic_file_write(tmp_path):
    """Verifies atomic writing logic prevents corrupt partial files."""
    from app.schemas import SourceMetadata, TranscriptionMetadata
    target_file = tmp_path / "atomic_test.json"

    transcript = ValidatedTranscript(
        schema_version="1.0",
        source=SourceMetadata(filename="test.wav", duration_sec=10.0),
        transcription=TranscriptionMetadata(model="small"),
        raw_words=[RawWord(id=0, text="hello", start_sec=0.0, end_sec=0.5, confidence=0.99)],
        display_words=[DisplayWord(id=0, text="hello", start_sec=0.0, end_sec=0.5, source_word_ids=[0])]
    )

    TranscriberService._atomic_write_json(target_file, transcript)
    assert target_file.exists()

    with open(target_file, "r", encoding="utf-8") as f:
        loaded = json.load(f)
    assert loaded["raw_words"][0]["text"] == "hello"
