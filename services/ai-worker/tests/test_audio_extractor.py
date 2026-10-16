"""Unit tests for AudioExtractorService and MediaProbeService."""

import subprocess
import pytest
from pathlib import Path

from app.services.audio_extractor import AudioExtractorService, AudioExtractionError
from app.services.media_probe import MediaProbeService, NoAudioStreamError, MediaCorruptError


@pytest.fixture(scope="module")
def valid_video_with_audio(tmp_path_factory):
    """Generates a small 2-second synthetic MP4 video with a valid audio track."""
    temp_dir = tmp_path_factory.mktemp("media_assets")
    video_path = temp_dir / "valid_lecture_clip.mp4"

    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=25",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
        "-c:v", "libx264",
        "-c:a", "aac",
        "-pix_fmt", "yuv420p",
        str(video_path)
    ]
    subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    return video_path


@pytest.fixture(scope="module")
def video_without_audio(tmp_path_factory):
    """Generates a synthetic MP4 video with video stream only (no audio stream)."""
    temp_dir = tmp_path_factory.mktemp("media_assets_no_audio")
    video_path = temp_dir / "video_only_clip.mp4"

    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=25",
        "-c:v", "libx264",
        "-an",  # Explicitly disable audio
        "-pix_fmt", "yuv420p",
        str(video_path)
    ]
    subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    return video_path


@pytest.fixture(scope="module")
def video_with_spaces_in_path(tmp_path_factory):
    """Generates a synthetic video in a directory with spaces in the filename and path."""
    temp_dir = tmp_path_factory.mktemp("media folder with spaces")
    video_path = temp_dir / "lecture sample with spaces.mp4"

    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=25",
        "-f", "lavfi", "-i", "sine=frequency=880:duration=2",
        "-c:v", "libx264",
        "-c:a", "aac",
        "-pix_fmt", "yuv420p",
        str(video_path)
    ]
    subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    return video_path


def test_audio_extraction_valid(valid_video_with_audio, tmp_path):
    """Verifies that extraction produces 16kHz mono 16-bit PCM WAV."""
    output_wav = tmp_path / "custom_output.wav"
    result = AudioExtractorService.extract_audio(
        video_path=valid_video_with_audio,
        output_wav_path=output_wav
    )

    assert result.exists()
    assert result.stat().st_size > 1000

    probe = MediaProbeService.inspect(result)
    assert probe.has_audio is True
    assert probe.audio_sample_rate == 16000
    assert probe.audio_channels == 1
    assert probe.audio_codec == "pcm_s16le"


def test_video_without_audio_rejected(video_without_audio):
    """Verifies that video with no audio stream is rejected with NoAudioStreamError."""
    with pytest.raises(NoAudioStreamError) as exc_info:
        AudioExtractorService.extract_audio(video_without_audio)
    assert "does not contain an audio stream" in str(exc_info.value)


def test_missing_input_file_raises():
    """Verifies that non-existent input raises FileNotFoundError."""
    with pytest.raises(FileNotFoundError):
        AudioExtractorService.extract_audio("missing_video_12345.mp4")


def test_path_with_spaces(video_with_spaces_in_path, tmp_path):
    """Verifies Windows path with spaces is safely handled."""
    out_dir = tmp_path / "output directory with spaces"
    out_wav = out_dir / "extracted audio with spaces.wav"

    result = AudioExtractorService.extract_audio(
        video_path=video_with_spaces_in_path,
        output_wav_path=out_wav
    )
    assert result.exists()
    assert "spaces" in str(result)
    assert result.stat().st_size > 1000


def test_caching_provenance_skips_ffmpeg(valid_video_with_audio, tmp_path):
    """Verifies existing up-to-date audio extraction is reused without rerunning FFmpeg."""
    out_wav = tmp_path / "cached_clip.wav"
    first = AudioExtractorService.extract_audio(valid_video_with_audio, out_wav)
    first_mtime = first.stat().st_mtime_ns

    # Call again with force_reextract=False
    second = AudioExtractorService.extract_audio(valid_video_with_audio, out_wav, force_reextract=False)
    second_mtime = second.stat().st_mtime_ns

    assert first_mtime == second_mtime


def test_corrupt_file_raises_mediacorrupt(tmp_path):
    """Verifies corrupt non-media file raises MediaCorruptError."""
    corrupt_file = tmp_path / "corrupt_video.mp4"
    corrupt_file.write_bytes(b"This is completely corrupt random junk bytes not a video file.")

    with pytest.raises(MediaCorruptError):
        MediaProbeService.inspect(corrupt_file)
