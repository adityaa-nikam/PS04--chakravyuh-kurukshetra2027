import { z } from "zod";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, readdirSync, openSync, closeSync, unlinkSync, statSync, lstatSync } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { explain } from "../video_gen/explain-pipeline";
import { generateExplainerScript } from "../video_gen/script-generator";
import { generateModelVisualPlan } from "../video_gen/model-visual-plan";
import { explainerScriptSchema, type ExplainerScript } from "../video_gen/schema";
import { buildStoryboard } from "../video_gen/storyboard";
import { renderStoryboard } from "../video_gen/render-service";
import { ollamaModel, type InferenceDiagnostic, redactDiagnostics } from "../video_gen/ollama";
import { jobInputSchema, jobIdSchema, type JobInput, type PublicJob } from "./contracts";
import { JobHttpError } from "./security";
const statusSchema = z.enum(["queued", "script_generation", "visual_planning", "rendering", "completed", "failed"]);
const recordSchema = z.strictObject({ version: z.literal(1), id: jobIdSchema, input: jobInputSchema, status: statusSchema, createdAt: z.string(), updatedAt: z.string(), approveOverrun: z.boolean(), code: z.string().optional(), durationSeconds: z.number().optional() });
type JobRecord = z.infer<typeof recordSchema>;
type Dependencies = { generate: (input: JobInput, onDiagnostic: (event: InferenceDiagnostic) => void) => Promise<ExplainerScript>; run: typeof explain; render: typeof renderStoryboard; verify: (video: string, metadata: string) => Promise<void> };
export async function verifyVideo(video: string, metadata: string) {
  const meta = JSON.parse(readFileSync(metadata, "utf8"));
  if (meta.output !== video || !lstatSync(video).isFile() || !lstatSync(metadata).isFile() || statSync(video).size === 0) throw new Error("Invalid finalized files");
  const output = await new Promise<string>((resolve, reject) => execFile("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,codec_type,width,height,nb_frames:format=duration", "-of", "json", video], { timeout: 15000, maxBuffer: 65536 }, (error, stdout) => error ? reject(error) : resolve(stdout)));
  const probe = JSON.parse(output), stream = probe.streams?.[0];
  if (probe.streams?.length !== 1 || stream?.codec_type !== "video" || stream.codec_name !== "h264" || stream.width !== meta.settings?.width || stream.height !== meta.settings?.height || Number(stream.nb_frames) !== meta.durationInFrames || Math.abs(Number(probe.format.duration) - meta.durationInFrames / meta.settings.fps) > 0.1) throw new Error("Final video verification failed");
}
const messages: Record<PublicJob["status"], string> = { queued: "Waiting for the laptop worker.", script_generation: "Generating the script with local Ollama.", visual_planning: "Planning and validating scene visuals.", rendering: "Rendering and verifying the MP4.", completed: "Your silent video is ready.", failed: "Generation stopped. Review the error before resuming." };
function safeCode(error: unknown) {
  if (error instanceof z.ZodError) return "INVALID_OUTPUT";
  const codes = ["DURATION_APPROVAL_REQUIRED", "SCRIPT_QUALITY", "PROVIDER_TIMEOUT", "PROVIDER_CONFIGURATION", "PROVIDER_FAILURE", "PROVIDER_RATE_LIMIT", "OUTPUT_LIMIT", "INVALID_OUTPUT", "VISUAL_PLAN", "VISUAL_ACTION", "RENDER_FAILED"];
  for (let current: unknown = error, depth = 0; current && typeof current === "object" && depth < 5; depth++) {
    const item = current as { code?: unknown; cause?: unknown };
    if (typeof item.code === "string" && codes.includes(item.code)) return item.code;
    current = item.cause;
  }
  const message = error instanceof Error ? error.message : "";
  for (const code of codes) if (message.includes(code)) return code;
  return "GENERATION_FAILED";
}
export class JobService {
  private running = false;
  private scheduled = false;
  private deps: Dependencies;
  constructor(readonly root = path.resolve("artifacts/jobs"), readonly fixtures = path.resolve("app/api/video_gen/fixtures/block05"), readonly capacity = 4, overrides: Partial<Dependencies> = {}) {
    this.deps = { generate: (input, onDiagnostic) => generateExplainerScript({ topic: input.topic, targetAudience: input.targetAudience, durationSeconds: input.durationSeconds }, { live: true, visualPlanning: true, provider: "ollama", onDiagnostic }), run: explain, render: renderStoryboard, verify: verifyVideo, ...overrides };
    mkdirSync(root, { recursive: true }); mkdirSync(fixtures, { recursive: true });
    this.recover(); this.wake();
  }
  files(id: string) {
    jobIdSchema.parse(id); const directory = path.join(this.root, id);
    return { directory, record: path.join(directory, "job.json"), receipt: path.join(directory, "request.json"), video: path.join(directory, "final.mp4"), metadata: path.join(directory, "final.mp4.json"), fixture: path.join(this.fixtures, `generated-${id}.script.json`), logs: path.join(directory, "events.ndjson") };
  }
  private all() { return readdirSync(this.root).filter(id => jobIdSchema.safeParse(id).success).flatMap(id => { try { return [this.read(id)]; } catch { return []; } }).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
  private read(id: string) { const file = this.files(id).record; if (!existsSync(file)) throw new JobHttpError(404, "JOB_NOT_FOUND", "Job not found."); return recordSchema.parse(JSON.parse(readFileSync(file, "utf8"))); }
  private save(record: JobRecord) {
    record.updatedAt = new Date().toISOString(); const file = this.files(record.id).record, temp = `${file}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(record, null, 2), { flag: "wx", mode: 0o600 }); renameSync(temp, file);
  }
  private update(id: string, fields: Partial<JobRecord>) { const record = { ...this.read(id), ...fields }; this.save(record); console.info("[astra_job]", { id, status: record.status, code: record.code }); return record; }
  private workerAlive() {
    const file = path.join(this.root, ".worker.lock"); if (!existsSync(file)) return false;
    try { const pid = Number(readFileSync(file, "utf8")); if (!Number.isInteger(pid) || pid < 1) return true; process.kill(pid, 0); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") { unlinkSync(file); return false; } return true; }
  }
  private recover() {
    if (this.workerAlive()) return;
    for (const job of this.all()) if (!["queued", "failed", "completed"].includes(job.status)) this.update(job.id, { status: "failed", code: "INTERRUPTED" });
  }
  create(input: unknown): PublicJob {
    const parsed = jobInputSchema.parse(input);
    if (this.all().filter(j => !["failed", "completed"].includes(j.status)).length >= this.capacity) throw new JobHttpError(429, "QUEUE_FULL", "The laptop queue is full. Try again after a job finishes.");
    const id = randomUUID(), now = new Date().toISOString(), files = this.files(id); mkdirSync(files.directory, { mode: 0o700 });
    this.save({ version: 1, id, input: parsed, status: "queued", createdAt: now, updatedAt: now, approveOverrun: false });
    this.wake(); return this.get(id);
  }
  get(id: string): PublicJob {
    const job = this.read(id); const file = this.files(id).fixture;
    const script = existsSync(file) ? explainerScriptSchema.parse(JSON.parse(readFileSync(file, "utf8"))) : undefined;
    return { id, status: job.status, createdAt: job.createdAt, updatedAt: job.updatedAt, message: messages[job.status], code: job.code, recoverable: job.status === "failed", durationSeconds: job.durationSeconds, script: script ? { title: script.title, scenes: script.scenes } : undefined, downloadUrl: job.status === "completed" ? `/api/jobs/${id}/video` : undefined };
  }
  resume(id: string, approveOverrun: boolean) {
    const job = this.read(id);
    if (job.status !== "failed") throw new JobHttpError(409, "JOB_NOT_FAILED", "Only failed jobs can be resumed; an active or completed job will not run twice.");
    if (this.all().filter(j => !["failed", "completed"].includes(j.status)).length >= this.capacity) throw new JobHttpError(429, "QUEUE_FULL", "The queue is full.");
    if (approveOverrun && !existsSync(this.files(id).receipt)) throw new JobHttpError(409, "NO_SAVED_SCRIPT", "There is no saved script to approve.");
    this.update(id, { status: "queued", approveOverrun, code: undefined }); this.wake(); return this.get(id);
  }
  video(id: string) {
    const job = this.read(id), files = this.files(id);
    if (job.status !== "completed" || !existsSync(files.video) || !existsSync(files.metadata) || existsSync(`${files.video}.lock`) || !lstatSync(files.video).isFile() || !lstatSync(files.metadata).isFile()) throw new JobHttpError(409, "VIDEO_NOT_READY", "No verified completed video is available.");
    return files.video;
  }
  private wake() {
    if (this.running || this.scheduled) return; this.scheduled = true;
    setTimeout(() => { this.scheduled = false; void this.drain().catch(() => console.error("[astra_job] worker unavailable; inspect local job records.")); }, 0);
  }
  async drain() {
    if (this.running) return;
    this.recover(); if (this.workerAlive()) return;
    const lock = path.join(this.root, ".worker.lock"); let handle: number;
    try { handle = openSync(lock, "wx"); writeFileSync(handle, String(process.pid)); } catch { return; }
    this.running = true;
    try { for (let next = this.all().find(j => j.status === "queued"); next; next = this.all().find(j => j.status === "queued")) await this.process(next); }
    finally { this.running = false; closeSync(handle); unlinkSync(lock); }
  }
  private async process(job: JobRecord) {
    const files = this.files(job.id);
    const log = (event: unknown) => writeFileSync(files.logs, JSON.stringify(redactDiagnostics(event)) + "\n", { flag: "a", mode: 0o600 });
    try {
      // A crash after publication but before recording completion may be recovered
      // by verification, without overwriting the pair or executing the model again.
      if (existsSync(files.video) && existsSync(files.metadata)) { await this.deps.verify(files.video, files.metadata); this.update(job.id, { status: "completed", code: undefined }); return; }
      let script: ExplainerScript;
      if (existsSync(files.receipt)) script = explainerScriptSchema.parse(JSON.parse(readFileSync(files.receipt, "utf8")).script);
      else {
        this.update(job.id, { status: "script_generation" });
        script = existsSync(files.fixture) ? explainerScriptSchema.parse(JSON.parse(readFileSync(files.fixture, "utf8"))) : explainerScriptSchema.parse(await this.deps.generate(job.input, log));
        if (script.estimatedDurationSeconds !== job.input.durationSeconds) throw new Error("INVALID_OUTPUT: declared duration mismatch");
        if (!existsSync(files.fixture)) writeFileSync(files.fixture, JSON.stringify(script, null, 2), { flag: "wx", mode: 0o600 });
        writeFileSync(files.receipt, JSON.stringify({ version: 1, request: { topic: job.input.topic, targetAudience: job.input.targetAudience, durationSeconds: job.input.durationSeconds }, script, provider: "ollama", model: ollamaModel(), generatedAt: new Date().toISOString(), output: files.video, planner: job.input.visualActions ? "actions-v1" : "graph" }, null, 2), { flag: "wx", mode: 0o600 });
      }
      const duration = buildStoryboard(script).estimatedDurationSeconds; this.update(job.id, { status: "visual_planning", durationSeconds: duration });
      await this.deps.run({ resume: files.receipt, output: files.video, visualActions: job.input.visualActions, approveOverrun: job.approveOverrun, ...(job.input.orientation === "landscape" ? { width: 960, height: 540 } : {}) }, {
        provider: "ollama", model: ollamaModel(), planVisuals: (board, options) => generateModelVisualPlan(board, { ...options, provider: "ollama" }),
        render: async (...args) => { this.update(job.id, { status: "rendering" }); return this.deps.render(...args); },
      });
      await this.deps.verify(files.video, files.metadata);
      this.update(job.id, { status: "completed", code: undefined });
    } catch (error) {
      log({ event: "failed", code: safeCode(error) });
      this.update(job.id, { status: "failed", code: safeCode(error) });
    }
  }
}
const key = Symbol.for("astra-studio.job-service.v1");
export function jobs() {
  const registry = globalThis as typeof globalThis & { [key]?: JobService };
  return registry[key] ??= new JobService();
}
