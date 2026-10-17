"use client";

import { Suspense, useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";

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

function ImportContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Pipeline form states
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [localPath, setLocalPath] = useState("");
  const [captionStyle, setCaptionStyle] = useState<"karaoke" | "minimal" | "bold" | "neon">("karaoke");
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);

  // Execution states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState(0);
  const [submitMessage, setSubmitMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [launchedJobId, setLaunchedJobId] = useState("");

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

  // 1-Click Launch Instant Remotion AI Reel
  const handleLaunchInstantRemotion = () => {
    const topicToLaunch = customTopic.trim() || `Explain ${sanitizeTopic(videoTitle)}`;
    router.push(`/?mode=ai_prompt&topic=${encodeURIComponent(topicToLaunch)}&autoStart=true#studio-workspace`);
  };

  // Launch AI Reel Pipeline with genuine uploaded file
  const handleStartPipeline = async () => {
    setErrorMessage("");
    setSubmitMessage("");

    // If no file selected, trigger the file picker!
    if (!selectedFile) {
      if (fileInputRef.current) {
        fileInputRef.current.click();
      }
      return;
    }

    setIsSubmitting(true);
    setSubmitProgress(10);
    setSubmitMessage("Preparing media upload for AI processing...");

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("renderVideo", "true");
      formData.append("subtitles", subtitlesEnabled ? "true" : "false");
      formData.append("captionStyle", captionStyle);
      formData.append("compositionMode", "adaptive");

      setSubmitProgress(40);
      setSubmitMessage("Uploading video to Astra storage workspace...");

      const res = await fetch("/api/ai/pipeline", {
        method: "POST",
        body: formData,
      });

      setSubmitProgress(80);

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || `Server responded with status ${res.status}`);
      }

      const data = await res.json();
      setSubmitProgress(100);
      setSubmitMessage("AI Pipeline initiated successfully! Redirecting to live workspace...");
      setLaunchedJobId(data.jobId || data.job_id || "job-started");

      setTimeout(() => {
        router.push(`/#studio-workspace`);
      }, 1500);
    } catch (err: unknown) {
      setIsSubmitting(false);
      setSubmitProgress(0);
      const msg = err instanceof Error ? err.message : "Failed to initiate pipeline.";
      setErrorMessage(msg);
    }
  };

  // Launch from Local Path
  const handleStartPathPipeline = async () => {
    setErrorMessage("");
    if (!localPath.trim()) {
      setErrorMessage("Please enter the full local video file path (e.g. D:\\lectures\\video.mp4).");
      return;
    }

    setIsSubmitting(true);
    setSubmitProgress(20);
    setSubmitMessage("Connecting local file path to Python AI worker...");

    try {
      const res = await fetch("/api/ai/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoPath: localPath.trim(),
          renderVideo: true,
          subtitles: subtitlesEnabled,
          captionStyle,
          compositionMode: "adaptive",
        }),
      });

      setSubmitProgress(80);

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || `Server responded with status ${res.status}`);
      }

      const data = await res.json();
      setSubmitProgress(100);
      setSubmitMessage("AI Pipeline initiated! Redirecting to live workspace...");
      setLaunchedJobId(data.jobId || data.job_id || "job-started");

      setTimeout(() => {
        router.push(`/#studio-workspace`);
      }, 1500);
    } catch (err: unknown) {
      setIsSubmitting(false);
      setSubmitProgress(0);
      const msg = err instanceof Error ? err.message : "Failed to initiate pipeline.";
      setErrorMessage(msg);
    }
  };

  const hasValidVideo = Boolean(videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId));
  const cleanTitle = sanitizeTopic(videoTitle);

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
                Extension
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
          <span>YouTube 1-Click Import Hub</span>
        </div>
        <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-white">
          Convert YouTube to Vertical 9:16 Reel
        </h1>
        <p className="text-xs sm:text-sm text-violet-200/80 mt-2 max-w-2xl leading-relaxed">
          Imported via Astra Extension. Choose to generate an autonomous AI explainer reel instantly, or process the original video file.
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
                Click <strong>✦ Create with Astra</strong> on any YouTube video, or paste a YouTube URL below to import metadata.
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
            {/* Left Column: Captured YouTube Metadata */}
            <div className="lg:col-span-5 flex flex-col gap-6">
              <div className="p-6 sm:p-7 rounded-3xl bg-white/95 backdrop-blur-2xl border border-white text-zinc-900 shadow-[0_24px_50px_-12px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.4)] flex flex-col gap-4">
                <div className="flex items-center justify-between pb-3 border-b border-zinc-200/80">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200">
                      STAGE 01
                    </span>
                    <h2 className="text-sm font-bold text-zinc-950">Captured YouTube Source</h2>
                  </div>
                  <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                    Verified
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

                {/* Clear Technical Notice */}
                <div className="p-3.5 rounded-2xl bg-violet-50/80 border border-violet-200/80 text-violet-900 text-xs flex items-start gap-2.5 leading-relaxed">
                  <div className="w-5 h-5 rounded-md bg-violet-200/80 text-violet-800 flex items-center justify-center shrink-0 mt-0.5">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <span className="font-bold">Two Ways to Generate:</span>
                    <ol className="list-decimal pl-4 mt-1 space-y-0.5 text-zinc-700">
                      <li><strong>Instant AI Explainer (Remotion)</strong>: No video file needed — generates full visual code reel from topic.</li>
                      <li><strong>Video Processing Pipeline</strong>: If you have the MP4 file, upload it for Whisper transcript &amp; 9:16 OpenCV tracking.</li>
                    </ol>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Generation Pathways */}
            <div className="lg:col-span-7 flex flex-col gap-6">
              
              {/* PATHWAY 1: INSTANT AI EXPLAINER REEL (REMOTION) — NO DOWNLOAD NEEDED */}
              <div className="p-6 sm:p-7 rounded-3xl bg-gradient-to-br from-white via-white to-violet-50/50 backdrop-blur-2xl border-2 border-violet-400/60 text-zinc-900 shadow-[0_24px_50px_-12px_rgba(124,58,237,0.25)] flex flex-col gap-4 relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono font-bold uppercase px-2.5 py-1 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-xs">
                      RECOMMENDED · ZERO DOWNLOAD
                    </span>
                    <span className="text-xs font-bold text-violet-900">Path A</span>
                  </div>
                  <span className="text-xs font-mono text-violet-600 font-semibold">Remotion 4.0 Engine</span>
                </div>

                <div>
                  <h3 className="text-lg font-extrabold text-zinc-950">
                    Instant 9:16 Explainer Reel via AI
                  </h3>
                  <p className="text-xs text-zinc-600 mt-1 leading-relaxed">
                    Don&apos;t have the video file? Generate an autonomous vertical 9:16 reel with animated diagrams, syntax blocks, and AI speech synthesized directly from this YouTube topic.
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="topic-input" className="text-xs font-bold text-zinc-700">
                    AI Prompt / Command (Auto-Extracted):
                  </label>
                  <input
                    id="topic-input"
                    type="text"
                    value={customTopic}
                    onChange={(e) => setCustomTopic(e.target.value)}
                    className="w-full bg-white border border-zinc-300 rounded-xl px-4 py-3 text-xs font-medium text-zinc-900 focus:outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-600/15 shadow-xs"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleLaunchInstantRemotion}
                  className="w-full py-4 px-6 rounded-xl font-bold text-sm bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-xl shadow-violet-600/30 transition-all transform active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer"
                >
                  <svg className="w-4 h-4 text-white fill-current" viewBox="0 0 24 24">
                    <path d="M12 2L14.6 9.4L22 12L14.6 14.6L12 22L9.4 14.6L2 12L9.4 9.4L12 2Z" />
                  </svg>
                  <span>Generate 9:16 Reel by AI (No File Needed) &rarr;</span>
                </button>
              </div>

              {/* PATHWAY 2: PROCESS ORIGINAL LECTURE VIDEO FILE */}
              <div className="p-6 sm:p-7 rounded-3xl bg-white/95 backdrop-blur-2xl border border-white text-zinc-900 shadow-[0_24px_50px_-12px_rgba(0,0,0,0.5)] flex flex-col gap-4">
                <div className="flex items-center justify-between pb-2 border-b border-zinc-200/80">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-700 border border-zinc-200">
                      PATH B · FOR RECORDINGS
                    </span>
                    <h3 className="text-sm font-bold text-zinc-950">
                      Process Original Video File (Whisper + CV 9:16 Crop)
                    </h3>
                  </div>
                </div>

                <p className="text-xs text-zinc-600 leading-relaxed">
                  If you have the original MP4, MOV, or MKV recording of this lecture on your disk, upload it below to run Faster-Whisper ASR, highlight selection, and OpenCV camera reframing:
                </p>

                {/* Dropzone with direct click-to-open */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  id="import-video-file-direct"
                  disabled={isSubmitting}
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setSelectedFile(f);
                    setErrorMessage("");
                  }}
                  className="hidden"
                />

                <div
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-5 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2 ${
                    selectedFile
                      ? "border-emerald-400 bg-emerald-50/50"
                      : "border-zinc-300 hover:border-violet-500 bg-zinc-50/70 hover:bg-violet-50/30"
                  }`}
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${selectedFile ? "bg-emerald-100 text-emerald-700" : "bg-violet-100 text-violet-600"}`}>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  </div>
                  <div>
                    <span className="text-sm font-bold text-zinc-900 block">
                      {selectedFile ? selectedFile.name : "Click here to choose your lecture MP4 file"}
                    </span>
                    {selectedFile ? (
                      <span className="text-xs font-mono font-semibold text-emerald-700">
                        {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB · Ready to upload
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-500">
                        Supports MP4, MOV, MKV up to 4GB
                      </span>
                    )}
                  </div>
                </div>

                {/* Caption / Options */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="text-zinc-700 block mb-1 font-semibold">Karaoke Subtitle Style</label>
                    <select
                      value={captionStyle}
                      onChange={(e) => setCaptionStyle(e.target.value as any)}
                      disabled={isSubmitting}
                      className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 text-zinc-900 focus:outline-none focus:border-violet-600 font-medium"
                    >
                      <option value="karaoke">✨ Karaoke (Word Pop)</option>
                      <option value="minimal">Minimal Clean</option>
                      <option value="bold">Bold Punchy</option>
                      <option value="neon">Neon Glow</option>
                    </select>
                  </div>

                  <div className="flex flex-col justify-end">
                    <label className="flex items-center gap-2 text-zinc-700 cursor-pointer py-2">
                      <input
                        type="checkbox"
                        checked={subtitlesEnabled}
                        onChange={(e) => setSubtitlesEnabled(e.target.checked)}
                        disabled={isSubmitting}
                        className="rounded border-zinc-300 text-violet-600 focus:ring-violet-500"
                      />
                      <span className="font-semibold text-xs">Burn Dynamic Word-Level Subtitles</span>
                    </label>
                  </div>
                </div>

                {/* Error Banner */}
                {errorMessage && (
                  <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
                    {errorMessage}
                  </div>
                )}

                {/* Progress Indicator */}
                {isSubmitting && (
                  <div className="flex flex-col gap-2 p-3.5 rounded-xl bg-violet-50 border border-violet-200 text-xs">
                    <div className="flex items-center justify-between font-bold text-violet-900">
                      <span>{submitMessage}</span>
                      <span className="font-mono">{submitProgress}%</span>
                    </div>
                    <div className="w-full h-2 bg-violet-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-violet-600 to-indigo-600 transition-all duration-300 rounded-full"
                        style={{ width: `${submitProgress}%` }}
                      />
                    </div>
                    {launchedJobId && (
                      <span className="font-mono text-[10px] text-violet-700 mt-1">
                        Active Job: {launchedJobId}
                      </span>
                    )}
                  </div>
                )}

                {/* Action button */}
                <button
                  type="button"
                  onClick={handleStartPipeline}
                  disabled={isSubmitting}
                  className={`w-full py-3.5 px-6 rounded-xl font-bold text-sm transition-all transform active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer ${
                    selectedFile
                      ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/30"
                      : "bg-zinc-800 hover:bg-zinc-900 text-white shadow-md"
                  }`}
                >
                  {isSubmitting ? (
                    <>
                      <svg className="animate-spin w-4 h-4 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      <span>Starting AI Pipeline...</span>
                    </>
                  ) : selectedFile ? (
                    <>
                      <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                      </svg>
                      <span>Upload &amp; Launch 9:16 Video Pipeline</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      <span>Browse Video File from Computer (.mp4)</span>
                    </>
                  )}
                </button>

                {/* Local path toggle */}
                <div className="pt-2 border-t border-zinc-200/80">
                  <details className="text-xs text-zinc-600 group">
                    <summary className="font-semibold text-zinc-700 hover:text-violet-700 cursor-pointer">
                      Or specify full file path on local drive (e.g. D:\videos\lecture.mp4)
                    </summary>
                    <div className="mt-3 flex gap-2">
                      <input
                        type="text"
                        value={localPath}
                        onChange={(e) => setLocalPath(e.target.value)}
                        placeholder={`D:\\Lectures\\${cleanTitle.replace(/[^a-zA-Z0-9_-]/g, "_")}.mp4`}
                        className="flex-1 bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs font-mono text-zinc-900"
                      />
                      <button
                        type="button"
                        onClick={handleStartPathPipeline}
                        className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs"
                      >
                        Start
                      </button>
                    </div>
                  </details>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-violet-900/30 bg-[#0a0518] backdrop-blur-md py-6 px-4 sm:px-6 text-center text-xs text-zinc-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 font-medium text-zinc-400">
            <img src="/astra-logo.svg" alt="Astra Logo" className="w-5 h-5 object-contain" />
            <span>Astra Studio — Autonomous AI Video Workstation</span>
          </div>
          <span>Next.js 16 · Remotion 4.0 · Faster-Whisper</span>
        </div>
      </footer>
    </div>
  );
}

export default function ImportPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen hostinger-hero-gradient flex items-center justify-center text-white">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 rounded-full border-2 border-violet-400 border-t-transparent animate-spin" />
            <p className="text-sm font-mono text-violet-200">Loading Astra Import Gateway...</p>
          </div>
        </div>
      }
    >
      <ImportContent />
    </Suspense>
  );
}
