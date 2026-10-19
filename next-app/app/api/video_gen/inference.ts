import { z } from "zod";
import { generateOllamaJson, ollamaModel, ScriptGenerationError, inferenceLimit, redactDiagnostics, type InferenceContext, type InferenceDiagnostic, type OutputReport } from "./ollama";
export function inferenceProvider(): "openrouter" | "ollama" {
  const value = process.env.VIDEO_GEN_PROVIDER?.trim() || "openrouter";
  if (value !== "openrouter" && value !== "ollama") throw new ScriptGenerationError(503, "PROVIDER_CONFIGURATION", "VIDEO_GEN_PROVIDER must be openrouter or ollama.");
  return value;
}
export function inferenceModel() { return inferenceProvider() === "ollama" ? ollamaModel() : process.env.OPENROUTER_MODEL?.trim() || "nvidia/nemotron-3-super-120b-a12b:free"; }
let lane: Promise<void> = Promise.resolve();
export async function generateJson<T extends z.ZodType>(schema: T, input: unknown, system: string, maxTokens = 2048, context: InferenceContext = {}): Promise<z.output<T>> {
  const previous = lane; let release!: () => void;
  lane = new Promise<void>(resolve => { release = resolve; });
  const queued = Date.now(); await previous;
  try { return inferenceProvider() === "ollama" ? await generateOllamaJson(schema, input, system, maxTokens, context) : await openRouterJson(schema, input, system, maxTokens, context, Date.now() - queued); }
  finally { release(); }
}
const completionSchema = z.object({ model: z.string(), choices: z.array(z.object({ finish_reason: z.string().nullable(), message: z.object({ content: z.string().nullable().optional() }) })).min(1), usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional(), completion_tokens_details: z.object({ reasoning_tokens: z.number().optional() }).optional() }).optional() });
async function openRouterJson<T extends z.ZodType>(schema: T, input: unknown, system: string, maxTokens: number, context: InferenceContext, queueMs: number): Promise<z.output<T>> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) throw new ScriptGenerationError(503, "PROVIDER_CONFIGURATION", "Add OPENROUTER_API_KEY to .env.local (server-only) before using OpenRouter.");
  const model = inferenceModel(), stage = context.stage ?? "script";
  const timeoutMs = inferenceLimit("OPENROUTER_TIMEOUT_MS", 180000, 1000, 600000);
  const outputLimit = inferenceLimit(stage === "visual" ? "OPENROUTER_VISUAL_MAX_TOKENS" : "OPENROUTER_SCRIPT_MAX_TOKENS", maxTokens, 256, 8192);
  const format = z.toJSONSchema(schema, { io: "input" }), user = JSON.stringify(input);
  const isReasoning = model.includes("nemotron") || model.includes("r1") || model.includes("reasoner");
  const body = JSON.stringify({
    model,
    stream: false,
    temperature: 0,
    max_tokens: outputLimit,
    ...(isReasoning ? { reasoning: { enabled: false }, provider: { require_parameters: true } } : {}),
    response_format: { type: "json_schema", json_schema: { name: "explainer_output", strict: true, schema: format } },
    messages: [{ role: "system", content: system }, { role: "user", content: user }]
  });
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const started = Date.now(), timeout = AbortSignal.timeout(timeoutMs);
    const event: InferenceDiagnostic = { provider: "openrouter", stage, sceneId: context.sceneId, planningAttempt: context.planningAttempt, model, attempt, queueMs, inputBytes: Buffer.byteLength(system + user), schemaBytes: Buffer.byteLength(JSON.stringify(format)), estimatedInputTokens: Math.ceil(Buffer.byteLength(system + user) / 4), outputLimit, timeoutMs, elapsedMs: 0, status: "started" };
    const report: OutputReport = { schema: format, phase: "envelope", sceneId: context.sceneId, planningAttempt: context.planningAttempt, transportAttempt: attempt };
    console.info("[video_gen] inference_start", event);
    let transient = false;
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body, signal: timeout, cache: "no-store" });
      report.rawOutput = await response.text();
      if (!response.ok) {
        transient = [429, 502, 503].includes(response.status);
        if ([400, 401, 402, 403, 404].includes(response.status)) throw new ScriptGenerationError(503, "PROVIDER_CONFIGURATION", `OpenRouter HTTP ${response.status}: check API key, model availability and structured-output support. No local or paid-model fallback was made.`);
        throw new ScriptGenerationError(response.status === 429 ? 429 : 502, "PROVIDER_FAILURE", `OpenRouter HTTP ${response.status}. Retry later if the free router is busy.`);
      }
      const envelope = completionSchema.parse(JSON.parse(report.rawOutput));
      const choice = envelope.choices[0];
      const content = choice.message.content;
      // Retain the envelope for null/absent content so finish reason and usage survive.
      if (typeof content === "string" && content.length) report.rawOutput = content;
      Object.assign(event, { resolvedModel: envelope.model, promptTokens: envelope.usage?.prompt_tokens, outputTokens: envelope.usage?.completion_tokens, outputBytes: typeof content === "string" ? Buffer.byteLength(content) : 0, finishReason: choice.finish_reason, reasoningTokens: envelope.usage?.completion_tokens_details?.reasoning_tokens });
      if (choice.finish_reason === "length") throw new ScriptGenerationError(502, "OUTPUT_LIMIT", `OpenRouter hit the output-token limit (${outputLimit} tokens; model ${envelope.model}; completion_tokens=${envelope.usage?.completion_tokens ?? "unreported"}; reasoning_tokens=${envelope.usage?.completion_tokens_details?.reasoning_tokens ?? "unreported"}; visible_bytes=${typeof content === "string" ? Buffer.byteLength(content) : 0}). No complete script/plan was returned. Reasoning was requested disabled. Inspect these counts and the selected free model before increasing limits again; narration budgets and validation still apply.`);
      if (choice.finish_reason !== "stop") throw new ScriptGenerationError(502, choice.finish_reason === "content_filter" ? "PROVIDER_REFUSAL" : "INCOMPLETE_OUTPUT", `OpenRouter returned no usable completion (finish_reason=${choice.finish_reason}; model ${envelope.model}).`, { phase: "envelope", finishReason: choice.finish_reason });
      if (typeof content !== "string" || !content.trim()) throw new ScriptGenerationError(502, "EMPTY_OUTPUT", `OpenRouter returned empty message content (finish_reason=stop; model ${envelope.model}). Authentication reached generation, but no JSON script/plan was provided. Retry explicitly; no reasoning text was used as output.`, { phase: "envelope", finishReason: choice.finish_reason });
      report.phase = "json_syntax"; const parsed: unknown = JSON.parse(content);
      report.phase = "structure"; const result = schema.parse(parsed);
      report.phase = "parsed"; event.status = "success"; return result;
    } catch (error) {
      let failure: ScriptGenerationError;
      if (error instanceof z.ZodError) report.issues = error.issues;
      if (error instanceof SyntaxError) report.parserMessage = error.message;
      if (timeout.aborted) { transient = false; failure = new ScriptGenerationError(504, "PROVIDER_TIMEOUT", `OpenRouter timed out after ${timeoutMs / 1000} seconds.`); }
      else if (error instanceof ScriptGenerationError) failure = error;
      else if (error instanceof z.ZodError || error instanceof SyntaxError) {
        transient = false;
        failure = new ScriptGenerationError(502, "INVALID_OUTPUT", `OpenRouter returned invalid output (${report.phase}).${error instanceof z.ZodError ? " Invalid fields: " + error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 900) : " Malformed JSON."}`, { phase: report.phase, issues: report.issues, parserMessage: report.parserMessage });
      } else { transient = error instanceof TypeError; failure = new ScriptGenerationError(502, "PROVIDER_FAILURE", "Could not communicate with OpenRouter. Check connectivity."); }
      event.status = transient && attempt < maxAttempts ? "retry" : "failed"; event.reason = failure.code;
      if (!transient || attempt === maxAttempts) throw new ScriptGenerationError(failure.status, failure.code, `${stage}${context.sceneId ? ` ${context.sceneId}` : ""}: ${failure.message}`, failure.details);
    } finally {
      event.elapsedMs = Date.now() - started; console.info("[video_gen] inference_end", event);
      if (report.rawOutput !== undefined) context.onResponse?.(redactDiagnostics(report) as OutputReport);
      context.onDiagnostic?.(event);
    }
    const backoffMs = Math.min(5000, attempt * 2000);
    console.info(`[video_gen] transient provider issue, retrying after ${backoffMs}ms (attempt ${attempt + 1}/${maxAttempts})...`);
    await new Promise(resolve => setTimeout(resolve, backoffMs));
  }
  throw new Error("Unreachable provider state");
}
