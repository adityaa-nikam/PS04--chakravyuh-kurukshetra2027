
"use client";

import { useState } from "react";
import * as tus from "tus-js-client";

type PublishStatus =
  | "idle"
  | "uploading"
  | "publishing"
  | "success"
  | "error";

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<PublishStatus>("idle");
  const [message, setMessage] = useState("");
  const [videoKey, setVideoKey] = useState("");
  const [publishedId, setPublishedId] = useState("");

  const busy = status === "uploading" || status === "publishing";

  async function publishToInstagram(objectName: string) {
    setStatus("publishing");
    setMessage("Video uploaded. Publishing your Instagram Reel...");
    setVideoKey(objectName);

    try {
      const response = await fetch("/api/publish/instagram", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          videoKey: objectName,
          caption,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ||
            result.message ||
            "Instagram publishing failed."
        );
      }

      setPublishedId(result.publishedId ?? "");
      setStatus("success");
      setMessage("Your Instagram Reel was published successfully!");
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "An unexpected publishing error occurred."
      );
    }
  }

  async function uploadVideo() {
    if (!file || busy) return;

    setStatus("uploading");
    setMessage("Uploading video to Supabase...");
    setProgress(0);
    setVideoKey("");
    setPublishedId("");

    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      if (!url || !key) {
        throw new Error("Supabase environment variables are missing.");
      }

      const objectName = `demo/${crypto.randomUUID()}-${file.name}`;

      const upload = new tus.Upload(file, {
        endpoint: `${url}/storage/v1/upload/resumable`,
        retryDelays: [0, 3000, 5000, 10000],
        chunkSize: 6 * 1024 * 1024,
        headers: {
          apikey: key,
        },
        metadata: {
          bucketName: "videos",
          objectName,
          contentType: file.type || "video/mp4",
          cacheControl: "3600",
        },
        onError(error) {
          setStatus("error");
          setMessage(`Upload failed: ${error.message}`);
        },
        onProgress(bytesUploaded, bytesTotal) {
          setProgress(
            Math.round((bytesUploaded / bytesTotal) * 100)
          );
        },
        onSuccess() {
          // Only publish after TUS confirms upload completion.
          void publishToInstagram(objectName);
        },
      });

      upload.start();
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof Error ? error.message : "Upload failed."
      );
    }
  }

  return (
    <main className="mx-auto max-w-xl space-y-5 p-8">
      <h1 className="text-2xl font-bold">
        Publish Instagram Reel
      </h1>

      <div className="space-y-2">
        <label htmlFor="video" className="block font-medium">
          Select video
        </label>
        <input
          id="video"
          type="file"
          accept="video/*"
          disabled={busy}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setStatus("idle");
            setMessage("");
            setProgress(0);
            setVideoKey("");
            setPublishedId("");
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
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          disabled={busy}
          placeholder="Write your Reel caption..."
          maxLength={2200}
          rows={4}
          className="w-full rounded-lg border p-3 text-black"
        />
      </div>

      <button
        onClick={uploadVideo}
        disabled={!file || busy}
        className="rounded-lg bg-blue-600 px-5 py-2 text-white disabled:opacity-50"
      >
        {status === "uploading"
          ? "Uploading..."
          : status === "publishing"
            ? "Publishing..."
            : "Upload and publish Reel"}
      </button>

      {(busy || progress > 0) && (
        <div className="space-y-2">
          <progress
            value={progress}
            max={100}
            className="w-full"
          />
          <p className="text-sm">Upload progress: {progress}%</p>
        </div>
      )}

      {message && (
        <div
          role="status"
          aria-live="polite"
          className={`rounded-lg p-3 ${
            status === "success"
              ? "bg-green-100 text-green-800"
              : status === "error"
                ? "bg-red-100 text-red-800"
                : "bg-blue-50 text-blue-800"
          }`}
        >
          {message}
          {publishedId && (
            <p className="mt-1 break-all text-sm">
              Published media ID: {publishedId}
            </p>
          )}
        </div>
      )}

      {videoKey && (
        <div className="break-all rounded bg-gray-100 p-3 text-sm text-black">
          <strong>Supabase storage path:</strong>
          <p>{videoKey}</p>
        </div>
      )}
    </main>
  );
}
