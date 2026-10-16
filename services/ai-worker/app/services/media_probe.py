"""Media inspection service using ffprobe."""

import json
import logging
import subprocess
from pathlib import Path
from typing import Optional

from app.schemas import MediaMetadata

logger = logging.getLogger(__name__)


class NoAudioStreamError(ValueError):
    """Raised when the media file contains no usable audio stream."""
    pass


class MediaCorruptError(RuntimeError):
    """Raised when ffprobe fails to parse or decode media headers."""
    pass


class MediaProbeService:
    """Inspects media files to extract stream information, dimensions, duration, and codecs."""

    @staticmethod
    def inspect(file_path: str | Path, timeout_sec: float = 30.0) -> MediaMetadata:
        """Inspects a video or audio file using ffprobe.
        
        Args:
            file_path: Absolute or relative path to media file (spaces allowed).
            timeout_sec: Maximum seconds to wait for ffprobe.
            
        Returns:
            MediaMetadata schema with resolution, duration, fps, audio presence.
            
        Raises:
            FileNotFoundError: If the target file does not exist.
            MediaCorruptError: If ffprobe fails or the file format is unreadable.
        """
        path = Path(file_path).resolve()
        if not path.exists():
            raise FileNotFoundError(f"Media file does not exist: {path}")

        if not path.is_file():
            raise ValueError(f"Path is not a regular file: {path}")

        cmd = [
            "ffprobe",
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            str(path)
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
            probe_data = json.loads(result.stdout)
        except subprocess.TimeoutExpired as e:
            logger.error("ffprobe timed out on %s after %s seconds", path, timeout_sec)
            raise MediaCorruptError(f"ffprobe timed out inspecting media file: {path.name}") from e
        except subprocess.CalledProcessError as e:
            logger.error("ffprobe failed on %s: %s", path, e.stderr)
            raise MediaCorruptError(
                f"ffprobe failed to inspect media file '{path.name}'. File may be corrupt or an unsupported format: {e.stderr.strip()}"
            ) from e
        except json.JSONDecodeError as e:
            raise MediaCorruptError(f"Failed to parse ffprobe JSON output for '{path.name}': {e}") from e

        streams = probe_data.get("streams", [])
        format_info = probe_data.get("format", {})

        # Parse duration
        duration = float(format_info.get("duration", 0.0))

        # Identify video and audio streams
        video_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
        audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)

        width = 0
        height = 0
        fps = 0.0
        video_codec = None

        if video_stream:
            width = int(video_stream.get("width", 0))
            height = int(video_stream.get("height", 0))
            video_codec = video_stream.get("codec_name")

            # Parse FPS from r_frame_rate e.g. "30/1" or "30000/1001"
            fps_str = video_stream.get("r_frame_rate", "0/1")
            if "/" in fps_str:
                num, den = fps_str.split("/")
                fps = float(num) / float(den) if float(den) != 0 else 0.0
            else:
                try:
                    fps = float(fps_str or 0.0)
                except ValueError:
                    fps = 0.0

            # Fallback duration from stream if format duration is 0
            if duration == 0.0 and "duration" in video_stream:
                try:
                    duration = float(video_stream["duration"])
                except ValueError:
                    pass

        has_audio = audio_stream is not None
        has_video = video_stream is not None
        audio_sample_rate = None
        audio_channels = None
        audio_codec = None

        if audio_stream:
            audio_codec = audio_stream.get("codec_name")
            audio_sample_rate = int(audio_stream.get("sample_rate", 0)) or None
            audio_channels = int(audio_stream.get("channels", 0)) or None
            if duration == 0.0 and "duration" in audio_stream:
                try:
                    duration = float(audio_stream["duration"])
                except ValueError:
                    pass

        return MediaMetadata(
            filename=path.name,
            filepath=str(path),
            duration_sec=round(duration, 3),
            width=width,
            height=height,
            fps=round(fps, 2),
            has_audio=has_audio,
            has_video=has_video,
            audio_sample_rate=audio_sample_rate,
            audio_channels=audio_channels,
            video_codec=video_codec,
            audio_codec=audio_codec
        )

    @classmethod
    def validate_for_transcription(cls, file_path: str | Path) -> MediaMetadata:
        """Inspects media file and ensures that it contains a usable audio stream.
        
        Raises:
            NoAudioStreamError: If file has no audio stream.
            FileNotFoundError: If file does not exist.
            MediaCorruptError: If media cannot be probed.
        """
        metadata = cls.inspect(file_path)
        if not metadata.has_audio:
            raise NoAudioStreamError(
                f"Media file '{metadata.filename}' does not contain an audio stream. Audio is required for transcription."
            )
        return metadata
