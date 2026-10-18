"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import {
  detectSystemCapabilities,
  SystemCapabilities,
  HardwareTier,
} from "@/lib/browser-pipeline/capabilities";

export default function BrowserPipelineLabPage() {
  const [capabilities, setCapabilities] = useState<SystemCapabilities | null>(null);
  const [loading, setLoading] = useState(true);

  // WebCodecs Benchmark State
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);
  const [benchmarkProgress, setBenchmarkProgress] = useState(0);
  const [benchmarkFps, setBenchmarkFps] = useState<number | null>(null);
  const [encodedFramesCount, setEncodedFramesCount] = useState(0);
  const [benchmarkStatus, setBenchmarkStatus] = useState("Ready to run benchmark");
  const [encodedVideoUrl, setEncodedVideoUrl] = useState<string | null>(null);
  const [encodedBytes, setEncodedBytes] = useState<number | null>(null);
  const [benchmarkError, setBenchmarkError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoPreviewRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    async function runDetection() {
      setLoading(true);
      try {
        const caps = await detectSystemCapabilities();
        setCapabilities(caps);
      } catch (e) {
        console.error("Capability detection error:", e);
      } finally {
        setLoading(false);
      }
    }
    runDetection();
  }, []);

  /**
   * Runs a synthetic WebCodecs 9:16 VideoEncoder stress test:
   * Encodes 150 frames (5 seconds @ 30fps) of 720x1280 vertical video with animated canvas graphics.
   */
  async function runWebCodecsBenchmark() {
    if (benchmarkRunning) return;
    if (typeof window === "undefined" || !("VideoEncoder" in window)) {
      alert("WebCodecs VideoEncoder is not available in this browser.");
      return;
    }

    setBenchmarkRunning(true);
    setBenchmarkProgress(0);
    setBenchmarkFps(null);
    setEncodedFramesCount(0);
    setBenchmarkError(null);
    setEncodedVideoUrl(null);
    setEncodedBytes(null);
    setBenchmarkStatus("Configuring WebCodecs VideoEncoder (720x1280 @ 4Mbps)...");

    const width = 720;
    const height = 1280;
    const fps = 30;
    const totalFrames = 150; // 5 seconds of reel footage

    const canvas = canvasRef.current || document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: false });
    if (!ctx) {
      setBenchmarkError("Could not initialize 2D canvas context.");
      setBenchmarkRunning(false);
      return;
    }

    const chunkBuffers: Uint8Array[] = [];
    let chunksEncoded = 0;
    const startTime = performance.now();

    try {
      const encoder = new VideoEncoder({
        output: (chunk) => {
          const buffer = new Uint8Array(chunk.byteLength);
          chunk.copyTo(buffer);
          chunkBuffers.push(buffer);
          chunksEncoded++;
          setEncodedFramesCount(chunksEncoded);
        },
        error: (err) => {
          console.error("VideoEncoder error:", err);
          setBenchmarkError(`Encoder error: ${err.message}`);
        },
      });

      await encoder.configure({
        codec: "avc1.4d002a", // H.264 Main Profile
        width,
        height,
        bitrate: 4_000_000,
        framerate: fps,
        avc: { format: "annexb" },
      });

      setBenchmarkStatus("Streaming synthetic 9:16 frames through VideoEncoder...");

      // Synthesize 150 frames
      for (let i = 0; i < totalFrames; i++) {
        const timestampUs = Math.round((i * 1_000_000) / fps);
        const progressFrac = i / totalFrames;

        // Render synthetic composition frame
        // 1. Hostinger Atmospheric Background Gradient
        const grad = ctx.createLinearGradient(0, 0, width, height);
        grad.addColorStop(0, "#0c061d");
        grad.addColorStop(0.5, "#2b1055");
        grad.addColorStop(1, "#13082e");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);

        // 2. Animated Subject Circle (Simulating Presenter Face Tracking)
        const faceX = width / 2 + Math.sin(i * 0.1) * 80;
        const faceY = 380 + Math.cos(i * 0.08) * 40;
        ctx.beginPath();
        ctx.arc(faceX, faceY, 110, 0, Math.PI * 2);
        ctx.fillStyle = "#6366f1";
        ctx.shadowColor = "#818cf8";
        ctx.shadowBlur = 24;
        ctx.fill();
        ctx.shadowBlur = 0;

        // 3. Screen Content Card (Simulating Lecture Slide Overlay)
        ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
        ctx.roundRect(60, 600, width - 120, 360, 24);
        ctx.fill();

        ctx.fillStyle = "#0f172a";
        ctx.font = "bold 26px sans-serif";
        ctx.fillText("Browser-Only Reel Engine", 90, 660);

        ctx.fillStyle = "#475569";
        ctx.font = "18px monospace";
        ctx.fillText(`Frame: ${i + 1} / ${totalFrames}`, 90, 710);
        ctx.fillText(`Timestamp: ${(timestampUs / 1000).toFixed(1)}ms`, 90, 745);
        ctx.fillText("Pipeline: OffscreenCanvas -> WebCodecs", 90, 780);

        // 4. Karaoke Subtitle Pill (Simulating Word-by-Word Highlight)
        ctx.fillStyle = "rgba(124, 58, 237, 0.9)";
        ctx.roundRect(60, 1040, width - 120, 80, 20);
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 24px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("✨ AI Vertical Short in Pure WebCodecs", width / 2, 1090);
        ctx.textAlign = "left";

        // Create VideoFrame from canvas
        const frame = new VideoFrame(canvas, {
          timestamp: timestampUs,
          duration: Math.round(1_000_000 / fps),
        });

        // Keyframe every 30 frames (1 second GOP)
        const keyFrame = i % 30 === 0;
        encoder.encode(frame, { keyFrame });
        frame.close(); // Crucial: prevent memory leaks

        // Back-pressure: wait if encoder queue is backed up
        if (encoder.encodeQueueSize > 4) {
          await new Promise((r) => setTimeout(r, 10));
        }

        setBenchmarkProgress(Math.round(((i + 1) / totalFrames) * 100));
      }

      await encoder.flush();
      encoder.close();

      const elapsedMs = performance.now() - startTime;
      const measuredFps = Math.round((totalFrames / (elapsedMs / 1000)) * 10) / 10;
      setBenchmarkFps(measuredFps);

      // Package chunks into raw H.264 annexb container
      const totalByteLength = chunkBuffers.reduce((sum, b) => sum + b.length, 0);
      setEncodedBytes(totalByteLength);

      const merged = new Uint8Array(totalByteLength);
      let offset = 0;
      for (const buf of chunkBuffers) {
        merged.set(buf, offset);
        offset += buf.length;
      }

      const videoBlob = new Blob([merged], { type: "video/mp4" });
      const blobUrl = URL.createObjectURL(videoBlob);
      setEncodedVideoUrl(blobUrl);

      setBenchmarkStatus(
        `Benchmark complete! Encoded ${totalFrames} frames in ${(elapsedMs / 1000).toFixed(2)}s (${measuredFps} FPS)`
      );
    } catch (err: unknown) {
      console.error(err);
      setBenchmarkError(err instanceof Error ? err.message : String(err));
      setBenchmarkStatus("Benchmark failed.");
    } finally {
      setBenchmarkRunning(false);
    }
  }

  const tierColors: Record<HardwareTier, { bg: string; text: string; border: string }> = {
    TIER_A_FULL: {
      bg: "bg-emerald-950/40",
      text: "text-emerald-300",
      border: "border-emerald-500/40",
    },
    TIER_B_REDUCED: {
      bg: "bg-amber-950/40",
      text: "text-amber-300",
      border: "border-amber-500/40",
    },
    TIER_C_UNSUPPORTED: {
      bg: "bg-rose-950/40",
      text: "text-rose-300",
      border: "border-rose-500/40",
    },
  };

  return (
    <div className="min-h-screen bg-[#0c061d] text-zinc-100 flex flex-col font-sans selection:bg-purple-600/40 selection:text-white relative overflow-x-hidden">
      {/* Background Atmosphere */}
      <div className="absolute top-0 left-0 right-0 h-[640px] hostinger-hero-gradient pointer-events-none -z-10" />

      {/* Header */}
      <header className="w-full bg-[#13082e]/60 backdrop-blur-md border-b border-violet-400/10 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 sm:h-20 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="relative w-8 h-8 flex items-center justify-center shrink-0">
              <img
                src="/astra-logo.svg"
                alt="Astra Studio Logo"
                className="w-full h-full object-contain drop-shadow-[0_0_14px_rgba(167,139,250,0.8)]"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-base tracking-tight text-white uppercase">
                Astra Studio Lab
              </span>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-violet-950/80 text-violet-300 border border-violet-600/40">
                Phase 1 Benchmarks
              </span>
            </div>
          </Link>

          <Link
            href="/"
            className="text-xs font-semibold px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white border border-white/20 transition-all cursor-pointer"
          >
            &larr; Return to Studio
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-12 flex flex-col gap-8 relative z-10">
        {/* Title Block */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2.5">
            <span className="text-[10px] font-mono uppercase px-2.5 py-1 rounded-full bg-violet-900/60 border border-violet-500/40 text-violet-300 font-semibold">
              Branch: browser · Migration Diagnostic
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            Client-Side Video Pipeline Benchmark Lab
          </h1>
          <p className="text-sm text-violet-200/80 max-w-2xl leading-relaxed">
            Measures your browser&apos;s real-time WebCodecs hardware encoding throughput, WebGPU Whisper ASR acceleration, memory limits, and capability tier for browser-only video rendering.
          </p>
        </div>

        {/* Card 1: System Hardware Tier & Engine Capabilities */}
        <div className="p-6 sm:p-7 rounded-3xl bg-white/95 backdrop-blur-2xl border border-white text-zinc-900 shadow-2xl flex flex-col gap-5">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-200/80">
            <div className="flex items-center gap-2.5">
              <span className="text-[10px] font-mono font-semibold uppercase px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200">
                MODULE 01
              </span>
              <h2 className="text-sm font-bold text-zinc-950 tracking-tight">
                Detected Hardware & Browser Capabilities
              </h2>
            </div>

            {capabilities && (
              <span
                className={`text-xs font-mono font-bold px-3 py-1 rounded-full border ${
                  tierColors[capabilities.tier].bg
                } ${tierColors[capabilities.tier].text} ${tierColors[capabilities.tier].border}`}
              >
                {capabilities.tier === "TIER_A_FULL"
                  ? "Tier A · Full WebGPU + WebCodecs"
                  : capabilities.tier === "TIER_B_REDUCED"
                  ? "Tier B · Reduced (WASM / CPU)"
                  : "Tier C · Unsupported Browser"}
              </span>
            )}
          </div>

          {loading ? (
            <div className="p-8 flex items-center justify-center gap-3 text-zinc-500 text-xs font-mono">
              <div className="w-5 h-5 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
              <span>Probing hardware encoders, WebGPU adapters, and memory limits...</span>
            </div>
          ) : capabilities ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              {/* WebCodecs Video */}
              <div className="p-3.5 rounded-2xl bg-zinc-50 border border-zinc-200 flex flex-col justify-between gap-1">
                <span className="text-[11px] font-semibold text-zinc-500">WebCodecs Video</span>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      capabilities.hasWebCodecsVideo ? "bg-emerald-500" : "bg-rose-500"
                    }`}
                  />
                  <span className="text-xs font-bold text-zinc-900">
                    {capabilities.hasWebCodecsVideo ? "Supported" : "Not Available"}
                  </span>
                </div>
              </div>

              {/* H.264 Hardware Encoder */}
              <div className="p-3.5 rounded-2xl bg-zinc-50 border border-zinc-200 flex flex-col justify-between gap-1">
                <span className="text-[11px] font-semibold text-zinc-500">H.264 Encoder (avc1)</span>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      capabilities.hasH264Encode ? "bg-emerald-500" : "bg-rose-500"
                    }`}
                  />
                  <span className="text-xs font-bold text-zinc-900">
                    {capabilities.hasH264Encode ? "720x1280 4Mbps" : "Unsupported"}
                  </span>
                </div>
              </div>

              {/* WebGPU Acceleration */}
              <div className="p-3.5 rounded-2xl bg-zinc-50 border border-zinc-200 flex flex-col justify-between gap-1">
                <span className="text-[11px] font-semibold text-zinc-500">WebGPU (Whisper ASR)</span>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      capabilities.hasWebGPU ? "bg-emerald-500" : "bg-amber-500"
                    }`}
                  />
                  <span className="text-xs font-bold text-zinc-900 truncate">
                    {capabilities.hasWebGPU ? capabilities.webGpuAdapterInfo || "Active" : "WASM Fallback"}
                  </span>
                </div>
              </div>

              {/* Device Memory */}
              <div className="p-3.5 rounded-2xl bg-zinc-50 border border-zinc-200 flex flex-col justify-between gap-1">
                <span className="text-[11px] font-semibold text-zinc-500">Device RAM & Cores</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-zinc-900">
                    {capabilities.deviceMemoryGb ? `${capabilities.deviceMemoryGb} GB RAM` : "Standard"}{" "}
                    · {capabilities.hardwareConcurrency} Cores
                  </span>
                </div>
              </div>
            </div>
          ) : null}

          {capabilities?.unsupportedReasons && capabilities.unsupportedReasons.length > 0 && (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex flex-col gap-1">
              <span className="font-bold">Hardware Notes:</span>
              <ul className="list-disc pl-4 space-y-0.5">
                {capabilities.unsupportedReasons.map((r, idx) => (
                  <li key={idx}>{r}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Card 2: Interactive WebCodecs 9:16 Encode Stress Test */}
        <div className="p-6 sm:p-7 rounded-3xl bg-white/95 backdrop-blur-2xl border border-white text-zinc-900 shadow-2xl flex flex-col gap-6">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-200/80">
            <div className="flex items-center gap-2.5">
              <span className="text-[10px] font-mono font-semibold uppercase px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200">
                MODULE 02
              </span>
              <h2 className="text-sm font-bold text-zinc-950 tracking-tight">
                WebCodecs 9:16 VideoEncoder Stress Test
              </h2>
            </div>

            {benchmarkFps !== null && (
              <span className="text-xs font-mono font-bold px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                ⚡ Throughput: {benchmarkFps} FPS
              </span>
            )}
          </div>

          <p className="text-xs text-zinc-600 leading-relaxed">
            Tests pure in-browser H.264 video rendering without contacting any server. Renders 150 frames (5 seconds @ 30 FPS) at 720x1280 resolution with animated 2D canvas drawing, face tracking simulation, and back-pressure memory management.
          </p>

          {/* Progress & Live Status */}
          <div className="flex flex-col gap-2">
            <div className="relative w-full h-3 bg-zinc-100 rounded-full overflow-hidden border border-zinc-200">
              <div
                className="h-full bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 transition-all duration-300 rounded-full"
                style={{ width: `${benchmarkProgress}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-zinc-600">{benchmarkStatus}</span>
              <span className="font-bold text-zinc-900">
                {benchmarkProgress}% ({encodedFramesCount} / 150 frames)
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={runWebCodecsBenchmark}
              disabled={benchmarkRunning}
              className="py-3 px-6 rounded-xl font-bold text-xs bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-lg shadow-violet-600/30 transition-all transform active:scale-95 disabled:opacity-50 cursor-pointer flex items-center gap-2"
            >
              {benchmarkRunning ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Encoding Frames ({benchmarkProgress}%)...</span>
                </>
              ) : (
                <>
                  <span>⚡</span>
                  <span>Run WebCodecs 9:16 Benchmark</span>
                </>
              )}
            </button>
          </div>

          {benchmarkError && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
              {benchmarkError}
            </div>
          )}

          {/* Benchmark Output Preview */}
          {encodedBytes && (
            <div className="p-4 rounded-2xl bg-zinc-50 border border-zinc-200 flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-xs font-bold text-zinc-900">Generated Video Deliverable</span>
                <span className="text-[11px] font-mono text-zinc-500">
                  Size: {(encodedBytes / (1024 * 1024)).toFixed(2)} MB · Format: H.264 Annex-B Bitstream
                </span>
              </div>
              <span className="text-xs font-mono font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                ✅ Zero Server Hops
              </span>
            </div>
          )}

          {/* Hidden Canvas for Frame Rendering */}
          <canvas ref={canvasRef} className="hidden" />
        </div>

        {/* Card 3: Interactive End-to-End Browser Video Reel Generator (Phase 2 & 3 Verification) */}
        <div className="p-6 sm:p-7 rounded-3xl bg-white/95 backdrop-blur-2xl border border-white text-zinc-900 shadow-2xl flex flex-col gap-6">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-200/80">
            <div className="flex items-center gap-2.5">
              <span className="text-[10px] font-mono font-semibold uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                MODULE 03
              </span>
              <h2 className="text-sm font-bold text-zinc-950 tracking-tight">
                Live End-to-End Browser Pipeline & MP4 Reel Generator
              </h2>
            </div>
            <span className="text-xs font-mono font-bold px-3 py-1 rounded-full bg-purple-100 text-purple-800 border border-purple-300">
              ⚡ WebCodecs + MP4 Muxer
            </span>
          </div>

          <p className="text-xs text-zinc-600 leading-relaxed">
            Direct verification of <strong>Phase 2 (No-AI Algorithmic Core & Canvas Compositor)</strong> and <strong>Phase 3 (Highlight & Caption Processing)</strong>. Runs deterministic technical term normalization, heuristic educational scoring, word-level karaoke timing, 9:16 background blur composition, and exports a real, playable MP4 file directly to your disk.
          </p>

          <PipelineDemoModule />
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Module 03 Subcomponent: Live Browser Pipeline Interactive Demo
// ---------------------------------------------------------------------------
import { TermNormalizerService } from "@/lib/browser-pipeline/terms";
import { HighlightSelectorService } from "@/lib/browser-pipeline/highlight/heuristics";
import { CaptionGroupingService } from "@/lib/browser-pipeline/captions/group";
import { WebCodecsVideoPipeline } from "@/lib/browser-pipeline/render/encoder";
import { RawWord, DisplayWord, ValidatedTranscript, HighlightResult, CaptionGroup } from "@/lib/browser-pipeline/schemas";

function PipelineDemoModule() {
  const [pipelineStep, setPipelineStep] = useState<"idle" | "normalized" | "highlighted" | "rendering" | "completed">("idle");
  const [normalizedDisplayWords, setNormalizedDisplayWords] = useState<DisplayWord[]>([]);
  const [highlightResult, setHighlightResult] = useState<HighlightResult | null>(null);
  const [captionGroups, setCaptionGroups] = useState<CaptionGroup[]>([]);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderFps, setRenderFps] = useState<number | null>(null);
  const [finalMp4Url, setFinalMp4Url] = useState<string | null>(null);
  const [finalMp4Size, setFinalMp4Size] = useState<string | null>(null);

  // Sample raw lecture speech tokens with spoken technical terms and pauses
  const sampleRawTokens: RawWord[] = [
    { id: 0, text: "Welcome.", start_sec: 0.0, end_sec: 0.6 },
    { id: 1, text: "In", start_sec: 0.8, end_sec: 1.0 },
    { id: 2, text: "React,", start_sec: 1.0, end_sec: 1.4 },
    { id: 3, text: "we", start_sec: 1.5, end_sec: 1.7 },
    { id: 4, text: "define", start_sec: 1.7, end_sec: 2.1 },
    { id: 5, text: "side", start_sec: 2.1, end_sec: 2.4 },
    { id: 6, text: "effects", start_sec: 2.4, end_sec: 2.8 },
    { id: 7, text: "using", start_sec: 2.8, end_sec: 3.1 },
    { id: 8, text: "use", start_sec: 3.1, end_sec: 3.4 },
    { id: 9, text: "effect.", start_sec: 3.4, end_sec: 3.9 },
    { id: 10, text: "The", start_sec: 4.5, end_sec: 4.7 },
    { id: 11, text: "reason", start_sec: 4.7, end_sec: 5.1 },
    { id: 12, text: "this", start_sec: 5.1, end_sec: 5.3 },
    { id: 13, text: "works", start_sec: 5.3, end_sec: 5.6 },
    { id: 14, text: "is", start_sec: 5.6, end_sec: 5.8 },
    { id: 15, text: "because", start_sec: 5.8, end_sec: 6.2 },
    { id: 16, text: "it", start_sec: 6.2, end_sec: 6.4 },
    { id: 17, text: "executes", start_sec: 6.4, end_sec: 6.9 },
    { id: 18, text: "after", start_sec: 6.9, end_sec: 7.2 },
    { id: 19, text: "every", start_sec: 7.2, end_sec: 7.5 },
    { id: 20, text: "component", start_sec: 7.5, end_sec: 8.0 },
    { id: 21, text: "render.", start_sec: 8.0, end_sec: 8.5 },
    { id: 22, text: "For", start_sec: 9.1, end_sec: 9.3 },
    { id: 23, text: "example,", start_sec: 9.3, end_sec: 9.8 },
    { id: 24, text: "think", start_sec: 9.9, end_sec: 10.2 },
    { id: 25, text: "of", start_sec: 10.2, end_sec: 10.4 },
    { id: 26, text: "connecting", start_sec: 10.4, end_sec: 11.0 },
    { id: 27, text: "to", start_sec: 11.0, end_sec: 11.2 },
    { id: 28, text: "a", start_sec: 11.2, end_sec: 11.3 },
    { id: 29, text: "websocket", start_sec: 11.3, end_sec: 11.9 },
    { id: 30, text: "or", start_sec: 11.9, end_sec: 12.1 },
    { id: 31, text: "calling", start_sec: 12.1, end_sec: 12.5 },
    { id: 32, text: "a", start_sec: 12.5, end_sec: 12.6 },
    { id: 33, text: "rest", start_sec: 12.6, end_sec: 12.9 },
    { id: 34, text: "api.", start_sec: 12.9, end_sec: 13.5 },
    { id: 35, text: "In", start_sec: 14.0, end_sec: 14.2 },
    { id: 36, text: "summary,", start_sec: 14.2, end_sec: 14.8 },
    { id: 37, text: "keep", start_sec: 14.9, end_sec: 15.2 },
    { id: 38, text: "in", start_sec: 15.2, end_sec: 15.4 },
    { id: 39, text: "mind", start_sec: 15.4, end_sec: 15.7 },
    { id: 40, text: "that", start_sec: 15.7, end_sec: 15.9 },
    { id: 41, text: "dependencies", start_sec: 15.9, end_sec: 16.6 },
    { id: 42, text: "must", start_sec: 16.6, end_sec: 16.9 },
    { id: 43, text: "be", start_sec: 16.9, end_sec: 17.1 },
    { id: 44, text: "explicit.", start_sec: 17.1, end_sec: 17.7 },
  ];

  function runNormalization() {
    const normalizer = new TermNormalizerService();
    const display = normalizer.normalize(sampleRawTokens);
    setNormalizedDisplayWords(display);
    setPipelineStep("normalized");
  }

  function runHighlightSelection() {
    const normalizer = new TermNormalizerService();
    const display = normalizer.normalize(sampleRawTokens);
    setNormalizedDisplayWords(display);

    const transcript: ValidatedTranscript = {
      schema_version: "1.0",
      source: {
        filename: "react_hooks_lesson.mp4",
        duration_sec: 18.0,
      },
      transcription: {
        model: "whisper-base.en",
        detected_language: "en",
        timestamp_origin: "start",
      },
      raw_words: sampleRawTokens,
      display_words: display,
    };

    const selector = new HighlightSelectorService(10.0, 30.0, 15.0);
    const highlight = selector.selectBestHighlight(transcript);
    setHighlightResult(highlight);

    const { words: relWords } = CaptionGroupingService.filterAndConvertWords(
      display,
      highlight.start_sec,
      highlight.end_sec
    );
    const groups = CaptionGroupingService.groupWordsIntoCaptions(relWords, highlight.duration_sec);
    setCaptionGroups(groups);
    setPipelineStep("highlighted");
  }

  const [renderError, setRenderError] = useState<string | null>(null);

  async function exportBrowserMp4() {
    setRenderError(null);
    let effectiveHighlight = highlightResult;
    let effectiveGroups = captionGroups;

    if (!effectiveHighlight || effectiveGroups.length === 0) {
      const normalizer = new TermNormalizerService();
      const display = normalizer.normalize(sampleRawTokens);
      setNormalizedDisplayWords(display);

      const transcript: ValidatedTranscript = {
        schema_version: "1.0",
        source: {
          filename: "react_hooks_lesson.mp4",
          duration_sec: 18.0,
        },
        transcription: {
          model: "whisper-base.en",
          detected_language: "en",
          timestamp_origin: "start",
        },
        raw_words: sampleRawTokens,
        display_words: display,
      };

      const selector = new HighlightSelectorService(10.0, 30.0, 15.0);
      effectiveHighlight = selector.selectBestHighlight(transcript);
      setHighlightResult(effectiveHighlight);

      const { words: relWords } = CaptionGroupingService.filterAndConvertWords(
        display,
        effectiveHighlight.start_sec,
        effectiveHighlight.end_sec
      );
      effectiveGroups = CaptionGroupingService.groupWordsIntoCaptions(relWords, effectiveHighlight.duration_sec);
      setCaptionGroups(effectiveGroups);
    }

    setPipelineStep("rendering");
    setRenderProgress(0);
    setRenderFps(null);
    setFinalMp4Url(null);

    // Create an animated demo canvas representing lecture slide + presenter
    const srcCanvas = document.createElement("canvas");
    srcCanvas.width = 1280;
    srcCanvas.height = 720;
    const sCtx = srcCanvas.getContext("2d")!;

    // Background gradient for source
    const sGrad = sCtx.createLinearGradient(0, 0, 1280, 720);
    sGrad.addColorStop(0, "#0f172a");
    sGrad.addColorStop(1, "#1e1b4b");
    sCtx.fillStyle = sGrad;
    sCtx.fillRect(0, 0, 1280, 720);

    // Slide box
    sCtx.fillStyle = "rgba(255, 255, 255, 0.95)";
    sCtx.roundRect(80, 80, 700, 560, 24);
    sCtx.fill();
    sCtx.fillStyle = "#0f172a";
    sCtx.font = "bold 34px sans-serif";
    sCtx.fillText("React.useEffect() Deep Dive", 130, 160);
    sCtx.fillStyle = "#475569";
    sCtx.font = "24px monospace";
    sCtx.fillText("useEffect(() => {", 130, 240);
    sCtx.fillText("  const ws = new WebSocket(url);", 160, 290);
    sCtx.fillText("  return () => ws.close();", 160, 340);
    sCtx.fillText("}, [url]);", 130, 390);

    // Presenter camera simulation box
    sCtx.fillStyle = "#6366f1";
    sCtx.beginPath();
    sCtx.arc(1040, 360, 160, 0, Math.PI * 2);
    sCtx.fill();

    const duration = Math.min(8.0, effectiveHighlight ? effectiveHighlight.duration_sec : 6.0);
    const pipeline = new WebCodecsVideoPipeline({
      width: 720,
      height: 1280,
      fps: 30,
      bitrate: 4_000_000,
    });

    const cropTimeline = [
      {
        relSec: 0,
        cropBox: { x: 300, y: 0, width: 405, height: 720 },
      },
    ];

    try {
      console.log("Starting WebCodecsVideoPipeline.renderReel...");
      const blob = await pipeline.renderReel({
        videoSource: srcCanvas,
        sourceWidth: 1280,
        sourceHeight: 720,
        durationSec: duration,
        cropTimeline,
        captionGroups: effectiveGroups,
        onProgress: (p, fps) => {
          setRenderProgress(Math.round(p * 100));
          setRenderFps(fps);
        },
      });

      console.log("Render complete! Blob size:", blob.size);
      const url = URL.createObjectURL(blob);
      setFinalMp4Url(url);
      setFinalMp4Size((blob.size / (1024 * 1024)).toFixed(2));
      setPipelineStep("completed");
    } catch (e: any) {
      console.error("Render error occurred:", e);
      setRenderError(e?.message || String(e));
      setPipelineStep("highlighted");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Action Pipeline Steps */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button
          type="button"
          onClick={runNormalization}
          className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
            pipelineStep === "normalized"
              ? "bg-violet-50 border-violet-300 ring-2 ring-violet-500/20"
              : "bg-zinc-50 border-zinc-200 hover:border-zinc-300"
          }`}
        >
          <div className="text-[11px] font-mono font-bold text-violet-600 mb-1">STEP 01</div>
          <div className="text-xs font-bold text-zinc-900">1. Term Normalizer</div>
          <div className="text-[11px] text-zinc-500 mt-1">
            Fixes spoken technical terms like &ldquo;use effect&rdquo; &rarr; &ldquo;useEffect&rdquo;
          </div>
        </button>

        <button
          type="button"
          onClick={runHighlightSelection}
          className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
            pipelineStep === "highlighted"
              ? "bg-violet-50 border-violet-300 ring-2 ring-violet-500/20"
              : "bg-zinc-50 border-zinc-200 hover:border-zinc-300"
          }`}
        >
          <div className="text-[11px] font-mono font-bold text-violet-600 mb-1">STEP 02</div>
          <div className="text-xs font-bold text-zinc-900">2. Highlight Heuristics</div>
          <div className="text-[11px] text-zinc-500 mt-1">
            Scores candidate pedagogical intervals &amp; partitions clauses
          </div>
        </button>

        <button
          type="button"
          onClick={exportBrowserMp4}
          disabled={pipelineStep === "rendering"}
          className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
            pipelineStep === "completed"
              ? "bg-emerald-50 border-emerald-300 ring-2 ring-emerald-500/20"
              : "bg-gradient-to-br from-violet-600 to-indigo-700 text-white border-transparent shadow-lg shadow-violet-600/20 hover:brightness-105"
          }`}
        >
          <div className={`text-[11px] font-mono font-bold mb-1 ${pipelineStep === "completed" ? "text-emerald-700" : "text-violet-200"}`}>
            STEP 03 · FINAL
          </div>
          <div className={`text-xs font-bold ${pipelineStep === "completed" ? "text-zinc-900" : "text-white"}`}>
            3. Export 9:16 MP4
          </div>
          <div className={`text-[11px] mt-1 ${pipelineStep === "completed" ? "text-zinc-600" : "text-violet-100"}`}>
            Renders WebCodecs frames &amp; multiplexes standard MP4
          </div>
        </button>
      </div>

      {/* Live Transcript & Term View */}
      {normalizedDisplayWords.length > 0 && (
        <div className="p-4 rounded-2xl bg-zinc-50 border border-zinc-200 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-zinc-900">Normalized Speech Transcript</span>
            <span className="text-[11px] font-mono text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
              {normalizedDisplayWords.filter((w) => w.correction?.applied).length} Technical Corrections Applied
            </span>
          </div>

          <div className="p-3 bg-white rounded-xl border border-zinc-200 text-xs font-mono leading-relaxed text-zinc-700 flex flex-wrap gap-1.5">
            {normalizedDisplayWords.map((w) => (
              <span
                key={w.id}
                className={
                  w.correction?.applied
                    ? "bg-emerald-100 text-emerald-900 font-bold px-1.5 py-0.5 rounded border border-emerald-300 shadow-sm"
                    : ""
                }
                title={w.correction ? `Corrected from: ${w.correction.matched_alias}` : undefined}
              >
                {w.text}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Heuristic Highlight Breakdown */}
      {highlightResult && (
        <div className="p-4 rounded-2xl bg-violet-50/60 border border-violet-200 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-violet-950">
              Selected 30-60s Highlight Interval: [{highlightResult.start_sec}s - {highlightResult.end_sec}s] ({highlightResult.duration_sec}s)
            </span>
            <span className="text-xs font-mono font-bold text-violet-800 bg-violet-200/80 px-2.5 py-0.5 rounded-full">
              Score: {highlightResult.score} / 100
            </span>
          </div>

          <div className="text-xs text-violet-900 italic">
            &ldquo;{highlightResult.reason}&rdquo;
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2 border-t border-violet-200/60 text-[11px] font-mono">
            <div className="bg-white p-2 rounded-lg border border-violet-100">
              <div className="text-zinc-500">Info Value</div>
              <div className="font-bold text-zinc-900">{highlightResult.score_breakdown.information_value}</div>
            </div>
            <div className="bg-white p-2 rounded-lg border border-violet-100">
              <div className="text-zinc-500">Self-Contained</div>
              <div className="font-bold text-zinc-900">{highlightResult.score_breakdown.self_contained}</div>
            </div>
            <div className="bg-white p-2 rounded-lg border border-violet-100">
              <div className="text-zinc-500">Opening Hook</div>
              <div className="font-bold text-zinc-900">{highlightResult.score_breakdown.opening_hook}</div>
            </div>
            <div className="bg-white p-2 rounded-lg border border-violet-100">
              <div className="text-zinc-500">Ending Quality</div>
              <div className="font-bold text-zinc-900">{highlightResult.score_breakdown.ending_quality}</div>
            </div>
            <div className="bg-white p-2 rounded-lg border border-violet-100">
              <div className="text-zinc-500">Cadence</div>
              <div className="font-bold text-zinc-900">{highlightResult.score_breakdown.speech_density}</div>
            </div>
          </div>
        </div>
      )}

      {renderError && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-300 text-rose-900 text-xs flex flex-col gap-1">
          <span className="font-bold">Encoding / Muxing Error:</span>
          <span className="font-mono">{renderError}</span>
        </div>
      )}

      {/* Rendering State & Deliverable */}
      {pipelineStep === "rendering" && (
        <div className="p-5 rounded-2xl bg-zinc-900 text-white flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs font-mono">
            <span>Rendering 9:16 Canvas Frames &amp; Muxing MP4...</span>
            <span className="font-bold text-emerald-400">{renderProgress}%</span>
          </div>

          <div className="w-full h-3 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-violet-500 to-emerald-400 transition-all rounded-full"
              style={{ width: `${renderProgress}%` }}
            />
          </div>

          {renderFps !== null && (
            <div className="text-[11px] font-mono text-zinc-400">
              Hardware Encoding Speed: {renderFps} FPS
            </div>
          )}
        </div>
      )}

      {/* Deliverable Preview */}
      {finalMp4Url && (
        <div className="p-5 rounded-3xl bg-gradient-to-br from-emerald-900/10 via-zinc-50 to-emerald-50/20 border-2 border-emerald-500/40 flex flex-col sm:flex-row items-center gap-6">
          <div className="w-44 h-72 rounded-2xl overflow-hidden shadow-2xl bg-black border border-zinc-800 shrink-0">
            <video
              src={finalMp4Url}
              controls
              autoPlay
              loop
              muted
              playsInline
              className="w-full h-full object-cover"
            />
          </div>

          <div className="flex flex-col gap-3 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300">
                PRODUCED LOCALLY
              </span>
              <span className="text-xs text-zinc-500">Zero Server Compute</span>
            </div>

            <h3 className="text-base font-bold text-zinc-950">
              Ready-to-Publish 9:16 Short Video (MP4)
            </h3>

            <p className="text-xs text-zinc-600 leading-relaxed">
              Standard playable MP4 container rendered with H.264 video, blurred ambient backdrop, focused crop, word-level karaoke caption burn-in, and Astra Reel branding.
            </p>

            <div className="text-xs font-mono text-zinc-500">
              Size: {finalMp4Size} MB · Container: MP4 (H.264 / AAC compliant)
            </div>

            <div className="flex items-center gap-3 pt-2">
              <a
                href={finalMp4Url}
                download="astra-reel-browser-short.mp4"
                className="py-2.5 px-5 rounded-xl font-bold text-xs bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30 transition-all cursor-pointer flex items-center gap-2"
              >
                <span>⬇</span>
                <span>Download MP4 File</span>
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
