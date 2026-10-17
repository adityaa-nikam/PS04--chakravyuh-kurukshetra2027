import type { ActionEvidence } from "./action-catalog";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { outputPaths, reserveOutput, publishOutput } from "./output-path";
import { prepareRender, type RenderOptions, type RenderPlan } from "./render-plan";

import net from "node:net";

function getFreePort(startPort = 3050): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", () => {
      const fallback = net.createServer();
      fallback.unref();
      fallback.on("error", reject);
      fallback.listen(0, "127.0.0.1", () => {
        const { port } = fallback.address() as net.AddressInfo;
        fallback.close(() => resolve(port));
      });
    });
    server.listen(startPort, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

export type VideoEncoder = (plan: RenderPlan, temporaryVideo: string, workDirectory: string, browser: string) => Promise<void>;
const encodeRemotion: VideoEncoder = async (plan, output, directory, browser) => {
  if (!existsSync(browser)) throw new Error("Browser not found; set REMOTION_BROWSER_EXECUTABLE or --browser to an installed Chrome binary. Nothing is downloaded.");
  const [{ bundle }, { selectComposition, renderMedia }] = await Promise.all([import("@remotion/bundler"), import("@remotion/renderer")]);
  const entryPoint = existsSync(path.resolve("app/api/video_gen/remotion/index.tsx"))
    ? path.resolve("app/api/video_gen/remotion/index.tsx")
    : path.resolve("next-app/app/api/video_gen/remotion/index.tsx");
  const serveUrl = await bundle({ entryPoint, outDir: path.join(directory, "bundle"), webpackOverride: config => ({ ...config, cache: false }) });
  const inputProps = { plan };
  const remotionPort = process.env.REMOTION_PORT ? Number(process.env.REMOTION_PORT) : await getFreePort(3050);
  const composition = await selectComposition({ serveUrl, id: "Explainer", inputProps, browserExecutable: browser, chromeMode: "chrome-for-testing", port: remotionPort });
  await renderMedia({ composition, serveUrl, inputProps, browserExecutable: browser, chromeMode: "chrome-for-testing", codec: "h264", pixelFormat: "yuv420p", outputLocation: output, concurrency: 1, muted: true, port: remotionPort });
};

import { generateNarrationAudio, muxAudioWithVideo } from "./audio-service";

export async function renderStoryboard(input: unknown, options: RenderOptions = {}, specifications: unknown = {}, requestedOutput?: string,
  provenance: Record<string, unknown> = {}, encoder: VideoEncoder = encodeRemotion, browser = process.env.REMOTION_BROWSER_EXECUTABLE || (process.platform === "win32" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : "/usr/bin/google-chrome"), context?: ActionEvidence) {
  const plan = prepareRender(input, options, specifications, context); // Guard before any output work.
  const paths = outputPaths(plan.storyboard.title, requestedOutput);
  const release = reserveOutput(paths);
  let directory: string | undefined;
  const started = Date.now();
  try {
    directory = mkdtempSync(path.join(tmpdir(), "explainer-render-"));
    const temporaryVideo = path.join(directory, "final.mp4");
    await encoder(plan, temporaryVideo, directory, browser);

    // Synthesize audio description / narration and mux into final video
    let videoToPublish = temporaryVideo;
    const narrationText = plan.storyboard.scenes
      .map(s => s.narration)
      .filter(Boolean)
      .join(" ");

    if (narrationText) {
      try {
        const narrationAudio = path.join(directory, "narration.mp3");
        await generateNarrationAudio(narrationText, narrationAudio);
        const narratedVideo = path.join(directory, "final_narrated.mp4");
        await muxAudioWithVideo(temporaryVideo, narrationAudio, narratedVideo);
        if (existsSync(narratedVideo)) {
          videoToPublish = narratedVideo;
        }
      } catch (audioErr) {
        console.warn("[render-service] Audio description synthesis skipped or failed, using silent video:", audioErr);
      }
    }

    const elapsedSeconds = (Date.now() - started) / 1000;
    publishOutput(paths, videoToPublish, { originalStoryboard: input, ...plan, elapsedSeconds, output: paths.video, provenance });
    return { output: paths.video, metadata: paths.metadata, elapsedSeconds, frames: plan.durationInFrames, durationSeconds: plan.durationInFrames / plan.settings.fps, width: plan.settings.width, height: plan.settings.height, fps: plan.settings.fps, warnings: plan.storyboard.warnings, scenes: plan.frames };
  } catch (error) {
    throw new Error(`RENDER_FAILED: ${error instanceof Error ? error.message : "Unknown error"}. Final output was not published. Check the browser/layout and retry.`, { cause: error });
  } finally {
    try { if (directory) rmSync(directory, { recursive: true, force: true }); }
    finally { release(); }
  }
}
