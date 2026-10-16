import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { visualActionSchema, compileActions, generateVisualActions, type VisualAction } from "./visual-actions";
import { actionCatalog, ACTION_EVIDENCE } from "./action-catalog";
import { buildStoryboard } from "./storyboard";
import { validateModelVisualPlan, modelSpecifications } from "./model-visual-plan";
import { prepareRender } from "./render-plan";
import { GraphVisual } from "./remotion/GraphVisual";
import { recordRepresentations } from "./visual-graph";
import { explain } from "./explain-pipeline";
import { renderStoryboard } from "./render-service";
import { parseExplainArgs } from "./explain-options";
import type { InferenceDiagnostic } from "./ollama";

const source = JSON.parse(readFileSync("app/api/video_gen/fixtures/regressions/xml-json-overview071.json", "utf8")).script;
const board = buildStoryboard(source);
const actions: VisualAction[] = board.scenes.map((s, i) => ({ sceneId: s.id, action: "format_comparison", exampleId: "record-001", focus: i === 0 ? "structure" : "fields" }));
const envelope = (data: unknown) => new Response(JSON.stringify({ done: true, message: { content: JSON.stringify(data) } }));

test("compact strict action union rejects unknown actions, fields, mechanics and references", () => {
  assert.doesNotThrow(() => visualActionSchema.parse(actions[0]));
  for (const bad of [{ ...actions[0], action: "run_code" }, { ...actions[0], graph: {} }, { ...actions[0], start: 0 }, { ...actions[0], exampleId: "invented" }, { ...actions[0], focus: "load_path" }]) assert.equal(visualActionSchema.safeParse(bad).success, false);
  assert.throws(() => compileActions(actions.slice(1), board, false), /scene IDs/);
  assert.throws(() => compileActions([], board), /one action/);
  assert.equal(parseExplainArgs(["--resume", "request.json", "--replan", "--visual-actions"]).visualActions, true);
  assert.equal(parseExplainArgs(["Explain XML and JSON"]).visualActions, undefined);
});

test("one source-excerpt record compiles deterministically to equivalent inert XML/JSON with paired highlights", () => {
  const catalog = actionCatalog(board);
  assert.equal(catalog.sourceSceneId, "scene-002"); assert.equal(catalog.example.name, "book");
  assert.deepEqual(catalog.example.fields.map(({ key, value }) => ({ key, value })), [{ key: "title", value: "Harry Potter" }]);
  const before = JSON.stringify(board), plan = compileActions(actions, board);
  assert.deepEqual(plan, compileActions(actions, board)); assert.equal(JSON.stringify(board), before);
  // The opt-in illustrative context never grants exceptions to the legacy path.
  assert.throws(() => validateModelVisualPlan(plan, board), /evidence/);
  assert.doesNotThrow(() => validateModelVisualPlan(plan, board, ACTION_EVIDENCE));
  for (const entry of plan.scenes) {
    const v = entry.visual; if (v.renderer !== "graph") assert.fail();
    assert.deepEqual(v.graph.example, catalog.example); assert.equal(v.graph.edges.length, 0);
    const formats = recordRepresentations(v.graph.example!);
    assert.deepEqual(JSON.parse(formats.json), { title: "Harry Potter" }); assert.match(formats.xml, /<title>Harry Potter<\/title>/);
    const markup = (frame: number) => renderToStaticMarkup(React.createElement(GraphVisual, { visual: v, frame, fps: 15, scale: 1, durationInFrames: 151 }));
    assert.match(markup(90), /data-emphasis="active"/); assert.doesNotMatch(markup(130), /data-emphasis="active"/);
    assert.match(markup(90), /&lt;book&gt;/); assert.ok(!markup(90).includes("<book>"));
    assert.ok(!markup(90).includes("bridge"));
  }
  const forged = structuredClone(plan); const forgedVisual = forged.scenes[0].visual;
  if (forgedVisual.renderer === "graph") forgedVisual.graph.example!.fields[0].value = "Invented";
  assert.throws(() => validateModelVisualPlan(forged, board, ACTION_EVIDENCE), /code-owned catalogue/);
  const rendered = prepareRender(board, {}, modelSpecifications(plan), ACTION_EVIDENCE);
  assert.deepEqual(rendered.frames.map(f => f.id), board.scenes.map(s => s.id));
  assert.ok(rendered.frames.every((f, i) => f.from === rendered.frames.slice(0, i).reduce((n, x) => n + x.durationInFrames, 0)));
});

test("missing example uses explicit illustrative data; missing concept evidence or unrelated comparison fails", () => {
  const noExample = buildStoryboard({ ...source, scenes: source.scenes.map(() => ({ narration: "XML and JSON can represent data.", visualDirection: "Compare structure." })) });
  const catalog = actionCatalog(noExample); assert.equal(catalog.provenance, "illustrative");
  assert.match(compileActions(actions, noExample).scenes[0].visual.note, /not source data/);
  const other = buildStoryboard({ ...source, title: "Uncertain concepts", scenes: source.scenes.map(() => ({ narration: "Quorums describe agreement.", visualDirection: "Introduce the concept." })) });
  assert.throws(() => compileActions(actions, other), /XML and JSON/);
  const overview: VisualAction[] = other.scenes.map(s => ({ sceneId: s.id, action: "concept_overview", labels: [{ text: "Quorums", evidence: "Quorums describe agreement." }] }));
  const plan = compileActions(overview, other); assert.ok(plan.scenes.every(s => s.confidence === "overview" && s.visual.note === "Conceptual overview"));
  const invalid = structuredClone(overview); if (invalid[0].action === "concept_overview") invalid[0].labels[0].evidence = "Invented facts.";
  assert.throws(() => compileActions(invalid, other), /unsupported overview/);
});

test("saved script requires explicit planner switch/replan, checkpoints action failures, resumes and publishes once", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "actions-resume-")), receipt = path.join(root, "old.json"), output = path.join(root, "final.mp4");
  const raw = JSON.stringify({ version: 1, request: { topic: "Compare XML and JSON", durationSeconds: 45, targetAudience: "Beginners" }, script: source, model: "qwen2.5:3b", generatedAt: new Date().toISOString(), output });
  writeFileSync(receipt, raw);
  const ids: string[] = []; let fail = true, active = 0, peak = 0;
  const provider = mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    active++; peak = Math.max(peak, active);
    const body = JSON.parse(String(init?.body)), input = JSON.parse(body.messages[1].content);
    assert.equal(input.narration, board.scenes[Number(input.sceneId.slice(-3)) - 1].narration);
    assert.equal(body.options.num_predict, 384); assert.ok(!JSON.stringify(body.format).includes('"renderer"'));
    ids.push(input.sceneId); await new Promise(resolve => setTimeout(resolve, 1)); active--;
    return envelope(fail && input.sceneId === "scene-002" ? { sceneId: input.sceneId, action: "unknown" } : actions[Number(input.sceneId.slice(-3)) - 1]);
  });
  const deps = { requestsDirectory: path.join(root, "requests"), render: ((b, opts, specs, file, provenance, _encoder, browser, context) => renderStoryboard(b, opts, specs, file, provenance, async (_p, tmp) => { writeFileSync(tmp, "mock encoder; not a video"); }, browser, context)) as typeof renderStoryboard };
  try {
    await assert.rejects(explain({ resume: receipt, visualActions: true, inspect: true }, deps), /requires.*--replan/);
    assert.equal(ids.length, 0);
    await assert.rejects(explain({ resume: receipt, visualActions: true, replan: true, inspect: true }, deps), /scene-002/);
    assert.equal(readFileSync(receipt, "utf8"), raw);
    const { readdirSync } = await import("node:fs");
    const fork = path.join(deps.requestsDirectory, readdirSync(deps.requestsDirectory)[0], "request.json");
    const checkpoint = JSON.parse(readFileSync(fork, "utf8"));
    assert.equal(checkpoint.completedActions.length, 1); assert.deepEqual(checkpoint.script, source); assert.ok(!existsSync(output));
    fail = false;
    const inspected = await explain({ resume: fork, inspect: true }, deps);
    assert.equal(peak, 1); assert.deepEqual(ids, ["scene-001", "scene-002", "scene-002", "scene-002", "scene-003"]);
    assert.ok("visualActions" in inspected); assert.ok(!existsSync(output));
    await explain({ resume: fork }, deps); assert.equal(ids.length, 5);
    const metadata = JSON.parse(readFileSync(output + ".json", "utf8"));
    assert.deepEqual(metadata.provenance.originalScript, source); assert.deepEqual(metadata.provenance.visualActions, actions);
    assert.equal(metadata.provenance.exampleCatalog.provenance, "source-excerpt");
    await assert.rejects(explain({ resume: fork }, deps), /already exists/); assert.equal(ids.length, 5);
  } finally { provider.mock.restore(); rmSync(root, { recursive: true, force: true }); }
});

test("opt-in action mode retains duration approval before any planning or publication", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "actions-duration-")), receipt = path.join(root, "request.json"), output = path.join(root, "final.mp4");
  const long = { ...source, scenes: source.scenes.map(() => ({ narration: Array(18).fill("XML and JSON represent data.").join(" "), visualDirection: "Compare." })) };
  writeFileSync(receipt, JSON.stringify({ version: 1, planner: "actions-v1", request: { topic: "XML vs JSON", durationSeconds: 45, targetAudience: "Beginners" }, script: long, model: "qwen2.5:3b", generatedAt: new Date().toISOString(), output }));
  const provider = mock.method(globalThis, "fetch", async () => assert.fail("guard must precede inference"));
  try { await assert.rejects(explain({ resume: receipt, inspect: true }), /DURATION_APPROVAL_REQUIRED/); assert.equal(provider.mock.callCount(), 0); assert.ok(!existsSync(output)); }
  finally { provider.mock.restore(); rmSync(root, { recursive: true, force: true }); }
});

test("action planning reports semantic failures and bounded attempts separately from raw JSON parsing", async () => {
  const events: InferenceDiagnostic[] = []; let count = 0;
  const provider = mock.method(globalThis, "fetch", async () => { count++; return envelope({ sceneId: "scene-999", action: "format_comparison", exampleId: "record-001", focus: "fields" }); });
  try { await assert.rejects(generateVisualActions(board, { onDiagnostic: e => events.push(e) }), /scene IDs/); assert.equal(count, 2); assert.deepEqual(events.map(e => e.status), ["validation_failed", "validation_failed"]); }
  finally { provider.mock.restore(); }
});
