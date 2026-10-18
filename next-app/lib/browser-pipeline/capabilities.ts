/**
 * Browser Video Pipeline - Hardware & Engine Capabilities Detection
 * Phase 1 Benchmark & Tier Detection
 */

export type HardwareTier = "TIER_A_FULL" | "TIER_B_REDUCED" | "TIER_C_UNSUPPORTED";

export interface SystemCapabilities {
  tier: HardwareTier;
  hasWebCodecsVideo: boolean;
  hasWebCodecsAudio: boolean;
  hasH264Encode: boolean;
  hasAACEncode: boolean;
  hasWebGPU: boolean;
  webGpuAdapterInfo?: string;
  hasWasmSimd: boolean;
  hasSharedArrayBuffer: boolean;
  isCrossOriginIsolated: boolean;
  deviceMemoryGb: number | null;
  hardwareConcurrency: number;
  estimatedStorageQuotaMb: number | null;
  unsupportedReasons: string[];
}

export async function detectSystemCapabilities(): Promise<SystemCapabilities> {
  const reasons: string[] = [];
  let hasWebCodecsVideo = false;
  let hasWebCodecsAudio = false;
  let hasH264Encode = false;
  let hasAACEncode = false;
  let hasWebGPU = false;
  let webGpuAdapterInfo: string | undefined;

  // 1. WebCodecs Video & H.264 Check
  if (typeof window !== "undefined" && "VideoEncoder" in window && "VideoDecoder" in window) {
    hasWebCodecsVideo = true;
    try {
      const config = {
        codec: "avc1.4d002a", // H.264 Main Profile Level 4.2 (Standard 720p/1080p)
        width: 720,
        height: 1280,
        bitrate: 4_000_000,
        framerate: 30,
      };
      const support = await VideoEncoder.isConfigSupported(config);
      hasH264Encode = !!support.supported;
      if (!hasH264Encode) {
        reasons.push("WebCodecs H.264 (avc1) hardware/software encode is not supported in this browser.");
      }
    } catch (e) {
      hasH264Encode = false;
      reasons.push(`H.264 support check failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    reasons.push("WebCodecs API (VideoEncoder/VideoDecoder) is not supported in this browser environment.");
  }

  // 2. WebCodecs Audio & AAC Check
  if (typeof window !== "undefined" && "AudioEncoder" in window && "AudioDecoder" in window) {
    hasWebCodecsAudio = true;
    try {
      const config = {
        codec: "mp4a.40.2", // AAC-LC
        sampleRate: 44100,
        numberOfChannels: 2,
        bitrate: 128000,
      };
      const support = await AudioEncoder.isConfigSupported(config);
      hasAACEncode = !!support.supported;
    } catch {
      hasAACEncode = false;
    }
  }

  // 3. WebGPU Check (for Whisper ONNX acceleration)
  if (typeof navigator !== "undefined" && "gpu" in navigator && (navigator as any).gpu) {
    try {
      const adapter = await (navigator as any).gpu.requestAdapter();
      if (adapter) {
        hasWebGPU = true;
        const info = (await adapter.requestAdapterInfo?.()) || null;
        webGpuAdapterInfo = info
          ? `${info.vendor || ""} ${info.architecture || ""} (${info.description || ""})`.trim()
          : "Active WebGPU Adapter";
      }
    } catch {
      hasWebGPU = false;
    }
  }

  // 4. Memory & Threads
  const isCrossOriginIsolated = typeof window !== "undefined" && !!window.crossOriginIsolated;
  const hasSharedArrayBuffer = typeof SharedArrayBuffer !== "undefined";
  const deviceMemoryGb =
    typeof navigator !== "undefined" && "deviceMemory" in navigator
      ? (navigator as any).deviceMemory
      : null;
  const hardwareConcurrency =
    typeof navigator !== "undefined" && navigator.hardwareConcurrency
      ? navigator.hardwareConcurrency
      : 4;

  let estimatedStorageQuotaMb: number | null = null;
  if (typeof navigator !== "undefined" && navigator.storage && navigator.storage.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      if (estimate.quota) {
        estimatedStorageQuotaMb = Math.round(estimate.quota / (1024 * 1024));
      }
    } catch {}
  }

  // 5. Tier Decision
  let tier: HardwareTier = "TIER_C_UNSUPPORTED";
  if (!hasWebCodecsVideo || !hasH264Encode) {
    tier = "TIER_C_UNSUPPORTED";
  } else if (hasWebGPU && (deviceMemoryGb === null || deviceMemoryGb >= 6)) {
    tier = "TIER_A_FULL";
  } else {
    tier = "TIER_B_REDUCED";
  }

  return {
    tier,
    hasWebCodecsVideo,
    hasWebCodecsAudio,
    hasH264Encode,
    hasAACEncode,
    hasWebGPU,
    webGpuAdapterInfo,
    hasWasmSimd: true,
    hasSharedArrayBuffer,
    isCrossOriginIsolated,
    deviceMemoryGb,
    hardwareConcurrency,
    estimatedStorageQuotaMb,
    unsupportedReasons: reasons,
  };
}
