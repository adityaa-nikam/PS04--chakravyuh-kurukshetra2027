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

class CropBoxPixels(BaseModel):
    """Integer pixel bounding box for crop cut [x, y, width, height]."""
    x: int = Field(..., ge=0)
    y: int = Field(..., ge=0)
    width: int = Field(..., gt=0)
    height: int = Field(..., gt=0)


class FaceBoundingBox(BaseModel):
    """Detected face bounding box in pixel coordinates."""
    x: int
    y: int
    width: int
    height: int
    confidence: Optional[float] = None


class CropTrackingMode(str, Enum):
    FACE_FOLLOWING = "face_following"
    CENTER_FALLBACK = "center_fallback"
    INTERPOLATED_HOLD = "interpolated_hold"
    CONTENT_FOLLOWING = "content_following"
    CONTENT_HOLD = "content_hold"


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


class CropKeyframeResult(BaseModel):
    """Detailed crop keyframe at a sampled analysis timestamp."""
    timestamp_abs_sec: float = Field(..., ge=0.0, description="Absolute source video timestamp")
    timestamp_rel_sec: float = Field(..., ge=0.0, description="Relative timestamp from start of highlight clip")
    crop_box_pixels: CropBoxPixels
    crop_box_norm: NormalizedCropBox
    tracking_mode: CropTrackingMode = CropTrackingMode.CENTER_FALLBACK
    detected_faces_count: int = 0
    primary_face_box: Optional[FaceBoundingBox] = None
    content_candidate: Optional[Any] = None
    content_tracking_mode: Optional[str] = None
    scene_change_detected: bool = False
    transition: str = "smooth_pan"  # "smooth_pan" | "cut"


class VisualDiagnostics(BaseModel):
    """Visual inspection diagnostics collected across analyzed video frames."""
    total_frames_analyzed: int = 0
    face_detected_frames_count: int = 0
    fallback_frames_count: int = 0
    interpolated_hold_frames_count: int = 0
    scene_changes_detected_count: int = 0
    scene_change_timestamps: List[float] = Field(default_factory=list)
    decode_error_count: int = 0
    face_detection_ratio: float = 0.0
    fallback_used: bool = False


class CropPlanResult(BaseModel):
    """Master Phase 4 Output Contract: Validated 9:16 Crop Plan Timeline."""
    schema_version: str = "1.0"
    source: SourceMetadata
    highlight: HighlightResult
    target_aspect_ratio: str = "9:16"
    target_aspect_ratio_float: float = 0.5625
    source_width: int
    source_height: int
    crop_width: Optional[int] = None
    crop_height: Optional[int] = None
    analysis_interval_sec: float = 0.5
    tracking_method: str = "opencv_haar_tracker_v1"
    fallback_used: bool = False
    keyframes: List[CropKeyframeResult] = Field(default_factory=list)
    diagnostics: VisualDiagnostics = Field(default_factory=VisualDiagnostics)
    warnings: List[str] = Field(default_factory=list)


class CropPlan(BaseModel):
    clip_id: str
    aspect_ratio: str = "9:16"
    target_resolution: VideoResolution = VideoResolution(width=1080, height=1920)
    interpolation_mode: str = "cubic_ease_in_out"
    keyframes: List[CropKeyframe] = Field(default_factory=list)
    safe_fallback: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Video Rendering Schemas (Phase 5, 5.1 & 5.2 contract)
# ---------------------------------------------------------------------------

class CompositionMode(str, Enum):
    ADAPTIVE_HYBRID = "adaptive_hybrid"
    CROP_ONLY = "crop_only"
    PRESENTATION_FIT_BLUR = "presentation_fit_blur"
    CONTENT_ONLY = "content_only"


# ---------------------------------------------------------------------------
# Brand Profile & Watermark Schemas (Phase 7 contract)
# ---------------------------------------------------------------------------

class LogoAnchor(str, Enum):
    TOP_LEFT = "top_left"
    TOP_RIGHT = "top_right"
    BOTTOM_LEFT = "bottom_left"
    BOTTOM_RIGHT = "bottom_right"
    DYNAMIC_SAFE = "dynamic_safe"


class BrandPalette(BaseModel):
    primary: str = "#2563EB"
    secondary: str = "#1E293B"
    accent: str = "#FACC15"
    text: str = "#FFFFFF"
    background: Optional[str] = None


class BrandTypography(BaseModel):
    font_family: str = "Arial"
    bold: bool = True
    font_size: int = 36
    text_color: Optional[str] = None
    highlight_color: Optional[str] = None
    outline_color: str = "#000000"
    outline_width: float = 2.5
    shadow_color: str = "#00000080"
    shadow_offset: float = 1.5
    margin_v: int = 190
    margin_lr: int = 40
    alignment: int = 2
    box_backing: bool = False
    backing_color: Optional[str] = "#00000066"


class BrandLogoConfig(BaseModel):
    enabled: bool = False
    asset_path: Optional[str] = None
    anchor: LogoAnchor = LogoAnchor.TOP_LEFT
    scale: float = Field(0.18, ge=0.04, le=0.60)
    max_height: Optional[int] = Field(100, ge=10, le=500)
    opacity: float = Field(0.85, ge=0.0, le=1.0)
    padding_x: int = Field(32, ge=0, le=250)
    padding_y: int = Field(32, ge=0, le=250)
    start_sec: Optional[float] = None
    end_sec: Optional[float] = None
    safe_placement: bool = True


class BrandProfile(BaseModel):
    brand_id: str
    brand_name: str
    description: Optional[str] = None
    version: str = "1.0"
    palette: BrandPalette = Field(default_factory=BrandPalette)
    typography: BrandTypography = Field(default_factory=BrandTypography)
    logo: BrandLogoConfig = Field(default_factory=BrandLogoConfig)


class BrandDiagnostics(BaseModel):
    enabled: bool = False
    brand_id: Optional[str] = None
    brand_name: Optional[str] = None
    profile_version: Optional[str] = None
    profile_path: Optional[str] = None
    logo_enabled: bool = False
    logo_asset_path: Optional[str] = None
    effective_anchor: Optional[str] = None
    effective_logo_width: Optional[int] = None
    effective_logo_height: Optional[int] = None
    effective_opacity: Optional[float] = None
    safe_placement_applied: bool = False
    anchor_switches_count: int = 0
    logo_hidden_scenes_count: int = 0
    caption_font_family: Optional[str] = None
    caption_text_color_ass: Optional[str] = None
    caption_highlight_color_ass: Optional[str] = None
    warnings: List[str] = Field(default_factory=list)


class RenderOptions(BaseModel):
    """Configuration options for final video rendering."""
    output_width: int = 720
    output_height: int = 1280
    video_bitrate: str = "4M"
    audio_bitrate: str = "128k"
    preset: str = "fast"
    crf: int = 20
    overwrite: bool = False
    composition_mode: str = "adaptive_hybrid"
    sustained_face_loss_sec: float = 1.0
    transition_duration_sec: float = 0.25
    bg_darken_factor: float = 0.55
    bg_blur_sigma: float = 10.0
    tiny_face_ratio_threshold: float = 0.015
    enable_content_tracking: bool = True
    content_min_score: float = 0.35
    content_max_width_ratio: float = 0.45
    content_smoothing_alpha: float = 0.3
    content_hold_sec: float = 1.0
    subtitles_enabled: bool = False
    caption_style: str = "karaoke"
    subtitles_ass_path: Optional[str] = None
    transcript_path: Optional[str] = None
    caption_font_name: str = "Arial"
    caption_font_size: int = 44
    caption_margin_v: int = 190
    # Phase 7 Branding Options
    brand_profile_path: Optional[str] = None
    branding_enabled: bool = True
    logo_path_override: Optional[str] = None
    logo_anchor_override: Optional[str] = None
    logo_opacity_override: Optional[float] = None
    logo_scale_override: Optional[float] = None


class SceneType(str, Enum):
    """Categorization of video scenes for intelligent layout framing (Phase 5.3)."""
    PRESENTER_ONLY = "presenter_only"
    PRECOMPOSITED_PIP = "precomposited_pip"
    PRESENTATION_SCREEN = "presentation_screen"
    TRANSITION_OR_UNCERTAIN = "transition_or_uncertain"


class RenderResult(BaseModel):
    """Master Phase 5/5.1/5.2/5.3/6/7 Output Contract: Validated Rendered Video Result."""
    schema_version: str = "1.5"
    source_video: str
    highlight_start_sec: float
    highlight_end_sec: float
    requested_duration_sec: float
    output_path: str
    output_width: int
    output_height: int
    output_fps: float
    output_video_codec: str = "h264"
    output_audio_codec: Optional[str] = None
    audio_included: bool = True
    rendered_frame_count: int
    actual_video_duration_sec: float
    actual_audio_duration_sec: Optional[float] = None
    render_duration_sec: float
    crop_plan_reference: Optional[str] = None
    highlight_reference: Optional[str] = None
    composition_mode: str = "adaptive_hybrid"
    presenter_frames_count: int = 0
    presentation_frames_count: int = 0
    content_frames_count: int = 0
    content_detections_count: int = 0
    composition_transitions_count: int = 0
    scene_cut_transitions_count: int = 0
    sustained_loss_transitions_count: int = 0
    content_transitions_count: int = 0
    scene_type_distribution: Dict[str, int] = Field(default_factory=dict)
    fallback_events_count: int = 0
    frame_diagnostics_sample: List[Dict[str, Any]] = Field(default_factory=list)
    background_style: Dict[str, Any] = Field(default_factory=dict)
    content_tracking_diagnostics: Dict[str, Any] = Field(default_factory=dict)
    subtitles_enabled: bool = False
    caption_style: Optional[str] = None
    subtitles_ass_path: Optional[str] = None
    caption_groups_count: Optional[int] = None
    caption_diagnostics: Optional[Dict[str, Any]] = None
    branding: Optional[Dict[str, Any]] = None
    warnings: List[str] = Field(default_factory=list)
    success: bool = True


# ---------------------------------------------------------------------------
# Subtitle & Code Overlay Schemas (Phase 6 contract)
# ---------------------------------------------------------------------------

class CaptionStyle(str, Enum):
    STANDARD = "standard"
    KARAOKE = "karaoke"


class CaptionOptions(BaseModel):
    """Configuration options for subtitle formatting, styling, and grouping."""
    enabled: bool = True
    style: CaptionStyle = CaptionStyle.KARAOKE
    font_name: str = "Arial"
    font_size: int = 44
    bold: bool = True
    primary_color: str = "&H00FFFFFF"    # Crisp White
    highlight_color: str = "&H0000FFFF"  # Vibrant Yellow in BGR format
    outline_color: str = "&H00141414"    # Dark Charcoal
    back_color: str = "&H80000000"       # 50% Translucent Shadow
    outline_width: float = 3.2
    shadow_depth: float = 1.2
    margin_v: int = 190
    margin_lr: int = 40
    max_words_per_group: int = 5
    min_words_per_group: int = 2
    max_chars_per_line: int = 28
    speech_pause_threshold_sec: float = 0.38
    tail_hold_sec: float = 0.28

    def apply_brand_profile(self, profile: "BrandProfile") -> None:
        """Applies typography, text color, and karaoke highlight styling from a BrandProfile."""
        from app.services.brand_manager import hex_to_ass_color
        t = profile.typography
        p = profile.palette
        if t.font_family:
            self.font_name = t.font_family
        if t.font_size:
            self.font_size = t.font_size
        if t.bold is not None:
            self.bold = t.bold
        if t.text_color:
            self.primary_color = hex_to_ass_color(t.text_color).rstrip("&")
        elif p.text:
            self.primary_color = hex_to_ass_color(p.text).rstrip("&")
        if t.highlight_color:
            self.highlight_color = hex_to_ass_color(t.highlight_color).rstrip("&")
        elif p.accent:
            self.highlight_color = hex_to_ass_color(p.accent).rstrip("&")
        if t.outline_color:
            self.outline_color = hex_to_ass_color(t.outline_color).rstrip("&")
        if t.shadow_color:
            self.back_color = hex_to_ass_color(t.shadow_color, default_alpha=128).rstrip("&")
        if t.outline_width is not None:
            self.outline_width = t.outline_width
        if t.shadow_offset is not None:
            self.shadow_depth = t.shadow_offset
        if t.margin_v is not None:
            self.margin_v = t.margin_v
        if t.margin_lr is not None:
            self.margin_lr = t.margin_lr


class CaptionWord(BaseModel):
    """Highlight-relative word timing token for caption rendering and highlighting."""
    id: Optional[int] = None
    text: str
    start_sec: float
    end_sec: float
    source_word_ids: List[int] = Field(default_factory=list)
    confidence: Optional[float] = None
    correction: Optional[CorrectionMetadata] = None


class CaptionGroup(BaseModel):
    """A coherent 1-2 line subtitle block with timing boundaries and constituent words."""
    id: int
    start_sec: float
    end_sec: float
    text: str
    lines: List[str] = Field(default_factory=list)
    words: List[CaptionWord] = Field(default_factory=list)
    is_karaoke: bool = False


class CaptionDiagnostics(BaseModel):
    """Audit diagnostics for caption filtering, grouping, and ASS generation."""
    total_source_words: int = 0
    highlight_words_count: int = 0
    caption_groups_count: int = 0
    total_ass_events: int = 0
    style: str = "karaoke"
    first_caption_start_sec: Optional[float] = None
    last_caption_end_sec: Optional[float] = None
    zero_duration_words_count: int = 0
    clamped_words_count: int = 0
    time_conversion_convention: str = "relative_to_highlight_start"
    ass_file_path: Optional[str] = None


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
