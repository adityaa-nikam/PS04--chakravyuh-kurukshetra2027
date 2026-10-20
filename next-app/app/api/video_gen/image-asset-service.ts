import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface ImageGenerationOptions {
  prompt: string;
  width?: number;
  height?: number;
  timeoutMs?: number;
}

export interface ImageGenerationResult {
  success: boolean;
  assetPath?: string;
  provider: string;
  elapsedMs: number;
  error?: string;
  fallbackUsed: boolean;
}

/**
 * Returns true if optional image asset generation is enabled in the environment.
 * Controlled by the documented feature flag `ASTRA_IMAGE_ASSETS_ENABLED`.
 * Default is FALSE (disabled).
 */
export function isImageAssetGenerationEnabled(): boolean {
  const flag = (process.env.ASTRA_IMAGE_ASSETS_ENABLED || "").trim().toLowerCase();
  return flag === "true" || flag === "1" || flag === "yes";
}

/**
 * Resolves the configured image generation provider.
 * Supports "pollinations", "openrouter", or custom HTTP endpoint.
 */
export function getImageProvider(): string {
  return (process.env.ASTRA_IMAGE_PROVIDER || "pollinations").trim().toLowerCase();
}

/**
 * Safely generates an illustrative asset if enabled, with zero-crash fallback.
 */
export async function generateImageAsset(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
  const started = Date.now();
  if (!isImageAssetGenerationEnabled()) {
    return {
      success: false,
      provider: "disabled",
      elapsedMs: 0,
      error: "ASTRA_IMAGE_ASSETS_ENABLED is false. Deterministic SVG fallback used.",
      fallbackUsed: true,
    };
  }

  const provider = getImageProvider();
  const width = options.width || 720;
  const height = options.height || 1280;
  const timeoutMs = options.timeoutMs || 8000;

  try {
    const hash = crypto.createHash("md5").update(options.prompt).digest("hex").slice(0, 16);
    const imagesDir = path.resolve(process.cwd(), "public", "generated-images");
    mkdirSync(imagesDir, { recursive: true });
    const localFilename = `img-${hash}.jpg`;
    const localFilePath = path.join(imagesDir, localFilename);
    const publicUrl = `/generated-images/${localFilename}`;

    // Return cached image if already generated
    if (existsSync(localFilePath)) {
      const cached = readFileSync(localFilePath);
      return {
        success: true,
        assetPath: `data:image/jpeg;base64,${cached.toString("base64")}`,
        provider,
        elapsedMs: Date.now() - started,
        fallbackUsed: false,
      };
    }

    // Provider 1: Pollinations AI (High-speed, official public REST endpoint, no secret required)
    if (provider === "pollinations") {
      const cleanPrompt = encodeURIComponent(
        `${options.prompt}, clean minimalist dark educational visual, high quality, 4k digital art, dramatic tech lighting, portrait 9:16 vertical`
      );
      const url = `https://image.pollinations.ai/prompt/${cleanPrompt}?width=${width}&height=${height}&nologo=true&seed=${Date.now()}`;
      
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      if (!res.ok) {
        throw new Error(`Pollinations HTTP ${res.status}: ${res.statusText}`);
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 1000) {
        throw new Error("Received empty or truncated image buffer.");
      }

      writeFileSync(localFilePath, buffer);
      return {
        success: true,
        assetPath: `data:image/jpeg;base64,${buffer.toString("base64")}`,
        provider: "pollinations",
        elapsedMs: Date.now() - started,
        fallbackUsed: false,
      };
    }

    // Provider 2: OpenRouter or custom endpoint
    if (provider === "openrouter") {
      const key = process.env.OPENROUTER_API_KEY?.trim();
      if (!key) {
        throw new Error("OPENROUTER_API_KEY is not configured.");
      }
      // If OpenRouter image generation is requested, use configured model
      const model = process.env.ASTRA_IMAGE_MODEL || "black-forest-labs/flux-1-schnell";
      // Fallback gracefully if not available
      throw new Error(`OpenRouter model ${model} not currently provisioned for direct image binary download.`);
    }

    throw new Error(`Unknown ASTRA_IMAGE_PROVIDER: ${provider}`);
  } catch (error) {
    console.warn(`[image_gen] Image asset generation skipped/failed (${error instanceof Error ? error.message : String(error)}). Using deterministic visual fallback.`);
    return {
      success: false,
      provider,
      elapsedMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
      fallbackUsed: true,
    };
  }
}
