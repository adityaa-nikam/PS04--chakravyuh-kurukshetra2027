"use client";

import { useEffect, useRef, useState } from "react";
import * as tus from "tus-js-client";
import { PipelineRenderedClip } from "@/lib/pipeline/client";

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
  const [targetClips, setTargetClips] = useState<number>(3);
  const [renderedClips, setRenderedClips] = useState<PipelineRenderedClip[]>([]);
  const [selectedClipIndex, setSelectedClipIndex] = useState<number>(0);

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

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pollingInstagram = useRef(false);

  // Clean up polling timer on unmount
  useEffect(() => {
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
  async function startRemotionGeneration() {
    if (!aiTopic.trim()) {
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
    setRenderedClips([]);
    setSelectedClipIndex(0);

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
          topic: aiTopic.trim(),
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
        formData.append("maxClips", targetClips.toString());

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
            maxClips: targetClips,
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
        if (job.rendered_clips && job.rendered_clips.length > 0) {
          setRenderedClips(job.rendered_clips);
        }

        if (job.status === "COMPLETED") {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          setElapsedSec(job.elapsed_sec ?? null);
          if (job.rendered_clips && job.rendered_clips.length > 0) {
            setRenderedClips(job.rendered_clips);
            setSelectedClipIndex(0);
            const first = job.rendered_clips[0];
            const vUrl = first.video_url || `/api/ai/video?filename=${encodeURIComponent(first.download_filename || `${activeJobId}_reel_01.mp4`)}`;
            setRenderedVideoUrl(`${vUrl}&t=${Date.now()}`);
            if (first.caption) {
              setCustomCaption(first.caption);
            }
          } else {
            // Set streaming video URL
            setRenderedVideoUrl(`/api/ai/video?jobId=${encodeURIComponent(activeJobId)}&t=${Date.now()}`);
          }
        } else if (job.status === "FAILED") {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          setErrorMessage(job.error_message || job.stage_message || "Pipeline failed.");
        }
      } catch (err) {
        console.warn("Polling error:", err);
      }
    }, 1500);
  }

  function handleSelectClip(index: number) {
    setSelectedClipIndex(index);
    const clip = renderedClips[index];
    if (!clip) return;
    const vUrl = clip.video_url || (clip.rendered_video_path ? `/api/ai/video?path=${encodeURIComponent(clip.rendered_video_path)}` : null);
    if (vUrl) {
      setRenderedVideoUrl(`${vUrl}&t=${Date.now()}`);
    }
    if (clip.caption) {
      setCustomCaption(clip.caption);
    }
    setHighlightData({
      clip_id: clip.clip_id,
      start_time_sec: clip.start_time_sec,
      end_time_sec: clip.end_time_sec,
      duration_sec: clip.duration_sec,
      pedagogical_score: clip.pedagogical_score,
      topic_summary: clip.title || clip.topic_summary,
      boundary_reasoning: clip.boundary_reasoning,
    });
  }

  function handleDownloadClip(clip: PipelineRenderedClip) {
    const rawUrl = clip.video_url
      ? clip.video_url
      : `/api/ai/video?path=${encodeURIComponent(clip.rendered_video_path || "")}`;
    const dlName = clip.download_filename || `${clip.clip_id}.mp4`;
    const downloadUrl = `${rawUrl}${rawUrl.includes("?") ? "&" : "?"}download=true&downloadName=${encodeURIComponent(dlName)}`;
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = dlName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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

            for (let attempt = 0; attempt < 50; attempt++) {
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
              setPublishProgress(60 + Math.min(38, Math.floor((attempt + 1) * 0.76)));
              setPublishMessage(`Instagram is encoding reel media (Check ${attempt + 1}/50)...`);

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
          <div className="p-6 sm:p-7 rounded-3xl bg-[#160d36]/80 border border-violet-500/20 backdrop-blur-xl shadow-2xl shadow-purple-950/60 relative overflow-hidden flex flex-col gap-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-violet-500/20">
              <div className="flex items-center gap-2.5">
                <span className="text-[10px] font-mono font-semibold uppercase px-2 py-0.5 rounded bg-violet-950/80 text-violet-300 border border-violet-600/40">
                  STEP 01
                </span>
                <h2 className="text-sm font-semibold text-white tracking-tight">
                  {inputMode === "ai_prompt"
                    ? "Generate Reel by Command (Remotion)"
                    : "Select Lecture Source Video"}
                </h2>
              </div>

              {/* Mode Toggle Tabs */}
              <div className="flex rounded-lg bg-[#0e0722] border border-violet-500/30 p-1 text-xs self-start sm:self-auto">
                <button
                  type="button"
                  onClick={() => setInputMode("ai_prompt")}
                  className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
                    inputMode === "ai_prompt"
                      ? "bg-[#281858] text-white font-medium shadow-xs"
                      : "text-violet-300/70 hover:text-white"
                  }`}
                >
                  <svg className="w-3.5 h-3.5 text-violet-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                  <span>AI Explainer</span>
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode("path")}
                  className={`px-3 py-1.5 rounded-md transition-all ${
                    inputMode === "path"
                      ? "bg-zinc-800 text-white font-medium shadow-xs"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  Local Path
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode("upload")}
                  className={`px-3 py-1.5 rounded-md transition-all ${
                    inputMode === "upload"
                      ? "bg-zinc-800 text-white font-medium shadow-xs"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  Upload File
                </button>
              </div>
            </div>

            {inputMode === "ai_prompt" ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-zinc-300">
                    Video Prompt / Command (Topic to explain)
                  </label>
                  <button
                    type="button"
                    onClick={loadLatestRemotionVideo}
                    className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-medium transition-colors"
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
                  className="w-full bg-[#221447]/70 border border-violet-400/20 rounded-xl px-4 py-3 text-sm text-zinc-100 placeholder:text-violet-300/40 focus:outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400 transition-all disabled:opacity-50 resize-none font-sans"
                />

                {/* Quick Presets */}
                <div className="flex items-center gap-1.5 flex-wrap text-xs text-zinc-400 mt-0.5">
                  <span className="text-zinc-500 text-[11px] uppercase font-mono mr-1">Presets:</span>
                  <button
                    type="button"
                    onClick={() => setAiTopic("Explain AI RAG System with a simple example")}
                    className="px-2.5 py-1 rounded-lg bg-zinc-950/60 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white transition-colors"
                  >
                    AI RAG System
                  </button>
                  <button
                    type="button"
                    onClick={() => setAiTopic("Explain XML versus JSON with a simple example")}
                    className="px-2.5 py-1 rounded-lg bg-zinc-950/60 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white transition-colors"
                  >
                    XML vs JSON
                  </button>
                  <button
                    type="button"
                    onClick={() => setAiTopic("Explain QuickSort versus MergeSort with time complexity")}
                    className="px-2.5 py-1 rounded-lg bg-zinc-950/60 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white transition-colors"
                  >
                    QuickSort vs MergeSort
                  </button>
                  <button
                    type="button"
                    onClick={() => setAiTopic("Explain how REST APIs work versus GraphQL in 45 seconds")}
                    className="px-2.5 py-1 rounded-lg bg-zinc-950/60 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white transition-colors"
                  >
                    REST vs GraphQL
                  </button>
                  <button
                    type="button"
                    onClick={() => setAiTopic("Explain how Git branching and merge conflicts work")}
                    className="px-2.5 py-1 rounded-lg bg-zinc-950/60 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white transition-colors"
                  >
                    Git Branching
                  </button>
                </div>

                {/* Remotion Configuration */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 pt-3 border-t border-zinc-800/60 text-xs">
                  <div>
                    <label className="text-zinc-400 block mb-1.5 font-medium">Target Audience</label>
                    <select
                      value={aiAudience}
                      onChange={(e) => setAiAudience(e.target.value)}
                      disabled={isRunning}
                      className="w-full bg-zinc-950/70 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-cyan-500"
                    >
                      <option value="Beginners">Beginners (Intuitive & Visual)</option>
                      <option value="CS Students">CS Students (Concepts & Big-O)</option>
                      <option value="Senior Developers">Engineers (In-depth Architecture)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-zinc-400 block mb-1.5 font-medium">Reel Duration</label>
                    <select
                      value={aiDuration}
                      onChange={(e) => setAiDuration(Number(e.target.value))}
                      disabled={isRunning}
                      className="w-full bg-zinc-950/70 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-cyan-500"
                    >
                      <option value={30}>30 Seconds (Fast Reel)</option>
                      <option value={45}>45 Seconds (Standard Recommended)</option>
                      <option value={60}>60 Seconds (Deep Dive)</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800/80 text-zinc-400 text-xs mt-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                  <span>Remotion 4.0 · Chrome Headless GPU (9:16 Vertical Render with Animated Code Blocks)</span>
                </div>
              </div>
            ) : inputMode === "path" ? (
              <div className="flex flex-col gap-3">
                <label className="text-xs font-medium text-zinc-300">
                  Full Video Path (Local Drive)
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={videoPath}
                    onChange={(e) => setVideoPath(e.target.value)}
                    disabled={isRunning}
                    placeholder="e.g. D:\softwares\lecture.mp4"
                    className="w-full bg-zinc-950/70 border border-zinc-800 rounded-xl px-4 py-3 text-sm font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all disabled:opacity-50"
                  />
                </div>

                {/* Quick Presets */}
                <div className="flex items-center gap-2 flex-wrap text-xs text-zinc-400 mt-1">
                  <span className="text-zinc-500 text-[11px] uppercase font-mono">Presets:</span>
                  <button
                    type="button"
                    onClick={() =>
                      setVideoPath(
                        "D:\\softwares\\Time and Space Complexity explained in literally 5 minutes _ Big O _ Concepts made simple ep -1.mp4.mp4"
                      )
                    }
                    className="px-2.5 py-1 rounded-lg bg-zinc-950/60 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white transition-colors"
                  >
                    Time & Space Complexity (5m)
                  </button>
                  <button
                    type="button"
                    onClick={() => setVideoPath("D:\\softwares\\videoplayback.mp4")}
                    className="px-2.5 py-1 rounded-lg bg-zinc-950/60 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white transition-colors"
                  >
                    videoplayback.mp4 (25m)
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <label className="text-xs font-medium text-zinc-300">
                  Select Video File (MP4, MOV, MKV)
                </label>
                <div className="border border-dashed border-zinc-800 hover:border-cyan-500/50 rounded-xl p-6 text-center cursor-pointer transition-colors bg-zinc-950/30">
                  <input
                    type="file"
                    accept="video/*"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                    disabled={isRunning}
                    className="hidden"
                    id="video-upload-input"
                  />
                  <label htmlFor="video-upload-input" className="cursor-pointer flex flex-col items-center gap-2">
                    <div className="w-10 h-10 rounded-xl bg-zinc-800/70 border border-zinc-700/50 flex items-center justify-center text-zinc-400">
                      <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                    </div>
                    <span className="text-sm font-medium text-zinc-200">
                      {selectedFile ? selectedFile.name : "Click to select or drag video here"}
                    </span>
                    {selectedFile && (
                      <span className="text-xs text-cyan-400 font-mono">
                        {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB
                      </span>
                    )}
                  </label>
                </div>
              </div>
            )}

            {/* AI Rendering Options (For video pipeline) */}
            {inputMode !== "ai_prompt" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4 pt-4 border-t border-zinc-800/60 text-xs">
                <div>
                  <label className="text-zinc-400 block mb-1.5 font-medium">Caption Style</label>
                  <select
                    value={captionStyle}
                    onChange={(e) => setCaptionStyle(e.target.value as any)}
                    disabled={isRunning}
                    className="w-full bg-zinc-950/70 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-cyan-500"
                  >
                    <option value="karaoke">✨ Karaoke (Word Pop)</option>
                    <option value="minimal">Minimal Clean</option>
                    <option value="bold">Bold Punchy</option>
                    <option value="neon">Neon Glow</option>
                  </select>
                </div>

                <div>
                  <label className="text-zinc-400 block mb-1.5 font-medium">9:16 Framing Mode</label>
                  <select
                    value={compositionMode}
                    onChange={(e) => setCompositionMode(e.target.value as any)}
                    disabled={isRunning}
                    className="w-full bg-zinc-950/70 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-cyan-500"
                  >
                    <option value="adaptive">Dynamic Hybrid (CV)</option>
                    <option value="presenter">Presenter Focus</option>
                    <option value="screen_content">Screen / Slide Focus</option>
                  </select>
                </div>

                <div>
                  <label className="text-zinc-400 block mb-1.5 font-medium">Subtitles Burn-In</label>
                  <button
                    type="button"
                    onClick={() => setSubtitlesEnabled(!subtitlesEnabled)}
                    disabled={isRunning}
                    className={`w-full py-2 px-3 rounded-lg border font-medium transition-colors flex items-center justify-center gap-2 ${
                      subtitlesEnabled
                        ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-300"
                        : "bg-zinc-950/70 border-zinc-800 text-zinc-400"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${subtitlesEnabled ? "bg-cyan-400" : "bg-zinc-500"}`} />
                    {subtitlesEnabled ? "Enabled" : "Disabled"}
                  </button>
                </div>

                <div>
                  <label className="text-zinc-400 block mb-1.5 font-medium flex items-center justify-between">
                    <span>Target Clips</span>
                    <span className="text-[10px] text-cyan-400 font-mono">1 to 10 clips</span>
                  </label>
                  <select
                    value={targetClips}
                    onChange={(e) => setTargetClips(parseInt(e.target.value, 10) || 3)}
                    disabled={isRunning}
                    className="w-full bg-zinc-950/70 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-cyan-500"
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                      <option key={num} value={num}>
                        {num} {num === 1 ? "Clip (Single Best)" : num === 3 ? "Clips (Recommended)" : "Clips"}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-2 lg:col-span-4 flex items-center gap-2 text-[11px] text-zinc-400 bg-cyan-950/20 border border-cyan-500/15 rounded-lg px-3 py-2 mt-1">
                  <span className="text-cyan-400">💡</span>
                  <span>
                    <strong className="text-cyan-300">Mercury Decide AI:</strong> Evaluates distinct topics across the lecture. If a video is short or only contains 1 or 2 topics, exactly that many clips are rendered (capped at your chosen limit).
                  </span>
                </div>
              </div>
            )}

            {/* Launch CTA */}
            <div className="pt-2">
              <button
                type="button"
                onClick={inputMode === "ai_prompt" ? startRemotionGeneration : startAIPipeline}
                disabled={isRunning}
                className="w-full py-4 px-6 rounded-xl font-semibold text-sm bg-white text-zinc-950 hover:bg-zinc-100 shadow-xl shadow-purple-950/40 transition-all transform active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
              >
                {isRunning ? (
                  <>
                    <svg className="animate-spin w-4 h-4 text-zinc-950" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    {inputMode === "ai_prompt"
                      ? `Rendering Remotion Reel (${pipelineProgress}%)...`
                      : `Processing AI Pipeline (${pipelineProgress}%)...`}
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4 text-violet-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
          <div className="p-6 sm:p-7 rounded-3xl bg-[#160d36]/80 border border-violet-500/20 backdrop-blur-xl shadow-2xl shadow-purple-950/60 flex flex-col gap-4">
            <div className="flex items-center justify-between pb-2 border-b border-violet-500/20">
              <div className="flex items-center gap-2.5">
                <span className="text-[10px] font-mono font-semibold uppercase px-2 py-0.5 rounded bg-violet-950/80 text-violet-300 border border-violet-600/40">
                  STEP 02
                </span>
                <h2 className="text-sm font-semibold text-white tracking-tight">Live Pipeline Tracker</h2>
              </div>
              {jobId && (
                <span className="font-mono text-xs px-2.5 py-1 rounded-lg bg-[#0e0722] border border-violet-500/30 text-violet-300 select-all">
                  {jobId}
                </span>
              )}
            </div>

            {/* Progress Bar */}
            <div className="relative w-full h-2 bg-[#0e0722] rounded-full overflow-hidden border border-violet-500/30">
              <div
                className={`h-full transition-all duration-500 rounded-full ${
                  pipelineStage === "FAILED"
                    ? "bg-rose-500"
                    : pipelineStage === "COMPLETED"
                    ? "bg-emerald-500"
                    : "bg-gradient-to-r from-violet-600 via-purple-500 to-indigo-500"
                }`}
                style={{ width: `${Math.max(3, pipelineProgress)}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-zinc-400">
                {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />}
                <span>{stageMessage || "Ready to execute pipeline"}</span>
              </div>
              <span className="font-mono font-semibold text-zinc-200">{pipelineProgress}%</span>
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
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 font-medium"
                        : isCurrent
                        ? "bg-cyan-500/15 border-cyan-500/60 text-cyan-200 font-medium ring-1 ring-cyan-500/30 shadow-xs"
                        : "bg-zinc-950/40 border-zinc-800/60 text-zinc-500"
                    }`}
                  >
                    {st.label}
                  </div>
                );
              })}
            </div>

            {/* Highlight Summary Card if extracted or generated */}
            {highlightData && (
              <div className="mt-2 p-4 rounded-xl bg-zinc-950/80 border border-zinc-800 flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-cyan-300 flex items-center gap-1.5">
                    {inputMode === "ai_prompt" ? "✨ Generated Storyboard Reel" : "🎯 Selected Educational Moment"}
                  </span>
                  <span className="font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded text-[11px]">
                    Score: {highlightData.pedagogical_score.toFixed(1)} / 100
                  </span>
                </div>
                <p className="text-xs text-zinc-300 italic border-l-2 border-cyan-500/60 pl-2.5 py-0.5">
                  &ldquo;{highlightData.topic_summary}&rdquo;
                </p>
                <div className="flex items-center gap-4 text-[11px] text-zinc-400 font-mono mt-1">
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
          <div className="p-6 sm:p-7 rounded-3xl bg-[#160d36]/80 border border-violet-500/20 backdrop-blur-xl shadow-2xl shadow-purple-950/60 flex flex-col items-center">
            <div className="w-full flex items-center justify-between mb-4 pb-2 border-b border-violet-500/20">
              <div className="flex items-center gap-2.5">
                <span className="text-[10px] font-mono font-semibold uppercase px-2 py-0.5 rounded bg-violet-950/80 text-violet-300 border border-violet-600/40">
                  STEP 03
                </span>
                <h2 className="text-sm font-semibold text-white tracking-tight">9:16 Reel Preview</h2>
              </div>
              {elapsedSec && (
                <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
                  Ready in {elapsedSec}s
                </span>
              )}
            </div>

            {/* Multi-Clip Options Deck (Mercury Decide Topic Selection) */}
            {renderedClips.length > 0 && (
              <div className="w-full mb-5 p-3.5 rounded-xl bg-[#030d22]/90 border border-cyan-500/30 shadow-lg shadow-cyan-950/20">
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-cyan-300">
                      Mercury Decide Options ({renderedClips.length} Generated)
                    </span>
                  </div>
                  <span className="text-[10px] text-zinc-400">
                    Select 1 for Instagram, download any
                  </span>
                </div>

                <div className="flex flex-col gap-2 max-h-[220px] overflow-y-auto pr-1">
                  {renderedClips.map((clip, idx) => {
                    const isSelected = selectedClipIndex === idx;
                    return (
                      <div
                        key={clip.clip_id || idx}
                        onClick={() => handleSelectClip(idx)}
                        className={`p-2.5 rounded-lg border transition-all cursor-pointer flex flex-col gap-1.5 ${
                          isSelected
                            ? "bg-cyan-950/50 border-cyan-400 ring-1 ring-cyan-400/40"
                            : "bg-black/40 border-white/10 hover:border-white/20 hover:bg-white/[0.03]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase shrink-0 ${
                              isSelected ? "bg-cyan-400 text-black" : "bg-white/10 text-zinc-300"
                            }`}>
                              Option #{idx + 1}
                            </span>
                            <span className="text-xs font-medium text-white truncate">
                              {clip.title}
                            </span>
                          </div>

                          <span className="text-[10px] font-mono text-cyan-300 shrink-0 bg-cyan-950 px-1.5 py-0.5 rounded border border-cyan-500/30">
                            ⭐ {clip.pedagogical_score.toFixed(0)}%
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-[11px] text-zinc-400 pt-1 border-t border-white/5 font-mono">
                          <div className="flex items-center gap-2.5">
                            <span>⏱ {clip.duration_sec.toFixed(1)}s</span>
                            <span>
                              {Math.floor(clip.start_time_sec / 60)}:{Math.floor(clip.start_time_sec % 60).toString().padStart(2, "0")} &rarr; {Math.floor(clip.end_time_sec / 60)}:{Math.floor(clip.end_time_sec % 60).toString().padStart(2, "0")}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => handleSelectClip(idx)}
                              className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                                isSelected
                                  ? "bg-cyan-400 text-black font-bold"
                                  : "bg-white/10 text-zinc-200 hover:bg-cyan-500/20 hover:text-cyan-300"
                              }`}
                            >
                              {isSelected ? "Active" : "Select"}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDownloadClip(clip)}
                              title="Download this clip MP4"
                              className="px-2 py-0.5 rounded text-[10px] bg-white/5 border border-white/10 text-zinc-300 hover:bg-white/10 hover:text-white flex items-center gap-1"
                            >
                              <span>⬇</span>
                              <span>Download</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Smartphone 9:16 Frame Player */}
            <div className="relative w-[270px] sm:w-[285px] h-[480px] sm:h-[506px] rounded-[36px] bg-zinc-950 p-2 border border-zinc-800 shadow-2xl overflow-hidden flex flex-col items-center justify-center ring-1 ring-white/5">
              {/* Camera Notch */}
              <div className="absolute top-3.5 w-20 h-3.5 bg-black rounded-full z-20 border border-zinc-800/50" />

              {renderedVideoUrl ? (
                <video
                  ref={videoRef}
                  src={renderedVideoUrl}
                  controls
                  playsInline
                  loop
                  className="w-full h-full object-cover rounded-[28px]"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center text-zinc-500 bg-zinc-950/80 rounded-[28px]">
                  {isRunning ? (
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-10 h-10 rounded-full border-2 border-cyan-500 border-t-transparent animate-spin" />
                      <p className="text-xs text-cyan-300 font-medium">
                        Rendering vertical reel...
                      </p>
                      <span className="text-[11px] text-zinc-500 font-mono">
                        {pipelineProgress}% completed
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-600 mb-3">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <p className="text-xs text-zinc-400 max-w-[200px]">
                        Rendered vertical 9:16 reel will appear here for instant preview.
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>

            {renderedVideoUrl && (
              <div className="w-full flex items-center justify-between mt-3 text-xs">
                <span className="text-zinc-400 font-mono text-[11px]">
                  {renderedClips.length > 0
                    ? `Active: Option #${selectedClipIndex + 1} (${renderedClips[selectedClipIndex]?.title || "Clip"})`
                    : "Active 9:16 Reel"}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (renderedClips.length > 0 && renderedClips[selectedClipIndex]) {
                      handleDownloadClip(renderedClips[selectedClipIndex]);
                    } else if (renderedVideoUrl) {
                      const a = document.createElement("a");
                      a.href = `${renderedVideoUrl}&download=true`;
                      a.download = `${jobId || "reel"}.mp4`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:border-cyan-500/40 text-cyan-300 hover:text-white flex items-center gap-1.5 transition-all text-xs font-medium"
                >
                  <span>⬇</span>
                  <span>Download Active MP4</span>
                </button>
              </div>
            )}

            {/* Instagram Publish Section */}
            <div className="w-full mt-6 pt-5 border-t border-violet-500/20 flex flex-col gap-3">
              <label className="text-xs font-medium text-zinc-300 flex items-center justify-between">
                <span>Instagram Caption &amp; Hashtags</span>
                <span className="text-[10px] text-violet-300/70 font-mono">Editable</span>
              </label>

              <textarea
                value={customCaption}
                onChange={(e) => setCustomCaption(e.target.value)}
                rows={3}
                placeholder="Write your reel caption and hashtags here..."
                className="w-full bg-[#221447]/70 border border-violet-400/20 rounded-xl p-3 text-xs text-zinc-100 placeholder:text-violet-300/40 focus:outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400 transition-all resize-none font-sans"
              />

              {publishMessage && (
                <div
                  className={`text-xs p-3.5 rounded-xl border ${
                    publishStage === "published"
                      ? "bg-emerald-950/20 border-emerald-800/30 text-emerald-300"
                      : publishStage === "publish-failed"
                      ? "bg-rose-950/20 border-rose-800/30 text-rose-300"
                      : "bg-violet-950/40 border-violet-600/30 text-violet-200"
                  }`}
                >
                  <p className="font-medium">{publishMessage}</p>
                  {publishStage !== "idle" && publishStage !== "published" && publishStage !== "publish-failed" && (
                    <div className="w-full h-1.5 bg-[#0e0722] rounded-full mt-2 overflow-hidden border border-violet-500/30">
                      <div
                        className="h-full bg-gradient-to-r from-violet-600 via-purple-500 to-indigo-500 transition-all duration-300 rounded-full"
                        style={{ width: `${publishProgress}%` }}
                      />
                    </div>
                  )}
                  {instagramMediaId && (
                    <p className="text-[11px] font-mono mt-1 text-emerald-400">
                      Instagram Media ID: {instagramMediaId}
                    </p>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={uploadToSupabaseAndPublish}
                disabled={!renderedVideoUrl || publishStage === "uploading-supabase" || publishStage === "processing-instagram"}
                className="w-full py-3.5 px-6 rounded-xl font-semibold text-sm bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-xl shadow-purple-950/50 transition-all transform active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
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
          <div className="p-5 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 backdrop-blur-sm flex flex-col gap-3 group hover:border-cyan-500/40 transition-colors">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono font-bold text-cyan-400 px-2 py-0.5 rounded bg-cyan-950/50 border border-cyan-800/40">
                PHASE 01
              </span>
              <div className="w-8 h-8 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center text-zinc-400 group-hover:text-cyan-300 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 100-6 3 3 0 000 6z" />
                </svg>
              </div>
            </div>
            <h3 className="text-sm font-semibold text-white">Audio Ingest &amp; Term Normalization</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Extracts 16kHz mono audio, runs word-level Faster-Whisper ASR, and matches technical vocabulary via regex to preserve terms like O(n), PyTorch, and SQL.
            </p>
          </div>

          {/* Step 2 */}
          <div className="p-5 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 backdrop-blur-sm flex flex-col gap-3 group hover:border-cyan-500/40 transition-colors">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono font-bold text-cyan-400 px-2 py-0.5 rounded bg-cyan-950/50 border border-cyan-800/40">
                PHASE 02
              </span>
              <div className="w-8 h-8 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center text-zinc-400 group-hover:text-cyan-300 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
            </div>
            <h3 className="text-sm font-semibold text-white">Pedagogical Highlight Scoring</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Evaluates candidate 30–60s windows across information density, self-containment, introductory hooks, and sentence closure to locate the single highest-value &ldquo;Aha!&rdquo; moment.
            </p>
          </div>

          {/* Step 3 */}
          <div className="p-5 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 backdrop-blur-sm flex flex-col gap-3 group hover:border-cyan-500/40 transition-colors">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono font-bold text-cyan-400 px-2 py-0.5 rounded bg-cyan-950/50 border border-cyan-800/40">
                PHASE 03
              </span>
              <div className="w-8 h-8 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center text-zinc-400 group-hover:text-cyan-300 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
            </div>
            <h3 className="text-sm font-semibold text-white">Computer Vision 9:16 Re-Framing</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              OpenCV face detection and screen content analyzers track the speaker and active code typing, generating smoothed pan trajectories and dynamic 9:16 compositions.
            </p>
          </div>

          {/* Step 4 */}
          <div className="p-5 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 backdrop-blur-sm flex flex-col gap-3 group hover:border-cyan-500/40 transition-colors">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono font-bold text-cyan-400 px-2 py-0.5 rounded bg-cyan-950/50 border border-cyan-800/40">
                PHASE 04
              </span>
              <div className="w-8 h-8 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center text-zinc-400 group-hover:text-cyan-300 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
              </div>
            </div>
            <h3 className="text-sm font-semibold text-white">Karaoke Captions &amp; Auto-Publish</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
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
