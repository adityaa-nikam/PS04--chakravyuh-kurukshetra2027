/**
 * Crop Smoother Engine
 * Ported from CropSmoother (services/ai-worker/app/services/crop_planner.py)
 * Smooths crop center trajectories using an exponential moving average (EMA)
 * with bounded pan velocity and deadband filtering.
 */

export class CropSmoother {
  public alpha: number;
  public maxVelocityPerSec: number;
  public deadbandNorm: number;
  public smoothedCenter: [number, number] | null = null;
  public prevTimestamp: number | null = null;

  constructor(
    alpha: number = 0.35,
    maxVelocityPerSec: number = 0.35,
    deadbandNorm: number = 0.03
  ) {
    this.alpha = alpha;
    this.maxVelocityPerSec = maxVelocityPerSec;
    this.deadbandNorm = deadbandNorm;
  }

  public reset(): void {
    this.smoothedCenter = null;
    this.prevTimestamp = null;
  }

  public smooth(
    targetCenter: [number, number],
    timestampSec: number,
    isCut: boolean,
    frameWidth: number,
    frameHeight: number
  ): [number, number] {
    const [tx, ty] = targetCenter;

    if (isCut || this.smoothedCenter === null || this.prevTimestamp === null) {
      this.smoothedCenter = [tx, ty];
      this.prevTimestamp = timestampSec;
      return [tx, ty];
    }

    const dt = Math.max(0.01, timestampSec - this.prevTimestamp);
    const [sx, sy] = this.smoothedCenter;

    // Check deadband to avoid camera jitter on micro-movements
    const deadbandX = this.deadbandNorm * frameWidth;
    const deadbandY = this.deadbandNorm * frameHeight;
    const diffTargetX = Math.abs(tx - sx);
    const diffTargetY = Math.abs(ty - sy);

    const effectiveTx = diffTargetX < deadbandX ? sx : tx;
    const effectiveTy = diffTargetY < deadbandY ? sy : ty;

    // 1. Exponential moving average
    let emaX = this.alpha * effectiveTx + (1.0 - this.alpha) * sx;
    let emaY = this.alpha * effectiveTy + (1.0 - this.alpha) * sy;

    // 2. Maximum velocity limit
    const maxShiftX = this.maxVelocityPerSec * frameWidth * dt;
    const maxShiftY = this.maxVelocityPerSec * frameHeight * dt;

    const diffX = emaX - sx;
    const diffY = emaY - sy;

    if (Math.abs(diffX) > maxShiftX) {
      emaX = sx + Math.sign(diffX) * maxShiftX;
    }
    if (Math.abs(diffY) > maxShiftY) {
      emaY = sy + Math.sign(diffY) * maxShiftY;
    }

    this.smoothedCenter = [emaX, emaY];
    this.prevTimestamp = timestampSec;
    return [emaX, emaY];
  }
}
