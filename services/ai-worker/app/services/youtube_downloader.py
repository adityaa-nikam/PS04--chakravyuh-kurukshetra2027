"""YouTube Downloader Service for Reel Studio AI Worker.

Downloads YouTube videos using yt-dlp with customizable quality presets
(360p, 480p, 720p, 1080p) and reports real-time progress callbacks.
"""

import logging
import re
from pathlib import Path
from typing import Optional, Dict, Any, Callable

import yt_dlp

from app.config import settings

logger = logging.getLogger("reel_studio_api.youtube_downloader")


class YoutubeDownloaderService:
    """Service to safely download YouTube media for AI pipeline ingestion."""

    # Quality formats prioritize MP4 containers with AAC/M4A audio for best FFmpeg compatibility
    QUALITY_FORMAT_MAP = {
        "360p": "bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=360]+bestaudio/best[height<=360][ext=mp4]/best[height<=360]/best",
        "480p": "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=480]+bestaudio/best[height<=480][ext=mp4]/best[height<=480]/best",
        "720p": "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720][ext=mp4]/best[height<=720]/best",
        "1080p": "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080][ext=mp4]/best[height<=1080]/best",
    }

    @staticmethod
    def extract_video_id(url_or_id: str) -> Optional[str]:
        """Extracts 11-char YouTube video ID from various URL patterns or raw ID."""
        cleaned = url_or_id.strip()
        if re.match(r"^[a-zA-Z0-9_-]{11}$", cleaned):
            return cleaned

        patterns = [
            r"(?:v=|\/v\/|\.be\/|\/shorts\/)([a-zA-Z0-9_-]{11})",
            r"(?:embed\/)([a-zA-Z0-9_-]{11})",
            r"(?:live\/)([a-zA-Z0-9_-]{11})",
        ]
        for pattern in patterns:
            match = re.search(pattern, cleaned)
            if match:
                return match.group(1)
        return None

    @staticmethod
    def is_youtube_url(url_or_path: str) -> bool:
        """Determines if the given input is a YouTube URL or video ID."""
        val = url_or_path.strip().lower()
        if "youtube.com" in val or "youtu.be" in val:
            return True
        if re.match(r"^[a-zA-Z0-9_-]{11}$", url_or_path.strip()):
            return True
        return False

    @classmethod
    def get_video_info(cls, url_or_id: str) -> Dict[str, Any]:
        """Fetches video metadata (title, duration, thumbnail) without downloading."""
        target_url = url_or_id if url_or_id.startswith("http") else f"https://www.youtube.com/watch?v={url_or_id}"
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(target_url, download=False)
            return {
                "id": info.get("id"),
                "title": info.get("title", "YouTube Video"),
                "duration": info.get("duration", 0),
                "thumbnail": info.get("thumbnail"),
                "uploader": info.get("uploader"),
                "view_count": info.get("view_count"),
            }

    @classmethod
    def download_video(
        cls,
        url_or_id: str,
        output_dir: Optional[Path] = None,
        quality: str = "360p",
        progress_callback: Optional[Callable[[float, str], None]] = None,
        force_redownload: bool = False,
    ) -> Dict[str, Any]:
        """Downloads the YouTube video with requested quality preset.

        Args:
            url_or_id: YouTube URL or 11-char ID.
            output_dir: Directory where raw video is stored (defaults to settings.RAW_DIR).
            quality: '360p', '480p', '720p', '1080p'. Defaults to '360p'.
            progress_callback: Optional callable(percent_float, status_str).
            force_redownload: If False, reuses existing non-empty file on disk.

        Returns:
            Dict containing filepath, id, title, duration, and metadata.
        """
        dest_dir = Path(output_dir or settings.RAW_DIR).resolve()
        dest_dir.mkdir(parents=True, exist_ok=True)

        video_id = cls.extract_video_id(url_or_id)
        target_url = url_or_id if url_or_id.startswith("http") else f"https://www.youtube.com/watch?v={url_or_id}"
        norm_quality = quality.lower().strip()
        if norm_quality not in cls.QUALITY_FORMAT_MAP:
            norm_quality = "360p"

        format_spec = cls.QUALITY_FORMAT_MAP[norm_quality]

        # Check if already downloaded
        if video_id and not force_redownload:
            candidate_file = dest_dir / f"yt_{video_id}_{norm_quality}.mp4"
            fallback_file = dest_dir / f"yt_{video_id}.mp4"
            for f in [candidate_file, fallback_file]:
                if f.exists() and f.stat().st_size > 1024 * 100:  # > 100KB
                    logger.info(f"Reusing existing downloaded YouTube video: {f}")
                    if progress_callback:
                        progress_callback(100.0, f"Found cached YouTube download: {f.name}")
                    return {
                        "filepath": f,
                        "id": video_id,
                        "title": f.stem,
                        "quality": norm_quality,
                        "cached": True,
                    }

        out_template = str(dest_dir / f"yt_%(id)s_{norm_quality}.%(ext)s")

        def _yt_hook(d: Dict[str, Any]) -> None:
            if not progress_callback:
                return
            status = d.get("status")
            if status == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                downloaded = d.get("downloaded_bytes") or 0
                pct = min(100.0, max(0.0, (downloaded / total) * 100.0)) if total > 0 else 0.0
                speed = d.get("_speed_str", "").strip()
                eta = d.get("_eta_str", "").strip()
                details = []
                if speed:
                    details.append(speed)
                if eta:
                    details.append(f"ETA {eta}")
                info_suffix = f" ({', '.join(details)})" if details else ""
                progress_callback(
                    pct,
                    f"Downloading YouTube video ({norm_quality}): {pct:.1f}%{info_suffix}"
                )
            elif status == "finished":
                progress_callback(99.0, f"Download complete ({norm_quality}). Merging streams with FFmpeg...")

        ydl_opts = {
            "format": format_spec,
            "outtmpl": out_template,
            "merge_output_format": "mp4",
            "progress_hooks": [_yt_hook],
            "quiet": True,
            "no_warnings": True,
            "overwrites": force_redownload,
        }

        logger.info(f"Starting YouTube download: {target_url} [quality={norm_quality}]")
        if progress_callback:
            progress_callback(5.0, f"Connecting to YouTube stream ({norm_quality})...")

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(target_url, download=True)
            resolved_id = info.get("id") or video_id or "youtube_video"
            downloaded_file = dest_dir / f"yt_{resolved_id}_{norm_quality}.mp4"

            # Check if file has another extension and was merged
            if not downloaded_file.exists():
                for alt in dest_dir.glob(f"yt_{resolved_id}*.mp4"):
                    if alt.is_file() and alt.stat().st_size > 0:
                        downloaded_file = alt
                        break

            if not downloaded_file.exists() or downloaded_file.stat().st_size == 0:
                raise FileNotFoundError(f"Failed to find downloaded video at: {downloaded_file}")

            logger.info(f"YouTube download successful: {downloaded_file} ({downloaded_file.stat().st_size / (1024*1024):.1f} MB)")
            if progress_callback:
                progress_callback(100.0, f"YouTube video downloaded ({norm_quality}, {downloaded_file.stat().st_size / (1024*1024):.1f} MB).")

            return {
                "filepath": downloaded_file,
                "id": resolved_id,
                "title": info.get("title", "YouTube Video"),
                "duration": info.get("duration", 0),
                "thumbnail": info.get("thumbnail"),
                "uploader": info.get("uploader"),
                "quality": norm_quality,
                "cached": False,
            }
