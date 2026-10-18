/**
 * Crop Geometry and Aspect Ratio Engine
 * Ported from CropGeometryCalculator (services/ai-worker/app/services/crop_planner.py)
 * Computes strictly bounded 9:16 (or custom aspect) pixel and normalized crop boxes.
 */

import { CropBoxPixels, NormalizedCropBox } from "../schemas";

export function parseAspectRatio(ratioStr: string): number {
  const cleaned = ratioStr.trim().toLowerCase();
  if (cleaned.includes(":")) {
    const parts = cleaned.split(":");
    if (parts.length !== 2) {
      throw new Error(`Invalid aspect ratio format '${ratioStr}'. Expected 'W:H' (e.g. '9:16').`);
    }
    const wVal = parseFloat(parts[0]);
    const hVal = parseFloat(parts[1]);
    if (wVal <= 0 || hVal <= 0 || isNaN(wVal) || isNaN(hVal)) {
      throw new Error("Aspect ratio components must be strictly positive numbers.");
    }
    return wVal / hVal;
  } else {
    const val = parseFloat(cleaned);
    if (val <= 0 || isNaN(val)) {
      throw new Error(`Aspect ratio must be strictly positive, got '${ratioStr}'.`);
    }
    return val;
  }
}

export class CropGeometryCalculator {
  public static calculateCropBox(
    sourceWidth: number,
    sourceHeight: number,
    targetAspectRatio: number,
    centerX: number,
    centerY: number
  ): { pixelBox: CropBoxPixels; normBox: NormalizedCropBox } {
    if (sourceWidth <= 0 || sourceHeight <= 0) {
      throw new Error(`Source dimensions must be positive, got ${sourceWidth}x${sourceHeight}`);
    }
    if (targetAspectRatio <= 0) {
      throw new Error(`Target aspect ratio must be positive, got ${targetAspectRatio}`);
    }

    const sourceAspect = sourceWidth / sourceHeight;
    let cropW: number;
    let cropH: number;

    if (sourceAspect >= targetAspectRatio) {
      // Source is wider than target (e.g. 16:9 source to 9:16 target) -> Full height crop
      cropH = sourceHeight;
      cropW = Math.round(cropH * targetAspectRatio);
      if (cropW > sourceWidth) {
        cropW = sourceWidth;
        cropH = Math.round(cropW / targetAspectRatio);
      }
    } else {
      // Source is narrower than target -> Full width crop
      cropW = sourceWidth;
      cropH = Math.round(cropW / targetAspectRatio);
      if (cropH > sourceHeight) {
        cropH = sourceHeight;
        cropW = Math.round(cropH * targetAspectRatio);
      }
    }

    cropW = Math.max(1, Math.min(cropW, sourceWidth));
    cropH = Math.max(1, Math.min(cropH, sourceHeight));

    // Center the crop window around (centerX, centerY)
    let left = Math.round(centerX - cropW / 2.0);
    let top = Math.round(centerY - cropH / 2.0);

    // Clamp strictly within source dimensions
    left = Math.max(0, Math.min(left, sourceWidth - cropW));
    top = Math.max(0, Math.min(top, sourceHeight - cropH));

    const xMinNorm = Math.round((left / sourceWidth) * 10000) / 10000;
    const yMinNorm = Math.round((top / sourceHeight) * 10000) / 10000;
    const widthNorm = Math.round((cropW / sourceWidth) * 10000) / 10000;
    const heightNorm = Math.round((cropH / sourceHeight) * 10000) / 10000;

    const pixelBox: CropBoxPixels = {
      x: left,
      y: top,
      width: cropW,
      height: cropH,
    };

    const normBox: NormalizedCropBox = {
      x_min: xMinNorm,
      y_min: yMinNorm,
      width: widthNorm,
      height: heightNorm,
    };

    return { pixelBox, normBox };
  }
}
