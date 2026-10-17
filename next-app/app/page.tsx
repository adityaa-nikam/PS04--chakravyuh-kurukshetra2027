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
    <div className="min-h-screen bg-[#08080c] text-white flex flex-col font-sans selection:bg-purple-600 selection:text-white">
      {/* Background Glow Accents */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-purple-700/20 rounded-full blur-[120px]" />
        <div className="absolute top-1/3 -right-40 w-[500px] h-[500px] bg-pink-600/15 rounded-full blur-[140px]" />
        <div className="absolute -bottom-40 left-1/3 w-96 h-96 bg-blue-600/15 rounded-full blur-[130px]" />
      </div>

      {/* Header */}
      <header className="border-b border-white/10 bg-black/40 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-18 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-600 via-pink-500 to-amber-400 p-[2px] shadow-lg shadow-purple-500/20">
              <div className="w-full h-full bg-black rounded-[10px] flex items-center justify-center font-black text-lg text-transparent bg-clip-text bg-gradient-to-tr from-purple-400 to-pink-400">
                CH
              </div>
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
                Chakravyuh <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 border border-purple-500/30 text-purple-300 font-mono">AI REEL STUDIO</span>
              </h1>
              <p className="text-xs text-zinc-400">Lecture Highlight Extractor • 9:16 Adaptive Framing • Auto Instagram Reels</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              NVIDIA RTX 2050 (CUDA Active)
            </div>
          </div>
        </div>
      </header>

      {/* Main Grid Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Input, Pipeline Controls & Live Status */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          {/* Card 1: Video Input Selection */}
          <div className="p-6 rounded-2xl bg-zinc-900/60 border border-white/10 backdrop-blur-md shadow-2xl relative overflow-hidden">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-500 text-xs font-bold">1</span>
                <h2 className="text-base font-semibold text-white">
                  {inputMode === "ai_prompt"
                    ? "Generate Reel by Command (Remotion Engine)"
                    : "Select Lecture Source Video"}
                </h2>
              </div>

              {/* Mode Toggle Tabs */}
              <div className="flex rounded-lg bg-black/50 p-1 border border-white/10 text-xs">
                <button
                  type="button"
                  onClick={() => setInputMode("ai_prompt")}
                  className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
                    inputMode === "ai_prompt"
                      ? "bg-purple-600 text-white font-medium shadow-sm"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  <span>✨</span>
                  <span>Command (Remotion)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode("path")}
                  className={`px-3 py-1.5 rounded-md transition-all ${
                    inputMode === "path"
                      ? "bg-purple-600 text-white font-medium shadow-sm"
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
                      ? "bg-purple-600 text-white font-medium shadow-sm"
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
                    className="text-[11px] text-purple-300 hover:text-purple-200 underline font-medium transition-colors"
                  >
                    ⚡ Load Last Rendered Video
                  </button>
                </div>
                <textarea
                  value={aiTopic}
                  onChange={(e) => setAiTopic(e.target.value)}
                  disabled={isRunning}
                  rows={3}
                  placeholder="e.g. Explain XML versus JSON with a simple example"
                  className="w-full bg-black/60 border border-white/15 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all disabled:opacity-50 resize-none font-sans"
                />

                {/* Quick Presets */}
                <div className="flex items-center gap-2 flex-wrap text-xs text-zinc-400 mt-1">
                  <span className="text-zinc-500">Quick Presets:</span>
                  <button
                    type="button"
                    onClick={() => setAiTopic("Explain AI RAG System with a simple example")}
                    className="px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-purple-300 transition-colors"
                  >
                    AI RAG System
                  </button>
                  <button
                    type="button"
                    onClick={() => setAiTopic("Explain XML versus JSON with a simple example")}
                    className="px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-purple-300 transition-colors"
                  >
                    XML vs JSON Example
                  </button>
                  <button
                    type="button"
                    onClick={() => setAiTopic("Explain QuickSort versus MergeSort with time complexity")}
                    className="px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-purple-300 transition-colors"
                  >
                    QuickSort vs MergeSort
                  </button>
                  <button
                    type="button"
                    onClick={() => setAiTopic("Explain how REST APIs work versus GraphQL in 45 seconds")}
                    className="px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-purple-300 transition-colors"
                  >
                    REST vs GraphQL
                  </button>
                  <button
                    type="button"
                    onClick={() => setAiTopic("Explain how Git branching and merge conflicts work")}
                    className="px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-purple-300 transition-colors"
                  >
                    Git Branching
                  </button>
                </div>

                {/* Remotion Configuration */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 pt-4 border-t border-white/10 text-xs">
                  <div>
                    <label className="text-zinc-400 block mb-1.5 font-medium">Target Audience</label>
                    <select
                      value={aiAudience}
                      onChange={(e) => setAiAudience(e.target.value)}
                      disabled={isRunning}
                      className="w-full bg-black/60 border border-white/15 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-purple-500"
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
                      className="w-full bg-black/60 border border-white/15 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-purple-500"
                    >
                      <option value={30}>30 Seconds (Fast Reel)</option>
                      <option value={45}>45 Seconds (Recommended Standard)</option>
                      <option value={60}>60 Seconds (Deep Dive)</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-300 text-xs mt-1">
                  <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
                  <span>Remotion 4.0 + Chrome Headless GPU (9:16 Vertical Render with Animated Visual Actions)</span>
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
                    className="w-full bg-black/60 border border-white/15 rounded-xl px-4 py-3 text-sm font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all disabled:opacity-50"
                  />
                </div>

                {/* Quick Presets */}
                <div className="flex items-center gap-2 flex-wrap text-xs text-zinc-400 mt-1">
                  <span>Quick Presets:</span>
                  <button
                    type="button"
                    onClick={() =>
                      setVideoPath(
                        "D:\\softwares\\Time and Space Complexity explained in literally 5 minutes _ Big O _ Concepts made simple ep -1.mp4.mp4"
                      )
                    }
                    className="px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-purple-300 transition-colors"
                  >
                    Time & Space Complexity (5m)
                  </button>
                  <button
                    type="button"
                    onClick={() => setVideoPath("D:\\softwares\\videoplayback.mp4")}
                    className="px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-purple-300 transition-colors"
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
                <div className="border-2 border-dashed border-white/15 hover:border-purple-500/50 rounded-xl p-6 text-center cursor-pointer transition-colors bg-black/30">
                  <input
                    type="file"
                    accept="video/*"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                    disabled={isRunning}
                    className="hidden"
                    id="video-upload-input"
                  />
                  <label htmlFor="video-upload-input" className="cursor-pointer flex flex-col items-center gap-2">
                    <svg className="w-8 h-8 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <span className="text-sm font-medium text-zinc-200">
                      {selectedFile ? selectedFile.name : "Click to select or drag video here"}
                    </span>
                    {selectedFile && (
                      <span className="text-xs text-purple-300 font-mono">
                        {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB
                      </span>
                    )}
                  </label>
                </div>
              </div>
            )}

            {/* AI Rendering Options (For video pipeline) */}
            {inputMode !== "ai_prompt" && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5 pt-5 border-t border-white/10 text-xs">
                <div>
                  <label className="text-zinc-400 block mb-1.5 font-medium">Caption Style</label>
                  <select
                    value={captionStyle}
                    onChange={(e) => setCaptionStyle(e.target.value as any)}
                    disabled={isRunning}
                    className="w-full bg-black/60 border border-white/15 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-purple-500"
                  >
                    <option value="karaoke">✨ Karaoke (Word Pop)</option>
                    <option value="minimal">Minimal Elegant</option>
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
                    className="w-full bg-black/60 border border-white/15 rounded-lg px-3 py-2 text-zinc-200 focus:outline-none focus:border-purple-500"
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
                        ? "bg-purple-600/20 border-purple-500/40 text-purple-300"
                        : "bg-black/60 border-white/15 text-zinc-400"
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${subtitlesEnabled ? "bg-purple-400" : "bg-zinc-500"}`} />
                    {subtitlesEnabled ? "Enabled" : "Disabled"}
                  </button>
                </div>
              </div>
            )}

            {/* Launch CTA */}
            <div className="mt-6">
              <button
                type="button"
                onClick={inputMode === "ai_prompt" ? startRemotionGeneration : startAIPipeline}
                disabled={isRunning}
                className="w-full py-3.5 px-6 rounded-xl font-semibold text-sm bg-gradient-to-r from-purple-600 via-pink-600 to-amber-500 hover:from-purple-500 hover:to-amber-400 text-white shadow-lg shadow-purple-600/30 transition-all transform active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
                    <span>⚡</span>
                    {inputMode === "ai_prompt"
                      ? "Generate Vertical 9:16 Reel by Command (Remotion)"
                      : "Generate AI Vertical Reel (Highlight + 9:16 Crop + Captions)"}
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Card 2: Live Pipeline Progress Tracker */}
          <div className="p-6 rounded-2xl bg-zinc-900/60 border border-white/10 backdrop-blur-md shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-pink-500 text-xs font-bold">2</span>
                <h2 className="text-base font-semibold text-white">Live Pipeline Tracker</h2>
              </div>
              {jobId && (
                <span className="font-mono text-xs px-2.5 py-1 rounded bg-black/60 border border-white/10 text-zinc-400">
                  {jobId}
                </span>
              )}
            </div>

            {/* Progress Bar */}
            <div className="relative w-full h-3 bg-black/60 rounded-full overflow-hidden border border-white/10 mb-3">
              <div
                className={`h-full transition-all duration-500 rounded-full ${
                  pipelineStage === "FAILED"
                    ? "bg-red-500"
                    : pipelineStage === "COMPLETED"
                    ? "bg-emerald-500"
                    : "bg-gradient-to-r from-purple-500 via-pink-500 to-amber-400"
                }`}
                style={{ width: `${Math.max(3, pipelineProgress)}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-xs mb-6">
              <span className="text-zinc-400 font-medium">
                {stageMessage || "Waiting to launch pipeline..."}
              </span>
              <span className="font-mono font-bold text-white">{pipelineProgress}%</span>
            </div>

            {/* Pipeline Stage Pills */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
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
                    className={`px-3 py-2 rounded-xl border text-center transition-all ${
                      isDone
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300 font-medium"
                        : isCurrent
                        ? "bg-purple-600/20 border-purple-500 text-purple-200 font-semibold ring-1 ring-purple-500/50 animate-pulse"
                        : "bg-black/40 border-white/5 text-zinc-500"
                    }`}
                  >
                    {st.label}
                  </div>
                );
              })}
            </div>

            {/* Highlight Summary Card if extracted or generated */}
            {highlightData && (
              <div className="mt-5 p-4 rounded-xl bg-purple-950/20 border border-purple-500/20 flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-purple-300 flex items-center gap-1.5">
                    {inputMode === "ai_prompt" ? "✨ Generated Storyboard Reel" : "🎯 Selected Educational Moment"}
                  </span>
                  <span className="font-mono text-zinc-300 bg-purple-900/40 px-2 py-0.5 rounded">
                    Score: {highlightData.pedagogical_score.toFixed(1)} / 100
                  </span>
                </div>
                <p className="text-xs text-zinc-300 italic line-clamp-2">
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
          <div className="p-6 rounded-2xl bg-zinc-900/60 border border-white/10 backdrop-blur-md shadow-2xl flex flex-col items-center">
            <div className="w-full flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-amber-500 text-xs font-bold text-black">3</span>
                <h2 className="text-base font-semibold text-white">9:16 Reel Preview</h2>
              </div>
              {elapsedSec && (
                <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  Ready in {elapsedSec}s
                </span>
              )}
            </div>

            {/* Smartphone 9:16 Frame Player */}
            <div className="relative w-[280px] h-[497px] rounded-[32px] bg-black p-2.5 border-[4px] border-zinc-800 shadow-2xl shadow-purple-950/40 overflow-hidden flex flex-col items-center justify-center">
              {/* Camera Notch */}
              <div className="absolute top-4 w-20 h-4 bg-zinc-900 rounded-full z-20" />

              {renderedVideoUrl ? (
                <video
                  ref={videoRef}
                  src={renderedVideoUrl}
                  controls
                  playsInline
                  loop
                  className="w-full h-full object-cover rounded-[24px]"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center text-zinc-500 bg-zinc-950/60 rounded-[24px]">
                  {isRunning ? (
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-12 h-12 rounded-full border-2 border-purple-500 border-t-transparent animate-spin" />
                      <p className="text-xs text-purple-300 font-medium">
                        Rendering vertical reel...
                      </p>
                      <span className="text-[11px] text-zinc-500 font-mono">
                        {pipelineProgress}% completed
                      </span>
                    </div>
                  ) : (
                    <>
                      <svg className="w-12 h-12 text-zinc-700 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      <p className="text-xs text-zinc-400">
                        Rendered vertical 9:16 reel will appear here for instant preview.
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Instagram Publish Section */}
            <div className="w-full mt-6 pt-5 border-t border-white/10 flex flex-col gap-3">
              <label className="text-xs font-semibold text-zinc-300 flex items-center justify-between">
                <span>Instagram Caption</span>
                <span className="text-[10px] text-zinc-500 font-normal">Editable</span>
              </label>

              <textarea
                value={customCaption}
                onChange={(e) => setCustomCaption(e.target.value)}
                rows={3}
                placeholder="Write your reel caption and hashtags here..."
                className="w-full bg-black/60 border border-white/15 rounded-xl p-3 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-pink-500 transition-all resize-none"
              />

              {publishMessage && (
                <div
                  className={`text-xs p-3 rounded-xl border ${
                    publishStage === "published"
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                      : publishStage === "publish-failed"
                      ? "bg-red-500/10 border-red-500/30 text-red-300"
                      : "bg-pink-500/10 border-pink-500/30 text-pink-300"
                  }`}
                >
                  <p className="font-medium">{publishMessage}</p>
                  {publishStage !== "idle" && publishStage !== "published" && publishStage !== "publish-failed" && (
                    <div className="w-full h-1.5 bg-black/40 rounded-full mt-2 overflow-hidden">
                      <div
                        className="h-full bg-pink-500 transition-all duration-300 rounded-full"
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
                className="w-full py-3.5 px-6 rounded-xl font-semibold text-sm bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white shadow-lg shadow-pink-600/30 transition-all transform active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {publishStage === "uploading-supabase" || publishStage === "processing-instagram" ? (
                  <>
                    <svg className="animate-spin w-4 h-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Publishing to Instagram...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
                    </svg>
                    Upload to Supabase & Publish Instagram Reel
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
