import { z } from "zod";

export type OutputReport = { rawOutput?: string; schema: unknown; phase: "json_syntax" | "structure" | "parsed" | "envelope"; issues?: unknown; parserMessage?: string; sceneId?: string; planningAttempt?: number; transportAttempt: number };
export function redactDiagnostics(value: unknown): unknown {
  let text = JSON.stringify(value);
  for (const [key, secret] of Object.entries(process.env)) if (/(?:secret|password|token|api_?key|credential)/i.test(key) && secret && secret.length >= 8) text = text.split(JSON.stringify(secret).slice(1, -1)).join("[REDACTED]");
  text = text.replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, "$1[REDACTED]");
  // Redact credential assignments inside the raw JSON string, including escaped quotes.
  const parsed = JSON.parse(text);
  const scrub = (item: unknown): unknown => typeof item === "string" ? item.replace(/(["'](?:password|secret|api[_-]?key|access[_-]?token)["']\s*:\s*["'])(?:\\.|[^"'])*(["'])/gi, "$1[REDACTED]$2").replace(/((?:password|secret|api[_-]?key|access[_-]?token)\s*[=:]\s*["']?)[^"'\s,}]+/gi, "$1[REDACTED]") : Array.isArray(item) ? item.map(scrub) : item && typeof item === "object" ? Object.fromEntries(Object.entries(item).map(([k, v]) => [k, /^(?:password|secret|api[_-]?key|access[_-]?token)$/i.test(k) ? "[REDACTED]" : scrub(v)])) : item;
  return scrub(parsed);
}
export class ScriptGenerationError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly details?: unknown) {
    super(message); this.name = "ScriptGenerationError";
  }
}
export type InferenceDiagnostic = {
  provider?: "ollama" | "openrouter"; resolvedModel?: string; finishReason?: string | null; reasoningTokens?: number; stage: string; sceneId?: string; model: string; attempt: number; elapsedMs: number;
  inputBytes: number; schemaBytes: number; estimatedInputTokens: number; contextTokens?: number;
  outputLimit: number; timeoutMs: number; queueMs?: number; providerTotalMs?: number; outputBytes?: number; outputTokens?: number;
  promptTokens?: number; loadMs?: number; promptEvalMs?: number; evalMs?: number;
  status: string; reason?: string; planningAttempt?: number;
};
export type InferenceContext = { provider?: "ollama" | "openrouter"; stage?: "script" | "visual"; sceneId?: string; planningAttempt?: number; onDiagnostic?: (event: InferenceDiagnostic) => void; onResponse?: (report: OutputReport) => void };
export function inferenceLimit(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new ScriptGenerationError(503, "PROVIDER_CONFIGURATION", `${name} must be an integer between ${min} and ${max}.`);
  return value;
}
const responseSchema = z.object({ done: z.literal(true), done_reason: z.string().optional(), message: z.object({ content: z.string() }),
  eval_count: z.number().optional(), prompt_eval_count: z.number().optional(), load_duration: z.number().optional(), prompt_eval_duration: z.number().optional(), eval_duration: z.number().optional(), total_duration: z.number().optional() });
export function ollamaModel() { return process.env.OLLAMA_MODEL?.trim() || "qwen2.5:3b"; }
// All local inference in this process shares one lane, including independent API requests.
let lane: Promise<void> = Promise.resolve();
export async function generateOllamaJson<T extends z.ZodType>(schema: T, input: unknown, system: string, maxTokens = 2048, context: InferenceContext = {}): Promise<z.output<T>> {
  const queuedAt = Date.now();
  const previous = lane;
  let release!: () => void;
  lane = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try { return await callOllama(schema, input, system, maxTokens, context, Date.now() - queuedAt); }
  finally { release(); }
}
async function callOllama<T extends z.ZodType>(schema: T, input: unknown, system: string, maxTokens: number, context: InferenceContext, queueMs: number): Promise<z.output<T>> {
  let endpoint: URL;
  try {
    const base = new URL(process.env.OLLAMA_BASE_URL?.trim() || "http://localhost:11434");
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error("Invalid base URL");
    endpoint = new URL(`${base.pathname.replace(/\/$/, "")}/api/chat`, base);
  } catch { throw new ScriptGenerationError(503, "PROVIDER_CONFIGURATION", "Configure OLLAMA_BASE_URL as an HTTP(S) base URL without credentials, query, or fragment."); }
  const stage = context.stage ?? "script", model = ollamaModel();
  const timeoutMs = inferenceLimit(stage === "visual" ? "OLLAMA_VISUAL_TIMEOUT_MS" : "OLLAMA_SCRIPT_TIMEOUT_MS", 180000, 1000, 600000);
  const numCtx = inferenceLimit("OLLAMA_NUM_CTX", 4096, 2048, 8192);
  const outputLimit = inferenceLimit(stage === "visual" ? "OLLAMA_VISUAL_MAX_TOKENS" : "OLLAMA_SCRIPT_MAX_TOKENS", maxTokens, 256, 4096);
  const format = z.toJSONSchema(schema, { io: "input" }), user = JSON.stringify(input);
  const inputBytes = Buffer.byteLength(system + user), schemaBytes = Buffer.byteLength(JSON.stringify(format));
  // This is a size estimate, not the model tokenizer; actual prompt counts are logged below.
  const estimatedInputTokens = Math.ceil(inputBytes / 4);
  if (outputLimit >= numCtx || estimatedInputTokens + outputLimit + 128 > numCtx) throw new ScriptGenerationError(400, "CONTEXT_BUDGET", `${stage} ${context.sceneId ?? ""}: estimated prompt plus output exceeds OLLAMA_NUM_CTX; reduce source size/output cap or deliberately configure context. No source was truncated.`);
  const body = JSON.stringify({ model, stream: false, truncate: false, format, keep_alive: "1m", options: { temperature: 0, num_predict: outputLimit, num_ctx: numCtx, repeat_penalty: 1.1, repeat_last_n: 128 }, messages: [{ role: "system", content: system }, { role: "user", content: user }] });
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now(), timeout = AbortSignal.timeout(timeoutMs);
    const event: InferenceDiagnostic = { stage, sceneId: context.sceneId, planningAttempt: context.planningAttempt, model, attempt, elapsedMs: 0, inputBytes, schemaBytes, estimatedInputTokens, contextTokens: numCtx, outputLimit, timeoutMs, queueMs, status: "started" };
    console.info("[video_gen] inference_start", event);
    let retry = false;
    const report: OutputReport = { schema: format, phase: "envelope", sceneId: context.sceneId, planningAttempt: context.planningAttempt, transportAttempt: attempt };
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, signal: timeout, cache: "no-store", body });
      if (!response.ok) {
        retry = response.status === 429 || response.status === 503;
        if (response.status === 404) throw new ScriptGenerationError(503, "PROVIDER_CONFIGURATION", "Ollama model or endpoint was not found. Check the already installed model and endpoint; no model is downloaded.");
        if ([401, 403].includes(response.status)) throw new ScriptGenerationError(503, "PROVIDER_CONFIGURATION", "Ollama access was denied. Check endpoint configuration.");
        throw new ScriptGenerationError(response.status === 429 ? 429 : 502, "PROVIDER_FAILURE", `Ollama HTTP ${response.status}. Check server logs/resources.`);
      }
      report.rawOutput = await response.text();
      const envelope = responseSchema.parse(JSON.parse(report.rawOutput));
      report.rawOutput = envelope.message.content;
      Object.assign(event, { outputBytes: Buffer.byteLength(envelope.message.content), providerTotalMs: envelope.total_duration === undefined ? undefined : envelope.total_duration / 1e6, outputTokens: envelope.eval_count, promptTokens: envelope.prompt_eval_count, loadMs: envelope.load_duration === undefined ? undefined : envelope.load_duration / 1e6, promptEvalMs: envelope.prompt_eval_duration === undefined ? undefined : envelope.prompt_eval_duration / 1e6, evalMs: envelope.eval_duration === undefined ? undefined : envelope.eval_duration / 1e6 });
      if (envelope.done_reason === "length") throw new ScriptGenerationError(502, "OUTPUT_LIMIT", "Ollama hit the output-token limit; incomplete output was rejected without truncation or automatic regeneration.");
      report.rawOutput = envelope.message.content;
      report.phase = "json_syntax";
      const parsed: unknown = JSON.parse(envelope.message.content);
      report.phase = "structure";
      const result = schema.parse(parsed);
      report.phase = "parsed";
      event.status = "success";
      return result;
    } catch (error) {
      let failure: ScriptGenerationError;
      if (error instanceof z.ZodError) report.issues = error.issues;
      if (error instanceof SyntaxError) report.parserMessage = error.message;
      if (timeout.aborted) { retry = false; failure = new ScriptGenerationError(504, "PROVIDER_TIMEOUT", `Ollama timed out after ${timeoutMs / 1000} seconds. Check model loading/resources before resuming.`); }
      else if (error instanceof ScriptGenerationError) failure = error;
      else if (error instanceof SyntaxError || error instanceof z.ZodError) { retry = false; failure = new ScriptGenerationError(502, "INVALID_OUTPUT", `Ollama returned malformed JSON or unsupported fields.${error instanceof z.ZodError ? " Invalid fields: " + error.issues.map(issue => `${issue.path.join(".") || "response"}: ${issue.message}`).join("; ").slice(0, 900) + "." : ""} No automatic transport retry of malformed output. Failure phase: ${report.phase}.`, { phase: report.phase, issues: report.issues, parserMessage: report.parserMessage }); }
      else { retry = error instanceof TypeError; failure = new ScriptGenerationError(502, "PROVIDER_FAILURE", "Could not communicate with Ollama. Ensure the existing local server is running and reachable."); }
      event.status = retry && attempt === 1 ? "retry" : "failed"; event.reason = failure.code;
      if (!retry || attempt === 2) throw new ScriptGenerationError(failure.status, failure.code, `${stage}${context.sceneId ? ` ${context.sceneId}` : ""}: ${failure.message}`, failure.details);
    } finally {
      event.elapsedMs = Date.now() - started;
      console.info("[video_gen] inference_end", event);
      if (report.rawOutput !== undefined || report.issues || report.parserMessage) context.onResponse?.(redactDiagnostics(report) as OutputReport);
      context.onDiagnostic?.(event);
    }
    // One short backoff only for connection failures or busy/unavailable responses.
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("Unreachable inference state");
}
