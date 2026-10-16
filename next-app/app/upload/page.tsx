
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
        headers: { apikey: key },
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
    <main className="mx-auto max-w-xl space-y-5 p-8">
      <h1 className="text-2xl font-bold">Chakravyuh Video Publishing</h1>

      <div className="space-y-2">
        <label htmlFor="video" className="block font-medium">
          Video
        </label>
        <input
          ref={fileInputRef}
          id="video"
          type="file"
          accept="video/*"
          disabled={busy}
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
      </div>

      {file && (
        <p className="text-sm text-gray-500">
          {file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB
        </p>
      )}

      <div className="space-y-2">
        <label htmlFor="caption" className="block font-medium">
          Instagram caption
        </label>
        <textarea
          id="caption"
          rows={4}
          maxLength={2200}
          value={caption}
          disabled={busy}
          onChange={(event) => updateCaption(event.target.value)}
          placeholder="Write your caption..."
          className="w-full rounded-lg border p-3 text-black"
        />
      </div>

      <button
        onClick={uploadVideo}
        disabled={!file || busy || stage === "success" || stage === "unknown"}
        className="rounded-lg bg-blue-600 px-5 py-2 text-white disabled:opacity-50"
      >
        {stage === "uploading"
          ? "Uploading..."
          : stage === "publishing"
            ? "Publishing..."
            : stage === "upload-failed"
              ? "Retry Supabase upload"
              : "Upload and publish"}
      </button>

      {(busy || progress > 0) && (
        <div className="space-y-2">
          <progress value={progress} max={100} className="w-full" />
          <p className="text-sm">Supabase upload: {progress}%</p>
        </div>
      )}

      {stage === "publishing" && (
        <div className="flex items-center gap-3 rounded-lg bg-blue-50 p-3 text-blue-800">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          <span>{message || "Instagram is processing your video..."}</span>
        </div>
      )}

      {message && stage !== "publishing" && (
        <p
          role="status"
          aria-live="polite"
          className={`break-words rounded-lg p-3 ${
            stage === "success"
              ? "bg-green-100 text-green-800"
              : stage === "upload-failed" ||
                  stage === "publish-failed" ||
                  stage === "unknown"
                ? "bg-red-100 text-red-800"
                : "bg-blue-50 text-blue-800"
          }`}
        >
          {message}
        </p>
      )}

      {stage === "publish-failed" && videoKey && (
        <div className="flex gap-3">
          <button
            onClick={retryInstagram}
            className="rounded-lg bg-orange-600 px-5 py-2 text-white"
          >
            Retry Instagram publishing
          </button>
          <button
            onClick={newJob}
            className="rounded-lg border border-gray-300 px-5 py-2 text-gray-700 hover:bg-gray-50"
          >
            Discard & start fresh
          </button>
        </div>
      )}

      {stage === "upload-failed" && (
        <button
          onClick={newJob}
          className="rounded-lg border border-gray-300 px-5 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          Discard & start fresh
        </button>
      )}

      {videoKey && (
        <div className="break-all rounded bg-gray-100 p-3 text-sm text-black">
          <strong>Supabase object path:</strong>
          <p>{videoKey}</p>
          <strong>Publishing job ID:</strong>
          <p>{jobId}</p>
        </div>
      )}

      {publishedId && (
        <p className="break-all rounded-lg bg-green-50 p-3 text-sm text-green-900">
          Published Instagram media ID: {publishedId}
        </p>
      )}

      {(stage === "success" || stage === "unknown") && (
        <button
          onClick={newJob}
          className="rounded-lg bg-blue-600 px-5 py-2 text-white hover:bg-blue-700"
        >
          Upload another video
        </button>
      )}
    </main>
  );
}
