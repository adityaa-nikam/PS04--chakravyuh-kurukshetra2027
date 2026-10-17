"""Centralized Configuration and Path Management for AI Worker."""

import os
from pathlib import Path
from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


def find_workspace_root() -> Path:
    """Find the workspace root directory by looking for characteristic markers."""
    current = Path(__file__).resolve().parent
    for parent in [current] + list(current.parents):
        if (parent / ".git").exists() and (parent / "next-app").exists():
            return parent
    for parent in [current] + list(current.parents):
        if (parent / "next-app").exists():
            return parent
    return Path(os.getcwd()).resolve()


WORKSPACE_ROOT = find_workspace_root()


class Settings(BaseSettings):
    # Service Network Settings
    HOST: str = "127.0.0.1"
    PORT: int = 8000
    ENVIRONMENT: str = "development"

    # Workspace & Storage Paths
    ROOT_DIR: Path = WORKSPACE_ROOT
    STORAGE_DIR: Path = WORKSPACE_ROOT / "storage"
    RAW_DIR: Path = WORKSPACE_ROOT / "storage" / "raw"
    AUDIO_DIR: Path = WORKSPACE_ROOT / "storage" / "audio"
    TRANSCRIPTS_DIR: Path = WORKSPACE_ROOT / "storage" / "transcripts"
    HIGHLIGHTS_DIR: Path = WORKSPACE_ROOT / "storage" / "highlights"
    FRAMES_DIR: Path = WORKSPACE_ROOT / "storage" / "frames"
    CROP_PLANS_DIR: Path = WORKSPACE_ROOT / "storage" / "crop_plans"
    OVERLAYS_DIR: Path = WORKSPACE_ROOT / "storage" / "overlays"
    RENDERED_DIR: Path = WORKSPACE_ROOT / "storage" / "rendered"
    SUBTITLES_DIR: Path = WORKSPACE_ROOT / "storage" / "subtitles"
    JOBS_DIR: Path = WORKSPACE_ROOT / "storage" / "jobs"
    TEST_SAMPLES_DIR: Path = WORKSPACE_ROOT / "storage" / "test_samples"

    # Brand Profiles Directory (Phase 7)
    BRANDS_DIR: Path = Path(__file__).resolve().parent.parent / "config" / "brands"

    # Vocabulary Path (relative to ai-worker package root)
    VOCABULARY_FILE: Path = (
        Path(__file__).resolve().parent.parent / "vocabulary" / "technical_terms.json"
    )

    # Whisper Settings (CPU-optimized)
    WHISPER_MODEL_SIZE: str = "base.en"
    WHISPER_DEVICE: str = "cpu"
    WHISPER_COMPUTE_TYPE: str = "int8"
    WHISPER_BEAM_SIZE: int = 5
    WHISPER_CPU_THREADS: int = 8

    # Highlight Selection Constraints
    HIGHLIGHT_MIN_DURATION_SEC: float = 30.0
    HIGHLIGHT_MAX_DURATION_SEC: float = 60.0
    HIGHLIGHT_TARGET_DURATION_SEC: float = 45.0
    MIN_SILENCE_PAUSE_SEC: float = 0.30

    # Framing / Computer Vision Settings
    CV_SAMPLE_FPS: float = 4.0
    CV_TARGET_ASPECT_RATIO: float = 9.0 / 16.0  # 0.5625
    CV_DEADBAND_THRESHOLD: float = 0.03
    CV_SMOOTHING_ALPHA: float = 0.15

    # OpenRouter Decision & LLM Integration
    OPENROUTER_API_KEY: Optional[str] = None
    DECISION_MODEL: str = "inception/mercury-decide"
    FREE_LLM_MODEL: str = "nvidia/nemotron-3-super-120b-a12b:free"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()

if not settings.OPENROUTER_API_KEY:
    next_env = WORKSPACE_ROOT / "next-app" / ".env.local"
    if next_env.exists():
        try:
            with open(next_env, "r", encoding="utf-8") as f:
                for line in f:
                    if line.startswith("OPENROUTER_API_KEY="):
                        settings.OPENROUTER_API_KEY = line.split("=", 1)[1].strip().strip('"').strip("'")
                        break
        except Exception:
            pass

# Ensure all runtime storage directories exist
for path in [
    settings.STORAGE_DIR,
    settings.RAW_DIR,
    settings.AUDIO_DIR,
    settings.TRANSCRIPTS_DIR,
    settings.HIGHLIGHTS_DIR,
    settings.FRAMES_DIR,
    settings.CROP_PLANS_DIR,
    settings.OVERLAYS_DIR,
    settings.RENDERED_DIR,
    settings.SUBTITLES_DIR,
    settings.JOBS_DIR,
    settings.TEST_SAMPLES_DIR,
    settings.BRANDS_DIR,
    settings.VOCABULARY_FILE.parent,
]:
    path.mkdir(parents=True, exist_ok=True)
