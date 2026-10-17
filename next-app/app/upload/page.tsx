
"use client";

import { useEffect, useRef, useState } from "react";
import * as tus from "tus-js-client";

type SavedJob = {
  jobId: string;
  videoKey: string;
  fileName: string;
  fileSize: number;
  lastModified: number;
  caption: string;
  uploadStatus: "uploading" | "failed" | "completed";
};

type Stage =
  | "idle"
  | "uploading"
  | "upload-failed"
  | "publishing"
  | "publish-failed"
  | "unknown"
  | "success";

const STORAGE_KEY = "chakravyuh-publishing-checkpoint";

function clearBrowserStorage() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (
        key &&
        (key.startsWith("tus::") ||
          key.includes("tus") ||
          key.includes("chakravyuh") ||
          key.includes("upload") ||
          key.includes("supabase"))
      ) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
    sessionStorage.clear();

    if (typeof document !== "undefined" && document.cookie) {
      document.cookie.split(";").forEach((c) => {
        const eqPos = c.indexOf("=");
        const name = eqPos > -1 ? c.substring(0, eqPos).trim() : c.trim();
        if (name) {
          document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
        }
      });
    }
  } catch (error) {
    console.warn("Storage cleanup error:", error);
  }
}

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<Stage>("idle");
  const [message, setMessage] = useState("");
  const [videoKey, setVideoKey] = useState("");
  const [jobId, setJobId] = useState("");
  const [publishedId, setPublishedId] = useState("");

  const busy = stage === "uploading" || stage === "publishing";
  const polling = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const saved = JSON.parse(raw) as SavedJob;

      setJobId(saved.jobId);
      setCaption(saved.caption ?? "");

      if (saved.uploadStatus === "completed") {
        setVideoKey(saved.videoKey);
        setStage("publish-failed");
        setMessage(
          "Previous upload found. Select the same file to resume publishing, or use Retry Instagram."
        );
      } else {
        setStage("upload-failed");
        setMessage(
          "An unfinished upload was found. Select the same file and retry."
        );
      }
    } catch {
      clearBrowserStorage();
    }
  }, []);

  function saveJob(job: SavedJob) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(job));
    setJobId(job.jobId);
  }

  function updateCaption(value: string) {
    setCaption(value);

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const saved = JSON.parse(raw) as SavedJob;
      saved.caption = value;
      saveJob(saved);
    } catch {
      // The next upload will save a fresh checkpoint.
    }
  }

  async function callPublishApi(
    action: "start" | "check" | "retry",
    saved: SavedJob
  ) {
    const response = await fetch("/api/publish/instagram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        jobId: saved.jobId,
        videoKey: saved.videoKey,
        caption: saved.caption,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        result.message || result.error || "Instagram request failed."
      );
    }

    return result;
  }

  async function publishOrResume(saved: SavedJob) {
    if (polling.current) return;
    polling.current = true;

    setStage("publishing");
    setMessage("Connecting to Instagram...");

    try {
      // Start or resume the saved Instagram container.
      let result = await callPublishApi("start", saved);

      for (let attempt = 0; attempt < 40; attempt++) {
        if (result.status === "published" && result.success) {
          clearBrowserStorage();
          setStage("success");
          setPublishedId(result.publishedId ?? "");
          setMessage("Your Instagram Reel is published!");
          return;
        }

        if (result.status === "unknown") {
          setStage("unknown");
          setMessage(
            result.message ||
              "Publication is uncertain. Verify Instagram before retrying."
          );
          return;
        }

        if (result.status === "failed") {
          setStage("publish-failed");
          setMessage(result.message || "Instagram processing failed.");
          return;
        }

        if (result.pending || result.status === "processing") {
          setMessage(
            `Instagram is processing your video. Check ${attempt + 1}/40...`
          );

          await new Promise((resolve) => setTimeout(resolve, 5000));
          result = await callPublishApi("check", saved);

          if (result.status === "published" && result.success) {
            clearBrowserStorage();
            setStage("success");
            setPublishedId(result.publishedId ?? "");
            setMessage("Your Instagram Reel is published!");
            return;
          }

          if (result.status === "failed") {
            setStage("publish-failed");
            setMessage(result.message || "Instagram processing failed.");
            return;
          }

          if (result.status === "unknown") {
            setStage("unknown");
            setMessage(result.message || "Publication status is uncertain.");
            return;
          }

          if (result.status === "processing") {
            // Ask the API to publish once the existing container is ready.
            const checkResult = await callPublishApi("retry", saved);

            if (checkResult.success && checkResult.status === "published") {
              clearBrowserStorage();
              setStage("success");
              setPublishedId(checkResult.publishedId ?? "");
              setMessage("Your Instagram Reel is published!");
              return;
            }

            if (checkResult.status === "unknown") {
              setStage("unknown");
              setMessage(checkResult.message || "Publication status is uncertain.");
              return;
            }

            result = checkResult;
          }
        } else {
          setStage("publish-failed");
          setMessage(result.message || "Unexpected publishing response.");
          return;
        }
      }

      setStage("publish-failed");
      setMessage(
        "Instagram is taking longer than expected. Retry publishing to resume the saved job."
      );
    } catch (error) {
      setStage("publish-failed");
      setMessage(
        error instanceof Error ? error.message : "Publishing failed."
      );
    } finally {
      polling.current = false;
    }
  }

  async function uploadVideo() {
    if (!file || busy) return;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !key) {
      setStage("upload-failed");
      setMessage("Supabase environment variables are missing.");
      return;
    }

    let saved: SavedJob | null = null;

    try {
      const raw = localStorage.getItem(STORAGE_KEY);

      if (raw) {
        const previous = JSON.parse(raw) as SavedJob;

        if (
          previous.fileName === file.name &&
          previous.fileSize === file.size &&
          previous.lastModified === file.lastModified
        ) {
          saved = previous;
        }
      }
    } catch {
      // Start a new job if the checkpoint cannot be read.
    }

    if (saved?.uploadStatus === "completed" && stage === "publish-failed") {
      setVideoKey(saved.videoKey);
      await publishOrResume({
        ...saved,
        caption,
      });
      return;
    }

    // For any fresh upload, generate a new job and video key to prevent collisions.
    const current: SavedJob = {
      jobId: crypto.randomUUID(),
      videoKey: `demo/${crypto.randomUUID()}-${file.name}`,
      fileName: file.name,
      fileSize: file.size,
      lastModified: file.lastModified,
      caption,
      uploadStatus: "uploading",
    };

    saveJob(current);

    setStage("uploading");
    setMessage("Uploading video to Supabase...");
    setProgress(0);
    setVideoKey("");
    setPublishedId("");

    try {
      const upload = new tus.Upload(file, {
        endpoint: `${url}/storage/v1/upload/resumable`,
        retryDelays: [0, 3000, 5000, 10000],
        chunkSize: 6 * 1024 * 1024,
        removeFingerprintOnSuccess: true,
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
        metadata: {
          bucketName: "videos",
          objectName: current.videoKey,
          contentType: file.type || "video/mp4",
          cacheControl: "3600",
        },
        onProgress(uploaded, total) {
          setProgress(Math.round((uploaded / total) * 100));
        },
        onError(error) {
          current.uploadStatus = "failed";
          saveJob(current);
          setStage("upload-failed");
          setMessage(`Supabase upload failed: ${error.message}`);
        },
        onSuccess() {
          current.uploadStatus = "completed";
          saveJob(current);
          setVideoKey(current.videoKey);

          void publishOrResume(current);
        },
      });

      const previous = await upload.findPreviousUploads();

      if (previous.length > 0) {
        upload.resumeFromPreviousUpload(previous[0]);
      }

      upload.start();
    } catch (error) {
      current.uploadStatus = "failed";
      saveJob(current);
      setStage("upload-failed");
      setMessage(
        error instanceof Error ? error.message : "Upload failed."
      );
    }
  }

  function retryInstagram() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) throw new Error("No saved publishing job was found.");

      const saved = JSON.parse(raw) as SavedJob;

      if (saved.uploadStatus !== "completed") {
        throw new Error("The Supabase upload is not complete.");
      }

      void publishOrResume({
        ...saved,
        caption,
      });
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not resume publishing."
      );
    }
  }

  function newJob() {
    clearBrowserStorage();
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setFile(null);
    setCaption("");
    setProgress(0);
    setStage("idle");
    setMessage("");
    setVideoKey("");
    setJobId("");
    setPublishedId("");
  }

  return (
    <div className="min-h-screen bg-[#0c061d] text-zinc-100 flex flex-col font-sans selection:bg-purple-600/40 selection:text-white relative overflow-x-hidden">
      {/* Hostinger-exact Atmospheric Purple Gradient Background */}
      <div className="absolute top-0 left-0 right-0 h-[600px] hostinger-hero-gradient pointer-events-none -z-10" />

      {/* Top Navigation Bar (Hostinger Style) */}
      <header className="w-full bg-[#13082e]/60 backdrop-blur-md border-b border-violet-400/10 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 sm:h-20 flex items-center justify-between">
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
                  PUBLISHER
                </span>
              </div>
            </a>

            <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-violet-100/80">
              <a href="/" className="hover:text-white transition-colors">
                Studio
              </a>
              <a href="/#how-it-works" className="hover:text-white transition-colors">
                How It Works
              </a>
              <a href="/upload" className="text-white hover:text-violet-200 transition-colors">
                Publisher
              </a>
            </nav>
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-violet-200/90 px-3 py-1.5 rounded-full bg-violet-950/40 border border-violet-400/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>TUS Resumable v4.3</span>
            </div>

            <a
              href="/"
              className="text-xs font-medium px-4 py-1.5 rounded-full bg-white text-zinc-950 hover:bg-zinc-100 font-semibold shadow-md transition-all active:scale-95"
            >
              Back to Studio
            </a>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-zinc-500 uppercase tracking-wider mb-1">
            <span>Stage 01</span>
            <span>·</span>
            <span>Asset Ingest & Distribution</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
            Direct Instagram Reel Publisher
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Upload pre-rendered reels via chunked resumable TUS to Supabase, then trigger automated Instagram Graph API publishing.
          </p>
        </div>

        {/* Publisher Workstation Card */}
        <div className="rounded-3xl bg-white/95 backdrop-blur-2xl border border-white p-6 sm:p-7 shadow-[0_24px_50px_-12px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.4)] text-zinc-900 flex flex-col gap-5">
          {/* File Ingest */}
          <div className="flex flex-col gap-2">
            <label htmlFor="video" className="text-xs font-bold text-zinc-700 flex items-center justify-between">
              <span>Source Video Reel</span>
              {file && (
                <span className="text-[11px] font-mono text-violet-600 font-semibold">
                  {(file.size / (1024 * 1024)).toFixed(1)} MB
                </span>
              )}
            </label>

            <input
              ref={fileInputRef}
              id="video"
              type="file"
              accept="video/*"
              disabled={busy}
              className="hidden"
              onChange={(event) => {
                const selected = event.target.files?.[0] ?? null;
                setFile(selected);
                if (stage === "success" || stage === "unknown") {
                  clearBrowserStorage();
                  setStage("idle");
                  setMessage("");
                  setProgress(0);
                  setVideoKey("");
                  setJobId("");
                  setPublishedId("");
                }
              }}
            />

            {!file ? (
              <label
                htmlFor="video"
                className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all flex flex-col items-center justify-center gap-2.5 ${
                  busy
                    ? "border-zinc-200 bg-zinc-50 opacity-50 cursor-not-allowed"
                    : "border-zinc-300 hover:border-violet-500 hover:bg-violet-50/40 bg-zinc-50/70 cursor-pointer"
                }`}
              >
                <div className="w-12 h-12 rounded-2xl bg-violet-100 border border-violet-200 flex items-center justify-center text-violet-600">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <div>
                  <span className="text-sm font-bold text-zinc-900">
                    Click to select vertical video reel
                  </span>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    MP4, MOV, or MKV · Up to 4GB supported
                  </p>
                </div>
              </label>
            ) : (
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 flex items-center justify-between">
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="w-10 h-10 rounded-xl bg-violet-100 border border-violet-200 text-violet-700 flex items-center justify-center shrink-0">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div className="overflow-hidden">
                    <p className="text-sm font-bold text-zinc-900 truncate">{file.name}</p>
                    <p className="text-xs text-zinc-500 font-mono font-medium">
                      {(file.size / (1024 * 1024)).toFixed(1)} MB · Ready for upload
                    </p>
                  </div>
                </div>

                {!busy && (
                  <label
                    htmlFor="video"
                    className="text-xs font-semibold text-zinc-700 hover:text-zinc-950 px-3 py-1.5 rounded-lg border border-zinc-300 hover:bg-zinc-100 cursor-pointer transition-colors shrink-0"
                  >
                    Change
                  </label>
                )}
              </div>
            )}
          </div>

          {/* Caption Input */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label htmlFor="caption" className="text-xs font-bold text-zinc-700">
                Instagram Caption &amp; Hashtags
              </label>
              <span className="text-[11px] font-mono text-zinc-500">
                {caption.length} / 2200
              </span>
            </div>
            <textarea
              id="caption"
              rows={4}
              maxLength={2200}
              value={caption}
              disabled={busy}
              onChange={(event) => updateCaption(event.target.value)}
              placeholder="Write your reel caption, topic breakdown, and relevant hashtags..."
              className="w-full bg-zinc-50 border border-zinc-200 rounded-xl p-3.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-600/15 transition-all disabled:opacity-50 resize-none font-sans font-medium"
            />
          </div>

          {/* Progress Indicator */}
          {(busy || progress > 0) && (
            <div className="flex flex-col gap-2 p-3.5 rounded-xl bg-zinc-50 border border-zinc-200">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-600 font-semibold">Supabase TUS Upload</span>
                <span className="font-mono text-zinc-900 font-bold">{progress}%</span>
              </div>
              <div className="w-full h-2 bg-zinc-200 rounded-full overflow-hidden border border-zinc-300">
                <div
                  className="h-full bg-gradient-to-r from-violet-600 to-indigo-600 transition-all duration-300 rounded-full"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Live Status Message & Alerts */}
          {stage === "publishing" && (
            <div className="flex items-center gap-3 rounded-xl bg-violet-50 border border-violet-200 p-4 text-violet-900 text-sm font-medium">
              <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-violet-600 border-t-transparent" />
              <span>{message || "Instagram is processing and encoding your video reel..."}</span>
            </div>
          )}

          {message && stage !== "publishing" && (
            <div
              role="status"
              aria-live="polite"
              className={`rounded-xl p-4 text-sm border flex items-start gap-3 break-words ${
                stage === "success"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                  : stage === "upload-failed" ||
                    stage === "publish-failed" ||
                    stage === "unknown"
                  ? "bg-rose-50 border-rose-200 text-rose-800"
                  : "bg-zinc-50 border-zinc-200 text-zinc-800"
              }`}
            >
              {stage === "success" ? (
                <svg className="w-5 h-5 shrink-0 text-emerald-600 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : stage === "upload-failed" || stage === "publish-failed" || stage === "unknown" ? (
                <svg className="w-5 h-5 shrink-0 text-rose-600 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              ) : (
                <svg className="w-5 h-5 shrink-0 text-zinc-600 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              <div className="flex-1">
                <p className="font-semibold">{message}</p>
              </div>
            </div>
          )}

          {/* Published ID Callout */}
          {publishedId && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-xs font-mono text-emerald-800 flex items-center justify-between font-bold">
              <span>Instagram Media ID:</span>
              <span className="font-bold text-emerald-900">{publishedId}</span>
            </div>
          )}

          {/* Primary Action Button */}
          <button
            onClick={uploadVideo}
            disabled={!file || busy || stage === "success" || stage === "unknown"}
            className="w-full py-3.5 px-6 rounded-xl font-bold text-sm bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 active:bg-violet-700 text-white shadow-xl shadow-violet-600/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
          >
            {stage === "uploading" ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                <span>Uploading to Supabase ({progress}%)...</span>
              </>
            ) : stage === "publishing" ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                <span>Publishing to Instagram...</span>
              </>
            ) : stage === "upload-failed" ? (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Retry Supabase Upload</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
                </svg>
                <span>Upload and Publish to Instagram</span>
              </>
            )}
          </button>

          {/* Recovery Buttons */}
          {stage === "publish-failed" && videoKey && (
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                onClick={retryInstagram}
                className="flex-1 rounded-xl bg-amber-600 hover:bg-amber-500 px-4 py-2.5 text-sm font-medium text-white transition-colors"
              >
                Retry Instagram Publishing
              </button>
              <button
                onClick={newJob}
                className="flex-1 rounded-xl border border-zinc-800 hover:bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors"
              >
                Discard & Start Fresh
              </button>
            </div>
          )}

          {stage === "upload-failed" && (
            <button
              onClick={newJob}
              className="rounded-xl border border-zinc-800 hover:bg-zinc-800 px-4 py-2.5 text-xs font-medium text-zinc-400 hover:text-white transition-colors w-fit"
            >
              Discard & Start Fresh
            </button>
          )}

          {(stage === "success" || stage === "unknown") && (
            <button
              onClick={newJob}
              className="w-full rounded-xl bg-violet-600 hover:bg-violet-500 px-5 py-3 text-sm font-medium text-white transition-colors"
            >
              Upload Another Video Reel
            </button>
          )}

          {/* Supabase Object & Job Metadata */}
          {videoKey && (
            <div className="rounded-xl bg-zinc-950/80 border border-zinc-800/60 p-4 font-mono text-xs text-zinc-400 space-y-2 break-all">
              <div>
                <span className="text-zinc-500 block text-[10px] uppercase font-semibold">Supabase Object Path</span>
                <span className="text-zinc-300 select-all">{videoKey}</span>
              </div>
              <div className="pt-2 border-t border-zinc-900">
                <span className="text-zinc-500 block text-[10px] uppercase font-semibold">Publishing Job ID</span>
                <span className="text-zinc-300 select-all">{jobId}</span>
              </div>
            </div>
          )}
        </div>
      </main>

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
            <a href="/" className="hover:text-white transition-colors">Studio</a>
            <a href="/#how-it-works" className="hover:text-white transition-colors">How It Works</a>
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
