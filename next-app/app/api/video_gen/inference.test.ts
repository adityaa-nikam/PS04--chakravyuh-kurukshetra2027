// Historical transport regressions explicitly use Ollama; production defaults to OpenRouter.
process.env.VIDEO_GEN_PROVIDER = "ollama";
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateOllamaJson, type InferenceDiagnostic, type OutputReport, redactDiagnostics } from "./ollama";
import { scriptBudget, validateScriptQuality } from "./script-quality";
import { generateExplainerScript } from "./script-generator";
import { generateModelVisualPlan, modelVisualPlanSchema, validateVisualPrefix, type PlanningAttempt, sceneOutputSchema, repairOverview } from "./model-visual-plan";
import { buildStoryboard } from "./storyboard";
import { type ExplainerScript } from "./schema";
import { explain } from "./explain-pipeline";

const envelope = (data: unknown, metrics = {}) => new Response(JSON.stringify({ done: true, message: { content: JSON.stringify(data) }, ...metrics }));
const source: ExplainerScript = { title: "JSON versus XML", targetAudience: "Beginners", estimatedDurationSeconds: 45, scenes: [
  { narration: "JSON and XML represent structured data for exchanging information.", visualDirection: "Introduce both formats." },
  { narration: "For an illustrative example, JSON and XML represent person with name Ana. Both formats carry the same field and value.", visualDirection: "Compare the same example." },
  { narration: "Choose JSON for compact records or XML when a document needs tags and attributes.", visualDirection: "Highlight the tradeoff." },
] };
function overview(i: number) {
  const sceneId = `scene-00${i + 1}`, narration = source.scenes[i].narration;
  return modelVisualPlanSchema.shape.scenes.element.parse({ sceneId, purpose: i === 0 ? "hook" : i === 2 ? "summary" : "example", explanation: "Introduce source formats.", confidence: "overview", visual: { sceneId, renderer: "graph", mode: "overview", concept: "diagram", heading: "Data formats", labels: ["JSON", "XML"], note: "Conceptual overview", graph: { topic: "general", layout: "overview", nodes: ["JSON", "XML"].map(label => ({ id: label.toLowerCase(), label, icon: "document", evidence: narration })), edges: [], values: [], actions: [{ kind: "reveal", target: "json", start: 0, end: 0.15 }, { kind: "reveal", target: "xml", start: 0.2, end: 0.35 }] } } });
}

test("duration-derived budgets scale to 120 seconds and reject excess and repetition without mutation", async () => {
  assert.ok(scriptBudget(120).totalWords > scriptBudget(45).totalWords * 2);
  assert.equal(scriptBudget(15).scenes.length, 3); assert.equal(scriptBudget(120).scenes.length, 5);
  assert.doesNotThrow(() => validateScriptQuality(source, 45));
  const bad = structuredClone(source); bad.scenes[1].narration = Array(90).fill("word").join(" ");
  const before = JSON.stringify(bad);
  assert.throws(() => validateScriptQuality(bad, 45), /exceeds/); assert.equal(JSON.stringify(bad), before);
  const repeated = structuredClone(source);
  repeated.scenes[1].narration = repeated.scenes[2].narration = "JSON and XML carry the same structured record with a name field and an illustrative value called Ana.";
  assert.throws(() => validateScriptQuality(repeated, 45), /Repeated/);
  const shortRepeat = structuredClone(source);
  shortRepeat.scenes[2].narration = shortRepeat.scenes[0].narration;
  assert.throws(() => validateScriptQuality(shortRepeat, 45), /Repeated/);
  const incident = JSON.parse(readFileSync("app/api/video_gen/fixtures/regressions/xml-json-bridge.json", "utf8"));
  assert.throws(() => validateScriptQuality(incident.script, 45), /exceeds/);
  const provider = mock.method(globalThis, "fetch", async () => envelope(bad));
  try { await assert.rejects(generateExplainerScript({ topic: "Compare formats" }, { live: true }), /SCRIPT_QUALITY/); assert.equal(provider.mock.callCount(), 1); }
  finally { provider.mock.restore(); }
});

test("transport bounds retries and records sizes/tokens/timings without prompt contents", async () => {
  const events: InferenceDiagnostic[] = []; let calls = 0;
  const provider = mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.options.num_ctx, 4096); assert.equal(body.options.num_predict, 512);
    assert.equal(body.stream, false); assert.equal(body.truncate, false); assert.equal(body.keep_alive, "1m");
    if (++calls === 1) return new Response("busy", { status: 503 });
    return envelope({ ok: true }, { eval_count: 5, prompt_eval_count: 42, load_duration: 2e6, prompt_eval_duration: 3e6, eval_duration: 4e6 });
  });
  try {
    assert.deepEqual(await generateOllamaJson(z.object({ ok: z.boolean() }), { secret: "private text" }, "system", 512, { stage: "visual", sceneId: "scene-001", onDiagnostic: e => events.push(e) }), { ok: true });
    assert.equal(calls, 2); assert.deepEqual(events.map(e => e.status), ["retry", "success"]);
    assert.equal(events[1].outputTokens, 5); assert.equal(events[1].loadMs, 2); assert.equal(events[1].evalMs, 4);
    assert.ok(events[1].inputBytes > 0 && events[1].schemaBytes > 0 && events[1].outputBytes! > 0);
    assert.ok(!JSON.stringify(events).includes("private text"));
    provider.mock.mockImplementation(async () => new Response("busy", { status: 429 }));
    const before = provider.mock.callCount();
    await assert.rejects(generateOllamaJson(z.object({}), {}, "data", 512), /HTTP 429/);
    assert.equal(provider.mock.callCount() - before, 2);
    provider.mock.mockImplementation(async () => { throw new TypeError("refused"); });
    const networkBefore = provider.mock.callCount();
    await assert.rejects(generateOllamaJson(z.object({}), {}, "data", 512), /existing local server/);
    assert.equal(provider.mock.callCount() - networkBefore, 2);
  } finally { provider.mock.restore(); }
});

test("malformed, truncated, and timed-out responses fail once; invalid config/context makes no request", async () => {
  const provider = mock.method(globalThis, "fetch", async () => new Response('{"done":true,"message":{"content":"not JSON"}}'));
  try {
    await assert.rejects(generateOllamaJson(z.object({}), {}, "data"), /malformed/); assert.equal(provider.mock.callCount(), 1);
    provider.mock.mockImplementation(async () => envelope({}, { done_reason: "length" }));
    await assert.rejects(generateOllamaJson(z.object({}), {}, "data"), /output-token limit/); assert.equal(provider.mock.callCount(), 2);
    const timer = mock.method(AbortSignal, "timeout", () => AbortSignal.abort());
    try {
      provider.mock.mockImplementation(async () => { throw new Error("aborted"); });
      const events: InferenceDiagnostic[] = [];
      await assert.rejects(generateOllamaJson(z.object({}), {}, "data", 512, { stage: "visual", sceneId: "scene-002", onDiagnostic: e => events.push(e) }), /visual scene-002.*timed out/);
      assert.equal(events.length, 1); assert.equal(events[0].reason, "PROVIDER_TIMEOUT"); assert.equal(provider.mock.callCount(), 3);
    } finally { timer.mock.restore(); }
    await assert.rejects(generateOllamaJson(z.object({}), {}, "x".repeat(20000)), /CONTEXT|exceeds/);
    assert.equal(provider.mock.callCount(), 3);
    const prior = process.env.OLLAMA_NUM_CTX; process.env.OLLAMA_NUM_CTX = "bogus";
    try { await assert.rejects(generateOllamaJson(z.object({}), {}, "data"), /OLLAMA_NUM_CTX/); }
    finally { if (prior === undefined) delete process.env.OLLAMA_NUM_CTX; else process.env.OLLAMA_NUM_CTX = prior; }
  } finally { provider.mock.restore(); }
});

test("process-wide inference lane serializes independent callers and releases after failure", async () => {
  let active = 0, peak = 0, calls = 0;
  const provider = mock.method(globalThis, "fetch", async () => {
    active++; peak = Math.max(peak, active); calls++;
    await new Promise(resolve => setTimeout(resolve, 5)); active--;
    return calls === 1 ? envelope({ bad: true }) : envelope({ ok: true });
  });
  try {
    const results = await Promise.allSettled([generateOllamaJson(z.object({ ok: z.boolean() }), {}, "data"), generateOllamaJson(z.object({ ok: z.boolean() }), {}, "data")]);
    assert.deepEqual(results.map(r => r.status), ["rejected", "fulfilled"]); assert.equal(peak, 1);
  } finally { provider.mock.restore(); }
});

test("scene planning consumes only local source, preserves order, checkpoints and resumes after scene failure", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "inference-recovery-"));
  let fail = true; const ids: string[] = [];
  const provider = mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)), input = JSON.parse(body.messages[1].content);
    const i = Number(input.sceneId.slice(-3)) - 1;
    ids.push(input.sceneId);
    assert.equal(input.narration, source.scenes[i].narration); assert.equal(input.targetAudience, source.targetAudience);
    assert.equal(input.scenes, undefined); assert.equal(body.options.num_predict, 1536);
    assert.ok(!JSON.stringify(body.format).includes('"const":"bridge"'));
    return fail && i === 1 ? envelope({ invalid: true }) : envelope(overview(i));
  });
  const receipt = path.join(root, "request.json"), output = path.join(root, "fresh/final.mp4");
  writeFileSync(receipt, JSON.stringify({ version: 1, request: { topic: "Compare XML and JSON", durationSeconds: 45, targetAudience: "Beginners" }, script: source, model: "qwen2.5:3b", generatedAt: new Date().toISOString(), output }));
  try {
    await assert.rejects(explain({ resume: receipt, inspect: true }), /scene-002/);
    const failed = JSON.parse(readFileSync(receipt, "utf8"));
    assert.equal(failed.completedScenes.length, 1); assert.ok(failed.planningFailure.includes("scene-002"));
    assert.equal(failed.inferenceDiagnostics.length, 3);
    assert.deepEqual(failed.script, source); assert.ok(!existsSync(output)); assert.ok(!existsSync(output + ".json"));
    fail = false;
    const report = await explain({ resume: receipt, inspect: true });
    assert.deepEqual(ids, ["scene-001", "scene-002", "scene-002", "scene-002", "scene-003"]);
    assert.ok("modelVisualPlan" in report); assert.equal(report.inferenceDiagnostics.length, 5);
    const complete = JSON.parse(readFileSync(receipt, "utf8"));
    assert.deepEqual(complete.visualPlan.scenes.map((s: { sceneId: string }) => s.sceneId), ["scene-001", "scene-002", "scene-003"]);
    assert.deepEqual(complete.script, source);
    await explain({ resume: receipt, inspect: true }); assert.equal(ids.length, 5);
    const wrong = overview(0); wrong.visual.sceneId = "scene-002";
    assert.throws(() => validateVisualPrefix([wrong], buildStoryboard(source)), /IDs/);
    assert.equal((await generateModelVisualPlan(buildStoryboard(source), { completed: complete.visualPlan.scenes })).scenes.length, 3);
    assert.equal(ids.length, 5);
    const stale = overview(0); if (stale.visual.renderer === "graph") stale.visual.graph.nodes[0].evidence = "An unrelated story";
    assert.throws(() => validateVisualPrefix([stale], buildStoryboard(source)), /evidence/);
  } finally { provider.mock.restore(); rmSync(root, { recursive: true, force: true }); }
});


test("overview supported-confidence failure is repaired only after full evidence validation, without a retry", async () => {
  const raw = overview(0); raw.confidence = "supported"; raw.visual.note = "Data formats";
  assert.throws(() => validateVisualPrefix([raw], buildStoryboard(source)), /confidence must be "overview"/);
  const original = structuredClone(raw), events: InferenceDiagnostic[] = [], attempts: PlanningAttempt[] = [];
  const provider = mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const input = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
    return envelope(input.sceneId === "scene-001" ? raw : overview(Number(input.sceneId.slice(-3)) - 1));
  });
  try {
    const plan = await generateModelVisualPlan(buildStoryboard(source), { onDiagnostic: e => events.push(e), onAttempt: a => attempts.push(a) });
    assert.equal(provider.mock.callCount(), 3);
    assert.equal(plan.scenes[0].confidence, "overview"); assert.equal(plan.scenes[0].visual.note, "Conceptual overview");
    assert.deepEqual(raw, original); assert.deepEqual(attempts[0].candidate, raw);
    assert.equal(events[0].status, "repaired"); assert.equal(events[0].planningAttempt, 1);
    assert.deepEqual(attempts[0].resolved, plan.scenes[0]);
    const wrongEvidence = overview(0); wrongEvidence.confidence = "supported";
    if (wrongEvidence.visual.renderer === "graph") wrongEvidence.visual.graph.nodes[0].evidence = "Not in this source";
    const { repairOverview } = await import("./model-visual-plan");
    assert.equal(repairOverview(wrongEvidence, [], buildStoryboard(source)), undefined);
    const edges = overview(0); edges.confidence = "supported";
    if (edges.visual.renderer === "graph") edges.visual.graph.edges.push({ from: "json", to: "xml", meaning: "cause", evidence: source.scenes[0].narration });
    assert.equal(repairOverview(edges, [], buildStoryboard(source)), undefined);
  } finally { provider.mock.restore(); }
});

test("one concise corrective retry targets only the failed scene and preserves inference limits", async () => {
  const ids: string[] = [], events: InferenceDiagnostic[] = [], attempts: PlanningAttempt[] = [];
  let failed = false;
  const provider = mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)), input = JSON.parse(body.messages[1].content);
    const i = Number(input.sceneId.slice(-3)) - 1;
    ids.push(input.sceneId);
    assert.equal(body.options.num_ctx, 4096); assert.equal(body.options.num_predict, 1536);
    if (i === 1 && !failed) {
      failed = true; const invalid = overview(i);
      if (invalid.visual.renderer === "graph") invalid.visual.graph.nodes[0].evidence = "Unsupported source";
      return envelope(invalid);
    }
    if (i === 1) { assert.match(input.correction, /unsupported label\/evidence/); assert.ok(input.correction.length < 1100); }
    else assert.equal(input.correction, undefined);
    return envelope(overview(i));
  });
  try {
    const result = await generateModelVisualPlan(buildStoryboard(source), { onDiagnostic: e => events.push(e), onAttempt: a => attempts.push(a) });
    assert.deepEqual(ids, ["scene-001", "scene-002", "scene-002", "scene-003"]);
    assert.deepEqual(events.map(e => e.planningAttempt), [1, 1, 2, 1]);
    assert.deepEqual(events.map(e => e.status), ["success", "validation_failed", "success", "success"]);
    assert.deepEqual(result.scenes.map(s => s.sceneId), ["scene-001", "scene-002", "scene-003"]);
    assert.equal(attempts[1].status, "validation_failed");
  } finally { provider.mock.restore(); }
});

test("persistent semantic failure saves rejected candidates, precise fields and checkpoint for resume", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "overview-checkpoint-"));
  const receipt = path.join(root, "request.json"), output = path.join(root, "final.mp4");
  writeFileSync(receipt, JSON.stringify({ version: 1, request: { topic: "XML versus JSON", durationSeconds: 45, targetAudience: "Beginners" }, script: source, model: "qwen2.5:3b", generatedAt: new Date().toISOString(), output }));
  const ids: string[] = []; let fail = true;
  const provider = mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const input = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
    ids.push(input.sceneId); const i = Number(input.sceneId.slice(-3)) - 1, entry = overview(i);
    if (fail && i === 1 && entry.visual.renderer === "graph") {
      entry.confidence = "supported";
      entry.visual.graph.edges.push({ from: "json", to: "xml", meaning: "cause", evidence: source.scenes[i].narration });
    }
    return envelope(entry);
  });
  try {
    await assert.rejects(explain({ resume: receipt, inspect: true }), /scene-002.*2 planning attempts.*confidence/);
    const saved = JSON.parse(readFileSync(receipt, "utf8"));
    const artifacts = readdirSync(path.join(root, "diagnostics"), { recursive: true }).map(String);
    assert.ok(artifacts.some(f => f.endsWith("response.json")));
    assert.ok(artifacts.some(f => f.endsWith("validation.json")));
    assert.equal(saved.completedScenes.length, 1); assert.equal(saved.visualAttempts.length, 3);
    assert.equal(saved.visualAttempts[2].candidate.confidence, "supported");
    assert.equal(saved.visualAttempts[2].planningAttempt, 2);
    assert.equal(saved.inferenceDiagnostics[2].status, "validation_failed");
    assert.match(saved.planningFailure, /visual.graph.layout/);
    assert.deepEqual(saved.script, source); assert.ok(!existsSync(output)); assert.ok(!existsSync(output + ".json"));
    fail = false;
    await explain({ resume: receipt, inspect: true });
    assert.deepEqual(ids, ["scene-001", "scene-002", "scene-002", "scene-002", "scene-003"]);
    const resumed = JSON.parse(readFileSync(receipt, "utf8"));
    assert.deepEqual(resumed.script, source); assert.equal(resumed.visualPlan.scenes.length, 3);
    assert.equal(resumed.planningFailure, undefined); assert.equal(resumed.visualAttempts.length, 5);
  } finally { provider.mock.restore(); rmSync(root, { recursive: true, force: true }); }
});


test("missing confidence gets one corrective attempt with the exact field path, never a guessed default", async () => {
  const events: InferenceDiagnostic[] = [], attempts: PlanningAttempt[] = [];
  const provider = mock.method(globalThis, "fetch", async () => {
    const raw: Record<string, unknown> = { ...overview(0) }; delete raw.confidence;
    return envelope(raw);
  });
  try {
    await assert.rejects(generateModelVisualPlan(buildStoryboard(source), { onDiagnostic: e => events.push(e), onAttempt: a => attempts.push(a) }), /scene-001.*2 planning attempts.*Invalid fields: confidence/);
    assert.equal(provider.mock.callCount(), 2);
    assert.deepEqual(events.map(e => e.planningAttempt), [1, 2]);
    assert.deepEqual(events.map(e => e.reason), ["INVALID_OUTPUT", "INVALID_OUTPUT"]);
    assert.equal(attempts.length, 2); assert.equal(attempts[0].candidate, undefined);
  } finally { provider.mock.restore(); }
});


test("raw response diagnostics distinguish malformed JSON from unsupported fields using the exact sent schema", async () => {
  const reports: OutputReport[] = [];
  const schema = z.strictObject({ value: z.string() });
  let malformed = false;
  const provider = mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.format, z.toJSONSchema(schema, { io: "input" }));
    return new Response(JSON.stringify({ done: true, message: { content: malformed ? '{"value":' : '{"value":"ok","extra":true}' } }));
  });
  try {
    await assert.rejects(generateOllamaJson(schema, {}, "data", 512, { onResponse: r => reports.push(r) }), /Failure phase: structure/);
    assert.equal(reports[0].phase, "structure"); assert.equal(reports[0].rawOutput, '{"value":"ok","extra":true}');
    const issues = reports[0].issues as { code: string; keys: string[] }[];
    assert.equal(issues[0].code, "unrecognized_keys"); assert.deepEqual(issues[0].keys, ["extra"]);
    malformed = true;
    await assert.rejects(generateOllamaJson(schema, {}, "data", 512, { onResponse: r => reports.push(r) }), /Failure phase: json_syntax/);
    assert.equal(reports[1].rawOutput, '{"value":'); assert.ok(reports[1].parserMessage); assert.equal(reports[1].issues, undefined);
    assert.equal(provider.mock.callCount(), 2);
    const redacted = JSON.stringify(redactDiagnostics({ rawOutput: '{"password":"very-private","api_key":"another-private"}', secret: "hidden" }));
    assert.ok(!redacted.includes("very-private")); assert.ok(!redacted.includes("another-private")); assert.ok(!redacted.includes("hidden"));
  } finally { provider.mock.restore(); }
});

test("graph custom constraints are semantic, remain enforced, and correction contains their exact issue", async () => {
  const reports: OutputReport[] = [], attempts: PlanningAttempt[] = [];
  let calls = 0;
  const provider = mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)), input = JSON.parse(body.messages[1].content);
    const i = Number(input.sceneId.slice(-3)) - 1;
    assert.deepEqual(body.format, z.toJSONSchema(sceneOutputSchema(buildStoryboard(source), buildStoryboard(source).scenes[i]), { io: "input" }));
    const entry = overview(i);
    if (calls++ === 0 && entry.visual.renderer === "graph") {
      entry.visual.graph.actions.push({ kind: "highlight", target: "nonexistent", start: 0, end: 1 });
    }
    if (input.correction) assert.match(input.correction, /Animation target must exist/);
    return envelope(entry);
  });
  try {
    const plan = await generateModelVisualPlan(buildStoryboard(source), { onResponse: r => reports.push(r), onAttempt: a => attempts.push(a) });
    assert.equal(plan.scenes.length, 3); assert.equal(calls, 4);
    assert.equal(reports[0].phase, "parsed");
    assert.equal(attempts[0].phase, "semantic");
    const issues = attempts[0].issues as { code: string; message: string; path: string[] }[];
    assert.equal(issues[0].code, "custom"); assert.match(issues[0].message, /Animation target/);
    assert.ok(issues[0].path.includes("graph"));
  } finally { provider.mock.restore(); }
});


test("saved live 07.1 candidate fails exact uncertainty fields and contains unsupported evidence", () => {
  const incident = JSON.parse(readFileSync("app/api/video_gen/fixtures/regressions/xml-json-overview071.json", "utf8"));
  const board = buildStoryboard(incident.script), candidate = incident.candidate;
  assert.doesNotThrow(() => sceneOutputSchema(board, board.scenes[0]).parse(candidate));
  assert.throws(() => validateVisualPrefix([candidate], board), /visual.graph.layout must equal "overview"; visual.graph.edges must be empty/);
  assert.equal(repairOverview(candidate, [], board), undefined);
  const changed = structuredClone(candidate); changed.confidence = "supported";
  assert.throws(() => validateVisualPrefix([changed], board), /unsupported label\/evidence/);
});
