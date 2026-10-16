"""Audio extraction service using FFmpeg."""

import logging
import subprocess
from pathlib import Path
from typing import Optional

from app.config import settings
from app.services.media_probe import MediaProbeService, NoAudioStreamError

logger = logging.getLogger(__name__)


class AudioExtractionError(RuntimeError):
    """Raised when FFmpeg fails to extract audio from video."""
    pass


class AudioExtractorService:
    """Extracts 16kHz mono 16-bit PCM WAV audio from input video for ASR processing."""

    @staticmethod
    def extract_audio(
        video_path: str | Path,
        output_wav_path: Optional[str | Path] = None,
        force_reextract: bool = False,
        timeout_sec: float = 300.0
    ) -> Path:
        """Extracts audio from video file to 16kHz mono WAV format.
        
        Args:
            video_path: Path to the source MP4 or media file (supports spaces).
            output_wav_path: Optional custom destination path. If not provided,
                             saves to `storage/audio/<video_stem>.wav`.
            force_reextract: If False, reuses existing cached WAV if valid and up-to-date.
            timeout_sec: Maximum timeout for FFmpeg extraction.
            
        Returns:
            Path to the extracted .wav file.
            
        Raises:
            FileNotFoundError: If video_path does not exist.
            NoAudioStreamError: If input media has no audio stream.
            AudioExtractionError: If FFmpeg fails or output is invalid.
        """
        source_path = Path(video_path).resolve()
        if not source_path.exists():
            raise FileNotFoundError(f"Source video file not found: {source_path}")

        # Validate that the file actually contains audio before launching FFmpeg
        probe_meta = MediaProbeService.validate_for_transcription(source_path)

        if output_wav_path is None:
            target_path = settings.AUDIO_DIR / f"{source_path.stem}.wav"
        else:
            target_path = Path(output_wav_path).resolve()

        target_path.parent.mkdir(parents=True, exist_ok=True)

        # Check provenance: if target exists, is non-empty (>1024 bytes), and newer than source
        if target_path.exists() and not force_reextract:
            target_size = target_path.stat().st_size
            source_mtime = source_path.stat().st_mtime
            target_mtime = target_path.stat().st_mtime

            if target_size > 1024 and target_mtime >= source_mtime:
                logger.info(
                    "Cached audio found at '%s' (size=%d bytes, up-to-date). Skipping extraction.",
                    target_path.name,
                    target_size
                )
                return target_path

        logger.info("Extracting 16kHz mono WAV: '%s' -> '%s'", source_path.name, target_path.name)

        cmd = [
            "ffmpeg",
            "-y",  # Overwrite target
            "-i", str(source_path),
            "-vn",  # Exclude video streams
            "-acodec", "pcm_s16le",  # 16-bit PCM
            "-ar", "16000",  # 16,000 Hz sample rate
            "-ac", "1",  # Mono channel
            str(target_path)
        ]

        try:
            result = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                check=True,
                timeout=timeout_sec
            )
            logger.info("Audio extraction succeeded for '%s'", source_path.name)
        except subprocess.TimeoutExpired as e:
            logger.error("FFmpeg audio extraction timed out after %s sec for '%s'", timeout_sec, source_path)
            if target_path.exists():
                target_path.unlink()
            raise AudioExtractionError(
                f"Audio extraction timed out after {timeout_sec} seconds for '{source_path.name}'"
            ) from e
        except subprocess.CalledProcessError as e:
            logger.error("FFmpeg audio extraction failed: %s", e.stderr)
            if target_path.exists():
                try:
                    target_path.unlink()
                except OSError:
                    pass
            raise AudioExtractionError(f"FFmpeg audio extraction failed: {e.stderr.strip()}") from e

        # Validate extracted WAV
        if not target_path.exists() or target_path.stat().st_size <= 44:  # 44 bytes is minimum WAV header
            raise AudioExtractionError(
                f"Extracted audio file is missing or contains an empty/corrupted header: {target_path}"
            )

        return target_path
