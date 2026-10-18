/**
 * Browser 9:16 Canvas Compositor Engine
 * Assembles multi-layer video frames:
 * 1. Background layer: Blurred, darkened ambient video fill
 * 2. Foreground layer: Intelligently cropped 9:16 primary subject / presentation window
 * 3. Caption layer: Real-time karaoke word-highlighting subtitle graphics
 * 4. Branding layer: Watermark logo / badge overlay
 */

import { CropBoxPixels, CaptionGroup, CaptionOptions, BrandProfile } from "../schemas";
import { CanvasCaptionRenderer } from "../captions/canvas-draw";
import { BrowserBrandManager } from "../brand/manager";

export interface CompositionFrameContext {
  sourceImage: CanvasImageSource; // VideoFrame, HTMLVideoElement, ImageBitmap, or Canvas
  sourceWidth: number;
  sourceHeight: number;
  cropBox: CropBoxPixels;
  currentRelSec: number;
  captionGroups?: CaptionGroup[];
  captionOptions?: CaptionOptions;
  zoomFactor?: number; // 1.0 = zoomed in on speaker, 0.0 = zoomed out to full presentation/board
}

export class FrameCompositor {
  private width: number;
  private height: number;
  private brandManager: BrowserBrandManager;
  private blurCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private blurCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;

  constructor(
    width: number = 720,
    height: number = 1280,
    brandProfile?: BrandProfile
  ) {
    this.width = width;
    this.height = height;
    this.brandManager = new BrowserBrandManager(brandProfile);
  }

  public getBrandManager(): BrowserBrandManager {
    return this.brandManager;
  }

  private initBlurCanvas(): void {
    if (this.blurCanvas) return;
    const downscaleW = Math.round(this.width / 4);
    const downscaleH = Math.round(this.height / 4);

    if (typeof OffscreenCanvas !== "undefined") {
      this.blurCanvas = new OffscreenCanvas(downscaleW, downscaleH);
      this.blurCtx = this.blurCanvas.getContext("2d");
    } else if (typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = downscaleW;
      c.height = downscaleH;
      this.blurCanvas = c;
      this.blurCtx = c.getContext("2d");
    }
  }

  public composite(
    targetCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    context: CompositionFrameContext
  ): void {
    const {
      sourceImage,
      sourceWidth,
      sourceHeight,
      cropBox,
      currentRelSec,
      captionGroups,
      captionOptions,
    } = context;

    targetCtx.save();

    // -------------------------------------------------------------
    // Layer 1: Ambient Blurred Background
    // -------------------------------------------------------------
    // Draw source scaled to cover 9:16 target
    this.initBlurCanvas();
    if (this.blurCtx && this.blurCanvas) {
      // Fast two-pass downscale blur to optimize performance
      this.blurCtx.drawImage(
        sourceImage,
        0,
        0,
        this.blurCanvas.width,
        this.blurCanvas.height
      );

      targetCtx.save();
      // CSS filter blur if supported
      if ("filter" in targetCtx) {
        targetCtx.filter = "blur(18px) brightness(0.65)";
      }
      targetCtx.drawImage(
        this.blurCanvas,
        0,
        0,
        this.width,
        this.height
      );
      targetCtx.restore();
    } else {
      // Fallback dark gradient background
      const grad = targetCtx.createLinearGradient(0, 0, 0, this.height);
      grad.addColorStop(0, "#090d16");
      grad.addColorStop(1, "#1e1b4b");
      targetCtx.fillStyle = grad;
      targetCtx.fillRect(0, 0, this.width, this.height);
    }

    // Subtle dark vignette tint
    targetCtx.fillStyle = "rgba(0, 0, 0, 0.35)";
    targetCtx.fillRect(0, 0, this.width, this.height);

    // -------------------------------------------------------------
    // Layer 2: Adaptive Foreground Subject Crop & Presentation Framing
    // -------------------------------------------------------------
    const z = Math.max(0.0, Math.min(1.0, context.zoomFactor ?? 1.0));

    // Full 16:9 uncropped bounds fitted inside 9:16 target (Board mode)
    const s = Math.min(this.width / sourceWidth, this.height / sourceHeight);
    const fg_w = Math.max(1, Math.round(sourceWidth * s));
    const fg_h = Math.max(1, Math.round(sourceHeight * s));
    const x_off = Math.max(0, Math.round((this.width - fg_w) / 2));
    const y_off = Math.max(0, Math.round((this.height - fg_h) / 2));

    // Person portrait crop box bounds (Speaker mode)
    const p_sx = Math.max(0, Math.min(cropBox.x, sourceWidth - 1));
    const p_sy = Math.max(0, Math.min(cropBox.y, sourceHeight - 1));
    const p_sw = Math.max(1, Math.min(cropBox.width, sourceWidth - p_sx));
    const p_sh = Math.max(1, Math.min(cropBox.height, sourceHeight - p_sy));

    // Smoothly interpolate source and destination rectangles between Board (0) and Speaker (1)
    const sx = (1.0 - z) * 0 + z * p_sx;
    const sy = (1.0 - z) * 0 + z * p_sy;
    const sw = (1.0 - z) * sourceWidth + z * p_sw;
    const sh = (1.0 - z) * sourceHeight + z * p_sh;

    const dx = (1.0 - z) * x_off + z * 0;
    const dy = (1.0 - z) * y_off + z * 0;
    const dw = (1.0 - z) * fg_w + z * this.width;
    const dh = (1.0 - z) * fg_h + z * this.height;

    targetCtx.drawImage(
      sourceImage,
      sx,
      sy,
      sw,
      sh,
      dx,
      dy,
      dw,
      dh
    );

    // -------------------------------------------------------------
    // Layer 3: Synchronized Karaoke Subtitles
    // -------------------------------------------------------------
    if (captionGroups && captionGroups.length > 0) {
      CanvasCaptionRenderer.drawCaptions(
        targetCtx,
        captionGroups,
        currentRelSec,
        this.width,
        this.height,
        captionOptions
      );
    }

    // -------------------------------------------------------------
    // Layer 4: Brand Identity & Watermark
    // -------------------------------------------------------------
    this.brandManager.drawBrandOverlay(targetCtx, this.width, this.height);

    targetCtx.restore();
  }
}
