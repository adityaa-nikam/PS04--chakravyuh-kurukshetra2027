import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { generateJson, inferenceModel, inferenceProvider } from "./inference";
import { type OutputReport, type InferenceDiagnostic } from "./ollama";
import { generateVisualActions } from "./visual-actions";
import { buildStoryboard } from "./storyboard";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { explain } from "./explain-pipeline";

process.env.VIDEO_GEN_PROVIDER = "openrouter";
process.env.OPENROUTER_API_KEY = "mock-secret-key-not-real";
delete process.env.OPENROUTER_MODEL;
const completion = (content: string, finish = "stop") => new Response(JSON.stringify({ model: "example/routed-model:free", choices: [{ finish_reason: finish, message: { content } }], usage: { prompt_tokens: 123, completion_tokens: 45 } }));

test("OpenRouter is default, pins NVIDIA/auth/JSON schema and records actual routed model", async () => {
  delete process.env.VIDEO_GEN_PROVIDER;
  assert.equal(inferenceProvider(), "openrouter"); assert.equal(inferenceModel(), "nvidia/nemotron-3-super-120b-a12b:free");
  const events: InferenceDiagnostic[] = [], reports: OutputReport[] = [], schema = z.strictObject({ value: z.string() });
  const provider = mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer mock-secret-key-not-real");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "nvidia/nemotron-3-super-120b-a12b:free"); assert.deepEqual(body.reasoning, { enabled: false }); assert.equal(body.max_tokens, 384); assert.equal(body.stream, false);
    assert.equal(body.provider.require_parameters, true); assert.equal(body.options, undefined);
    assert.deepEqual(body.response_format.json_schema.schema, z.toJSONSchema(schema, { io: "input" }));
    assert.equal(JSON.parse(body.messages[1].content).topic, "XML and JSON");
    return completion('{"value":"ok"}');
  });
  try {
    assert.deepEqual(await generateJson(schema, { topic: "XML and JSON" }, "Return JSON", 384, { onDiagnostic: e => events.push(e), onResponse: r => reports.push(r) }), { value: "ok" });
    assert.equal(events[0].provider, "openrouter"); assert.equal(events[0].resolvedModel, "example/routed-model:free");
    assert.equal(events[0].outputTokens, 45); assert.equal(events[0].contextTokens, undefined);
    assert.ok(!JSON.stringify([events, reports]).includes(process.env.OPENROUTER_API_KEY!));
  } finally { provider.mock.restore(); }
});

test("missing key fails before networking; auth/config errors do not retry or fall back", async () => {
  const provider = mock.method(globalThis, "fetch", async () => new Response("mock-secret-key-not-real", { status: 401 }));
  const key = process.env.OPENROUTER_API_KEY;
  try {
    delete process.env.OPENROUTER_API_KEY;
    await assert.rejects(generateJson(z.object({}), {}, "data"), /OPENROUTER_API_KEY/); assert.equal(provider.mock.callCount(), 0);
    process.env.OPENROUTER_API_KEY = key;
    const reports: OutputReport[] = [];
    await assert.rejects(generateJson(z.object({}), {}, "data", 512, { onResponse: r => reports.push(r) }), /HTTP 401/);
    assert.equal(provider.mock.callCount(), 1); assert.ok(!JSON.stringify(reports).includes(key!));
  } finally { process.env.OPENROUTER_API_KEY = key; provider.mock.restore(); }
});

test("OpenRouter preserves syntax/schema diagnostics, rejects truncation and bounds retries", async () => {
  const reports: OutputReport[] = [];
  const provider = mock.method(globalThis, "fetch", async () => completion('{"value":'));
  try {
    await assert.rejects(generateJson(z.strictObject({ value: z.string() }), {}, "JSON", 512, { onResponse: r => reports.push(r) }), /json_syntax/);
    assert.equal(provider.mock.callCount(), 1); assert.equal(reports[0].phase, "json_syntax");
    provider.mock.mockImplementation(async () => completion('{"value":"ok","extra":true}'));
    await assert.rejects(generateJson(z.strictObject({ value: z.string() }), {}, "JSON", 512, { onResponse: r => reports.push(r) }), /structure/);
    assert.ok(reports[1].issues);
    provider.mock.mockImplementation(async () => completion('{}', "length"));
    await assert.rejects(generateJson(z.object({}), {}, "JSON"), /output-token limit/);
    provider.mock.mockImplementation(async () => new Response("busy", { status: 429 }));
    const before = provider.mock.callCount();
    await assert.rejects(generateJson(z.object({}), {}, "JSON"), /HTTP 429/);
    assert.equal(provider.mock.callCount() - before, 2);
    const timer = mock.method(AbortSignal, "timeout", () => AbortSignal.abort());
    try {
      provider.mock.mockImplementation(async () => { throw new Error("aborted"); });
      const count = provider.mock.callCount(); await assert.rejects(generateJson(z.object({}), {}, "JSON"), /timed out/);
      assert.equal(provider.mock.callCount() - count, 1);
    } finally { timer.mock.restore(); }
  } finally { provider.mock.restore(); }
});

test("saved Ollama script replans sequentially with OpenRouter actions and retains source provenance", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "openrouter-resume-"));
  const source = JSON.parse(readFileSync("app/api/video_gen/fixtures/regressions/xml-json-overview071.json", "utf8")).script;
  const receipt = path.join(root, "old.json");
  const raw = JSON.stringify({ version: 1, request: { topic: "XML vs JSON", durationSeconds: 45, targetAudience: "Beginners" }, script: source, model: "qwen2.5:3b", generatedAt: new Date().toISOString(), output: path.join(root, "final.mp4") });
  writeFileSync(receipt, raw);
  let active = 0, peak = 0; const ids: string[] = [];
  const provider = mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    active++; peak = Math.max(peak, active);
    const body = JSON.parse(String(init?.body)), input = JSON.parse(body.messages[1].content);
    assert.equal(body.model, "nvidia/nemotron-3-super-120b-a12b:free"); ids.push(input.sceneId);
    await new Promise(resolve => setTimeout(resolve, 1)); active--;
    return completion(JSON.stringify({ sceneId: input.sceneId, action: "format_comparison", exampleId: "record-001", focus: "fields" }));
  });
  try {
    const result = await explain({ resume: receipt, visualActions: true, replan: true, inspect: true }, { requestsDirectory: path.join(root, "requests") });
    assert.equal(readFileSync(receipt, "utf8"), raw); assert.equal(peak, 1);
    assert.deepEqual(ids, ["scene-001", "scene-002", "scene-003"]);
    const saved = JSON.parse(readFileSync(result.requestReceipt!, "utf8"));
    assert.deepEqual(saved.script, source); assert.equal(saved.model, "qwen2.5:3b");
    assert.equal(saved.plannerProvider, "openrouter"); assert.equal(saved.plannerModel, "nvidia/nemotron-3-super-120b-a12b:free");
    await explain({ resume: result.requestReceipt, inspect: true }); assert.equal(ids.length, 3);
    // Direct complete prefix reuse must not contact either provider.
    assert.equal((await generateVisualActions(buildStoryboard(source), { completedActions: saved.actionPlan })).actions.length, 3);
  } finally { provider.mock.restore(); rmSync(root, { recursive: true, force: true }); }
});


test("null content is classified by finish reason before text parsing; reasoning is never a script", async () => {
  let finish = "length";
  const events: InferenceDiagnostic[] = [], reports: OutputReport[] = [];
  const provider = mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ model: "example/reasoner:free", choices: [{ finish_reason: finish, message: { content: null, reasoning: "Private reasoning, not script JSON" } }], usage: { completion_tokens: 869, completion_tokens_details: { reasoning_tokens: 869 } } })));
  try {
    await assert.rejects(generateJson(z.object({}), {}, "JSON", 869, { onDiagnostic: e => events.push(e), onResponse: r => reports.push(r) }), (error: unknown) => error instanceof Error && "code" in error && error.code === "OUTPUT_LIMIT");
    assert.equal(events[0].resolvedModel, "example/reasoner:free"); assert.equal(events[0].reasoningTokens, 869); assert.equal(events[0].finishReason, "length");
    assert.equal(JSON.parse(reports[0].rawOutput!).choices[0].message.content, null);
    finish = "stop";
    await assert.rejects(generateJson(z.object({}), {}, "JSON"), (error: unknown) => error instanceof Error && "code" in error && error.code === "EMPTY_OUTPUT");
    finish = "content_filter";
    await assert.rejects(generateJson(z.object({}), {}, "JSON"), (error: unknown) => error instanceof Error && "code" in error && error.code === "PROVIDER_REFUSAL");
    assert.equal(provider.mock.callCount(), 3);
  } finally { provider.mock.restore(); }
});


test("4096-token exhaustion reports reasoning and visible usage without raising limits or retrying", async () => {
  const original = process.env.OPENROUTER_SCRIPT_MAX_TOKENS;
  process.env.OPENROUTER_SCRIPT_MAX_TOKENS = "4096";
  const provider = mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.max_tokens, 4096); assert.deepEqual(body.reasoning, { enabled: false });
    return new Response(JSON.stringify({ model: "example/free-reasoner", choices: [{ finish_reason: "length", message: { content: null } }], usage: { completion_tokens: 4096, completion_tokens_details: { reasoning_tokens: 4096 } } }));
  });
  try {
    await assert.rejects(generateJson(z.object({}), {}, "JSON"), /completion_tokens=4096; reasoning_tokens=4096; visible_bytes=0/);
    assert.equal(provider.mock.callCount(), 1);
    provider.mock.mockImplementation(async () => new Response("Unsupported reasoning control", { status: 400 }));
    await assert.rejects(generateJson(z.object({}), {}, "JSON"), /HTTP 400/);
    assert.equal(provider.mock.callCount(), 2); // no dropped parameter, changed model or local fallback
  } finally {
    if (original === undefined) delete process.env.OPENROUTER_SCRIPT_MAX_TOKENS; else process.env.OPENROUTER_SCRIPT_MAX_TOKENS = original;
    provider.mock.restore();
  }
});
