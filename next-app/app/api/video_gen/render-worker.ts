import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

type RendererEnvironment = Record<string, string | undefined>;

// Keep changes local to the render child. Next's instrumented process.env is
// shared across requests and its dev launcher can re-inject Node-only hooks.
// A complete process environment stays complete; partial fixtures need no NODE_ENV.
export function rendererEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export function rendererEnvironment(source: RendererEnvironment): RendererEnvironment;
export function rendererEnvironment(source: RendererEnvironment): RendererEnvironment {
  const env = { ...source };
  const preload = env.LD_PRELOAD?.split(/[\s:]+/).filter(entry => entry && !entry.includes("console-ninja"));
  if (preload?.length) env.LD_PRELOAD = preload.join(":");
  else delete env.LD_PRELOAD;
  // An isolated renderer must not bootstrap IDE/debugger --require/--import hooks.
  delete env.NODE_OPTIONS;
  return env;
}

export function runRenderWorker(args: string[]): Promise<void> {
  const relative = "app/api/video_gen/remotion-worker.mjs";
  const worker = existsSync(path.resolve(relative)) ? path.resolve(relative) : path.resolve("next-app", relative);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker, ...args], {
      env: rendererEnvironment(process.env), stdio: ["ignore", "pipe", "pipe"],
    });
    let diagnostics = "";
    const collect = (chunk: Buffer) => { diagnostics = (diagnostics + chunk.toString()).slice(-16000); };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Isolated renderer exited (${signal ?? code}): ${diagnostics.trim()}`));
    });
  });
}
