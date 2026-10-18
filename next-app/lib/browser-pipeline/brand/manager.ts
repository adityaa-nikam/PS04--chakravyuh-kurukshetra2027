/**
 * Browser Brand & Watermark Manager
 * Ported from BrandManager (services/ai-worker/app/services/brand_manager.py)
 * Manages brand identity overlays, logo watermark anchoring, opacity, and safe padding.
 */

import { BrandProfile, LogoAnchor } from "../schemas";

export class BrowserBrandManager {
  private profile: BrandProfile;
  private logoImage: ImageBitmap | HTMLImageElement | null = null;

  constructor(profile?: BrandProfile) {
    this.profile = profile || {
      brand_id: "default",
      brand_name: "Astra Reel",
      logo: {
        enabled: true,
        anchor: "top_right",
        scale: 0.16,
        opacity: 0.85,
        padding_x: 28,
        padding_y: 28,
      },
      primary_color: "#6366F1",
      highlight_color: "#FACC15",
    };
  }

  public async loadLogo(imageSource: string | Blob): Promise<void> {
    try {
      if (typeof window !== "undefined") {
        if (typeof imageSource === "string") {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.src = imageSource;
          await img.decode();
          this.logoImage = img;
        } else if (imageSource instanceof Blob) {
          this.logoImage = await createImageBitmap(imageSource);
        }
      }
    } catch (e) {
      console.warn("Failed to load brand logo image:", e);
      this.logoImage = null;
    }
  }

  public drawBrandOverlay(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number
  ): void {
    if (!this.profile.logo.enabled) return;

    const logo = this.profile.logo;
    const paddingX = logo.padding_x ?? 28;
    const paddingY = logo.padding_y ?? 28;
    const opacity = logo.opacity ?? 0.85;

    ctx.save();
    ctx.globalAlpha = opacity;

    if (this.logoImage) {
      // Calculate scaled dimensions
      const aspect = this.logoImage.width / this.logoImage.height;
      const targetW = canvasWidth * logo.scale;
      const targetH = targetW / aspect;

      let x = paddingX;
      let y = paddingY;

      switch (logo.anchor) {
        case "top_left":
          x = paddingX;
          y = paddingY;
          break;
        case "top_right":
          x = canvasWidth - targetW - paddingX;
          y = paddingY;
          break;
        case "bottom_left":
          x = paddingX;
          y = canvasHeight - targetH - paddingY;
          break;
        case "bottom_right":
          x = canvasWidth - targetW - paddingX;
          y = canvasHeight - targetH - paddingY;
          break;
      }

      ctx.drawImage(this.logoImage, x, y, targetW, targetH);
    } else if (this.profile.brand_name) {
      // Elegant minimal text badge fallback
      const tagText = this.profile.brand_name.toUpperCase();
      const fontSize = Math.round(canvasHeight * 0.018); // ~23px on 1280h
      ctx.font = `700 ${fontSize}px Inter, sans-serif`;

      const textMetrics = ctx.measureText(tagText);
      const badgeW = textMetrics.width + 24;
      const badgeH = fontSize * 1.8;

      let bx = paddingX;
      let by = paddingY;

      if (logo.anchor === "top_right" || logo.anchor === "bottom_right") {
        bx = canvasWidth - badgeW - paddingX;
      }
      if (logo.anchor === "bottom_left" || logo.anchor === "bottom_right") {
        by = canvasHeight - badgeH - paddingY;
      }

      // Rounded pill backing
      ctx.fillStyle = "rgba(15, 23, 42, 0.75)";
      ctx.beginPath();
      const r = badgeH / 2;
      ctx.roundRect(bx, by, badgeW, badgeH, r);
      ctx.fill();

      // Border glow
      ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Brand text
      ctx.fillStyle = "#FFFFFF";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(tagText, bx + badgeW / 2, by + badgeH / 2);
    }

    ctx.restore();
  }
}
