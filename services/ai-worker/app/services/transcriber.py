"""Speech-to-Text Transcription Service with Word-Level Timestamps.

Produces validated word-level transcripts using faster-whisper on CPU with INT8 quantization,
atomic file writes, and separate raw vs display word streams.
"""

import json
import logging
import os
import tempfile
from pathlib import Path
from typing import List, Optional, Tuple, Dict, Any

from app.config import settings
from app.schemas import (
    ValidatedTranscript,
    SourceMetadata,
    TranscriptionMetadata,
    RawWord,
    DisplayWord,
    FullTranscript,
    TranscriptWord,
    TranscriptSegment,
)
from app.services.term_normalizer import TermNormalizerService
from app.services.media_probe import MediaProbeService

logger = logging.getLogger(__name__)

# Process-level model cache to avoid re-allocating model weights
_MODEL_CACHE: Dict[Tuple[str, str, str], Any] = {}


def get_whisper_model(
    model_size: str = "small",
    device: str = "cpu",
    compute_type: str = "int8",
    cpu_threads: int = 8
):
    """Retrieves or initializes a cached faster-whisper model instance."""
    key = (model_size, device, compute_type)
    if key in _MODEL_CACHE:
        return _MODEL_CACHE[key]

    try:
        from faster_whisper import WhisperModel
        logger.info(
            "Loading faster-whisper model '%s' (device=%s, compute_type=%s, threads=%d)",
            model_size,
            device,
            compute_type,
            cpu_threads
        )
        try:
            model = WhisperModel(
                model_size_or_path=model_size,
                device=device,
                compute_type=compute_type,
                cpu_threads=cpu_threads
            )
        except Exception as e:
            if compute_type != "float32":
                logger.warning("Failed loading with compute_type='%s' (%s). Retrying with 'float32'...", compute_type, e)
                model = WhisperModel(
                    model_size_or_path=model_size,
                    device=device,
                    compute_type="float32",
                    cpu_threads=cpu_threads
                )
            else:
                raise e

        _MODEL_CACHE[key] = model
        return model
    except ImportError as e:
        logger.error("faster-whisper is not installed: %s", e)
        raise RuntimeError("faster-whisper package is required for transcription.") from e


def load_audio_waveform(wav_path: Path) -> "np.ndarray":
    """Loads 16kHz mono 16-bit PCM WAV into a normalized float32 numpy array.
    
    Bypasses PyAV av.open() bugs in PyAV >= 14 by reading standard PCM WAV
    directly using Python's built-in wave module.
    """
    import wave
    import numpy as np

    with wave.open(str(wav_path), "rb") as wf:
        n_frames = wf.getnframes()
        data = wf.readframes(n_frames)
        sampwidth = wf.getsampwidth()

    if sampwidth == 2:
        audio = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
    elif sampwidth == 4:
        audio = np.frombuffer(data, dtype=np.int32).astype(np.float32) / 2147483648.0
    else:
        audio = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
    return audio


class TranscriberService:
    """Orchestrates word-level speech recognition and validated transcript generation."""

    def __init__(
        self,
        model_size: Optional[str] = None,
        device: Optional[str] = None,
        compute_type: Optional[str] = None,
        language: Optional[str] = None,
        term_normalizer: Optional[TermNormalizerService] = None
    ):
        self.model_size = model_size or settings.WHISPER_MODEL_SIZE
        self.device = device or settings.WHISPER_DEVICE
        self.compute_type = compute_type or settings.WHISPER_COMPUTE_TYPE
        self.language = language
        self.normalizer = term_normalizer or TermNormalizerService()

    def transcribe(
        self,
        audio_path: str | Path,
        source_media_path: Optional[str | Path] = None,
        cache_transcript: bool = True,
        force_retranscribe: bool = False,
        limit_sec: Optional[float] = None
    ) -> ValidatedTranscript:
        """Transcribes a 16kHz WAV file into a ValidatedTranscript.
        
        Args:
            audio_path: Path to the 16kHz mono WAV audio file.
            source_media_path: Optional original MP4 path for metadata attribution.
            cache_transcript: If True, writes validated transcript to storage/transcripts/.
            force_retranscribe: If False, reuses existing cached JSON transcript if valid.
            limit_sec: Optional duration cap in seconds for short smoke tests.
            
        Returns:
            ValidatedTranscript conforming strictly to the Master Contract.
        """
        wav_path = Path(audio_path).resolve()
        if not wav_path.exists():
            raise FileNotFoundError(f"Audio file not found: {wav_path}")

        cache_file = settings.TRANSCRIPTS_DIR / f"{wav_path.stem}.json"

        # Check existing valid cache (if not forcing re-transcription)
        if cache_file.exists() and not force_retranscribe and limit_sec is None:
            try:
                with open(cache_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                cached_transcript = ValidatedTranscript(**data)
                # Verify cache provenance against audio mtime
                if cache_file.stat().st_mtime >= wav_path.stat().st_mtime:
                    logger.info("Reusing up-to-date cached transcript: %s", cache_file.name)
                    return cached_transcript
            except Exception as e:
                logger.warning("Cache invalid or outdated (%s). Transcribing anew...", e)

        # Inspect source media or audio for duration
        ref_path = Path(source_media_path).resolve() if source_media_path else wav_path
        media_meta = MediaProbeService.inspect(ref_path)

        model = get_whisper_model(
            model_size=self.model_size,
            device=self.device,
            compute_type=self.compute_type,
            cpu_threads=settings.WHISPER_CPU_THREADS
        )

        initial_prompt = (
            "Technical lecture explaining programming concepts, software development, "
            "functions, APIs, Docker, Kubernetes, React, TypeScript, and database configuration."
        )

        logger.info(
            "Transcribing '%s' with model='%s' (limit_sec=%s)...",
            wav_path.name,
            self.model_size,
            limit_sec
        )

        # Load waveform safely via wave module
        audio_array = load_audio_waveform(wav_path)

        # Execute transcription with word-level timestamps and VAD
        segments, info = model.transcribe(
            audio_array,
            beam_size=settings.WHISPER_BEAM_SIZE,
            word_timestamps=True,
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=500),
            language=self.language,
            initial_prompt=initial_prompt
        )

        detected_lang = getattr(info, "language", self.language or "en")

        raw_words: List[RawWord] = []
        raw_word_id = 0

        for segment in segments:
            if limit_sec is not None and segment.start >= limit_sec:
                break

            if segment.words:
                for w in segment.words:
                    if limit_sec is not None and w.start >= limit_sec:
                        break

                    clean_text = w.word.strip()
                    if clean_text:
                        start_t = max(0.0, float(w.start))
                        end_t = max(start_t, float(w.end))
                        # Use genuine probability score if available from model
                        prob = float(w.probability) if hasattr(w, "probability") and w.probability is not None else None
                        if prob is not None:
                            prob = round(prob, 3)

                        raw_words.append(
                            RawWord(
                                id=raw_word_id,
                                text=clean_text,
                                start_sec=round(start_t, 3),
                                end_sec=round(end_t, 3),
                                confidence=prob
                            )
                        )
                        raw_word_id += 1

        # Apply technical terminology normalization
        display_words = self.normalizer.normalize(raw_words)

        duration = media_meta.duration_sec
        if limit_sec and duration > limit_sec:
            duration = limit_sec
        elif not duration and raw_words:
            duration = raw_words[-1].end_sec

        validated = ValidatedTranscript(
            schema_version="1.0",
            source=SourceMetadata(
                filename=ref_path.name,
                duration_sec=round(duration, 3),
                audio_sample_rate=media_meta.audio_sample_rate or 16000,
                video_width=media_meta.width if media_meta.has_video else None,
                video_height=media_meta.height if media_meta.has_video else None,
                fps=media_meta.fps if media_meta.has_video else None
            ),
            transcription=TranscriptionMetadata(
                model=self.model_size,
                detected_language=detected_lang,
                timestamp_origin="original_source_start",
                compute_type=self.compute_type,
                device=self.device
            ),
            raw_words=raw_words,
            display_words=display_words
        )

        # Atomic write to cache file using a temporary file in the same directory
        if cache_transcript:
            self._atomic_write_json(cache_file, validated)

        return validated

    @staticmethod
    def _atomic_write_json(target_path: Path, transcript: ValidatedTranscript) -> None:
        """Writes JSON atomically to target path to prevent corrupt files on interruption."""
        target_path.parent.mkdir(parents=True, exist_ok=True)
        temp_fd, temp_path = tempfile.mkstemp(
            dir=target_path.parent,
            prefix=f"{target_path.stem}_",
            suffix=".tmp"
        )
        try:
            with os.fdopen(temp_fd, "w", encoding="utf-8") as f:
                f.write(transcript.model_dump_json(indent=2))
            os.replace(temp_path, target_path)
            logger.info("Atomically saved validated transcript to: %s", target_path.name)
        except Exception as e:
            if os.path.exists(temp_path):
                try:
                    os.unlink(temp_path)
                except OSError:
                    pass
            logger.error("Failed to write transcript atomically: %s", e)
            raise

    # Legacy FullTranscript compatibility adapter
    def transcribe_legacy(self, audio_path: str | Path, **kwargs) -> FullTranscript:
        validated = self.transcribe(audio_path, **kwargs)
        legacy_words: List[TranscriptWord] = []
        for d in validated.display_words:
            is_tech = d.correction is not None and d.correction.applied
            term_id = d.correction.term_id if is_tech else None
            raw_phrase = " ".join(validated.raw_words[wid].text for wid in d.source_word_ids)
            legacy_words.append(
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
        return FullTranscript(
            source_filename=validated.source.filename,
            duration_sec=validated.source.duration_sec,
            language=validated.transcription.detected_language,
            segments=[],
            words=legacy_words
        )
