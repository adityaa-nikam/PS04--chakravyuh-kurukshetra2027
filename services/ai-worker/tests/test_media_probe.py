"""Unit tests for MediaProbeService using synthetic video generation."""

import subprocess
import pytest
from pathlib import Path
from app.config import settings
from app.services.media_probe import MediaProbeService


@pytest.fixture(scope="module")
def sample_video(tmp_path_factory):
    """Generates a small 2-second synthetic MP4 video with audio using FFmpeg."""
    temp_dir = tmp_path_factory.mktemp("media")
    video_path = temp_dir / "sample_probe.mp4"

    cmd = [
        "ffmpeg",
        "-y",
        "-f", "lavfi", "-i", "testsrc=duration=2:size=640x360:rate=30",
        "-f", "lavfi", "-i", "sine=frequency=1000:duration=2",
        "-c:v", "libx264",
        "-c:a", "aac",
        "-pix_fmt", "yuv420p",
        str(video_path)
    ]
    subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    return video_path


def test_media_probe_success(sample_video):
    metadata = MediaProbeService.inspect(sample_video)
    assert metadata.filename == "sample_probe.mp4"
    assert metadata.width == 640
    assert metadata.height == 360
    assert metadata.fps == 30.0
    assert metadata.has_audio is True
    assert metadata.duration_sec >= 1.9  # Approximately 2.0s
    assert metadata.video_codec == "h264"
    assert metadata.audio_codec == "aac"


def test_media_probe_file_not_found():
    with pytest.raises(FileNotFoundError):
        MediaProbeService.inspect("non_existent_video_file_12345.mp4")
