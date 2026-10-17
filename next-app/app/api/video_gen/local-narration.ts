import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { RenderPlan } from "./render-plan";
import { rendererEnvironment } from "./render-worker";

// All subprocess inputs are separate arguments; narration never becomes shell code.
export function runLocalTool(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = { ...rendererEnvironment(process.env), PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" };
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", diagnostics = "";
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`LOCAL_TTS: ${path.basename(command)} timed out.`)); }, 300_000);
    child.stdout.on("data", chunk => { output = (output + chunk).slice(-16000); });
    child.stderr.on("data", chunk => { diagnostics = (diagnostics + chunk).slice(-4000); });
    child.once("error", error => { clearTimeout(timeout); reject(error); });
    child.once("close", code => { clearTimeout(timeout); if (code === 0) resolve(output); else reject(new Error(`LOCAL_TTS: ${path.basename(command)} exited ${code}: ${diagnostics}`)); });
  });
}

export function applyNarrationTiming(plan: RenderPlan, seconds: number[], voice: string) {
  if (seconds.length !== plan.frames.length || seconds.some(n => !Number.isFinite(n) || n <= 0)) throw new Error("LOCAL_TTS: invalid scene audio durations.");
  let from = 0;
  const frames = plan.frames.map((frame, i) => {
    // Keep the existing reading time; extend for a complete spoken sentence and
    // a short pause. Never speed up, truncate, or change the script.
    const durationInFrames = Math.max(frame.durationInFrames, Math.ceil((seconds[i] + 0.35) * plan.settings.fps));
    const allocation = { ...frame, from, durationInFrames }; from += durationInFrames; return allocation;
  });
  if (from > plan.durationInFrames && !plan.settings.approveOverrun) throw new Error("DURATION_APPROVAL_REQUIRED: local narration exceeds the allocated frames; retry with --approve-overrun.");
  plan.frames = frames; plan.durationInFrames = from;
  plan.narration = { engine: "piper", voice, seconds };
}

export async function prepareLocalNarration(plan: RenderPlan, directory: string): Promise<string[] | undefined> {
  const provider = process.env.VIDEO_GEN_TTS ?? "piper";
  if (provider === "off") return;
  if (provider !== "piper") throw new Error("LOCAL_TTS: VIDEO_GEN_TTS must be piper or off.");
  const app = existsSync(path.resolve("app/api/video_gen")) ? process.cwd() : path.resolve("next-app");
  const defaultPython = process.platform === "win32"
    ? (existsSync(path.join(app, ".venv-tts/Scripts/python.exe")) ? path.join(app, ".venv-tts/Scripts/python.exe") : path.join(app, ".venv-tts/bin/python"))
    : (existsSync(path.join(app, ".venv-tts/bin/python")) ? path.join(app, ".venv-tts/bin/python") : path.join(app, ".venv-tts/Scripts/python.exe"));
  const python = process.env.PIPER_PYTHON || defaultPython;
  const model = process.env.PIPER_MODEL || path.join(app, "artifacts/voices/en_US-lessac-medium.onnx");
  if (!existsSync(python) || !existsSync(model) || !existsSync(`${model}.json`)) throw new Error("LOCAL_TTS: Piper or its voice is missing. Run python3 -m venv .venv-tts, .venv-tts/bin/pip install piper-tts==1.4.2, then download en_US-lessac-medium into artifacts/voices. Set VIDEO_GEN_TTS=off only for an explicitly silent export.");
  const files = plan.storyboard.scenes.map(scene => path.join(directory, `${scene.id}.wav`));
  const manifest = path.join(directory, "speech-job.json");
  writeFileSync(manifest, JSON.stringify({ model, scenes: plan.storyboard.scenes.map((scene, i) => ({ text: scene.narration, output: files[i] })) }), { mode: 0o600 });
  await runLocalTool(python, [path.join(app, "app/api/video_gen/piper-worker.py"), manifest]);
  const seconds = [];
  for (const file of files) seconds.push(Number(await runLocalTool("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file])));
  applyNarrationTiming(plan, seconds, path.basename(model, ".onnx"));
  return files;
}

export async function muxLocalNarration(plan: RenderPlan, files: string[], video: string, output: string) {
  const args = ["-v", "error", "-n", "-i", video, ...files.flatMap(file => ["-i", file])];
  const filters = plan.frames.map((frame, i) => `[${i + 1}:a]aresample=48000,apad,atrim=duration=${frame.durationInFrames / plan.settings.fps},asetpts=PTS-STARTPTS[a${i}]`);
  filters.push(`${files.map((_, i) => `[a${i}]`).join("")}concat=n=${files.length}:v=0:a=1[voice]`);
  await runLocalTool("ffmpeg", [...args, "-filter_complex", filters.join(";"), "-map", "0:v:0", "-map", "[voice]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", output]);
}
