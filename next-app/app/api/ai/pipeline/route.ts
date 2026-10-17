import { NextRequest, NextResponse } from "next/server";
import { PipelineClient } from "@/lib/pipeline/client";
import fs from "fs";
import path from "path";

/**
 * POST /api/ai/pipeline
 * Starts an end-to-end AI reel generation job.
 * Accepts either:
 *  1. JSON with { videoPath, renderVideo, subtitles, captionStyle, compositionMode }
 *  2. Multipart FormData with a file upload (saved to storage/raw/<filename>)
 */
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";

    let videoPath = "";
    let renderVideo = true;
    let subtitles = true;
    let captionStyle: "karaoke" | "minimal" | "bold" | "neon" = "karaoke";
    let compositionMode: "adaptive" | "presenter" | "screen_content" = "adaptive";
    let modelSize = "base.en";
    let jobId: string | undefined;

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      const pathParam = formData.get("videoPath") as string | null;

      if (formData.has("renderVideo")) renderVideo = formData.get("renderVideo") === "true";
      if (formData.has("subtitles")) subtitles = formData.get("subtitles") === "true";
      if (formData.has("captionStyle")) captionStyle = formData.get("captionStyle") as any;
      if (formData.has("compositionMode")) compositionMode = formData.get("compositionMode") as any;
      if (formData.has("modelSize")) modelSize = formData.get("modelSize") as string;
      if (formData.has("jobId")) jobId = formData.get("jobId") as string;

      if (file && file.size > 0) {
        // Save uploaded video file to storage/raw
        const workspaceRoot = path.resolve(process.cwd(), "..");
        const rawDir = path.join(workspaceRoot, "storage", "raw");
        if (!fs.existsSync(rawDir)) {
          fs.mkdirSync(rawDir, { recursive: true });
        }

        const safeFilename = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const targetFilePath = path.join(rawDir, safeFilename);

        const bytes = await file.arrayBuffer();
        fs.writeFileSync(targetFilePath, Buffer.from(bytes));
        videoPath = targetFilePath;
      } else if (pathParam) {
        videoPath = pathParam.trim();
      }
    } else {
      const body = await req.json();
      videoPath = body.videoPath || body.video_path || "";
      if (body.renderVideo !== undefined) renderVideo = body.renderVideo;
      if (body.subtitles !== undefined) subtitles = body.subtitles;
      if (body.captionStyle) captionStyle = body.captionStyle;
      if (body.compositionMode) compositionMode = body.compositionMode;
      if (body.modelSize) modelSize = body.modelSize;
      if (body.jobId) jobId = body.jobId;
    }

    if (!videoPath) {
      return NextResponse.json(
        { error: "videoPath or file upload is required." },
        { status: 400 }
      );
    }

    const job = await PipelineClient.startPipelineJob({
      videoPath,
      renderVideo,
      subtitles,
      captionStyle,
      compositionMode,
      modelSize,
      jobId,
    });

    return NextResponse.json(
      {
        success: true,
        jobId: job.jobId,
        status: job.status,
        message: job.message,
      },
      { status: 202 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
