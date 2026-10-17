"use client";

import { useEffect, useRef, useState } from "react";
import * as tus from "tus-js-client";

type StageStep =
  | "idle"
  | "submitting"
  | "EXTRACTING_AUDIO"
  | "TRANSCRIBING"
  | "NORMALIZING_TERMS"
  | "SELECTING_MOMENT"
  | "PLANNING_CROPS"
  | "RENDERING_VIDEO"
  | "REMOTION_SCRIPT"
  | "REMOTION_PLAN"
  | "REMOTION_BUNDLE"
  | "REMOTION_RENDER"
  | "COMPLETED"
  | "FAILED";

type PublishStage =
  | "idle"
  | "fetching-video"
  | "uploading-supabase"
  | "connecting-instagram"
  | "processing-instagram"
  | "published"
  | "publish-failed";

interface HighlightInfo {
  clip_id: string;
  start_time_sec: number;
  end_time_sec: number;
  duration_sec: number;
  pedagogical_score: number;
  topic_summary: string;
  boundary_reasoning: string;
}

interface CropPlanInfo {
  clip_id: string;
  aspect_ratio: string;
  keyframes_count: number;
}

export default function AIStudioPage() {
  // Input Selection State
  const [inputMode, setInputMode] = useState<"path" | "upload" | "ai_prompt">("ai_prompt");
  const [videoPath, setVideoPath] = useState(
    "D:\\softwares\\Time and Space Complexity explained in literally 5 minutes _ Big O _ Concepts made simple ep -1.mp4.mp4"
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // AI Prompt Generation State (Remotion)
  const [aiTopic, setAiTopic] = useState("Explain XML versus JSON with a simple example");
  const [aiAudience, setAiAudience] = useState("Beginners");
  const [aiDuration, setAiDuration] = useState(45);

  // Configuration State
  const [captionStyle, setCaptionStyle] = useState<"karaoke" | "minimal" | "bold" | "neon">("karaoke");
  const [compositionMode, setCompositionMode] = useState<"adaptive" | "presenter" | "screen_content">("adaptive");
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);

  // AI Pipeline Execution State
  const [pipelineStage, setPipelineStage] = useState<StageStep>("idle");
  const [pipelineProgress, setPipelineProgress] = useState(0);
  const [stageMessage, setStageMessage] = useState("");
  const [jobId, setJobId] = useState("");
  const [elapsedSec, setElapsedSec] = useState<number | null>(null);
  const [highlightData, setHighlightData] = useState<HighlightInfo | null>(null);
  const [cropPlanData, setCropPlanData] = useState<CropPlanInfo | null>(null);
  const [renderedVideoUrl, setRenderedVideoUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  // Instagram Publishing State
  const [customCaption, setCustomCaption] = useState("");
  const [publishStage, setPublishStage] = useState<PublishStage>("idle");
  const [publishProgress, setPublishProgress] = useState(0);
  const [publishMessage, setPublishMessage] = useState("");
  const [instagramMediaId, setInstagramMediaId] = useState("");

  // Video player custom controls
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pollingInstagram = useRef(false);

  const toggleVideoPlayback = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current
        .play()
        .then(() => setIsVideoPlaying(true))
        .catch(() => {});
    } else {
      videoRef.current.pause();
      setIsVideoPlaying(false);
    }
  };

  const toggleVideoMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!videoRef.current) return;
    videoRef.current.muted = !videoRef.current.muted;
    setIsVideoMuted(videoRef.current.muted);
  };

  useEffect(() => {
    setIsVideoPlaying(false);
  }, [renderedVideoUrl]);

  // Clean up polling timer on unmount & read URL query parameters
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const mode = params.get("mode");
      const topic = params.get("topic");
      const autoStart = params.get("autoStart");

      if (mode === "ai_prompt" || mode === "path" || mode === "upload") {
        setInputMode(mode);
      }
      if (topic) {
        setAiTopic(topic);
      }
      if (autoStart === "true" && topic) {
        setTimeout(() => {
          const el = document.getElementById("studio-workspace");
          if (el) el.scrollIntoView({ behavior: "smooth" });
          startRemotionGeneration(topic);
        }, 500);
      }
    }

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  // Update default caption when highlight is selected
  useEffect(() => {
    if (highlightData?.topic_summary && !customCaption) {
      setCustomCaption(
        `💡 ${highlightData.topic_summary}\n\n#Programming #ComputerScience #TechEducation #LearnToCode #Shorts`
      );
    }
  }, [highlightData, customCaption]);

  // --------------------------------------------------------------------------
  // AI Video Generation by Command (Remotion Engine)
  // --------------------------------------------------------------------------
  async function startRemotionGeneration(topicOverride?: string | React.MouseEvent) {
    const topicToUse = (typeof topicOverride === "string" ? topicOverride : aiTopic).trim();
    if (!topicToUse) {
      alert("Please provide a topic or command to generate the video.");
      return;
    }

    setPipelineStage("REMOTION_SCRIPT");
    setPipelineProgress(10);
    setStageMessage("Synthesizing pedagogical storyboard script via AI...");
    setErrorMessage("");
    setRenderedVideoUrl(null);
    setHighlightData(null);
    setCropPlanData(null);
    setElapsedSec(null);

    const startTime = Date.now();
    const newJobId = `remotion-${Date.now().toString(36)}`;
    setJobId(newJobId);

    // Dynamic progress simulator for Remotion generation phases
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      if (elapsed < 12) {
        setPipelineStage("REMOTION_SCRIPT");
        setPipelineProgress(Math.min(28, 10 + Math.floor(elapsed * 1.5)));
        setStageMessage("Synthesizing pedagogical storyboard script via AI...");
      } else if (elapsed < 24) {
        setPipelineStage("REMOTION_PLAN");
        setPipelineProgress(Math.min(50, 28 + Math.floor((elapsed - 12) * 1.8)));
        setStageMessage("Planning 9:16 layout, diagrams & visual code blocks...");
      } else if (elapsed < 38) {
        setPipelineStage("REMOTION_BUNDLE");
        setPipelineProgress(Math.min(72, 50 + Math.floor((elapsed - 24) * 1.6)));
        setStageMessage("Bundling Remotion React composition engine...");
      } else {
        setPipelineStage("REMOTION_RENDER");
        setPipelineProgress(Math.min(94, 72 + Math.floor((elapsed - 38) * 0.8)));
        setStageMessage("Rendering 9:16 vertical frames via Chrome GPU...");
      }
    }, 1000);

    try {
      const res = await fetch("/api/video_gen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topicToUse,
          targetAudience: aiAudience,
          durationSeconds: aiDuration,
          render: true,
          visualActions: true,
        }),
      });

      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

      const data = await res.json();
      if (!res.ok) {
        const errorMsg = data.error?.message || data.error || data.message || "Failed to generate video";
        throw new Error(errorMsg);
      }

      const totalElapsed = Math.round((Date.now() - startTime) / 1000);
      setElapsedSec(totalElapsed);
      setPipelineProgress(100);
      setPipelineStage("COMPLETED");
      setStageMessage(`✨ Vertical 9:16 reel generated successfully in ${totalElapsed}s!`);

      // Set video URL - directly from public URL or via streaming endpoint
      const finalUrl = data.videoUrl || (data.outputPath ? `/api/video_gen?latest=true&t=${Date.now()}` : null);
      setRenderedVideoUrl(finalUrl);

      // Populate highlight summary
      setHighlightData({
        clip_id: newJobId,
        start_time_sec: 0,
        end_time_sec: data.durationSeconds || aiDuration,
        duration_sec: data.durationSeconds || aiDuration,
        pedagogical_score: 99.0,
        topic_summary: data.title || aiTopic,
        boundary_reasoning: `AI Remotion Generator created ${data.scenes?.length || 4} animated vertical scenes for ${aiAudience}`,
      });

      // Populate crop info
      setCropPlanData({
        clip_id: newJobId,
        aspect_ratio: "9:16 (Vertical Full HD)",
        keyframes_count: data.frameCount || 480,
      });

      // Prepopulate custom caption for Instagram
      setCustomCaption(
        `💡 ${data.title || aiTopic}\n\nClear, dynamic visual explanation tailored for ${aiAudience}.\n\n#Programming #ComputerScience #TechEducation #LearnToCode #Shorts #Remotion`
      );
    } catch (err: unknown) {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      const msg = err instanceof Error ? err.message : "Failed to generate video.";
      setPipelineStage("FAILED");
      setErrorMessage(msg);
      setStageMessage(`Error: ${msg}`);
    }
  }

  async function loadLatestRemotionVideo() {
    try {
      const res = await fetch("/api/video_gen?latest=true", { method: "HEAD" });
      if (!res.ok) {
        alert("No previous rendered video found. Generate one first!");
        return;
      }
      setRenderedVideoUrl(`/api/video_gen?latest=true&t=${Date.now()}`);
      setJobId("remotion-latest");
      setPipelineStage("COMPLETED");
      setPipelineProgress(100);
      setStageMessage("Loaded previously generated 9:16 vertical video.");
      setHighlightData({
        clip_id: "remotion-latest",
        start_time_sec: 0,
        end_time_sec: 45,
        duration_sec: 44.5,
        pedagogical_score: 99.0,
        topic_summary: "Explain AI RAG System",
        boundary_reasoning: "Loaded from latest Remotion render artifacts (667 frames, 9:16 vertical)",
      });
      setCropPlanData({
        clip_id: "remotion-latest",
        aspect_ratio: "9:16 (Vertical Full HD)",
        keyframes_count: 667,
      });
      setCustomCaption(
        "💡 Explain AI RAG System with a simple example\n\nHow AI answers questions by retrieving real-time relevant data.\n\n#Programming #AI #RAG #MachineLearning #TechShorts"
      );
    } catch (e) {
      console.error(e);
    }
  }

  // --------------------------------------------------------------------------
  // AI Pipeline Runner
  // --------------------------------------------------------------------------
  async function startAIPipeline() {
    if (inputMode === "path" && !videoPath.trim()) {
      alert("Please provide a valid video file path.");
      return;
    }
    if (inputMode === "upload" && !selectedFile) {
      alert("Please select a video file to upload.");
      return;
    }

    setPipelineStage("submitting");
    setPipelineProgress(5);
    setStageMessage("Initiating job with Python AI Worker...");
    setErrorMessage("");
    setRenderedVideoUrl(null);
    setHighlightData(null);
    setCropPlanData(null);
    setElapsedSec(null);

    try {
      let res: Response;

      if (inputMode === "upload" && selectedFile) {
        const formData = new FormData();
        formData.append("file", selectedFile);
        formData.append("renderVideo", "true");
        formData.append("subtitles", subtitlesEnabled ? "true" : "false");
        formData.append("captionStyle", captionStyle);
        formData.append("compositionMode", compositionMode);

        setStageMessage("Uploading video to workspace storage...");
        res = await fetch("/api/ai/pipeline", {
          method: "POST",
          body: formData,
        });
      } else {
        res = await fetch("/api/ai/pipeline", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            video_path: videoPath.trim(),
            render_video: true,
            subtitles: subtitlesEnabled,
            caption_style: captionStyle,
            composition_mode: compositionMode,
          }),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to start AI pipeline.");
      }

      const activeJobId = data.jobId;
      setJobId(activeJobId);
      setPipelineStage("EXTRACTING_AUDIO");
      setPipelineProgress(10);
      setStageMessage(data.message || "Pipeline started. Probing audio...");

      // Start status polling
      startStatusPolling(activeJobId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to initiate AI worker.";
      setPipelineStage("FAILED");
      setErrorMessage(msg);
      setStageMessage(`Error: ${msg}`);
    }
  }

  function startStatusPolling(activeJobId: string) {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/ai/pipeline/${encodeURIComponent(activeJobId)}`);
        if (!res.ok) return;

        const { job } = await res.json();
        if (!job) return;

        setPipelineStage(job.status as StageStep);
        setPipelineProgress(job.progress_pct ?? 0);
        setStageMessage(job.stage_message || job.status);

        if (job.selected_highlight) {
          setHighlightData(job.selected_highlight);
        }
        if (job.crop_plan) {
          setCropPlanData(job.crop_plan);
        }

        if (job.status === "COMPLETED") {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          setElapsedSec(job.elapsed_sec ?? null);
          // Set streaming video URL
          setRenderedVideoUrl(`/api/ai/video?jobId=${encodeURIComponent(activeJobId)}&t=${Date.now()}`);
        } else if (job.status === "FAILED") {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          setErrorMessage(job.error_message || job.stage_message || "Pipeline failed.");
        }
      } catch (err) {
        console.warn("Polling error:", err);
      }
    }, 1500);
  }

  // --------------------------------------------------------------------------
  // Instagram Publishing (via Supabase Resumable TUS)
  // --------------------------------------------------------------------------
  async function callInstagramApi(action: "start" | "check" | "retry", jobData: any) {
    const res = await fetch("/api/publish/instagram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        jobId: jobData.jobId,
        videoKey: jobData.videoKey,
        caption: customCaption || jobData.caption,
      }),
    });
    const result = await res.json();
    if (!res.ok) {
      throw new Error(result.message || result.error || "Instagram API request failed.");
    }
    return result;
  }

  async function uploadToSupabaseAndPublish() {
    if (!jobId || !renderedVideoUrl) {
      alert("No rendered reel is ready yet.");
      return;
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      alert("Supabase environment variables (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY) are missing.");
      return;
    }

    setPublishStage("fetching-video");
    setPublishProgress(5);
    setPublishMessage("Preparing rendered 9:16 vertical video blob...");

    try {
      // 1. Fetch rendered reel from our local video endpoint
      const vidResponse = await fetch(renderedVideoUrl);
      if (!vidResponse.ok) throw new Error("Could not load rendered reel for upload.");
      const videoBlob = await vidResponse.blob();
      const reelFile = new File([videoBlob], `${jobId}_reel.mp4`, { type: "video/mp4" });

      setPublishStage("uploading-supabase");
      setPublishProgress(10);
      setPublishMessage("Uploading to Supabase Storage (videos bucket)...");

      const savedJob = {
        jobId: crypto.randomUUID(),
        videoKey: `demo/${crypto.randomUUID()}-${reelFile.name}`,
        fileName: reelFile.name,
        fileSize: reelFile.size,
        lastModified: reelFile.lastModified,
        caption: customCaption,
      };

      // 2. TUS resumable upload
      const upload = new tus.Upload(reelFile, {
        endpoint: `${supabaseUrl}/storage/v1/upload/resumable`,
        retryDelays: [0, 2000, 5000],
        chunkSize: 6 * 1024 * 1024,
        removeFingerprintOnSuccess: true,
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
        metadata: {
          bucketName: "videos",
          objectName: savedJob.videoKey,
          contentType: "video/mp4",
          cacheControl: "3600",
        },
        onProgress(uploaded, total) {
          const pct = Math.round((uploaded / total) * 100);
          setPublishProgress(10 + Math.round(pct * 0.4)); // 10% to 50%
          setPublishMessage(`Uploading to Supabase: ${pct}%`);
        },
        onError(error) {
          setPublishStage("publish-failed");
          setPublishMessage(`Supabase upload failed: ${error.message}`);
        },
        async onSuccess() {
          setPublishStage("connecting-instagram");
          setPublishProgress(60);
          setPublishMessage("Video uploaded to Supabase! Creating Instagram Reel container...");

          try {
            let result = await callInstagramApi("start", savedJob);

            for (let attempt = 0; attempt < 35; attempt++) {
              if (result.status === "published" && result.success) {
                setPublishStage("published");
                setPublishProgress(100);
                setInstagramMediaId(result.publishedId || "");
                setPublishMessage("🎉 Your Instagram Reel is LIVE and published successfully!");
                return;
              }

              if (result.status === "failed") {
                setPublishStage("publish-failed");
                setPublishMessage(result.message || "Instagram processing failed.");
                return;
              }

              setPublishStage("processing-instagram");
              setPublishProgress(60 + Math.min(35, (attempt + 1) * 2));
              setPublishMessage(`Instagram is encoding reel media (Check ${attempt + 1}/35)...`);

              await new Promise((r) => setTimeout(r, 4500));
              result = await callInstagramApi("check", savedJob);

              if (result.status === "processing") {
                const checkRes = await callInstagramApi("retry", savedJob);
                if (checkRes.success && checkRes.status === "published") {
                  setPublishStage("published");
                  setPublishProgress(100);
                  setInstagramMediaId(checkRes.publishedId || "");
                  setPublishMessage("🎉 Your Instagram Reel is LIVE and published successfully!");
                  return;
                }
                result = checkRes;
              }
            }

            setPublishStage("publish-failed");
            setPublishMessage("Instagram processing took longer than expected. You can retry anytime.");
          } catch (pubErr: unknown) {
            const errTxt = pubErr instanceof Error ? pubErr.message : "Publishing error";
            setPublishStage("publish-failed");
            setPublishMessage(errTxt);
          }
        },
      });

      upload.start();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to upload video.";
      setPublishStage("publish-failed");
      setPublishMessage(msg);
    }
  }

  const isRunning =
    pipelineStage !== "idle" &&
    pipelineStage !== "COMPLETED" &&
    pipelineStage !== "FAILED";

  return (
    <div className="min-h-screen bg-[#0c061d] text-zinc-100 flex flex-col font-sans selection:bg-purple-600/40 selection:text-white relative overflow-x-hidden">
      {/* Hostinger-exact Atmospheric Purple Gradient Background */}
      <div className="absolute top-0 left-0 right-0 h-[740px] hostinger-hero-gradient pointer-events-none -z-10" />

      {/* Top Navigation Bar (Hostinger Style) */}
      <header className="w-full bg-[#13082e]/60 backdrop-blur-md border-b border-violet-400/10 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 sm:h-20 flex items-center justify-between">
          {/* Logo & Navigation Links */}
          <div className="flex items-center gap-8 sm:gap-12">
            <a href="/" className="flex items-center gap-3 group">
              <div className="relative w-8 h-8 flex items-center justify-center shrink-0">
                <img
                  src="/astra-logo.svg"
                  alt="Astra Studio Logo"
                  className="w-full h-full object-contain drop-shadow-[0_0_14px_rgba(167,139,250,0.8)] group-hover:scale-105 transition-transform"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base tracking-tight text-white group-hover:text-violet-200 transition-colors uppercase">
                  Astra Studio
                </span>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-violet-950/80 text-violet-300 border border-violet-600/40">
                  AI
                </span>
              </div>
            </a>

            {/* Desktop Navigation Links */}
            <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-violet-100/80">
              <a href="#studio-workspace" className="text-white hover:text-violet-200 transition-colors">
                Studio
              </a>
              <a href="#how-it-works" className="hover:text-white transition-colors flex items-center gap-1">
                <span>Pipeline</span>
              </a>
              <a href="#how-it-works" className="hover:text-white transition-colors flex items-center gap-1">
                <span>Features</span>
                <svg className="w-3.5 h-3.5 text-violet-300/70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </a>
              <a href="#how-it-works" className="hover:text-white transition-colors">
                How It Works
              </a>
              <a href="/upload" className="hover:text-white transition-colors">
                Publisher
              </a>
            </nav>
          </div>

          {/* Right Action Badges & Buttons */}
          <div className="flex items-center gap-3 sm:gap-4">
            <button
              type="button"
              onClick={() => {
                const searchEl = document.getElementById("hero-command-input");
                searchEl?.focus();
              }}
              className="px-4 py-1.5 rounded-full border border-violet-400/40 bg-violet-950/50 hover:bg-violet-900/50 text-violet-200 text-xs font-medium flex items-center gap-2 shadow-sm transition-all cursor-pointer"
            >
              <span className="text-violet-300">✨</span>
              <span>AI Agent</span>
            </button>

            <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-violet-200/90 px-3 py-1.5 rounded-full bg-violet-950/40 border border-violet-400/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>CUDA Active</span>
            </div>

            <a
              href="/upload"
              className="text-xs font-medium px-4 py-1.5 rounded-full bg-white text-zinc-950 hover:bg-zinc-100 font-semibold shadow-md transition-all active:scale-95"
            >
              Publisher
            </a>
          </div>
        </div>
      </header>

      {/* Hostinger Command / Topic Search Bar (Directly below Header) */}
      <div className="w-full max-w-4xl mx-auto px-4 pt-6 sm:pt-8 relative z-20">
        <div className="bg-[#24174d]/85 border border-violet-400/30 rounded-full p-2 pl-5 shadow-2xl shadow-purple-950/60 flex items-center justify-between backdrop-blur-md transition-all focus-within:border-violet-300 focus-within:ring-2 focus-within:ring-violet-400/20">
          <div className="flex items-center gap-3 flex-1 min-w-0 mr-3">
            <svg className="w-5 h-5 text-violet-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              id="hero-command-input"
              type="text"
              value={aiTopic}
              onChange={(e) => setAiTopic(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isRunning && aiTopic.trim()) {
                  startRemotionGeneration();
                }
              }}
              placeholder="Type your lecture topic, YouTube URL, or prompt..."
              className="w-full bg-transparent text-sm sm:text-base text-white placeholder-violet-200/50 outline-none font-normal"
            />
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={startRemotionGeneration}
              disabled={isRunning || !aiTopic.trim()}
              className="bg-white text-zinc-950 hover:bg-zinc-100 disabled:opacity-40 font-semibold text-xs sm:text-sm px-6 py-2.5 rounded-full shadow-md transition-all active:scale-95 cursor-pointer"
            >
              {isRunning ? "Generating..." : "Generate Reel"}
            </button>
          </div>
        </div>
        <div className="text-right text-xs text-violet-200/70 mt-2 pr-4 font-normal">
          Instant GPU pipeline included with <a href="#studio-workspace" className="underline hover:text-white transition-colors">all plans</a>
        </div>
      </div>

      {/* Hostinger-exact Hero Section */}
      <section className="pt-16 sm:pt-24 pb-16 sm:pb-20 px-4 sm:px-6 max-w-4xl mx-auto text-center flex flex-col items-center gap-5 relative z-10">
        <h1 className="text-4xl sm:text-6xl md:text-7xl font-bold tracking-tight text-white leading-[1.08] text-center max-w-3xl mx-auto">
          All-in-One AI Studio.
          <br />
          <span className="text-white">Create, Automate, Distribute, Analyze.</span>
        </h1>

        <p className="text-sm sm:text-base text-violet-200/85 max-w-xl mx-auto text-center font-normal leading-relaxed mt-1">
          An agentic platform to build, automate, and publish technical video reels online, all in one place.
        </p>

        {/* CTA Button & Guarantee Line */}
        <div className="flex flex-col items-center gap-3 pt-3">
          <button
            type="button"
            onClick={() => {
              const studioMain = document.getElementById("studio-workspace");
              studioMain?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className="bg-white text-zinc-950 hover:bg-zinc-100 font-semibold px-8 py-3.5 rounded-xl shadow-xl shadow-purple-950/60 hover:shadow-purple-900/80 transition-all text-sm sm:text-base cursor-pointer active:scale-95"
          >
            Get started
          </button>
          <div className="flex items-center gap-2 text-xs text-violet-200/70 font-normal">
            <svg className="w-3.5 h-3.5 text-violet-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <span>Autonomous AI Video Workstation · NVIDIA CUDA Accelerated</span>
          </div>
        </div>
      </section>

      {/* Main Grid Content - Peeking into Hero bottom (Hostinger Showcase style) */}
      <main id="studio-workspace" className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 -mt-4 sm:-mt-8 relative z-20 pb-16 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Input, Pipeline Controls & Live Status */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          {/* Card 1: Video Input & Creation Controls */}
          <div className="p-6 sm:p-7 rounded-3xl bg-white/95 backdrop-blur-2xl border border-white text-zinc-900 shadow-[0_24px_50px_-12px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.4)] relative overflow-hidden flex flex-col gap-5 transition-all">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-200/80">
              <div className="flex items-center gap-2.5">
                <span className="text-[10px] font-mono font-semibold uppercase px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200">
                  STEP 01
                </span>
                <h2 className="text-sm font-bold text-zinc-950 tracking-tight">
                  {inputMode === "ai_prompt"
                    ? "Generate Reel by Command (Remotion)"
                    : "Select Lecture Source Video"}
                </h2>
              </div>

              {/* Mode Toggle Tabs */}
              <div className="flex rounded-xl bg-zinc-100/90 border border-zinc-200/80 p-1 text-xs self-start sm:self-auto">
                <button
                  type="button"
                  onClick={() => setInputMode("ai_prompt")}
                  className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                    inputMode === "ai_prompt"
                      ? "bg-white text-zinc-950 font-semibold shadow-xs"
                      : "text-zinc-500 hover:text-zinc-900"
                  }`}
                >
                  <svg className="w-3.5 h-3.5 text-violet-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                  <span>AI Explainer</span>
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode("path")}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    inputMode === "path"
                      ? "bg-white text-zinc-950 font-semibold shadow-xs"
                      : "text-zinc-500 hover:text-zinc-900"
                  }`}
                >
                  Local Path
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode("upload")}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    inputMode === "upload"
                      ? "bg-white text-zinc-950 font-semibold shadow-xs"
                      : "text-zinc-500 hover:text-zinc-900"
                  }`}
                >
                  Upload File
                </button>
              </div>
            </div>

            {inputMode === "ai_prompt" ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-zinc-700">
                    Video Prompt / Command (Topic to explain)
                  </label>
                  <button
                    type="button"
                    onClick={loadLatestRemotionVideo}
                    className="text-xs text-violet-600 hover:text-violet-700 flex items-center gap-1 font-semibold transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Load Last Rendered Video</span>
                  </button>
                </div>
                <textarea
                  value={aiTopic}
                  onChange={(e) => setAiTopic(e.target.value)}
                  disabled={isRunning}
                  rows={3}
                  placeholder="e.g. Explain XML versus JSON with a simple example"
                  className="w-full bg-white border border-zinc-200/90 rounded-xl px-4 py-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-600/15 shadow-xs transition-all disabled:opacity-50 resize-none font-sans"
                />

                {/* Quick Presets */}
                <div className="flex items-center gap-1.5 flex-wrap text-xs text-zinc-600 mt-0.5">
                  <span className="text-zinc-400 text-[11px] uppercase font-mono mr-1">Presets:</span>
                  <button
                    type="button"
                    onClick={() => setAiTopic("Explain AI RAG System with a simple example")}
                    className="px-2.5 py-1 rounded-lg bg-zinc-100 hover:bg-zinc-200/80 border border-zinc-200 text-zinc-700 hover:text-zinc-950 font-medium transition-colors"
                  >
                    AI RAG System
                  </button>
                  <button
                    type="button"
                    onClick={() => setAiTopic("Explain XML versus JSON with a simple example")}
                    className="px-2.5 py-1 rounded-lg bg-zinc-100 hover:bg-zinc-200/80 border border-zinc-200 text-zinc-700 hover:text-zinc-950 font-medium transition-colors"
                  >
                    XML vs JSON
                  </button>
                  <button
                    type="button"
                    onClick={() => setAiTopic("Explain QuickSort versus MergeSort with time complexity")}
                    className="px-2.5 py-1 rounded-lg bg-zinc-100 hover:bg-zinc-200/80 border border-zinc-200 text-zinc-700 hover:text-zinc-950 font-medium transition-colors"
                  >
                    QuickSort vs MergeSort
                  </button>
                  <button
                    type="button"
                    onClick={() => setAiTopic("Explain how REST APIs work versus GraphQL in 45 seconds")}
                    className="px-2.5 py-1 rounded-lg bg-zinc-100 hover:bg-zinc-200/80 border border-zinc-200 text-zinc-700 hover:text-zinc-950 font-medium transition-colors"
                  >
                    REST vs GraphQL
                  </button>
                  <button
                    type="button"
                    onClick={() => setAiTopic("Explain how Git branching and merge conflicts work")}
                    className="px-2.5 py-1 rounded-lg bg-zinc-100 hover:bg-zinc-200/80 border border-zinc-200 text-zinc-700 hover:text-zinc-950 font-medium transition-colors"
                  >
                    Git Branching
                  </button>
                </div>

                {/* Remotion Configuration */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 pt-3 border-t border-zinc-200/80 text-xs">
                  <div>
                    <label className="text-zinc-700 block mb-1.5 font-semibold">Target Audience</label>
                    <select
                      value={aiAudience}
                      onChange={(e) => setAiAudience(e.target.value)}
                      disabled={isRunning}
                      className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-zinc-900 focus:outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-600/15 shadow-xs"
                    >
                      <option value="Beginners">Beginners (Intuitive & Visual)</option>
                      <option value="CS Students">CS Students (Concepts & Big-O)</option>
                      <option value="Senior Developers">Engineers (In-depth Architecture)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-zinc-700 block mb-1.5 font-semibold">Reel Duration</label>
                    <select
                      value={aiDuration}
                      onChange={(e) => setAiDuration(Number(e.target.value))}
                      disabled={isRunning}
                      className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-zinc-900 focus:outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-600/15 shadow-xs"
                    >
                      <option value={30}>30 Seconds (Fast Reel)</option>
                      <option value={45}>45 Seconds (Standard Recommended)</option>
                      <option value={60}>60 Seconds (Deep Dive)</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-violet-50/80 border border-violet-200/80 text-violet-800 text-xs mt-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-600 animate-pulse" />
                  <span>Remotion 4.0 · Chrome Headless GPU (9:16 Vertical Render with Animated Code Blocks)</span>
                </div>
              </div>
            ) : inputMode === "path" ? (
              <div className="flex flex-col gap-3">
                <label className="text-xs font-semibold text-zinc-700">
                  Full Video Path (Local Drive)
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={videoPath}
                    onChange={(e) => setVideoPath(e.target.value)}
                    disabled={isRunning}
                    placeholder="e.g. D:\softwares\lecture.mp4"
                    className="w-full bg-white border border-zinc-200/90 rounded-xl px-4 py-3 text-sm font-mono text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-600/15 shadow-xs transition-all disabled:opacity-50"
                  />
                </div>

                {/* Quick Presets */}
                <div className="flex items-center gap-2 flex-wrap text-xs text-zinc-600 mt-1">
                  <span className="text-zinc-400 text-[11px] uppercase font-mono">Presets:</span>
                  <button
                    type="button"
                    onClick={() =>
                      setVideoPath(
                        "D:\\softwares\\Time and Space Complexity explained in literally 5 minutes _ Big O _ Concepts made simple ep -1.mp4.mp4"
                      )
                    }
                    className="px-2.5 py-1 rounded-lg bg-zinc-100 hover:bg-zinc-200/80 border border-zinc-200 text-zinc-700 hover:text-zinc-950 font-medium transition-colors"
                  >
                    Time & Space Complexity (5m)
                  </button>
                  <button
                    type="button"
                    onClick={() => setVideoPath("D:\\softwares\\videoplayback.mp4")}
                    className="px-2.5 py-1 rounded-lg bg-zinc-100 hover:bg-zinc-200/80 border border-zinc-200 text-zinc-700 hover:text-zinc-950 font-medium transition-colors"
                  >
                    videoplayback.mp4 (25m)
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <label className="text-xs font-semibold text-zinc-700">
                  Select Video File (MP4, MOV, MKV)
                </label>
                <div className="border-2 border-dashed border-zinc-300 hover:border-violet-500 rounded-2xl p-6 text-center cursor-pointer transition-colors bg-zinc-50/60">
                  <input
                    type="file"
                    accept="video/*"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                    disabled={isRunning}
                    className="hidden"
                    id="video-upload-input"
                  />
                  <label htmlFor="video-upload-input" className="cursor-pointer flex flex-col items-center gap-2">
                    <div className="w-10 h-10 rounded-xl bg-violet-50 border border-violet-200 flex items-center justify-center text-violet-600">
                      <svg className="w-5 h-5 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                    </div>
                    <span className="text-sm font-semibold text-zinc-800">
                      {selectedFile ? selectedFile.name : "Click to select or drag video here"}
                    </span>
                    {selectedFile && (
                      <span className="text-xs text-violet-600 font-mono font-medium">
                        {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB
                      </span>
                    )}
                  </label>
                </div>
              </div>
            )}

            {/* AI Rendering Options (For video pipeline) */}
            {inputMode !== "ai_prompt" && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4 pt-4 border-t border-zinc-200/80 text-xs">
                <div>
                  <label className="text-zinc-700 block mb-1.5 font-semibold">Caption Style</label>
                  <select
                    value={captionStyle}
                    onChange={(e) => setCaptionStyle(e.target.value as any)}
                    disabled={isRunning}
                    className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-zinc-900 focus:outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-600/15 shadow-xs"
                  >
                    <option value="karaoke">✨ Karaoke (Word Pop)</option>
                    <option value="minimal">Minimal Clean</option>
                    <option value="bold">Bold Punchy</option>
                    <option value="neon">Neon Glow</option>
                  </select>
                </div>

                <div>
                  <label className="text-zinc-700 block mb-1.5 font-semibold">9:16 Framing Mode</label>
                  <select
                    value={compositionMode}
                    onChange={(e) => setCompositionMode(e.target.value as any)}
                    disabled={isRunning}
                    className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-zinc-900 focus:outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-600/15 shadow-xs"
                  >
                    <option value="adaptive">Dynamic Hybrid (CV)</option>
                    <option value="presenter">Presenter Focus</option>
                    <option value="screen_content">Screen / Slide Focus</option>
                  </select>
                </div>

                <div>
                  <label className="text-zinc-700 block mb-1.5 font-semibold">Subtitles Burn-In</label>
                  <button
                    type="button"
                    onClick={() => setSubtitlesEnabled(!subtitlesEnabled)}
                    disabled={isRunning}
                    className={`w-full py-2 px-3 rounded-lg border font-medium transition-colors flex items-center justify-center gap-2 ${
                      subtitlesEnabled
                        ? "bg-violet-50 border-violet-300 text-violet-700"
                        : "bg-zinc-100 border-zinc-200 text-zinc-500"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${subtitlesEnabled ? "bg-violet-600" : "bg-zinc-400"}`} />
                    {subtitlesEnabled ? "Enabled" : "Disabled"}
                  </button>
                </div>
              </div>
            )}

            {/* Launch CTA */}
            <div className="pt-2">
              <button
                type="button"
                onClick={inputMode === "ai_prompt" ? startRemotionGeneration : startAIPipeline}
                disabled={isRunning}
                className="w-full py-4 px-6 rounded-xl font-bold text-sm bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-xl shadow-violet-600/30 transition-all transform active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
              >
                {isRunning ? (
                  <>
                    <svg className="animate-spin w-4 h-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    {inputMode === "ai_prompt"
                      ? `Rendering Remotion Reel (${pipelineProgress}%)...`
                      : `Processing AI Pipeline (${pipelineProgress}%)...`}
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                    </svg>
                    {inputMode === "ai_prompt"
                      ? "Generate Vertical 9:16 Reel by Command"
                      : "Generate AI Vertical Reel (Highlight + 9:16 Crop + Captions)"}
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Card 2: Live Pipeline Progress Tracker */}
          <div className="p-6 sm:p-7 rounded-3xl bg-white/95 backdrop-blur-2xl border border-white text-zinc-900 shadow-[0_24px_50px_-12px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.4)] flex flex-col gap-4 transition-all">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-200/80">
              <div className="flex items-center gap-2.5">
                <span className="text-[10px] font-mono font-semibold uppercase px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200">
                  STEP 02
                </span>
                <h2 className="text-sm font-bold text-zinc-950 tracking-tight">Live Pipeline Tracker</h2>
              </div>
              {jobId && (
                <span className="font-mono text-xs px-2.5 py-1 rounded-lg bg-zinc-100 border border-zinc-200 text-violet-700 font-semibold select-all">
                  {jobId}
                </span>
              )}
            </div>

            {/* Progress Bar */}
            <div className="relative w-full h-2.5 bg-zinc-100 rounded-full overflow-hidden border border-zinc-200/80">
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

            <div className="flex items-center justify-between text-xs font-medium">
              <div className="flex items-center gap-2 text-zinc-600">
                {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-violet-600 animate-pulse" />}
                <span>{stageMessage || "Ready to execute pipeline"}</span>
              </div>
              <span className="font-mono font-bold text-zinc-900">{pipelineProgress}%</span>
            </div>

            {/* Pipeline Stage Pills */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs pt-1">
              {(inputMode === "ai_prompt"
                ? [
                    { key: "REMOTION_SCRIPT", label: "1. Script Gen" },
                    { key: "REMOTION_PLAN", label: "2. Visual Plan" },
                    { key: "REMOTION_BUNDLE", label: "3. Action Build" },
                    { key: "REMOTION_BUNDLE", label: "4. Bundler" },
                    { key: "REMOTION_RENDER", label: "5. Chrome 9:16" },
                  ]
                : [
                    { key: "EXTRACTING_AUDIO", label: "1. Audio Extract" },
                    { key: "TRANSCRIBING", label: "2. GPU Whisper" },
                    { key: "SELECTING_MOMENT", label: "3. Best Highlight" },
                    { key: "PLANNING_CROPS", label: "4. CV 9:16 Crop" },
                    { key: "RENDERING_VIDEO", label: "5. FFmpeg Reel" },
                  ]
              ).map((st, idx) => {
                const remotionStepIdx =
                  pipelineStage === "REMOTION_SCRIPT"
                    ? 0
                    : pipelineStage === "REMOTION_PLAN"
                    ? 1
                    : pipelineStage === "REMOTION_BUNDLE"
                    ? 3
                    : pipelineStage === "REMOTION_RENDER"
                    ? 4
                    : pipelineStage === "COMPLETED"
                    ? 5
                    : -1;

                const isCurrent =
                  inputMode === "ai_prompt"
                    ? (idx === 0 && pipelineStage === "REMOTION_SCRIPT") ||
                      (idx === 1 && pipelineStage === "REMOTION_PLAN") ||
                      (idx === 2 && pipelineStage === "REMOTION_BUNDLE") ||
                      (idx === 3 && pipelineStage === "REMOTION_BUNDLE") ||
                      (idx === 4 && pipelineStage === "REMOTION_RENDER")
                    : pipelineStage === st.key;

                const isDone =
                  pipelineStage === "COMPLETED" ||
                  (inputMode === "ai_prompt"
                    ? remotionStepIdx > idx
                    : (pipelineStage === "RENDERING_VIDEO" && st.key !== "RENDERING_VIDEO") ||
                      (pipelineStage === "PLANNING_CROPS" &&
                        ["EXTRACTING_AUDIO", "TRANSCRIBING", "SELECTING_MOMENT"].includes(st.key)) ||
                      (pipelineStage === "SELECTING_MOMENT" &&
                        ["EXTRACTING_AUDIO", "TRANSCRIBING"].includes(st.key)) ||
                      (pipelineStage === "TRANSCRIBING" && st.key === "EXTRACTING_AUDIO"));

                return (
                  <div
                    key={`${st.label}-${idx}`}
                    className={`px-2.5 py-2 rounded-xl border text-center transition-all ${
                      isDone
                        ? "bg-emerald-50 border-emerald-200 text-emerald-700 font-semibold shadow-2xs"
                        : isCurrent
                        ? "bg-violet-100 border-violet-400 text-violet-900 font-bold ring-2 ring-violet-500/20 shadow-xs animate-pulse"
                        : "bg-zinc-100/80 border-zinc-200 text-zinc-500 font-medium"
                    }`}
                  >
                    {st.label}
                  </div>
                );
              })}
            </div>

            {/* Highlight Summary Card if extracted or generated */}
            {highlightData && (
              <div className="mt-2 p-4 rounded-2xl bg-zinc-50/90 border border-zinc-200/90 flex flex-col gap-2 shadow-xs">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-violet-900 flex items-center gap-1.5">
                    {inputMode === "ai_prompt" ? "✨ Generated Storyboard Reel" : "🎯 Selected Educational Moment"}
                  </span>
                  <span className="font-mono text-emerald-700 bg-emerald-100/90 border border-emerald-300 px-2.5 py-0.5 rounded text-[11px] font-bold">
                    Score: {highlightData.pedagogical_score.toFixed(1)} / 100
                  </span>
                </div>
                <p className="text-xs text-zinc-700 italic border-l-2 border-violet-600 pl-2.5 py-0.5 font-medium">
                  &ldquo;{highlightData.topic_summary}&rdquo;
                </p>
                <div className="flex items-center gap-4 text-[11px] text-zinc-600 font-mono mt-1 font-semibold">
                  <span>⏱ {highlightData.duration_sec.toFixed(1)}s duration</span>
                  {inputMode !== "ai_prompt" && (
                    <span>
                      Range: {Math.floor(highlightData.start_time_sec / 60)}:
                      {Math.floor(highlightData.start_time_sec % 60)
                        .toString()
                        .padStart(2, "0")}{" "}
                      &rarr; {Math.floor(highlightData.end_time_sec / 60)}:
                      {Math.floor(highlightData.end_time_sec % 60)
                        .toString()
                        .padStart(2, "0")}
                    </span>
                  )}
                  {cropPlanData && <span>📐 {cropPlanData.keyframes_count} 9:16 frames</span>}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: 9:16 Video Preview & Instagram Publishing */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          <div className="p-6 sm:p-7 rounded-3xl bg-white/95 backdrop-blur-2xl border border-white text-zinc-900 shadow-[0_24px_50px_-12px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.4)] flex flex-col items-center transition-all">
            <div className="w-full flex items-center justify-between mb-4 pb-3 border-b border-zinc-200/80">
              <div className="flex items-center gap-2.5">
                <span className="text-[10px] font-mono font-semibold uppercase px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200">
                  STEP 03
                </span>
                <h2 className="text-sm font-bold text-zinc-950 tracking-tight">9:16 Reel Preview</h2>
              </div>
              {elapsedSec && (
                <span className="text-xs font-mono text-emerald-700 bg-emerald-100/90 px-2.5 py-0.5 rounded-full border border-emerald-300 font-bold">
                  Ready in {elapsedSec}s
                </span>
              )}
            </div>

            {/* 3D Realistic Smartphone Mockup Chassis */}
            <div className="relative group/phone select-none my-2">
              {/* Outer Physical Hardware Buttons - Left (Action Button + Volume Rockers) */}
              <div className="absolute -left-[3px] top-20 w-[3px] h-6 bg-gradient-to-r from-zinc-600 via-zinc-500 to-zinc-700 rounded-l-sm shadow-[inset_0_1px_1px_rgba(255,255,255,0.3)] z-10" />
              <div className="absolute -left-[3px] top-32 w-[3px] h-11 bg-gradient-to-r from-zinc-600 via-zinc-500 to-zinc-700 rounded-l-sm shadow-[inset_0_1px_1px_rgba(255,255,255,0.3)] z-10" />
              <div className="absolute -left-[3px] top-48 w-[3px] h-11 bg-gradient-to-r from-zinc-600 via-zinc-500 to-zinc-700 rounded-l-sm shadow-[inset_0_1px_1px_rgba(255,255,255,0.3)] z-10" />

              {/* Outer Physical Hardware Button - Right (Power / Lock Button) */}
              <div className="absolute -right-[3px] top-36 w-[3px] h-16 bg-gradient-to-l from-zinc-600 via-zinc-500 to-zinc-700 rounded-r-sm shadow-[inset_0_1px_1px_rgba(255,255,255,0.3)] z-10" />

              {/* 3D Phone Chassis (Brushed Titanium / Dark Slate Frame with Dual Bevel) */}
              <div className="relative w-[280px] sm:w-[295px] h-[500px] sm:h-[530px] rounded-[52px] p-[8px] sm:p-[9px] bg-gradient-to-b from-[#4e4e5e] via-[#242430] to-[#121218] shadow-[0_35px_80px_-15px_rgba(0,0,0,0.65),0_15px_30px_-8px_rgba(0,0,0,0.5),inset_0_2px_3px_rgba(255,255,255,0.45),inset_0_-2px_4px_rgba(0,0,0,0.9),0_0_0_1px_rgba(255,255,255,0.14)] transition-transform duration-300 group-hover/phone:scale-[1.01]">
                
                {/* Metallic Antenna Cutouts */}
                <div className="absolute top-20 -left-[1px] w-[2px] h-[3px] bg-zinc-900/90" />
                <div className="absolute top-20 -right-[1px] w-[2px] h-[3px] bg-zinc-900/90" />
                <div className="absolute bottom-24 -left-[1px] w-[2px] h-[3px] bg-zinc-900/90" />
                <div className="absolute bottom-24 -right-[1px] w-[2px] h-[3px] bg-zinc-900/90" />

                {/* Inner Black OLED Bezel */}
                <div className="relative w-full h-full rounded-[44px] p-[3px] bg-black ring-1 ring-white/10 shadow-inner overflow-hidden flex flex-col">
                  
                  {/* Screen Body */}
                  <div className="relative w-full h-full rounded-[40px] bg-[#07060d] overflow-hidden flex flex-col">
                    
                    {/* 3D Diagonal Glass Sheen Reflection Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-br from-white/[0.09] via-white/[0.01] to-transparent pointer-events-none z-30" />
                    
                    {/* Top Speaker Slit */}
                    <div className="absolute top-2 left-1/2 -translate-x-1/2 w-14 h-1 bg-zinc-800/90 rounded-full z-40" />

                    {/* Dynamic Island with Camera Glint */}
                    <div className="absolute top-3.5 left-1/2 -translate-x-1/2 z-40 h-[26px] w-[105px] bg-black rounded-full border border-zinc-800/80 shadow-[0_3px_10px_rgba(0,0,0,0.9),inset_0_1px_1px_rgba(255,255,255,0.1)] flex items-center justify-between px-2.5">
                      {/* Left: Camera Lens with Blue Reflection Glint */}
                      <div className="w-2.5 h-2.5 rounded-full bg-[#0a0d1e] border border-blue-900/60 flex items-center justify-center relative">
                        <div className="w-1 h-1 rounded-full bg-blue-500/80" />
                      </div>
                      {/* Center: Live indicator dot if pipeline is active */}
                      {isRunning && (
                        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
                      )}
                      {/* Right: Proximity sensor */}
                      <div className="w-2 h-2 rounded-full bg-[#0e0f18]" />
                    </div>

                    {/* Top iOS Status Bar (Time & Signal Icons) */}
                    <div className="absolute top-4 inset-x-0 px-6 flex items-center justify-between z-35 text-[11px] font-semibold text-white/80 pointer-events-none">
                      <span>9:41</span>
                      <div className="flex items-center gap-1.5 text-white/80">
                        {/* Cellular Signal */}
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M2 18h3v3H2zm5-4h3v7H7zm5-4h3v11h-3zm5-5h3v16h-3z" />
                        </svg>
                        {/* Battery Icon */}
                        <div className="w-5 h-2.5 rounded-[3px] border border-white/70 p-0.5 flex items-center">
                          <div className="w-full h-full bg-white/90 rounded-[1px]" />
                        </div>
                      </div>
                    </div>

                    {/* Main Screen Player Content */}
                    {renderedVideoUrl ? (
                      <div className="relative w-full h-full group/video flex items-center justify-center">
                        <video
                          ref={videoRef}
                          src={renderedVideoUrl}
                          playsInline
                          loop
                          muted={isVideoMuted}
                          onPlay={() => setIsVideoPlaying(true)}
                          onPause={() => setIsVideoPlaying(false)}
                          onEnded={() => setIsVideoPlaying(false)}
                          onClick={toggleVideoPlayback}
                          className="w-full h-full object-cover cursor-pointer"
                        />

                        {/* BIG CENTRAL PLAY BUTTON */}
                        {!isVideoPlaying && (
                          <div
                            onClick={toggleVideoPlayback}
                            className="absolute inset-0 flex flex-col items-center justify-center z-25 bg-black/40 backdrop-blur-[2px] transition-all cursor-pointer group/btn"
                          >
                            {/* Outer Pulsing Glow Halo */}
                            <div className="relative flex items-center justify-center">
                              <div className="absolute w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-violet-600/40 blur-xl animate-pulse" />
                              
                              {/* Glassmorphic Play Plate */}
                              <div className="relative w-20 h-20 sm:w-22 sm:h-22 rounded-full bg-white/25 backdrop-blur-xl border-2 border-white/90 shadow-[0_15px_35px_rgba(0,0,0,0.6),0_0_35px_rgba(139,92,246,0.7)] flex items-center justify-center group-hover/btn:scale-110 active:scale-95 transition-all duration-300">
                                
                                {/* Inner Vibrant Gradient Orb */}
                                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gradient-to-tr from-violet-600 via-purple-600 to-indigo-500 shadow-inner flex items-center justify-center group-hover/btn:from-violet-500 group-hover/btn:to-indigo-400">
                                  {/* Triangle Play Icon */}
                                  <svg className="w-8 h-8 text-white ml-1 fill-current drop-shadow-md" viewBox="0 0 24 24">
                                    <path d="M8 5v14l11-7z" />
                                  </svg>
                                </div>
                              </div>
                            </div>

                            <span className="mt-3.5 px-3 py-1 rounded-full bg-black/70 backdrop-blur-md border border-white/20 text-[11px] font-bold text-white tracking-wider uppercase shadow-md flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                              Click to Play 9:16 Reel
                            </span>
                          </div>
                        )}

                        {/* Top-Right Quick Audio Mute/Unmute Pill */}
                        <button
                          type="button"
                          onClick={toggleVideoMute}
                          className="absolute top-12 right-3.5 z-35 p-2 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-md border border-white/20 text-white transition-all hover:scale-105 active:scale-95 shadow-md"
                          title={isVideoMuted ? "Unmute Audio" : "Mute Audio"}
                        >
                          {isVideoMuted ? (
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                            </svg>
                          ) : (
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                            </svg>
                          )}
                        </button>

                        {/* Bottom Overlay Bar on Hover when playing */}
                        {isVideoPlaying && (
                          <div
                            onClick={toggleVideoPlayback}
                            className="absolute bottom-6 inset-x-4 z-30 flex items-center justify-between p-2 rounded-2xl bg-black/60 backdrop-blur-md border border-white/15 opacity-0 group-hover/video:opacity-100 transition-opacity duration-200 cursor-pointer text-white"
                          >
                            <div className="flex items-center gap-2 text-xs font-medium pl-1">
                              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                              </svg>
                              <span>Tap to pause</span>
                            </div>
                            <span className="text-[10px] font-mono text-violet-300 pr-1">9:16 Vertical</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* Standby / Empty / Rendering Screen */
                      <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#1f1442] via-[#0b061c] to-[#04020a]">
                        {isRunning ? (
                          <div className="flex flex-col items-center gap-3.5">
                            <div className="relative flex items-center justify-center">
                              <div className="w-14 h-14 rounded-full border-3 border-violet-500/20 border-t-violet-400 animate-spin" />
                              <div className="absolute w-8 h-8 rounded-full bg-violet-600/30 blur-md animate-pulse" />
                            </div>
                            <p className="text-xs text-violet-200 font-bold tracking-tight">
                              Rendering 9:16 Vertical Reel...
                            </p>
                            <span className="text-[11px] text-violet-300/90 font-mono bg-violet-950/70 px-2.5 py-0.5 rounded-full border border-violet-700/40">
                              {pipelineProgress}% completed
                            </span>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center">
                            {/* Glowing 3D Glass Studio Emblem */}
                            <div className="relative mb-4 group/icon">
                              <div className="absolute -inset-1.5 rounded-3xl bg-gradient-to-r from-violet-600 to-indigo-600 opacity-30 blur-md" />
                              <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-b from-white/15 via-white/5 to-transparent border border-white/20 backdrop-blur-md shadow-xl flex items-center justify-center text-violet-300 shadow-[0_10px_25px_rgba(0,0,0,0.5)]">
                                <svg className="w-7 h-7 drop-shadow-[0_2px_8px_rgba(167,139,250,0.6)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                              </div>
                            </div>
                            <p className="text-xs font-semibold text-zinc-200 max-w-[210px] leading-relaxed">
                              Rendered vertical 9:16 reel will appear here for instant preview.
                            </p>
                            <span className="text-[10px] text-zinc-400 font-mono mt-2 bg-zinc-900/80 px-2.5 py-1 rounded-full border border-zinc-800">
                              Ready for Render
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* iOS Home Indicator Bar */}
                    <div className="w-28 h-1 bg-white/50 rounded-full mx-auto absolute bottom-2.5 left-1/2 -translate-x-1/2 z-40 pointer-events-none shadow-sm" />
                  </div>
                </div>
              </div>
            </div>

            {/* Instagram Publish Section */}
            <div className="w-full mt-6 pt-5 border-t border-zinc-200/80 flex flex-col gap-3">
              <label className="text-xs font-bold text-zinc-800 flex items-center justify-between">
                <span>Instagram Caption &amp; Hashtags</span>
                <span className="text-[10px] text-violet-600 font-mono font-semibold">Editable</span>
              </label>

              <textarea
                value={customCaption}
                onChange={(e) => setCustomCaption(e.target.value)}
                rows={3}
                placeholder="Write your reel caption and hashtags here..."
                className="w-full bg-zinc-50/90 border border-zinc-200 rounded-xl p-3 text-xs text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-600/15 transition-all resize-none font-sans font-medium"
              />

              {publishMessage && (
                <div
                  className={`text-xs p-3.5 rounded-xl border ${
                    publishStage === "published"
                      ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                      : publishStage === "publish-failed"
                      ? "bg-rose-50 border-rose-200 text-rose-800"
                      : "bg-violet-50 border-violet-200 text-violet-900"
                  }`}
                >
                  <p className="font-semibold">{publishMessage}</p>
                  {publishStage !== "idle" && publishStage !== "published" && publishStage !== "publish-failed" && (
                    <div className="w-full h-1.5 bg-zinc-200 rounded-full mt-2 overflow-hidden border border-zinc-300">
                      <div
                        className="h-full bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 transition-all duration-300 rounded-full"
                        style={{ width: `${publishProgress}%` }}
                      />
                    </div>
                  )}
                  {instagramMediaId && (
                    <p className="text-[11px] font-mono mt-1 text-emerald-700 font-bold">
                      Instagram Media ID: {instagramMediaId}
                    </p>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={uploadToSupabaseAndPublish}
                disabled={!renderedVideoUrl || publishStage === "uploading-supabase" || publishStage === "processing-instagram"}
                className="w-full py-3.5 px-6 rounded-xl font-bold text-sm bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-xl shadow-violet-600/25 hover:shadow-violet-600/35 transition-all transform active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
              >
                {publishStage === "uploading-supabase" || publishStage === "processing-instagram" ? (
                  <>
                    <svg className="animate-spin w-4 h-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    <span>Publishing to Instagram...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
                    </svg>
                    <span>Upload to Supabase &amp; Publish Instagram Reel</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* How AI Astra Works Section */}
      <section id="how-it-works" className="max-w-7xl w-full mx-auto px-4 sm:px-6 py-20 border-t border-violet-500/20 mt-16">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <span className="text-[11px] font-mono uppercase tracking-wider text-violet-300 bg-violet-950/70 border border-violet-600/40 px-3 py-1 rounded-full inline-block mb-3">
            SYSTEM ARCHITECTURE
          </span>
          <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-white">
            How Astra Studio Works
          </h2>
          <p className="text-sm text-violet-200/80 mt-2">
            A fully autonomous 4-stage pipeline that converts raw, horizontal video lectures into captivating, production-ready vertical reels.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
          {/* Step 1 */}
          <div className="p-6 rounded-3xl bg-white/95 backdrop-blur-xl border border-white text-zinc-900 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.3)] hover:shadow-[0_24px_50px_-12px_rgba(0,0,0,0.4)] transition-all flex flex-col gap-3 group">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono font-bold text-violet-700 px-2.5 py-0.5 rounded-full bg-violet-100 border border-violet-200">
                PHASE 01
              </span>
              <div className="w-9 h-9 rounded-xl bg-violet-50 border border-violet-200/80 flex items-center justify-center text-violet-600 group-hover:bg-violet-600 group-hover:text-white transition-colors shadow-2xs">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 100-6 3 3 0 000 6z" />
                </svg>
              </div>
            </div>
            <h3 className="text-sm font-bold text-zinc-950">Audio Ingest &amp; Term Normalization</h3>
            <p className="text-xs text-zinc-600 leading-relaxed font-normal">
              Extracts 16kHz mono audio, runs word-level Faster-Whisper ASR, and matches technical vocabulary via regex to preserve terms like O(n), PyTorch, and SQL.
            </p>
          </div>

          {/* Step 2 */}
          <div className="p-6 rounded-3xl bg-white/95 backdrop-blur-xl border border-white text-zinc-900 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.3)] hover:shadow-[0_24px_50px_-12px_rgba(0,0,0,0.4)] transition-all flex flex-col gap-3 group">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono font-bold text-violet-700 px-2.5 py-0.5 rounded-full bg-violet-100 border border-violet-200">
                PHASE 02
              </span>
              <div className="w-9 h-9 rounded-xl bg-violet-50 border border-violet-200/80 flex items-center justify-center text-violet-600 group-hover:bg-violet-600 group-hover:text-white transition-colors shadow-2xs">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
            </div>
            <h3 className="text-sm font-bold text-zinc-950">Pedagogical Highlight Scoring</h3>
            <p className="text-xs text-zinc-600 leading-relaxed font-normal">
              Evaluates candidate 30–60s windows across information density, self-containment, introductory hooks, and sentence closure to locate the single highest-value &ldquo;Aha!&rdquo; moment.
            </p>
          </div>

          {/* Step 3 */}
          <div className="p-6 rounded-3xl bg-white/95 backdrop-blur-xl border border-white text-zinc-900 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.3)] hover:shadow-[0_24px_50px_-12px_rgba(0,0,0,0.4)] transition-all flex flex-col gap-3 group">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono font-bold text-violet-700 px-2.5 py-0.5 rounded-full bg-violet-100 border border-violet-200">
                PHASE 03
              </span>
              <div className="w-9 h-9 rounded-xl bg-violet-50 border border-violet-200/80 flex items-center justify-center text-violet-600 group-hover:bg-violet-600 group-hover:text-white transition-colors shadow-2xs">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
            </div>
            <h3 className="text-sm font-bold text-zinc-950">Computer Vision 9:16 Re-Framing</h3>
            <p className="text-xs text-zinc-600 leading-relaxed font-normal">
              OpenCV face detection and screen content analyzers track the speaker and active code typing, generating smoothed pan trajectories and dynamic 9:16 compositions.
            </p>
          </div>

          {/* Step 4 */}
          <div className="p-6 rounded-3xl bg-white/95 backdrop-blur-xl border border-white text-zinc-900 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.3)] hover:shadow-[0_24px_50px_-12px_rgba(0,0,0,0.4)] transition-all flex flex-col gap-3 group">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono font-bold text-violet-700 px-2.5 py-0.5 rounded-full bg-violet-100 border border-violet-200">
                PHASE 04
              </span>
              <div className="w-9 h-9 rounded-xl bg-violet-50 border border-violet-200/80 flex items-center justify-center text-violet-600 group-hover:bg-violet-600 group-hover:text-white transition-colors shadow-2xs">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
              </div>
            </div>
            <h3 className="text-sm font-bold text-zinc-950">Karaoke Captions &amp; Auto-Publish</h3>
            <p className="text-xs text-zinc-600 leading-relaxed font-normal">
              Renders synchronized word-pop ASS subtitles, burns branding logos, and triggers direct Instagram Reel upload via resumable TUS and the Graph API.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-violet-900/30 bg-[#0a0518] backdrop-blur-md mt-20 py-12 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <img
              src="/astra-logo.svg"
              alt="Astra Studio Logo"
              className="w-7 h-7 object-contain drop-shadow-[0_0_10px_rgba(167,139,250,0.8)]"
            />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm tracking-tight text-white">Astra Studio</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-violet-950/80 text-violet-300 border border-violet-700/50">
                  PRO
                </span>
              </div>
              <p className="text-xs text-violet-300/70">Autonomous AI Video Workstation for Technical Educators</p>
            </div>
          </div>

          <div className="flex items-center gap-6 text-xs text-violet-200/80 font-medium">
            <a href="#studio-workspace" className="hover:text-white transition-colors">Studio</a>
            <a href="#how-it-works" className="hover:text-white transition-colors">How It Works</a>
            <a href="/upload" className="hover:text-white transition-colors">Direct Publisher</a>
          </div>

          <div className="text-xs text-violet-400/60 text-center md:text-right font-mono">
            <p>© 2026 Astra Studio. All rights reserved.</p>
            <p className="text-[11px] text-violet-500/60 mt-0.5">Next.js 16 · Remotion 4.0 · Faster-Whisper · FFmpeg</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
