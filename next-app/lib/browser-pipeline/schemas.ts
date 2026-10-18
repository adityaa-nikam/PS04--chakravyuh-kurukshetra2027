/**
 * Browser-Only Video Pipeline Schemas and Types
 * Strict TypeScript contracts matching the core video pipeline data models.
 */

export interface SourceMetadata {
  filename: string;
  duration_sec: floatNumber;
  audio_sample_rate?: number;
  video_width?: number;
  video_height?: number;
  fps?: number;
}

export type floatNumber = number;

export interface RawWord {
  id: number;
  text: string;
  start_sec: number;
  end_sec: number;
  confidence?: number | null;
}

export interface CorrectionMetadata {
  term_id: string;
  matched_alias: string;
  applied: boolean;
  requires_review: boolean;
  reason?: string | null;
}

export interface DisplayWord {
  id: number;
  text: string;
  start_sec: number;
  end_sec: number;
  source_word_ids: number[];
  confidence?: number | null;
  correction?: CorrectionMetadata | null;
}

export interface TimestampDiagnostics {
  total_words: number;
  valid_words_count: number;
  zero_duration_count: number;
  zero_duration_word_ids: number[];
  fatal_errors: string[];
}

export interface ValidatedTranscript {
  schema_version: string;
  source: SourceMetadata;
  transcription: {
    model: string;
    detected_language: string;
    timestamp_origin: string;
    compute_type?: string;
    device?: string;
  };
  raw_words: RawWord[];
  display_words: DisplayWord[];
}

export interface ScoreBreakdown {
  information_value: number;
  self_contained: number;
  opening_hook: number;
  ending_quality: number;
  speech_density: number;
  confidence: number;
  duration_penalty: number;
}

export interface HighlightResult {
  schema_version: string;
  source: SourceMetadata;
  start_sec: number;
  end_sec: number;
  duration_sec: number;
  score: number;
  reason: string;
  transcript_excerpt: string;
  score_breakdown: ScoreBreakdown;
  word_start_id: number;
  word_end_id: number;
  selection_method: string;
  title?: string | null;
  caption?: string | null;
  mercury_score?: number | null;
}

export interface CropBoxPixels {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NormalizedCropBox {
  x_min: number;
  y_min: number;
  width: number;
  height: number;
}

export type CropTrackingMode =
  | "face_following"
  | "center_fallback"
  | "interpolated_hold"
  | "content_following"
  | "content_hold";

export interface FaceBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence?: number | null;
}

export interface CropKeyframeResult {
  timestamp_abs_sec: number;
  timestamp_rel_sec: number;
  crop_box_pixels: CropBoxPixels;
  crop_box_norm: NormalizedCropBox;
  tracking_mode: CropTrackingMode;
  detected_faces_count: number;
  primary_face_box?: FaceBoundingBox | null;
  scene_change_detected: boolean;
  transition: "smooth_pan" | "cut";
}

export interface VisualDiagnostics {
  total_frames_analyzed: number;
  face_detected_frames_count: number;
  fallback_frames_count: number;
  interpolated_hold_frames_count: number;
  scene_changes_detected_count: number;
  scene_change_timestamps: number[];
  face_detection_ratio: number;
  fallback_used: boolean;
}

export interface CropPlanResult {
  schema_version: string;
  source: SourceMetadata;
  highlight: HighlightResult;
  target_aspect_ratio: string;
  target_aspect_ratio_float: number;
  source_width: number;
  source_height: number;
  crop_width: number;
  crop_height: number;
  analysis_interval_sec: number;
  tracking_method: string;
  fallback_used: boolean;
  keyframes: CropKeyframeResult[];
  diagnostics: VisualDiagnostics;
  warnings: string[];
}

export interface CaptionWord {
  id?: number;
  text: string;
  start_sec: number;
  end_sec: number;
  source_word_ids: number[];
  confidence?: number | null;
  correction?: CorrectionMetadata | null;
}

export interface CaptionGroup {
  id: number;
  start_sec: number;
  end_sec: number;
  text: string;
  lines: string[];
  words: CaptionWord[];
}

export interface CaptionOptions {
  min_words_per_group?: number;
  max_words_per_group?: number;
  max_chars_per_line?: number;
  tail_hold_sec?: number;
  speech_pause_threshold_sec?: number;
  font_family?: string;
  font_size?: number;
  primary_color?: string;
  highlight_color?: string;
  outline_color?: string;
  outline_width?: number;
  shadow_color?: string;
  margin_v?: number;
}

export type LogoAnchor = "top_left" | "top_right" | "bottom_left" | "bottom_right";

export interface BrandLogoConfig {
  enabled: boolean;
  asset_url?: string;
  anchor: LogoAnchor;
  scale: number;
  max_height?: number;
  opacity: number;
  padding_x: number;
  padding_y: number;
}

export interface BrandProfile {
  brand_id: string;
  brand_name: string;
  logo: BrandLogoConfig;
  primary_color: string;
  highlight_color: string;
}

export interface RenderOptions {
  output_width: number;
  output_height: number;
  video_bitrate: number;
  fps: number;
  bg_blur_sigma?: number;
  bg_darken_factor?: number;
  caption_options?: CaptionOptions;
  brand_profile?: BrandProfile;
}

export type PipelineStage =
  | "idle"
  | "probing"
  | "audio_extraction"
  | "transcription"
  | "highlight_selection"
  | "crop_planning"
  | "rendering"
  | "completed"
  | "failed";

export interface PipelineProgressEvent {
  stage: PipelineStage;
  progress: number; // 0.0 - 1.0
  message: string;
  details?: Record<string, any>;
}
