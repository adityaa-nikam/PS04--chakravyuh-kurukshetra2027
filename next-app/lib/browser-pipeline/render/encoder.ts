/**
 * Browser WebCodecs Video Encoder & MP4 Muxer Pipeline
 * Encodes 720x1280 9:16 vertical H.264 video frames with real-time backpressure management,
 * frame memory reclamation (VideoFrame.close()), and standard MP4 container multiplexing.
 */

import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import { FrameCompositor, CompositionFrameContext } from "./compositor";
import { CropBoxPixels, CaptionGroup, CaptionOptions, BrandProfile } from "../schemas";

export interface RenderPipelineConfig {
  width?: number; // default 720
  height?: number; // default 1280
  fps?: number; // default 30
  bitrate?: number; // default 4_000_000 (4 Mbps)
  brandProfile?: BrandProfile;
  captionOptions?: CaptionOptions;
}

export interface RenderJobInput {
  videoSource: CanvasImageSource; // e.g. HTMLVideoElement or OffscreenCanvas
  sourceWidth: number;
  sourceHeight: number;
  durationSec: number;
  cropTimeline: Array<{ relSec: number; cropBox: CropBoxPixels }>;
  captionGroups?: CaptionGroup[];
  onProgress?: (progress: number, fps: number) => void;
}

export class WebCodecsVideoPipeline {
  private width: number;
  private height: number;
  private fps: number;
  private bitrate: number;
  private compositor: FrameCompositor;
  private canvas: OffscreenCanvas | HTMLCanvasElement;
  private ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

  constructor(config?: RenderPipelineConfig) {
    this.width = config?.width ?? 720;
    this.height = config?.height ?? 1280;
    this.fps = config?.fps ?? 30;
    this.bitrate = config?.bitrate ?? 4_000_000;
    this.compositor = new FrameCompositor(this.width, this.height, config?.brandProfile);

    if (typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = this.width;
      c.height = this.height;
      this.canvas = c;
      this.ctx = c.getContext("2d")!;
    } else if (typeof OffscreenCanvas !== "undefined") {
      this.canvas = new OffscreenCanvas(this.width, this.height);
      this.ctx = this.canvas.getContext("2d")!;
    } else {
      throw new Error("Canvas context is not available in this environment.");
    }
  }

  /**
   * Encodes a synthetic demonstration reel or video element with compositor,
   * karaoke captions, and MP4 muxing.
   */
  public async renderReel(job: RenderJobInput): Promise<Blob> {
    if (typeof VideoEncoder === "undefined") {
      throw new Error("WebCodecs VideoEncoder is not supported in this browser.");
    }

    const muxerTarget = new ArrayBufferTarget();
    const muxer = new Muxer({
      target: muxerTarget,
      video: {
        codec: "avc",
        width: this.width,
        height: this.height,
      },
      fastStart: "in-memory",
    });

    let encoderError: Error | null = null;

    const encoder = new VideoEncoder({
      output: (chunk, meta) => {
        try {
          muxer.addVideoChunk(chunk, meta);
        } catch (e: any) {
          console.error("Muxer addVideoChunk error:", e);
          encoderError = e;
        }
      },
      error: (e) => {
        console.error("VideoEncoder error callback:", e);
        encoderError = e;
      },
    });

    await encoder.configure({
      codec: "avc1.4d002a",
      width: this.width,
      height: this.height,
      bitrate: this.bitrate,
      framerate: this.fps,
      avc: { format: "avc" },
    });

    const totalFrames = Math.round(job.durationSec * this.fps);
    const frameIntervalUs = Math.round(1_000_000 / this.fps);
    const startTime = performance.now();

    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
      if (encoderError) {
        throw encoderError;
      }

      const relSec = frameIndex / this.fps;

      // Find current crop box from timeline (or interpolate)
      let currentCrop = job.cropTimeline[0]?.cropBox || {
        x: Math.round((job.sourceWidth - (job.sourceHeight * 9) / 16) / 2),
        y: 0,
        width: Math.round((job.sourceHeight * 9) / 16),
        height: job.sourceHeight,
      };

      // Find closest keyframe
      for (const kf of job.cropTimeline) {
        if (kf.relSec <= relSec) {
          currentCrop = kf.cropBox;
        } else {
          break;
        }
      }

      // 1. Composite frame
      const frameCtx: CompositionFrameContext = {
        sourceImage: job.videoSource,
        sourceWidth: job.sourceWidth,
        sourceHeight: job.sourceHeight,
        cropBox: currentCrop,
        currentRelSec: relSec,
        captionGroups: job.captionGroups,
      };

      this.compositor.composite(this.ctx, frameCtx);

      // 2. Create VideoFrame from canvas
      const timestampUs = frameIndex * frameIntervalUs;
      const videoFrame = new VideoFrame(this.canvas as any, {
        timestamp: timestampUs,
        duration: frameIntervalUs,
      });

      // Keyframe every 2 seconds
      const keyFrame = frameIndex % (this.fps * 2) === 0;
      encoder.encode(videoFrame, { keyFrame });

      // Clean up VideoFrame immediately to avoid memory leaks
      videoFrame.close();

      // Backpressure management: wait if encoder queue gets backlogged
      if (encoder.encodeQueueSize > 4) {
        await new Promise((resolve) => setTimeout(resolve, 8));
      }

      if (job.onProgress && frameIndex % 10 === 0) {
        const elapsedSec = (performance.now() - startTime) / 1000;
        const currentFps = elapsedSec > 0 ? (frameIndex + 1) / elapsedSec : 0;
        job.onProgress((frameIndex + 1) / totalFrames, Math.round(currentFps * 10) / 10);
      }
    }

    // Flush encoder and finalize MP4
    await encoder.flush();
    encoder.close();
    muxer.finalize();

    if (encoderError) {
      throw encoderError;
    }

    const buffer = muxerTarget.buffer;
    return new Blob([buffer], { type: "video/mp4" });
  }
}
