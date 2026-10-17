import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { PipelineClient } from "@/lib/pipeline/client";

/**
 * GET /api/ai/video
 * Streams a rendered MP4 video from local storage with full HTTP 206 Range support.
 * Allows the browser <video> player to preview, seek, and stream the generated reel.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("jobId");
    let targetPath = searchParams.get("path");
    const filename = searchParams.get("filename");

    // 1. Resolve path from jobId if provided
    if (!targetPath && jobId) {
      const job = await PipelineClient.getJobStatus(jobId);
      if (job?.rendered_video_path) {
        targetPath = job.rendered_video_path;
      }
    }

    // 2. Resolve from filename in storage/rendered
    if (!targetPath && filename) {
      const workspaceRoot = path.resolve(process.cwd(), "..");
      targetPath = path.join(workspaceRoot, "storage", "rendered", filename);
    }

    if (!targetPath) {
      return NextResponse.json(
        { error: "Missing video source. Provide 'jobId', 'path', or 'filename'." },
        { status: 400 }
      );
    }

    // Normalize path
    let resolvedPath = path.resolve(targetPath);

    // If relative to next-app, check parent workspace storage
    if (!fs.existsSync(resolvedPath)) {
      const altWorkspace = path.resolve(process.cwd(), "..", "storage", "rendered", path.basename(targetPath));
      if (fs.existsSync(altWorkspace)) {
        resolvedPath = altWorkspace;
      } else {
        return NextResponse.json(
          { error: `Rendered video file not found on disk at: ${resolvedPath}` },
          { status: 404 }
        );
      }
    }

    const stat = fs.statSync(resolvedPath);
    const fileSize = stat.size;
    const isDownload = searchParams.get("download") === "true";
    const downloadName = searchParams.get("downloadName") || path.basename(resolvedPath);
    const rangeHeader = req.headers.get("range");

    if (rangeHeader && !isDownload) {
      const parts = rangeHeader.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${fileSize}` },
        });
      }

      const chunkSize = end - start + 1;
      const fileStream = fs.createReadStream(resolvedPath, { start, end });

      // Convert Node readable stream to Web ReadableStream
      const webStream = new ReadableStream({
        start(controller) {
          fileStream.on("data", (chunk) => controller.enqueue(chunk));
          fileStream.on("end", () => controller.close());
          fileStream.on("error", (err) => controller.error(err));
        },
      });

      return new NextResponse(webStream, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunkSize.toString(),
          "Content-Type": "video/mp4",
          "Cache-Control": "no-cache",
        },
      });
    }

    // Full file stream (or download)
    const fileStream = fs.createReadStream(resolvedPath);
    const webStream = new ReadableStream({
      start(controller) {
        fileStream.on("data", (chunk) => controller.enqueue(chunk));
        fileStream.on("end", () => controller.close());
        fileStream.on("error", (err) => controller.error(err));
      },
    });

    const responseHeaders: Record<string, string> = {
      "Content-Length": fileSize.toString(),
      "Content-Type": "video/mp4",
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache",
    };

    if (isDownload) {
      responseHeaders["Content-Disposition"] = `attachment; filename="${downloadName}"`;
    }

    return new NextResponse(webStream, {
      status: 200,
      headers: responseHeaders,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Error serving video";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function HEAD(req: NextRequest) {
  return GET(req);
}
