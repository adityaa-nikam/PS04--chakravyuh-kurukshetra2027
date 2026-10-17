/**
 * PipelineClient
 * Client for interacting with the local Python AI Worker service on http://127.0.0.1:8000
 */

const AI_WORKER_URL = process.env.AI_WORKER_URL || "http://127.0.0.1:8000";

export interface PipelineStartParams {
  videoPath: string;
  renderVideo?: boolean;
  subtitles?: boolean;
  captionStyle?: "karaoke" | "minimal" | "bold" | "neon";
  compositionMode?: "adaptive" | "presenter" | "screen_content";
  modelSize?: string;
  jobId?: string;
  maxClips?: number;
}

export interface PipelineRenderedClip {
  clip_index: number;
  clip_id: string;
  title: string;
  start_time_sec: number;
  end_time_sec: number;
  duration_sec: number;
  pedagogical_score: number;
  topic_summary: string;
  boundary_reasoning: string;
  rendered_video_path?: string | null;
  video_url?: string | null;
  download_filename?: string | null;
  mercury_score?: number | null;
  caption?: string | null;
}

export interface PipelineJobStatus {
  job_id: string;
  status:
    | "PENDING"
    | "EXTRACTING_AUDIO"
    | "TRANSCRIBING"
    | "NORMALIZING_TERMS"
    | "SELECTING_MOMENT"
    | "PLANNING_CROPS"
    | "RENDERING_VIDEO"
    | "COMPLETED"
    | "FAILED";
  progress_pct: number;
  stage_message: string;
  created_at: number;
  updated_at: number;
  media_metadata?: {
    filename: string;
    filepath: string;
    duration_sec: number;
    width: number;
    height: number;
    fps: number;
    has_audio: boolean;
  };
  selected_highlight?: {
    clip_id: string;
    start_time_sec: number;
    end_time_sec: number;
    duration_sec: number;
    pedagogical_score: number;
    topic_summary: string;
    boundary_reasoning: string;
    title?: string;
    caption?: string;
    mercury_score?: number;
  };
  rendered_clips?: PipelineRenderedClip[];
  crop_plan?: {
    clip_id: string;
    aspect_ratio: string;
    keyframes_count: number;
  };
  rendered_video_path?: string | null;
  subtitles_ass_path?: string | null;
  elapsed_sec?: number;
  error_message?: string;
}

export class PipelineClient {
  /**
   * Starts the full Reel Studio AI pipeline (audio -> whisper -> highlight -> 9:16 crop -> render)
   */
  static async startPipelineJob(params: PipelineStartParams) {
    const payload = {
      video_path: params.videoPath,
      render_video: params.renderVideo ?? true,
      subtitles: params.subtitles ?? true,
      caption_style: params.captionStyle ?? "karaoke",
      composition_mode: params.compositionMode ?? "adaptive",
      model_size: params.modelSize ?? "base.en",
      max_clips: params.maxClips ?? 3,
      ...(params.jobId ? { job_id: params.jobId } : {}),
    };

    const res = await fetch(`${AI_WORKER_URL}/api/v1/pipeline/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`AI Worker returned HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json();
    return {
      jobId: data.job_id,
      status: data.status,
      message: data.message,
    };
  }

  /**
   * Compatibility wrapper for POST /api/cropping
   */
  static async startCroppingJob(videoPath: string, jobId?: string) {
    return this.startPipelineJob({
      videoPath,
      renderVideo: true,
      subtitles: true,
      captionStyle: "karaoke",
      compositionMode: "adaptive",
      jobId,
    });
  }

  /**
   * Retrieves the current progress and result artifacts for a running/completed pipeline job.
   */
  static async getJobStatus(jobId: string): Promise<PipelineJobStatus | null> {
    const res = await fetch(`${AI_WORKER_URL}/api/v1/pipeline/status/${encodeURIComponent(jobId)}`, {
      method: "GET",
      cache: "no-store",
    });

    if (res.status === 404) {
      return null;
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`AI Worker status check failed (${res.status}): ${errText}`);
    }

    return (await res.json()) as PipelineJobStatus;
  }
}
