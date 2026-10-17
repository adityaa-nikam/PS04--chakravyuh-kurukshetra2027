"use client";

import { Suspense, useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { PipelineRenderedClip } from "@/lib/pipeline/client";

// ----------------------------------------------------------------------------
// Topic Sanitizer
// ----------------------------------------------------------------------------
function sanitizeTopic(title: string): string {
  if (!title) return "Computer Science Concept";
  return title
    .replace(/^\s*\(\d+\)\s*/, "") // Remove leading "(41) "
    .replace(/^\s*\[.*?\]\s*/, "") // Remove leading "[Full Course] "
    .replace(/^\s*#\d+\s*/, "")    // Remove leading "#1 "
    .replace(/\|\s*.*$/, "")        // Remove trailing channel name e.g. "| FreeCodeCamp"
    .replace(/-\s*YouTube$/i, "")
    .trim();
}

type PipelineStage =
  | "idle"
  | "submitting"
  | "DOWNLOADING"
  | "INGESTING"
  | "EXTRACTING_AUDIO"
  | "TRANSCRIBING"
  | "NORMALIZING_TERMS"
  | "SELECTING_MOMENT"
  | "PLANNING_CROPS"
  | "RENDERING_VIDEO"
  | "COMPLETED"
  | "FAILED";

type QualityPreset = "360p" | "480p" | "720p" | "1080p";

function ImportContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const videoPlayerRef = useRef<HTMLVideoElement>(null);

  // Query parameters from Chrome Extension
  const rawUrl = searchParams.get("url") || "";
  const rawId = searchParams.get("id") || "";
  const rawTitle = searchParams.get("title") || "";

  // State
  const [videoId, setVideoId] = useState(rawId);
  const [videoUrl, setVideoUrl] = useState(rawUrl);
  const [videoTitle, setVideoTitle] = useState(rawTitle || "YouTube Video");
  const [customTopic, setCustomTopic] = useState("");
  const [manualInput, setManualInput] = useState("");

  // Quality Preset (DEFAULT 360p as requested)
  const [downloadQuality, setDownloadQuality] = useState<QualityPreset>("360p");

  // Pipeline form states
  const [captionStyle, setCaptionStyle] = useState<"karaoke" | "minimal" | "bold" | "neon">("karaoke");
  const [compositionMode, setCompositionMode] = useState<"adaptive" | "presenter" | "screen_content">("adaptive");
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [targetClips, setTargetClips] = useState(3);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Real-time Pipeline Execution & Tracking State
  const [pipelineStage, setPipelineStage] = useState<PipelineStage>("idle");
  const [pipelineProgress, setPipelineProgress] = useState(0);
  const [stageMessage, setStageMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [activeJobId, setActiveJobId] = useState("");
  const [renderedClips, setRenderedClips] = useState<PipelineRenderedClip[]>([]);
  const [selectedClipIndex, setSelectedClipIndex] = useState(0);
  const [elapsedSec, setElapsedSec] = useState<number | null>(null);

  // Video playback state
  const [isPlaying, setIsPlaying] = useState(false);

  // Clean up polling timer on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  // Parse and validate incoming params on mount or param change
  useEffect(() => {
    let parsedId = rawId.trim();
    let parsedUrl = rawUrl.trim();

    if (!parsedId && parsedUrl) {
      try {
        const u = new URL(parsedUrl);
        const v = u.searchParams.get("v");
        if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) {
          parsedId = v;
        } else {
          const match = u.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
          if (match) parsedId = match[1];
        }
      } catch {
        // invalid URL
      }
    }

    if (parsedId && /^[a-zA-Z0-9_-]{11}$/.test(parsedId)) {
      setVideoId(parsedId);
      setVideoUrl(`https://www.youtube.com/watch?v=${parsedId}`);
      const titleToUse = rawTitle || "YouTube Video";
      setVideoTitle(titleToUse);
      const clean = sanitizeTopic(titleToUse);
      setCustomTopic(`Explain ${clean} with visual examples`);
    }
  }, [rawId, rawUrl, rawTitle]);

  // Handle manual YouTube link paste
  const handleManualImport = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");

    const input = manualInput.trim();
    if (!input) return;

    let extractedId: string | null = null;

    if (/^[a-zA-Z0-9_-]{11}$/.test(input)) {
      extractedId = input;
    } else {
      try {
        const u = new URL(input.startsWith("http") ? input : `https://${input}`);
        const v = u.searchParams.get("v");
        if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) {
          extractedId = v;
        } else {
          const match = u.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
          if (match) extractedId = match[1];
        }
      } catch {
        setErrorMessage("Please enter a valid YouTube URL (e.g. https://www.youtube.com/watch?v=...)");
        return;
      }
    }

    if (extractedId) {
      setVideoId(extractedId);
      setVideoUrl(`https://www.youtube.com/watch?v=${extractedId}`);
      setVideoTitle(`YouTube Video (${extractedId})`);
      setCustomTopic(`Explain YouTube Video (${extractedId}) with visual code examples`);
      setManualInput("");
    } else {
      setErrorMessage("Could not extract a valid 11-character YouTube video ID.");
    }
  };

  // --------------------------------------------------------------------------
  // Direct YouTube Download & AI Pipeline Trigger
  // --------------------------------------------------------------------------
  const handleStartYouTubePipeline = async () => {
    const targetUrl = videoUrl || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : "");
    if (!targetUrl) {
      setErrorMessage("Please select or paste a valid YouTube video URL first.");
      return;
    }

    setErrorMessage("");
    setPipelineStage("submitting");
    setPipelineProgress(3);
    setStageMessage(`Connecting to Python AI worker for YouTube stream download (${downloadQuality})...`);
    setRenderedClips([]);
    setSelectedClipIndex(0);
    setElapsedSec(null);

    try {
      const res = await fetch("/api/ai/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          youtubeUrl: targetUrl,
          downloadQuality,
          renderVideo: true,
          subtitles: subtitlesEnabled,
          captionStyle,
          compositionMode,
          maxClips: targetClips,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Server responded with status ${res.status}`);
      }

      const newJobId = data.jobId || data.job_id;
      setActiveJobId(newJobId);
      setPipelineStage("DOWNLOADING");
      setPipelineProgress(5);
      setStageMessage(data.message || `Download initiated at ${downloadQuality}. Polling live status...`);

      startStatusPolling(newJobId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to initiate YouTube pipeline.";
      setPipelineStage("FAILED");
      setErrorMessage(msg);
      setStageMessage(`Error: ${msg}`);
    }
  };

  // --------------------------------------------------------------------------
  // Status Polling for Real-Time UI Tracking
  // --------------------------------------------------------------------------
  const startStatusPolling = (jobIdToPoll: string) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/ai/pipeline/${encodeURIComponent(jobIdToPoll)}`);
        if (!res.ok) return;

        const { job } = await res.json();
        if (!job) return;

        setPipelineStage(job.status as PipelineStage);
        setPipelineProgress(job.progress_pct ?? 0);
        setStageMessage(job.stage_message || job.status);

        if (job.rendered_clips && job.rendered_clips.length > 0) {
          setRenderedClips(job.rendered_clips);
        }

        if (job.status === "COMPLETED") {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          setElapsedSec(job.elapsed_sec ?? null);
          if (job.rendered_clips && job.rendered_clips.length > 0) {
            setRenderedClips(job.rendered_clips);
            setSelectedClipIndex(0);
          }
        } else if (job.status === "FAILED") {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          setErrorMessage(job.error_message || job.stage_message || "Processing failed.");
        }
      } catch (err) {
        console.warn("Polling error:", err);
      }
    }, 1200);
  };

  // --------------------------------------------------------------------------
  // Alternative: Instant Remotion Explainer Reel (Synthetic, No Download)
  // --------------------------------------------------------------------------
  const handleLaunchInstantRemotion = () => {
    const topicToLaunch = customTopic.trim() || `Explain ${sanitizeTopic(videoTitle)}`;
    router.push(`/?mode=ai_prompt&topic=${encodeURIComponent(topicToLaunch)}&autoStart=true#studio-workspace`);
  };

  // --------------------------------------------------------------------------
  // Alternative: Manual Local File Upload
  // --------------------------------------------------------------------------
  const handleStartFilePipeline = async () => {
    if (!selectedFile) {
      if (fileInputRef.current) fileInputRef.current.click();
      return;
    }

    setErrorMessage("");
    setPipelineStage("submitting");
    setPipelineProgress(5);
    setStageMessage("Uploading video file to workspace storage...");

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("renderVideo", "true");
      formData.append("subtitles", subtitlesEnabled ? "true" : "false");
      formData.append("captionStyle", captionStyle);
      formData.append("compositionMode", compositionMode);
      formData.append("maxClips", targetClips.toString());

      const res = await fetch("/api/ai/pipeline", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Server responded with status ${res.status}`);
      }

      const newJobId = data.jobId || data.job_id;
      setActiveJobId(newJobId);
      setPipelineStage("EXTRACTING_AUDIO");
      setPipelineProgress(10);
      setStageMessage(data.message || "File uploaded. Probing media and extracting audio...");

      startStatusPolling(newJobId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to upload and start pipeline.";
      setPipelineStage("FAILED");
      setErrorMessage(msg);
      setStageMessage(`Error: ${msg}`);
    }
  };

  const isRunning =
    pipelineStage !== "idle" &&
    pipelineStage !== "COMPLETED" &&
    pipelineStage !== "FAILED";

  const hasValidVideo = Boolean(videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId));
  const currentClip = renderedClips[selectedClipIndex] || null;

  // Real-time Pipeline Stage List for Visual Tracking
  const pipelineSteps = [
    { key: "DOWNLOADING", label: `0. YT (${downloadQuality})` },
    { key: "EXTRACTING_AUDIO", label: "1. Audio Extract" },
    { key: "TRANSCRIBING", label: "2. Whisper ASR" },
    { key: "SELECTING_MOMENT", label: "3. Best Highlight" },
    { key: "PLANNING_CROPS", label: "4. CV 9:16 Crop" },
    { key: "RENDERING_VIDEO", label: "5. FFmpeg Reel" },
  ];

  const getStepStatus = (stepKey: string) => {
    if (pipelineStage === "COMPLETED") return "done";
    if (pipelineStage === "FAILED") return "failed";

    if (stepKey === "DOWNLOADING") {
      if (pipelineStage === "DOWNLOADING") return "current";
      if (["INGESTING", "EXTRACTING_AUDIO", "TRANSCRIBING", "NORMALIZING_TERMS", "SELECTING_MOMENT", "PLANNING_CROPS", "RENDERING_VIDEO"].includes(pipelineStage)) return "done";
      return "pending";
    }

    if (stepKey === "EXTRACTING_AUDIO") {
      if (["INGESTING", "EXTRACTING_AUDIO"].includes(pipelineStage)) return "current";
      if (["TRANSCRIBING", "NORMALIZING_TERMS", "SELECTING_MOMENT", "PLANNING_CROPS", "RENDERING_VIDEO"].includes(pipelineStage)) return "done";
      return "pending";
    }

    if (stepKey === "TRANSCRIBING") {
      if (["TRANSCRIBING", "NORMALIZING_TERMS"].includes(pipelineStage)) return "current";
      if (["SELECTING_MOMENT", "PLANNING_CROPS", "RENDERING_VIDEO"].includes(pipelineStage)) return "done";
      return "pending";
    }

    if (stepKey === "SELECTING_MOMENT") {
      if (pipelineStage === "SELECTING_MOMENT") return "current";
      if (["PLANNING_CROPS", "RENDERING_VIDEO"].includes(pipelineStage)) return "done";
      return "pending";
    }

    if (stepKey === "PLANNING_CROPS") {
      if (pipelineStage === "PLANNING_CROPS") return "current";
      if (pipelineStage === "RENDERING_VIDEO") return "done";
      return "pending";
    }

    if (stepKey === "RENDERING_VIDEO") {
      if (pipelineStage === "RENDERING_VIDEO") return "current";
      return "pending";
    }

    return "pending";
  };

  return (
    <div className="min-h-screen hostinger-hero-gradient text-zinc-100 flex flex-col font-sans selection:bg-violet-600 selection:text-white">
      {/* Top Header / Nav */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-[#0c061d]/80 border-b border-violet-500/15">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <img
              src="/astra-logo.svg"
              alt="Astra Studio Logo"
              className="w-8 h-8 object-contain transition-transform group-hover:scale-105"
            />
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-lg tracking-tight text-white">Astra Studio</span>
              <span className="text-[10px] font-mono font-semibold uppercase px-2 py-0.5 rounded-full bg-violet-950/90 text-violet-300 border border-violet-500/30">
                YouTube Pipeline
              </span>
            </div>
          </Link>

          <div className="flex items-center gap-3 text-xs">
            <Link
              href="/"
              className="text-zinc-300 hover:text-white px-3 py-1.5 rounded-lg border border-zinc-800 hover:bg-zinc-800/60 transition-colors flex items-center gap-1.5"
            >
              <span>&larr; Studio Workspace</span>
            </Link>
            <Link
              href="/upload"
              className="text-violet-300 hover:text-white px-3 py-1.5 rounded-lg bg-violet-950/60 border border-violet-600/40 hover:bg-violet-900/60 transition-colors"
            >
              Publisher
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Header */}
      <section className="pt-8 pb-4 px-4 sm:px-6 text-center max-w-3xl mx-auto flex flex-col items-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-950/80 border border-violet-500/30 text-violet-300 text-xs font-mono uppercase mb-3">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>YouTube Direct Ingestion &amp; 9:16 Shorts Generation</span>
        </div>
        <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-white">
          Convert YouTube Video to Vertical 9:16 Shorts
        </h1>
        <p className="text-xs sm:text-sm text-violet-200/80 mt-2 max-w-2xl leading-relaxed">
          Download video directly from YouTube at your preferred quality, extract speech highlights with Whisper, track faces and screens with OpenCV, and render synchronized 9:16 vertical shorts.
        </p>
      </section>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-4 pb-20">
        {!hasValidVideo ? (
          /* Empty / Manual Entry State */
          <div className="max-w-xl mx-auto p-8 rounded-3xl bg-white/95 backdrop-blur-2xl border border-white text-zinc-900 shadow-[0_24px_50px_-12px_rgba(0,0,0,0.5)] flex flex-col gap-5 text-center">
            <div className="w-14 h-14 rounded-2xl bg-violet-100 border border-violet-200 text-violet-600 flex items-center justify-center mx-auto">
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-zinc-950">No Active YouTube Video Attached</h2>
              <p className="text-xs text-zinc-600 mt-1.5 leading-relaxed">
                Click <strong>✦ Create with Astra</strong> on any YouTube video via the extension, or paste a YouTube URL below to import.
              </p>
            </div>

            <form onSubmit={handleManualImport} className="flex flex-col gap-3 mt-2 text-left">
              <label htmlFor="yt-url-input" className="text-xs font-bold text-zinc-700">
                Paste YouTube Video URL or ID:
              </label>
              <div className="flex gap-2">
                <input
                  id="yt-url-input"
                  type="text"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                  className="flex-1 bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2.5 text-xs text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-600/15"
                />
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs transition-colors shadow-sm cursor-pointer shrink-0"
                >
                  Import
                </button>
              </div>
            </form>

            {errorMessage && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs text-left">
                {errorMessage}
              </div>
            )}
          </div>
        ) : (
          /* Active Imported YouTube Video Workstation */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left Column: Captured YouTube Source & Status */}
            <div className="lg:col-span-5 flex flex-col gap-6">
              <div className="p-6 sm:p-7 rounded-3xl bg-white/95 backdrop-blur-2xl border border-white text-zinc-900 shadow-[0_24px_50px_-12px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.4)] flex flex-col gap-4">
                <div className="flex items-center justify-between pb-3 border-b border-zinc-200/80">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200">
                      SOURCE
                    </span>
                    <h2 className="text-sm font-bold text-zinc-950">Captured YouTube Video</h2>
                  </div>
                  <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                    Ready
                  </span>
                </div>

                {/* YouTube Video Thumbnail Card */}
                <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-zinc-950 shadow-md group">
                  <img
                    src={`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`}
                    alt={videoTitle}
                    className="w-full h-full object-cover transition-transform group-hover:scale-105"
                  />
                  <div className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded bg-red-600/90 text-white font-bold text-[10px] uppercase tracking-wider flex items-center gap-1">
                    <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
                      <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z" />
                    </svg>
                    <span>YouTube</span>
                  </div>
                  <div className="absolute bottom-2.5 right-2.5 px-2 py-0.5 rounded bg-black/80 text-white font-mono text-[10px]">
                    ID: {videoId}
                  </div>
                </div>

                {/* Video Title */}
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 font-mono">
                    Video Title
                  </label>
                  <p className="text-base font-bold text-zinc-950 leading-snug">
                    {videoTitle}
                  </p>
                </div>

                {/* Video URL Link */}
                <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-50 border border-zinc-200 text-xs">
                  <span className="font-mono text-zinc-600 truncate max-w-[240px]">
                    {videoUrl}
                  </span>
                  <a
                    href={videoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-violet-600 font-semibold hover:text-violet-800 flex items-center gap-1 shrink-0"
                  >
                    <span>Watch</span>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>

                {/* Information Callout */}
                <div className="p-3.5 rounded-2xl bg-violet-50/80 border border-violet-200/80 text-violet-900 text-xs flex items-start gap-2.5 leading-relaxed">
                  <div className="w-5 h-5 rounded-md bg-violet-200/80 text-violet-800 flex items-center justify-center shrink-0 mt-0.5">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <span className="font-bold">What happens next:</span>
                    <p className="mt-1 text-zinc-700">
                      Astra downloads this YouTube video directly to local storage at your chosen quality, executes Faster-Whisper transcription, detects the best 30-60s pedagogical highlights, plans 9:16 dynamic camera crops, and renders vertical short clips with karaoke captions.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Generation Pathways & Live Pipeline Tracker */}
            <div className="lg:col-span-7 flex flex-col gap-6">
              
              {/* ============================================================ */}
              {/* HERO CARD: DIRECT YOUTUBE DOWNLOAD & REEL GENERATION PIPELINE */}
              {/* ============================================================ */}
              <div className="p-6 sm:p-7 rounded-3xl bg-gradient-to-br from-white via-white to-violet-50/60 backdrop-blur-2xl border-2 border-violet-400/60 text-zinc-900 shadow-[0_24px_50px_-12px_rgba(124,58,237,0.25)] flex flex-col gap-5 relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono font-bold uppercase px-2.5 py-1 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-xs">
                      PRIMARY PIPELINE
                    </span>
                    <span className="text-xs font-bold text-violet-950">Direct Ingestion</span>
                  </div>
                  <span className="text-xs font-mono text-violet-700 font-semibold flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-violet-600 animate-pulse" />
                    <span>Whisper + CV 9:16</span>
                  </span>
                </div>

                <div>
                  <h3 className="text-xl font-extrabold text-zinc-950">
                    Download YouTube Video &amp; Generate 9:16 Shorts
                  </h3>
                  <p className="text-xs text-zinc-600 mt-1 leading-relaxed">
                    Downloads the original video stream directly from YouTube into Astra, extracts high-retention highlights, reframes to 9:16, and burns synchronized captions.
                  </p>
                </div>

                {/* Quality Selector Buttons (Default: 360p) */}
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-zinc-800 flex items-center justify-between">
                    <span>Choose Download Quality Preset:</span>
                    <span className="text-[11px] font-mono text-violet-600 font-semibold">
                      Selected: {downloadQuality}
                    </span>
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {(
                      [
                        { id: "360p", label: "360p", desc: "Fastest · Default", badge: "Default" },
                        { id: "480p", label: "480p", desc: "Standard", badge: null },
                        { id: "720p", label: "720p", desc: "HD Quality", badge: null },
                        { id: "1080p", label: "1080p", desc: "Full HD", badge: null },
                      ] as const
                    ).map((q) => {
                      const isSelected = downloadQuality === q.id;
                      return (
                        <button
                          key={q.id}
                          type="button"
                          disabled={isRunning}
                          onClick={() => setDownloadQuality(q.id)}
                          className={`p-3 rounded-2xl border text-left transition-all cursor-pointer relative ${
                            isSelected
                              ? "bg-violet-50/90 border-violet-600 text-violet-950 shadow-sm ring-2 ring-violet-500/20"
                              : "bg-white border-zinc-200/90 hover:border-zinc-300 text-zinc-700 hover:bg-zinc-50"
                          } ${isRunning ? "opacity-50 cursor-not-allowed" : ""}`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-extrabold text-sm">{q.label}</span>
                            {q.badge && (
                              <span className="text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-violet-600 text-white">
                                {q.badge}
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-zinc-500 block mt-0.5 font-medium">
                            {q.desc}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Pipeline Configuration Options */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-zinc-200/80 text-xs">
                  <div>
                    <label className="text-zinc-700 block mb-1 font-semibold">Caption Style</label>
                    <select
                      value={captionStyle}
                      onChange={(e) => setCaptionStyle(e.target.value as any)}
                      disabled={isRunning}
                      className="w-full bg-white border border-zinc-300 rounded-xl px-3 py-2 text-zinc-900 focus:outline-none focus:border-violet-600 font-medium"
                    >
                      <option value="karaoke">✨ Karaoke (Word Pop)</option>
                      <option value="minimal">Minimal Clean</option>
                      <option value="bold">Bold Punchy</option>
                      <option value="neon">Neon Glow</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-zinc-700 block mb-1 font-semibold">9:16 Framing Mode</label>
                    <select
                      value={compositionMode}
                      onChange={(e) => setCompositionMode(e.target.value as any)}
                      disabled={isRunning}
                      className="w-full bg-white border border-zinc-300 rounded-xl px-3 py-2 text-zinc-900 focus:outline-none focus:border-violet-600 font-medium"
                    >
                      <option value="adaptive">Dynamic Hybrid (CV)</option>
                      <option value="presenter">Presenter Focus</option>
                      <option value="screen_content">Screen / Slide Focus</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-zinc-700 block mb-1 font-semibold">Target Shorts</label>
                    <select
                      value={targetClips}
                      onChange={(e) => setTargetClips(parseInt(e.target.value, 10) || 3)}
                      disabled={isRunning}
                      className="w-full bg-white border border-zinc-300 rounded-xl px-3 py-2 text-zinc-900 focus:outline-none focus:border-violet-600 font-medium"
                    >
                      <option value={1}>1 Clip (Single Best)</option>
                      <option value={2}>2 Clips</option>
                      <option value={3}>3 Clips (Recommended)</option>
                      <option value={5}>5 Clips</option>
                    </select>
                  </div>
                </div>

                {/* Subtitles Toggle */}
                <div className="flex items-center justify-between text-xs pt-1">
                  <label className="flex items-center gap-2 text-zinc-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={subtitlesEnabled}
                      onChange={(e) => setSubtitlesEnabled(e.target.checked)}
                      disabled={isRunning}
                      className="rounded border-zinc-300 text-violet-600 focus:ring-violet-500 w-4 h-4 cursor-pointer"
                    />
                    <span className="font-semibold">Burn Synchronized Word-Level Karaoke Subtitles</span>
                  </label>
                  <span className="text-[11px] font-mono text-zinc-500">Fast CPU Whisper (int8)</span>
                </div>

                {/* Error Banner */}
                {errorMessage && (
                  <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
                    {errorMessage}
                  </div>
                )}

                {/* Action Launch Button */}
                <button
                  type="button"
                  onClick={handleStartYouTubePipeline}
                  disabled={isRunning}
                  className="w-full py-4 px-6 rounded-xl font-bold text-sm bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-xl shadow-violet-600/30 transition-all transform active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isRunning ? (
                    <>
                      <svg className="animate-spin w-4 h-4 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      <span>Processing YouTube Video ({pipelineProgress}%)...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 text-white fill-current" viewBox="0 0 24 24">
                        <path d="M12 2L14.6 9.4L22 12L14.6 14.6L12 22L9.4 14.6L2 12L9.4 9.4L12 2Z" />
                      </svg>
                      <span>Download YouTube Video &amp; Generate 9:16 Shorts ({downloadQuality}) &rarr;</span>
                    </>
                  )}
                </button>
              </div>

              {/* ============================================================ */}
              {/* REAL-TIME LIVE PIPELINE TRACKER CARD */}
              {/* ============================================================ */}
              {(pipelineStage !== "idle" || activeJobId) && (
                <div className="p-6 sm:p-7 rounded-3xl bg-white/95 backdrop-blur-2xl border border-white text-zinc-900 shadow-[0_24px_50px_-12px_rgba(0,0,0,0.5)] flex flex-col gap-4 transition-all">
                  <div className="flex items-center justify-between pb-3 border-b border-zinc-200/80">
                    <div className="flex items-center gap-2.5">
                      <span className="text-[10px] font-mono font-semibold uppercase px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200">
                        LIVE TRACKER
                      </span>
                      <h3 className="text-sm font-bold text-zinc-950">Real-Time Pipeline Progress</h3>
                    </div>
                    {activeJobId && (
                      <span className="font-mono text-xs px-2.5 py-1 rounded-lg bg-zinc-100 border border-zinc-200 text-violet-700 font-semibold select-all">
                        {activeJobId}
                      </span>
                    )}
                  </div>

                  {/* Progress Bar */}
                  <div className="relative w-full h-3 bg-zinc-100 rounded-full overflow-hidden border border-zinc-200/80">
                    <div
                      className={`h-full transition-all duration-500 rounded-full ${
                        pipelineStage === "FAILED"
                          ? "bg-rose-500"
                          : pipelineStage === "COMPLETED"
                          ? "bg-emerald-500"
                          : "bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-500 shadow-sm"
                      }`}
                      style={{ width: `${Math.max(3, pipelineProgress)}%` }}
                    />
                  </div>

                  {/* Status Message & Percentage */}
                  <div className="flex items-center justify-between text-xs font-medium">
                    <div className="flex items-center gap-2 text-zinc-700">
                      {isRunning && <span className="w-2 h-2 rounded-full bg-violet-600 animate-pulse" />}
                      <span className="font-semibold">{stageMessage || "Executing pipeline..."}</span>
                    </div>
                    <span className="font-mono font-bold text-zinc-950 text-sm">{pipelineProgress}%</span>
                  </div>

                  {/* Pipeline Stage Pills */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 text-xs pt-1">
                    {pipelineSteps.map((st) => {
                      const status = getStepStatus(st.key);
                      const isDone = status === "done";
                      const isCurrent = status === "current";

                      return (
                        <div
                          key={st.key}
                          className={`px-2 py-2 rounded-xl border text-center transition-all ${
                            isDone
                              ? "bg-emerald-50 border-emerald-300 text-emerald-800 font-semibold shadow-2xs"
                              : isCurrent
                              ? "bg-violet-100 border-violet-500 text-violet-950 font-bold ring-2 ring-violet-500/30 shadow-xs animate-pulse"
                              : "bg-zinc-100/70 border-zinc-200 text-zinc-400 font-medium"
                          }`}
                        >
                          <div className="flex items-center justify-center gap-1">
                            {isDone && <span className="text-emerald-600 font-bold">✓</span>}
                            <span>{st.label}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Completed Summary Banner */}
                  {pipelineStage === "COMPLETED" && (
                    <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-emerald-600 text-base">✨</span>
                        <div>
                          <span className="font-bold block">
                            Pipeline Complete! {renderedClips.length} vertical 9:16 short(s) generated.
                          </span>
                          {elapsedSec && (
                            <span className="text-emerald-700 text-[11px] font-mono">
                              Total elapsed time: {elapsedSec}s
                            </span>
                          )}
                        </div>
                      </div>
                      <Link
                        href="/#studio-workspace"
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-colors shadow-xs"
                      >
                        Open Studio &rarr;
                      </Link>
                    </div>
                  )}
                </div>
              )}

              {/* ============================================================ */}
              {/* RENDERED SHORT CLIPS PREVIEW CARD */}
              {/* ============================================================ */}
              {renderedClips.length > 0 && currentClip && (
                <div className="p-6 sm:p-7 rounded-3xl bg-white/95 backdrop-blur-2xl border border-white text-zinc-900 shadow-[0_24px_50px_-12px_rgba(0,0,0,0.5)] flex flex-col gap-5">
                  <div className="flex items-center justify-between pb-3 border-b border-zinc-200/80">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                        OUTPUT
                      </span>
                      <h3 className="text-sm font-bold text-zinc-950">Generated 9:16 Vertical Shorts</h3>
                    </div>
                    <span className="text-xs font-mono font-bold text-violet-700">
                      {renderedClips.length} Clip(s) Available
                    </span>
                  </div>

                  {/* Multi-Clip Switcher Tabs */}
                  {renderedClips.length > 1 && (
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {renderedClips.map((clip, idx) => {
                        const isSelected = idx === selectedClipIndex;
                        return (
                          <button
                            key={clip.clip_id}
                            type="button"
                            onClick={() => {
                              setSelectedClipIndex(idx);
                              setIsPlaying(false);
                            }}
                            className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer whitespace-nowrap flex items-center gap-2 ${
                              isSelected
                                ? "bg-violet-600 text-white border-violet-600 shadow-sm"
                                : "bg-zinc-100 text-zinc-700 border-zinc-200 hover:bg-zinc-200"
                            }`}
                          >
                            <span>Clip #{idx + 1}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${isSelected ? "bg-violet-700 text-white" : "bg-zinc-200 text-zinc-600"}`}>
                              {clip.pedagogical_score.toFixed(0)} pts
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Video Player & Clip Details */}
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-5 items-start">
                    {/* Video Player (9:16 Aspect) */}
                    <div className="sm:col-span-5 relative aspect-[9/16] w-full max-w-[240px] mx-auto rounded-2xl overflow-hidden bg-black shadow-lg border border-zinc-800">
                      <video
                        ref={videoPlayerRef}
                        src={currentClip.video_url || `/api/ai/video?filename=${encodeURIComponent(currentClip.download_filename || "")}`}
                        playsInline
                        controls
                        className="w-full h-full object-cover"
                        onPlay={() => setIsPlaying(true)}
                        onPause={() => setIsPlaying(false)}
                      />
                    </div>

                    {/* Clip Details and Action Buttons */}
                    <div className="sm:col-span-7 flex flex-col gap-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded bg-violet-100 text-violet-700">
                            Clip #{selectedClipIndex + 1}
                          </span>
                          <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">
                            Pedagogical Score: {currentClip.pedagogical_score.toFixed(1)} / 100
                          </span>
                        </div>
                        <h4 className="text-base font-bold text-zinc-950 leading-snug">
                          {currentClip.title}
                        </h4>
                        <p className="text-xs text-zinc-600 mt-1 italic">
                          &ldquo;{currentClip.topic_summary}&rdquo;
                        </p>
                      </div>

                      <div className="p-3 rounded-xl bg-zinc-50 border border-zinc-200 text-xs font-mono text-zinc-600 flex flex-col gap-1">
                        <div className="flex justify-between">
                          <span>Duration:</span>
                          <span className="font-bold text-zinc-900">{currentClip.duration_sec.toFixed(1)}s</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Timeline Range:</span>
                          <span className="font-bold text-zinc-900">
                            {Math.floor(currentClip.start_time_sec / 60)}:
                            {Math.floor(currentClip.start_time_sec % 60).toString().padStart(2, "0")}{" "}
                            &rarr; {Math.floor(currentClip.end_time_sec / 60)}:
                            {Math.floor(currentClip.end_time_sec % 60).toString().padStart(2, "0")}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Captions:</span>
                          <span className="font-bold text-violet-700 capitalize">{captionStyle} (Word-Level)</span>
                        </div>
                      </div>

                      {/* Download & Publish Actions */}
                      <div className="flex flex-col gap-2 pt-2">
                        <a
                          href={`${currentClip.video_url || `/api/ai/video?filename=${encodeURIComponent(currentClip.download_filename || "")}`}&download=true&downloadName=${encodeURIComponent(currentClip.download_filename || "reel.mp4")}`}
                          download={currentClip.download_filename || "reel.mp4"}
                          className="w-full py-2.5 px-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white font-bold text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm text-center"
                        >
                          <svg className="w-4 h-4 fill-none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          <span>Download Vertical MP4 ({currentClip.download_filename || "reel.mp4"})</span>
                        </a>

                        <Link
                          href="/#studio-workspace"
                          className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm text-center"
                        >
                          <svg className="w-4 h-4 fill-none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                          </svg>
                          <span>Publish to Instagram in Studio Workspace &rarr;</span>
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ============================================================ */}
              {/* ALTERNATIVE OPTIONS (ACCORDIONS / COLLAPSIBLES) */}
              {/* ============================================================ */}
              <div className="flex flex-col gap-4 pt-2">
                <span className="text-xs font-bold uppercase tracking-wider text-violet-300 font-mono">
                  Alternative Workflows
                </span>

                {/* Pathway A: Remotion Code Explainer (Zero Download) */}
                <details className="group p-5 rounded-2xl bg-white/90 backdrop-blur-xl border border-white text-zinc-900 shadow-sm transition-all">
                  <summary className="font-bold text-sm text-zinc-950 flex items-center justify-between cursor-pointer list-none">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-violet-600" />
                      <span>Instant AI Explainer Reel via Remotion (Synthetic Diagrams, No Download)</span>
                    </div>
                    <span className="text-violet-600 group-open:rotate-180 transition-transform text-xs">▼</span>
                  </summary>

                  <div className="pt-4 flex flex-col gap-3">
                    <p className="text-xs text-zinc-600 leading-relaxed">
                      Instead of using video frames from YouTube, generate an autonomous vertical 9:16 reel with animated diagrams, syntax blocks, and AI speech synthesized directly from this YouTube topic.
                    </p>

                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="topic-input" className="text-xs font-bold text-zinc-700">
                        AI Prompt / Command:
                      </label>
                      <input
                        id="topic-input"
                        type="text"
                        value={customTopic}
                        onChange={(e) => setCustomTopic(e.target.value)}
                        className="w-full bg-white border border-zinc-300 rounded-xl px-4 py-2.5 text-xs font-medium text-zinc-900 focus:outline-none focus:border-violet-600"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={handleLaunchInstantRemotion}
                      className="py-3 px-5 rounded-xl font-bold text-xs bg-zinc-900 hover:bg-zinc-800 text-white transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <span>Generate 9:16 Reel by Prompt (Remotion Engine) &rarr;</span>
                    </button>
                  </div>
                </details>

                {/* Pathway B: Local Video File Upload */}
                <details className="group p-5 rounded-2xl bg-white/90 backdrop-blur-xl border border-white text-zinc-900 shadow-sm transition-all">
                  <summary className="font-bold text-sm text-zinc-950 flex items-center justify-between cursor-pointer list-none">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-zinc-400" />
                      <span>Process Local Video File (If you already downloaded an MP4 to disk)</span>
                    </div>
                    <span className="text-zinc-600 group-open:rotate-180 transition-transform text-xs">▼</span>
                  </summary>

                  <div className="pt-4 flex flex-col gap-3">
                    <p className="text-xs text-zinc-600 leading-relaxed">
                      Upload an existing MP4, MOV, or MKV recording from your hard drive to process directly through the AI pipeline:
                    </p>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="video/*"
                      id="import-video-file-direct"
                      disabled={isRunning}
                      onChange={(e) => {
                        const f = e.target.files?.[0] || null;
                        setSelectedFile(f);
                        setErrorMessage("");
                      }}
                      className="hidden"
                    />

                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className={`border-2 border-dashed rounded-2xl p-4 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2 ${
                        selectedFile
                          ? "border-emerald-400 bg-emerald-50/50"
                          : "border-zinc-300 hover:border-violet-500 bg-zinc-50"
                      }`}
                    >
                      <span className="text-xs font-bold text-zinc-800">
                        {selectedFile ? selectedFile.name : "Click here to choose your local video file"}
                      </span>
                      {selectedFile && (
                        <span className="text-[11px] font-mono text-emerald-700">
                          {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB · Ready
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={handleStartFilePipeline}
                      disabled={!selectedFile || isRunning}
                      className="py-3 px-5 rounded-xl font-bold text-xs bg-zinc-900 hover:bg-zinc-800 text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <span>Upload &amp; Process Local File &rarr;</span>
                    </button>
                  </div>
                </details>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function ImportPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen hostinger-hero-gradient flex items-center justify-center">
          <div className="p-8 rounded-3xl bg-[#0c061d]/80 border border-violet-500/20 backdrop-blur-xl flex flex-col items-center gap-4 text-center">
            <div className="w-10 h-10 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-mono text-violet-200">Loading Astra Import Gateway...</p>
          </div>
        </div>
      }
    >
      <ImportContent />
    </Suspense>
  );
}
