/**
 * TypeScript Data Contracts for Reel Studio Pipeline
 * Mirrors the Python schemas in services/ai-worker/app/schemas.py
 */

export interface VideoResolution {
  width: number;
  height: number;
}

export interface MediaMetadata {
  filename: string;
  filepath: string;
  duration_sec: number;
  width: number;
  height: number;
  fps: number;
  has_audio: boolean;
  audio_sample_rate?: number;
  audio_channels?: number;
  video_codec?: string;
  audio_codec?: string;
}

export interface TranscriptWord {
  word: string;
  raw_asr_word?: string;
  start_abs_sec: number;
  end_abs_sec: number;
  start_rel_sec?: number;
  end_rel_sec?: number;
  confidence: number;
  is_technical_term: boolean;
  term_id?: string;
}

export interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  words: TranscriptWord[];
}

export interface FullTranscript {
  source_filename: string;
  duration_sec: number;
  language: string;
  segments: TranscriptSegment[];
  words: TranscriptWord[];
}

export interface SelectedHighlight {
  clip_id: string;
  start_time_sec: number;
  end_time_sec: number;
  duration_sec: number;
  pedagogical_score: number;
  topic_summary: string;
  boundary_reasoning: string;
}

export interface NormalizedCropBox {
  x_min: number; // 0.0 to 1.0
  y_min: number; // 0.0 to 1.0
  width: number; // 0.0 to 1.0
  height: number; // 0.0 to 1.0
}

export type ActiveRegionType =
  | "code_editor_typing"
  | "code_editor_active_line"
  | "code_editor_static"
  | "terminal_output"
  | "diagram_illustration"
  | "speaker_webcam"
  | "fallback_center";

export interface CropKeyframe {
  timestamp_rel_sec: number;
  timestamp_abs_sec: number;
  crop_box_norm: NormalizedCropBox;
  active_region_type: ActiveRegionType;
  detection_confidence: number;
  is_fallback: boolean;
  transition: "smooth_pan" | "cut";
}

export interface CropPlan {
  clip_id: string;
  aspect_ratio: "9:16";
  target_resolution: VideoResolution;
  interpolation_mode: string;
  keyframes: CropKeyframe[];
  safe_fallback?: Record<string, unknown>;
}

export interface CodeOverlay {
  overlay_id: string;
  timestamp_start_rel_sec: number;
  timestamp_end_rel_sec: number;
  position: "lower_third" | "upper_third" | "floating";
  language: string;
  code_content: string;
  asset_path: string;
}

export type JobStatus =
  | "PENDING"
  | "EXTRACTING_AUDIO"
  | "TRANSCRIBING"
  | "NORMALIZING_TERMS"
  | "SELECTING_MOMENT"
  | "SAMPLING_FRAMES"
  | "PLANNING_CROPS"
  | "GENERATING_CAPTIONS"
  | "COMPLETED"
  | "FAILED";

export interface PipelineHandoffPackage {
  job_id: string;
  status: JobStatus;
  media_metadata: MediaMetadata;
  selected_highlight: SelectedHighlight;
  transcript_words: TranscriptWord[];
  crop_plan: CropPlan;
  subtitles_ass_path?: string;
  code_overlays: CodeOverlay[];
  error_message?: string;
}
