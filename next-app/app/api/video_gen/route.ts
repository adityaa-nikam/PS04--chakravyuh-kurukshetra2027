import { existsSync, mkdirSync, copyFileSync, statSync, createReadStream, readdirSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { generateExplainerScript, ScriptGenerationError } from "./script-generator";
import { explain } from "./explain-pipeline";

interface VideoGenRequestPayload {
  topic?: string;
  prompt?: string;
  targetAudience?: string;
  audience?: string;
  durationSeconds?: number;
  duration?: number;
  render?: boolean;
  mode?: "script" | "video";
  visualActions?: boolean;
  approveOverrun?: boolean;
  output?: string;
  resume?: string;
}

function resolveAppRoot(): string {
  const cwd = process.cwd();
  if (existsSync(path.join(cwd, "package.json")) && !existsSync(path.join(cwd, "next-app"))) {
    return cwd;
  }
  return path.join(cwd, "next-app");
}

export async function POST(request: Request) {
  const reader = request.body?.getReader();
  let body = "";
  if (reader) {
    const decoder = new TextDecoder();
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 16384) {
          await reader.cancel();
          return Response.json({ error: { code: "BODY_TOO_LARGE", message: "Request body must not exceed 16 KB." } }, { status: 413 });
        }
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
    } catch {
      return Response.json({ error: { code: "INVALID_BODY", message: "Could not read the request body." } }, { status: 400 });
    } finally {
      reader.releaseLock();
    }
  }

  let input: VideoGenRequestPayload;
  try {
    input = JSON.parse(body);
  } catch {
    return Response.json({ error: { code: "INVALID_JSON", message: "Send a valid JSON request body." } }, { status: 400 });
  }

  const topic = input.topic || input.prompt;
  if (!topic || typeof topic !== "string" || !topic.trim()) {
    return Response.json({ error: { code: "INVALID_INPUT", message: "Provide a 'topic' or 'prompt' string." } }, { status: 400 });
  }

  const targetAudience = input.targetAudience || input.audience || "Beginners";
  let durationSeconds = input.durationSeconds ?? input.duration ?? 45;

  // Extract explicit duration requirement if the user stated one in their prompt command
  // e.g. "video should be of 30 to 40 seconds", "video of 30 to 40 sec", "duration: 35s", "30-40 sec video"
  const promptDurationMatch =
    topic.match(/(?:video\s+(?:(?:should|shoud|must|needs to)\s+be\s+)?(?:of\s+)?|duration\s*(?:of|:)?\s*|generate\s+video\s+of\s*)(\d+)(?:\s*(?:to|-)\s*(\d+))?\s*(?:s|sec|seconds?)?/i) ||
    topic.match(/(\d+)(?:\s*(?:to|-)\s*(\d+))?\s*(?:s|sec|seconds?)\s*(?:video|reel|clip)?/i);
  if (promptDurationMatch) {
    const minVal = parseInt(promptDurationMatch[1], 10);
    const maxVal = promptDurationMatch[2] ? parseInt(promptDurationMatch[2], 10) : minVal;
    if (!isNaN(minVal) && minVal >= 15 && minVal <= 120) {
      durationSeconds = Math.round((minVal + maxVal) / 2);
      console.info(`[video_gen] Honoring prompt duration request: ${durationSeconds}s (from "${promptDurationMatch[0]}")`);
    }
  }

  const shouldRender = input.render !== false && input.mode !== "script";

  // Mode 1: Script only
  if (!shouldRender) {
    try {
      const script = await generateExplainerScript({ topic, targetAudience, durationSeconds }, { live: true });
      return Response.json(script, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof ScriptGenerationError) {
        return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
      }
      return Response.json({ error: { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : "Script generation failed unexpectedly." } }, { status: 500 });
    }
  }

  // Mode 2: Full Video Generation & Remotion Render
  try {
    const appRoot = resolveAppRoot();
    const slug = topic.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "explainer";
    const timestamp = Date.now();
    const folderName = `${slug}-${timestamp}`;
    const outputVideoPath = input.output
      ? path.resolve(input.output)
      : path.join(appRoot, "artifacts", "videos", folderName, "final.mp4");

    console.info(`[video_gen] starting full pipeline for "${topic}" -> ${outputVideoPath}`);

    const result = await explain({
      prompt: input.resume ? undefined : topic,
      audience: input.resume ? undefined : targetAudience,
      duration: input.resume ? undefined : durationSeconds,
      output: outputVideoPath,
      visualActions: input.visualActions ?? true,
      approveOverrun: input.approveOverrun ?? true,
      resume: input.resume,
    });

    // Make video accessible via /videos/<folderName>/final.mp4
    let publicUrl = `/api/video_gen?video=${encodeURIComponent(result.output)}`;
    try {
      const publicDir = path.join(appRoot, "public", "videos", folderName);
      mkdirSync(publicDir, { recursive: true });
      const publicVideo = path.join(publicDir, "final.mp4");
      copyFileSync(result.output, publicVideo);
      const diagSource = path.join(path.dirname(result.output), "narration-diagnostic.json");
      if (existsSync(diagSource)) {
        copyFileSync(diagSource, path.join(publicDir, "narration-diagnostic.json"));
      }
      publicUrl = `/videos/${folderName}/final.mp4`;
    } catch (copyErr) {
      console.warn("[video_gen] Warning: could not copy to public/ directory:", copyErr);
    }

    const renderResult = result as Record<string, any>;
    return Response.json({
      success: true,
      message: "Video generated successfully",
      topic,
      targetAudience,
      videoUrl: publicUrl,
      videoPath: renderResult.output,
      metadataPath: renderResult.metadata,
      durationSeconds: renderResult.durationSeconds,
      elapsedSeconds: renderResult.elapsedSeconds,
      frames: renderResult.frames,
      width: renderResult.width,
      height: renderResult.height,
      fps: renderResult.fps,
      scenes: renderResult.scenes,
    }, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    console.error("[video_gen] Pipeline render failed:", error);
    if (error instanceof ScriptGenerationError) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    }
    return Response.json({
      error: {
        code: "PIPELINE_ERROR",
        message: error instanceof Error ? error.message : "Video generation failed unexpectedly."
      }
    }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const videoParam = searchParams.get("video") || searchParams.get("path");

  let filePath: string | null = null;

  if (videoParam) {
    const candidate = path.resolve(videoParam);
    if (existsSync(candidate) && candidate.endsWith(".mp4")) {
      filePath = candidate;
    }
  } else if (searchParams.get("latest") === "true") {
    const appRoot = resolveAppRoot();
    const baseDir = path.join(appRoot, "artifacts", "videos");
    if (existsSync(baseDir)) {
      const subdirs = readdirSync(baseDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => path.join(baseDir, d.name, "final.mp4"))
        .filter(f => existsSync(f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
      if (subdirs.length > 0) filePath = subdirs[0];
    }
  }

  if (filePath && existsSync(filePath)) {
    const stat = statSync(filePath);
    const nodeStream = createReadStream(filePath);
    // Convert Node ReadStream to Web ReadableStream
    const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

    return new Response(webStream, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": stat.size.toString(),
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  return Response.json({
    status: "ok",
    service: "video_gen",
    capabilities: ["script_generation", "remotion_rendering", "visual_actions"],
    usage: {
      post: "Send POST with { topic, targetAudience?, durationSeconds?, render?: true } to generate a full video.",
      getLatest: "GET /api/video_gen?latest=true to stream the latest rendered video",
      getVideo: "GET /api/video_gen?video=<path> to stream a specific video",
    }
  });
}
