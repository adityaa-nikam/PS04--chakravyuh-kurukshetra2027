import type { ActionEvidence } from "./action-catalog";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { outputPaths, reserveOutput, publishOutput } from "./output-path";
import { prepareRender, type RenderOptions, type RenderPlan } from "./render-plan";
import { prepareLocalNarration, muxLocalNarration } from "./local-narration";
import { runRenderWorker } from "./render-worker";

export type VideoEncoder = (plan: RenderPlan, temporaryVideo: string, workDirectory: string, browser: string) => Promise<void>;
const encodeRemotion: VideoEncoder = async (plan, output, directory, browser) => {
  if (!existsSync(browser)) throw new Error("Browser not found; set REMOTION_BROWSER_EXECUTABLE or --browser to an installed Chrome binary. Nothing is downloaded.");
  const entryPoint = existsSync(path.resolve("app/api/video_gen/remotion/index.tsx"))
    ? path.resolve("app/api/video_gen/remotion/index.tsx")
    : path.resolve("next-app/app/api/video_gen/remotion/index.tsx");
  const audio = await prepareLocalNarration(plan, directory);
  // Remotion encodes the visual track; FFmpeg attaches complete scene speech
  // before publishOutput can expose the final MP4.
  const visualOutput = audio ? path.join(directory, "silent.mp4") : output;
  const job = path.join(directory, "render-job.json");
  writeFileSync(job, JSON.stringify({ plan, output: visualOutput, directory, browser, entryPoint }), { mode: 0o600 });
  await runRenderWorker([job]);
  if (audio) await muxLocalNarration(plan, audio, visualOutput, output);
};

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
    const elapsedSeconds = (Date.now() - started) / 1000;
    publishOutput(paths, temporaryVideo, { originalStoryboard: input, ...plan, elapsedSeconds, output: paths.video, provenance });
    return { output: paths.video, metadata: paths.metadata, elapsedSeconds, frames: plan.durationInFrames, durationSeconds: plan.durationInFrames / plan.settings.fps, width: plan.settings.width, height: plan.settings.height, fps: plan.settings.fps, warnings: plan.storyboard.warnings, scenes: plan.frames };
  } catch (error) {
    throw new Error(`RENDER_FAILED: ${error instanceof Error ? error.message : "Unknown error"}. Final output was not published. Check the browser/layout and retry.`, { cause: error });
  } finally {
    try { if (directory) rmSync(directory, { recursive: true, force: true }); }
    finally { release(); }
  }
}
