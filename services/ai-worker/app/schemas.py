"""Data contracts and Pydantic schemas for the Reel Studio AI Worker pipeline."""

import math
from enum import Enum
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, model_validator


# ---------------------------------------------------------------------------
# Media Inspection Schemas
# ---------------------------------------------------------------------------

class VideoResolution(BaseModel):
    width: int
    height: int


class MediaMetadata(BaseModel):
    filename: str
    filepath: str
    duration_sec: float
    width: int
    height: int
    fps: float
    has_audio: bool
    has_video: bool = True
    audio_sample_rate: Optional[int] = None
    audio_channels: Optional[int] = None
    video_codec: Optional[str] = None
    audio_codec: Optional[str] = None


# ---------------------------------------------------------------------------
# Phase 2: Speech-to-Text & Validated Transcript JSON Contract
# ---------------------------------------------------------------------------

class SourceMetadata(BaseModel):
    filename: str
    duration_sec: float
    audio_sample_rate: int = 16000
    video_width: Optional[int] = None
    video_height: Optional[int] = None
    fps: Optional[float] = None


class TranscriptionMetadata(BaseModel):
    model: str = "small"
    detected_language: str = "en"
    timestamp_origin: str = "original_source_start"
    compute_type: Optional[str] = "int8"
    device: Optional[str] = "cpu"


class RawWord(BaseModel):
    """Raw speech recognition word exactly as returned by Whisper."""
    id: int
    text: str
    start_sec: float
    end_sec: float
    confidence: Optional[float] = None  # None if not reliably provided by ASR model

    @model_validator(mode="after")
    def validate_timestamps(self) -> "RawWord":
        if math.isnan(self.start_sec) or math.isnan(self.end_sec):
            raise ValueError(f"Word #{self.id}: timestamps cannot be NaN")
        if math.isinf(self.start_sec) or math.isinf(self.end_sec):
            raise ValueError(f"Word #{self.id}: timestamps cannot be infinite")
        if self.start_sec < 0:
            raise ValueError(f"Word #{self.id}: start_sec cannot be negative ({self.start_sec})")
        if self.end_sec < self.start_sec:
            raise ValueError(
                f"Word #{self.id}: end_sec ({self.end_sec}) cannot be earlier than start_sec ({self.start_sec})"
            )
        return self


class CorrectionMetadata(BaseModel):
    """Provenance and audit trail for technical term corrections."""
    term_id: str
    matched_alias: str
    applied: bool = True
    requires_review: bool = False
    reason: Optional[str] = None


class DisplayWord(BaseModel):
    """Word token for display/captions with technically normalized spelling and source mapping."""
    id: int
    text: str
    start_sec: float
    end_sec: float
    source_word_ids: List[int] = Field(default_factory=list)
    confidence: Optional[float] = None
    correction: Optional[CorrectionMetadata] = None

    @model_validator(mode="after")
    def validate_timestamps(self) -> "DisplayWord":
        if math.isnan(self.start_sec) or math.isnan(self.end_sec):
            raise ValueError(f"Word #{self.id}: timestamps cannot be NaN")
        if math.isinf(self.start_sec) or math.isinf(self.end_sec):
            raise ValueError(f"Word #{self.id}: timestamps cannot be infinite")
        if self.start_sec < 0:
            raise ValueError(f"Word #{self.id}: start_sec cannot be negative ({self.start_sec})")
        if self.end_sec < self.start_sec:
            raise ValueError(
                f"Word #{self.id}: end_sec ({self.end_sec}) cannot be earlier than start_sec ({self.start_sec})"
            )
        return self


class TimestampDiagnostics(BaseModel):
    """Diagnostic report distinguishing non-fatal timestamp anomalies from fatal structural errors."""
    total_words: int = 0
    valid_words_count: int = 0
    zero_duration_count: int = 0
    zero_duration_word_ids: List[int] = Field(default_factory=list)
    fatal_errors: List[str] = Field(default_factory=list)

    @property
    def is_structurally_valid(self) -> bool:
        """Returns True if there are zero fatal errors (zero-duration words are non-fatal)."""
        return len(self.fatal_errors) == 0

    @property
    def has_zero_duration_anomalies(self) -> bool:
        """Returns True if any instantaneous/point timestamps (start == end) were detected."""
        return self.zero_duration_count > 0


class ValidatedTranscript(BaseModel):
    """Master Transcript Contract for Phase 2."""
    schema_version: str = "1.0"
    source: SourceMetadata
    transcription: TranscriptionMetadata
    raw_words: List[RawWord] = Field(default_factory=list)
    display_words: List[DisplayWord] = Field(default_factory=list)

    def diagnose_timestamps(self) -> TimestampDiagnostics:
        """Audits transcript timestamps, distinguishing zero-duration anomalies from fatal errors."""
        diag = TimestampDiagnostics(total_words=len(self.display_words))
        for w in self.display_words:
            if w.start_sec is None or w.end_sec is None:
                diag.fatal_errors.append(f"Word #{w.id}: missing timestamp")
                continue
            if not isinstance(w.start_sec, (int, float)) or not isinstance(w.end_sec, (int, float)):
                diag.fatal_errors.append(f"Word #{w.id}: non-numeric timestamp")
                continue
            if math.isnan(w.start_sec) or math.isnan(w.end_sec) or math.isinf(w.start_sec) or math.isinf(w.end_sec):
                diag.fatal_errors.append(f"Word #{w.id}: NaN/Inf timestamp")
                continue
            if w.start_sec < 0 or w.end_sec < 0:
                diag.fatal_errors.append(f"Word #{w.id}: negative timestamp (start={w.start_sec}, end={w.end_sec})")
                continue
            if w.end_sec < w.start_sec:
                diag.fatal_errors.append(f"Word #{w.id}: end_sec ({w.end_sec}) < start_sec ({w.start_sec})")
                continue
            if w.start_sec == w.end_sec:
                diag.zero_duration_count += 1
                diag.zero_duration_word_ids.append(w.id)
            else:
                diag.valid_words_count += 1
        return diag


# ---------------------------------------------------------------------------
# Compatibility Schemas (Used by downstream selectors and legacy tests)
# ---------------------------------------------------------------------------

class TranscriptWord(BaseModel):
    word: str
    raw_asr_word: Optional[str] = None
    start_abs_sec: float
    end_abs_sec: float
    start_rel_sec: Optional[float] = None
    end_rel_sec: Optional[float] = None
    confidence: float = 1.0
    is_technical_term: bool = False
    term_id: Optional[str] = None


class TranscriptSegment(BaseModel):
    id: int
    start: float
    end: float
    text: str
    words: List[TranscriptWord] = Field(default_factory=list)


class FullTranscript(BaseModel):
    source_filename: str
    duration_sec: float
    language: str = "en"
    segments: List[TranscriptSegment] = Field(default_factory=list)
    words: List[TranscriptWord] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Highlight Selection Schemas (Phase 3 contract)
# ---------------------------------------------------------------------------

class ScoreBreakdown(BaseModel):
    information_value: float = Field(..., description="Educational content, concept definitions, technical terms")
    self_contained: float = Field(..., description="Logical coherence, lack of unresolved dangling referents")
    opening_hook: float = Field(..., description="Strength of the opening thought or problem statement")
    ending_quality: float = Field(..., description="Completeness of thought at concluding boundary")
    speech_density: float = Field(..., description="Cadence, lack of filler, words per second appropriateness")
    confidence: float = Field(..., description="Average ASR confidence score")
    duration_penalty: float = Field(default=0.0, description="Penalty for suboptimal duration")


class HighlightResult(BaseModel):
    """Documented Master Output Contract for Phase 3 Highlight Selection."""
    schema_version: str = "1.0"
    source: SourceMetadata
    start_sec: float
    end_sec: float
    duration_sec: float
    score: float
    reason: str
    transcript_excerpt: str
    score_breakdown: ScoreBreakdown
    word_start_id: int
    word_end_id: int
    selection_method: str = "transcript_heuristic_v1"


class SelectedHighlight(BaseModel):
    clip_id: str
    start_time_sec: float
    end_time_sec: float
    duration_sec: float
    pedagogical_score: float
    topic_summary: str
    boundary_reasoning: str


# ---------------------------------------------------------------------------
# Framing & Crop Plan Schemas (Phase 4 contract)
# ---------------------------------------------------------------------------

class NormalizedCropBox(BaseModel):
    x_min: float = Field(..., ge=0.0, le=1.0)
    y_min: float = Field(..., ge=0.0, le=1.0)
    width: float = Field(..., gt=0.0, le=1.0)
    height: float = Field(..., gt=0.0, le=1.0)


class ActiveRegionType(str, Enum):
    CODE_EDITOR_TYPING = "code_editor_typing"
    CODE_EDITOR_ACTIVE_LINE = "code_editor_active_line"
    CODE_EDITOR_STATIC = "code_editor_static"
    TERMINAL_OUTPUT = "terminal_output"
    DIAGRAM_ILLUSTRATION = "diagram_illustration"
    SPEAKER_WEBCAM = "speaker_webcam"
    FALLBACK_CENTER = "fallback_center"


class CropKeyframe(BaseModel):
    timestamp_rel_sec: float
    timestamp_abs_sec: float
    crop_box_norm: NormalizedCropBox
    active_region_type: ActiveRegionType = ActiveRegionType.CODE_EDITOR_ACTIVE_LINE
    detection_confidence: float = Field(..., ge=0.0, le=1.0)
    is_fallback: bool = False
    transition: str = "smooth_pan"  # "smooth_pan" | "cut"


class CropPlan(BaseModel):
    clip_id: str
    aspect_ratio: str = "9:16"
    target_resolution: VideoResolution = VideoResolution(width=1080, height=1920)
    interpolation_mode: str = "cubic_ease_in_out"
    keyframes: List[CropKeyframe] = Field(default_factory=list)
    safe_fallback: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Subtitle & Code Overlay Schemas (Phase 5 contract)
# ---------------------------------------------------------------------------

class CodeOverlay(BaseModel):
    overlay_id: str
    timestamp_start_rel_sec: float
    timestamp_end_rel_sec: float
    position: str = "lower_third"  # "lower_third" | "upper_third" | "floating"
    language: str = "typescript"
    code_content: str
    asset_path: str


# ---------------------------------------------------------------------------
# Pipeline Job & Handoff Schemas
# ---------------------------------------------------------------------------

class JobStatus(str, Enum):
    PENDING = "PENDING"
    EXTRACTING_AUDIO = "EXTRACTING_AUDIO"
    TRANSCRIBING = "TRANSCRIBING"
    NORMALIZING_TERMS = "NORMALIZING_TERMS"
    SELECTING_MOMENT = "SELECTING_MOMENT"
    SAMPLING_FRAMES = "SAMPLING_FRAMES"
    PLANNING_CROPS = "PLANNING_CROPS"
    GENERATING_CAPTIONS = "GENERATING_CAPTIONS"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class PipelineJobRequest(BaseModel):
    video_path: str
    job_id: Optional[str] = None
    preferred_min_duration: Optional[float] = None
    preferred_max_duration: Optional[float] = None


class PipelineHandoffPackage(BaseModel):
    """Complete package consumed by Teammate B's video-rendering engine (/api/video_gen)."""
    job_id: str
    status: JobStatus
    media_metadata: MediaMetadata
    selected_highlight: SelectedHighlight
    transcript_words: List[TranscriptWord]
    crop_plan: CropPlan
    subtitles_ass_path: Optional[str] = None
    code_overlays: List[CodeOverlay] = Field(default_factory=list)
    error_message: Optional[str] = None
