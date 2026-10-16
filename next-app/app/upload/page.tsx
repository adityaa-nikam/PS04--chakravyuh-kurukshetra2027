
"use client";

import { useState } from "react";
import * as tus from "tus-js-client";

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [videoKey, setVideoKey] = useState("");

  async function uploadVideo() {
    if (!file) return;

    setStatus("Uploading...");
    setProgress(0);
    setVideoKey("");

    try {
      // Add Supabase Auth before using this in production.
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

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
          setStatus(`Upload failed: ${error.message}`);
        },
        onProgress(bytesUploaded, bytesTotal) {
          setProgress(
            Math.round((bytesUploaded / bytesTotal) * 100)
          );
        },
        onSuccess() {
          setVideoKey(objectName);
          setStatus("Upload complete!");
        },
      });

      // Resume an unfinished upload when a matching upload exists.
      const previousUploads = await upload.findPreviousUploads();

      if (previousUploads.length > 0) {
        upload.resumeFromPreviousUpload(previousUploads[0]);
      }

      upload.start();
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Upload failed"
      );
    }
  }

  return (
    <main className="mx-auto max-w-xl space-y-5 p-8">
      <h1 className="text-2xl font-bold">Video Upload</h1>

      <input
        type="file"
        accept="video/*"
        onChange={(event) =>
          setFile(event.target.files?.[0] ?? null)
        }
      />

      {file && (
        <p className="text-sm text-gray-500">
          {file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB
        </p>
      )}

      <button
        onClick={uploadVideo}
        disabled={!file || status === "Uploading..."}
        className="rounded-lg bg-blue-600 px-5 py-2 text-white disabled:opacity-50"
      >
        Upload video
      </button>

      <progress value={progress} max={100} className="w-full" />

      <p>{status} {progress}%</p>

      {videoKey && (
        <div className="break-all rounded bg-gray-100 p-3 text-sm text-black">
          <strong>Storage key:</strong>
          <p>{videoKey}</p>
        </div>
      )}
    </main>
  );
}
