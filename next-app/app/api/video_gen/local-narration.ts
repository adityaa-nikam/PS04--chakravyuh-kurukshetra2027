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

import { createHash } from "node:crypto";

export function applyNarrationTiming(
  plan: RenderPlan,
  seconds: number[],
  voice: string,
  engine: string = "piper",
  metadata?: {
    modelId?: string;
    settings?: Record<string, unknown>;
    scriptHash?: string;
  }
) {
  if (seconds.length !== plan.frames.length || seconds.some(n => !Number.isFinite(n) || n <= 0)) throw new Error("LOCAL_TTS: invalid scene audio durations.");
  let from = 0;
  const frames = plan.frames.map((frame, i) => {
    // Keep the existing reading time; extend for a complete spoken sentence and
    // a short pause. Never speed up, truncate, or change the script.
    const durationInFrames = Math.max(frame.durationInFrames, Math.ceil((seconds[i] + 0.35) * plan.settings.fps));
    const allocation = { ...frame, from, durationInFrames }; from += durationInFrames; return allocation;
  });
  if (from > plan.durationInFrames && !plan.settings.approveOverrun) {
    throw new Error("DURATION_APPROVAL_REQUIRED: Spoken audio extends duration beyond allocated frames.");
  }
  plan.frames = frames;
  plan.durationInFrames = from;
  plan.narration = {
    engine,
    voice,
    seconds,
    ...(metadata ? {
      modelId: metadata.modelId,
      settings: metadata.settings,
      scriptHash: metadata.scriptHash,
    } : {}),
  };
}

export async function prepareLocalNarration(plan: RenderPlan, directory: string): Promise<string[] | undefined> {
  const provider = (process.env.VIDEO_GEN_TTS ?? "elevenlabs").toLowerCase();
  if (provider === "off" || provider === "none" || provider === "silent") return undefined;

  const app = existsSync(path.resolve("app/api/video_gen")) ? process.cwd() : path.resolve("next-app");

  // Primary Provider: Official ElevenLabs Natural Female TTS
  const { generateSpeechWithElevenLabs, getElevenLabsConfig, isElevenLabsConfigured } = await import("./elevenlabs-service");

  if (isElevenLabsConfigured()) {
    const config = getElevenLabsConfig();
    const files: string[] = [];
    const seconds: number[] = [];

    const fullScript = plan.storyboard.scenes.map(s => s.narration).join("\n");
    const scriptHash = createHash("sha256").update(fullScript).digest("hex").slice(0, 16);

    for (let i = 0; i < plan.storyboard.scenes.length; i++) {
      const scene = plan.storyboard.scenes[i];
      const audioFile = path.join(directory, `${scene.id}.mp3`);
      const result = await generateSpeechWithElevenLabs(scene.narration, audioFile, config);
      files.push(result.audioPath);
      seconds.push(result.durationSeconds);
    }

    applyNarrationTiming(plan, seconds, config.voiceId, "elevenlabs", {
      modelId: config.modelId,
      settings: {
        stability: config.stability,
        similarityBoost: config.similarityBoost,
      },
      scriptHash,
    });
    return files;
  }

  // If ElevenLabs is missing, never silently fall back to robotic voice unless explicitly opted into via VIDEO_GEN_TTS
  if (provider === "elevenlabs" || !process.env.VIDEO_GEN_TTS) {
    throw getElevenLabsConfig();
  }

  // Explicit opt-in local fallback to Piper (only when VIDEO_GEN_TTS="piper")
  if (provider === "piper") {
    const defaultPython = process.platform === "win32"
      ? (existsSync(path.join(app, ".venv-tts/Scripts/python.exe")) ? path.join(app, ".venv-tts/Scripts/python.exe") : path.join(app, ".venv-tts/bin/python"))
      : (existsSync(path.join(app, ".venv-tts/bin/python")) ? path.join(app, ".venv-tts/bin/python") : path.join(app, ".venv-tts/Scripts/python.exe"));
    const python = process.env.PIPER_PYTHON || defaultPython;
    const model = process.env.PIPER_MODEL || path.join(app, "artifacts/voices/en_US-lessac-medium.onnx");

    const files = plan.storyboard.scenes.map(scene => path.join(directory, `${scene.id}.wav`));
    let voice = "en_US-lessac-medium";

    const piperAvailable = existsSync(python) && existsSync(model) && existsSync(`${model}.json`);

    if (piperAvailable) {
      try {
        const manifest = path.join(directory, "speech-job.json");
        writeFileSync(manifest, JSON.stringify({ model, scenes: plan.storyboard.scenes.map((scene, i) => ({ text: scene.narration, output: files[i] })) }), { mode: 0o600 });
        await runLocalTool(python, [path.join(app, "app/api/video_gen/piper-worker.py"), manifest]);
        voice = path.basename(model, ".onnx");
      } catch (piperErr) {
        console.warn("[local-narration] Piper execution failed:", piperErr);
        return undefined;
      }
    } else {
      return undefined;
    }

    const seconds: number[] = [];
    for (const file of files) {
      if (!existsSync(file)) return undefined;
      const dur = await runLocalTool("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file]);
      const secVal = Number(dur.trim());
      seconds.push(Number.isFinite(secVal) && secVal > 0 ? secVal : 5.0);
    }

    applyNarrationTiming(plan, seconds, voice, "piper");
    return files;
  }

  // Natural neural fallback to Edge-TTS / Windows SAPI
  if (provider === "edge" || provider === "sapi" || provider === "auto" || !process.env.VIDEO_GEN_TTS) {
    const files = plan.storyboard.scenes.map(scene => path.join(directory, `${scene.id}.mp3`));
    const { generateNarrationAudio } = await import("./audio-service");
    for (let i = 0; i < plan.storyboard.scenes.length; i++) {
      const scene = plan.storyboard.scenes[i];
      await generateNarrationAudio(scene.narration, files[i]);
    }

    const seconds: number[] = [];
    for (const file of files) {
      const dur = await runLocalTool("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file]);
      const secVal = Number(dur.trim());
      seconds.push(Number.isFinite(secVal) && secVal > 0 ? secVal : 5.0);
    }

    applyNarrationTiming(plan, seconds, "edge-speech", "edge");
    return files;
  }

  throw new Error(`UNSUPPORTED_TTS_PROVIDER: '${provider}' is not a supported TTS provider. Configure ElevenLabs credentials or set VIDEO_GEN_TTS='off'.`);
}

export async function muxLocalNarration(plan: RenderPlan, files: string[], video: string, output: string) {
  const args = ["-v", "error", "-y", "-i", video, ...files.flatMap(file => ["-i", file])];
  const filters = plan.frames.map((frame, i) => `[${i + 1}:a]aresample=48000,apad,atrim=duration=${frame.durationInFrames / plan.settings.fps},asetpts=PTS-STARTPTS[a${i}]`);
  filters.push(`${files.map((_, i) => `[a${i}]`).join("")}concat=n=${files.length}:v=0:a=1,loudnorm=I=-16:TP=-1.5:LRA=11[voice]`);
  await runLocalTool("ffmpeg", [...args, "-filter_complex", filters.join(";"), "-map", "0:v:0", "-map", "[voice]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", output]);
}
