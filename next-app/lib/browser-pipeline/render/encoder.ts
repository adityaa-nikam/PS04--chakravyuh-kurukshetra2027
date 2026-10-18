/**
 * Browser WebCodecs Video Encoder & MP4 Muxer Pipeline
 * Encodes 720x1280 9:16 vertical H.264 video frames with real-time backpressure management,
 * dynamic frame-by-frame source seeking, synchronized AAC audio multiplexing, and standard MP4 container output.
 */

import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import { FrameCompositor, CompositionFrameContext } from "./compositor";
import { CropBoxPixels, CaptionGroup, CaptionOptions, BrandProfile } from "../schemas";
import { BrowserAudioExtractor } from "../audio/extractor";

export interface RenderPipelineConfig {
  width?: number; // default 720
  height?: number; // default 1280
  fps?: number; // default 30
  bitrate?: number; // default 4_000_000 (4 Mbps)
  brandProfile?: BrandProfile;
  captionOptions?: CaptionOptions;
}

export interface RenderJobInput {
  videoSource?: CanvasImageSource; // e.g. Canvas or pre-rendered frame
  videoElement?: HTMLVideoElement; // Live video element for dynamic moving frames
  startTimeSec?: number; // Start timestamp in seconds
  sourceWidth: number;
  sourceHeight: number;
  durationSec: number;
  cropTimeline: Array<{ relSec: number; cropBox: CropBoxPixels }>;
  captionGroups?: CaptionGroup[];
  audioBuffer?: AudioBuffer; // Decoded full audio buffer to encode into AAC
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
  private analysisCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  private analysisCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  private currentZoomFactor: number = 1.0;

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
   * Computer Vision scene analyzer:
   * Detects speaker presence vs high-density board/slide content.
   * Returns zoom factor: 1.0 = zoom in to speaker, 0.0 = zoom out to full board.
   */
  private detectSceneZoom(source: CanvasImageSource): number {
    if (!this.analysisCanvas) {
      if (typeof document !== "undefined") {
        this.analysisCanvas = document.createElement("canvas");
      } else if (typeof OffscreenCanvas !== "undefined") {
        this.analysisCanvas = new OffscreenCanvas(160, 90);
      }
      if (this.analysisCanvas) {
        this.analysisCanvas.width = 160;
        this.analysisCanvas.height = 90;
        this.analysisCtx = this.analysisCanvas.getContext("2d", { willReadFrequently: true }) as any;
      }
    }

    if (!this.analysisCtx || !this.analysisCanvas) {
      return 1.0;
    }

    try {
      this.analysisCtx.drawImage(source, 0, 0, 160, 90);
      const imgData = this.analysisCtx.getImageData(0, 0, 160, 90);
      const data = imgData.data;
      const totalPixels = 160 * 90;

      let skinPixels = 0;
      let skinXSum = 0;
      let edgeTransitions = 0;

      for (let y = 0; y < 90; y++) {
        for (let x = 0; x < 160; x++) {
          const idx = (y * 160 + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];

          // 1. Skin tone detector (detects instructor face/body)
          const maxVal = Math.max(r, g, b);
          const minVal = Math.min(r, g, b);
          if (
            r > 80 &&
            g > 35 &&
            b > 20 &&
            r > g &&
            r > b &&
            Math.abs(r - g) > 12 &&
            maxVal - minVal > 15
          ) {
            skinPixels++;
            skinXSum += x;
          }

          // 2. High-contrast horizontal edge detector (slides, code text, whiteboard equations)
          if (x > 0) {
            const prevIdx = idx - 4;
            const diff =
              Math.abs(r - data[prevIdx]) +
              Math.abs(g - data[prevIdx + 1]) +
              Math.abs(b - data[prevIdx + 2]);
            if (diff > 75) {
              edgeTransitions++;
            }
          }
        }
      }

      const skinRatio = skinPixels / totalPixels;
      const avgSkinX = skinPixels > 0 ? (skinXSum / skinPixels) / 160 : 0.5;
      const edgeDensity = edgeTransitions / totalPixels;

      let targetZoom = 1.0;
      if (skinRatio > 0.035 && avgSkinX >= 0.22 && avgSkinX <= 0.78) {
        // Instructor is talking directly to camera -> Zoom in to presenter
        targetZoom = 1.0;
      } else if (edgeDensity > 0.065 || skinRatio < 0.015) {
        // Board, code editor, slide presentation or diagram content -> Zoom out to board
        targetZoom = 0.0;
      } else {
        // Balanced intermediate
        targetZoom = 0.5;
      }

      // Smooth camera transition (EMA)
      this.currentZoomFactor = this.currentZoomFactor + (targetZoom - this.currentZoomFactor) * 0.12;
      return this.currentZoomFactor;
    } catch {
      return 1.0;
    }
  }

  private seekVideoTo(video: HTMLVideoElement, targetTime: number): Promise<void> {
    if (Math.abs(video.currentTime - targetTime) < 0.005) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let resolved = false;
      const done = () => {
        if (!resolved) {
          resolved = true;
          video.removeEventListener("seeked", onSeeked);
          resolve();
        }
      };
      const onSeeked = () => done();
      video.addEventListener("seeked", onSeeked);
      video.currentTime = targetTime;
      // Safeguard timeout so encoding never hangs if a seek stalls
      setTimeout(done, 120);
    });
  }

  /**
   * Encodes a video element or canvas with compositor, karaoke captions,
   * AAC audio track, and MP4 muxing into a playable MP4 Blob.
   */
  public async renderReel(job: RenderJobInput): Promise<Blob> {
    if (typeof VideoEncoder === "undefined") {
      throw new Error("WebCodecs VideoEncoder is not supported in this browser.");
    }

    const videoEl = job.videoElement;
    const startTimeSec = Math.max(0, job.startTimeSec || 0);
    const AUDIO_SAMPLE_RATE = 48000;
    let audioEncoder: AudioEncoder | null = null;
    let audioConfigured = false;
    let encoderError: Error | null = null;

    // Check AudioEncoder support if audioBuffer is provided
    if (typeof AudioEncoder !== "undefined" && job.audioBuffer) {
      try {
        const audioConfig: AudioEncoderConfig = {
          codec: "mp4a.40.2", // AAC-LC
          numberOfChannels: 1,
          sampleRate: AUDIO_SAMPLE_RATE,
          bitrate: 128_000,
        };

        const isSupported = await AudioEncoder.isConfigSupported(audioConfig);
        if (isSupported.supported) {
          audioConfigured = true;
        }
      } catch (e) {
        console.warn("AudioEncoder configuration check warning:", e);
      }
    }

    const muxerTarget = new ArrayBufferTarget();
    const muxerOptions: any = {
      target: muxerTarget,
      video: {
        codec: "avc",
        width: this.width,
        height: this.height,
      },
      fastStart: "in-memory",
    };

    if (audioConfigured) {
      muxerOptions.audio = {
        codec: "aac",
        numberOfChannels: 1,
        sampleRate: AUDIO_SAMPLE_RATE,
      };
    }

    const muxer = new Muxer(muxerOptions);

    // Initialize VideoEncoder
    const videoEncoder = new VideoEncoder({
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

    await videoEncoder.configure({
      codec: "avc1.4d002a",
      width: this.width,
      height: this.height,
      bitrate: this.bitrate,
      framerate: this.fps,
      avc: { format: "avc" },
    });

    // Initialize AudioEncoder if enabled
    if (audioConfigured) {
      audioEncoder = new AudioEncoder({
        output: (chunk, meta) => {
          try {
            muxer.addAudioChunk(chunk, meta);
          } catch (e: any) {
            console.error("Muxer addAudioChunk error:", e);
            encoderError = e;
          }
        },
        error: (e) => {
          console.error("AudioEncoder error callback:", e);
          encoderError = e;
        },
      });

      await audioEncoder.configure({
        codec: "mp4a.40.2",
        numberOfChannels: 1,
        sampleRate: AUDIO_SAMPLE_RATE,
        bitrate: 128_000,
      });
    }

    // Prepare video element state
    if (videoEl) {
      videoEl.muted = true;
      videoEl.pause();
    }

    const totalFrames = Math.round(job.durationSec * this.fps);
    const frameIntervalUs = Math.round(1_000_000 / this.fps);
    const startTime = performance.now();

    // -------------------------------------------------------------------------
    // 1. Encode Video Frames (with dynamic seeking)
    // -------------------------------------------------------------------------
    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
      if (encoderError) {
        throw encoderError;
      }

      const relSec = frameIndex / this.fps;
      const targetSec = startTimeSec + relSec;

      // Seek video to exact frame timestamp
      if (videoEl) {
        await this.seekVideoTo(videoEl, targetSec);
      }

      // Find current crop box from timeline
      let currentCrop = job.cropTimeline[0]?.cropBox || {
        x: Math.round((job.sourceWidth - (job.sourceHeight * 9) / 16) / 2),
        y: 0,
        width: Math.round((job.sourceHeight * 9) / 16),
        height: job.sourceHeight,
      };

      for (const kf of job.cropTimeline) {
        if (kf.relSec <= relSec) {
          currentCrop = kf.cropBox;
        } else {
          break;
        }
      }

      // Composite frame with video frame, ambient blur, captions, branding
      const frameSource = videoEl || job.videoSource;
      if (!frameSource) {
        throw new Error("No video source or video element provided for rendering.");
      }

      // Computer vision scene zoom: zooms into speaker when talking, zooms out to full board for slides/code
      const zoomFactor = this.detectSceneZoom(frameSource);

      const frameCtx: CompositionFrameContext = {
        sourceImage: frameSource,
        sourceWidth: job.sourceWidth,
        sourceHeight: job.sourceHeight,
        cropBox: currentCrop,
        currentRelSec: relSec,
        captionGroups: job.captionGroups,
        zoomFactor: zoomFactor,
      };

      this.compositor.composite(this.ctx, frameCtx);

      // Create VideoFrame from canvas
      const timestampUs = frameIndex * frameIntervalUs;
      const videoFrame = new VideoFrame(this.canvas as any, {
        timestamp: timestampUs,
        duration: frameIntervalUs,
      });

      // Keyframe every 2 seconds
      const keyFrame = frameIndex % (this.fps * 2) === 0;
      videoEncoder.encode(videoFrame, { keyFrame });
      videoFrame.close();

      // Backpressure management
      if (videoEncoder.encodeQueueSize > 4) {
        await new Promise((resolve) => setTimeout(resolve, 8));
      }

      if (job.onProgress && frameIndex % 10 === 0) {
        const elapsedSec = (performance.now() - startTime) / 1000;
        const currentFps = elapsedSec > 0 ? (frameIndex + 1) / elapsedSec : 0;
        job.onProgress((frameIndex + 1) / totalFrames, Math.round(currentFps * 10) / 10);
      }
    }

    // Flush video encoder
    await videoEncoder.flush();
    videoEncoder.close();

    // -------------------------------------------------------------------------
    // 2. Encode Audio Track (AAC-LC @ 48kHz)
    // -------------------------------------------------------------------------
    if (audioEncoder && job.audioBuffer) {
      try {
        const monoAudio = await BrowserAudioExtractor.extractResampledSegment(
          job.audioBuffer,
          startTimeSec,
          job.durationSec,
          AUDIO_SAMPLE_RATE
        );

        const totalSamples = monoAudio.length;
        const SAMPLES_PER_FRAME = 1024;

        for (let offset = 0; offset < totalSamples; offset += SAMPLES_PER_FRAME) {
          if (encoderError) break;

          const frameSize = Math.min(SAMPLES_PER_FRAME, totalSamples - offset);
          const chunkData = new Float32Array(SAMPLES_PER_FRAME);
          chunkData.set(monoAudio.subarray(offset, offset + frameSize));

          const timestampUs = Math.round((offset / AUDIO_SAMPLE_RATE) * 1_000_000);
          const audioData = new AudioData({
            format: "f32-planar",
            sampleRate: AUDIO_SAMPLE_RATE,
            numberOfFrames: SAMPLES_PER_FRAME,
            numberOfChannels: 1,
            timestamp: timestampUs,
            data: chunkData,
          });

          audioEncoder.encode(audioData);
          audioData.close();
        }

        await audioEncoder.flush();
        audioEncoder.close();
      } catch (aErr) {
        console.warn("Audio encoding warning (continuing with video only):", aErr);
      }
    }

    // Finalize MP4 muxer
    muxer.finalize();

    if (encoderError) {
      throw encoderError;
    }

    const buffer = muxerTarget.buffer;
    return new Blob([buffer], { type: "video/mp4" });
  }
}
