import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildStoryboard } from "./storyboard";
import { type ExplainerScript } from "./schema";
import { validateModelVisualPlan, modelVisualPlanSchema, generateModelVisualPlan, modelSpecifications } from "./model-visual-plan";
import { graphSchema, graphActionSchema, plannedMotion, recordRepresentations } from "./visual-graph";
import { explain, PendingExplanation } from "./explain-pipeline";
import { parseExplainArgs } from "./explain-options";
import { renderStoryboard, type VideoEncoder } from "./render-service";
import { prepareRender } from "./render-plan";
import { generateExplainerScript } from "./script-generator";
import { generateOllamaJson } from "./ollama";
import { z } from "zod";
import "./cli-environment";

function script(text?: string): ExplainerScript {
  return { title: "Representing data", targetAudience: "Beginners", estimatedDurationSeconds: 45,
    scenes: [
      "JSON and XML can both represent person with name Ana.",
      "For example, person has name Ana, expressed using JSON or XML.",
      "Choose JSON or XML for person with name Ana according to context.",
    ].map(narration => ({ narration: text ?? narration, visualDirection: "Show the named components." })) };
}
function planFor(source: ExplainerScript) {
  const board = buildStoryboard(source);
  return modelVisualPlanSchema.parse({ scenes: board.scenes.map((s, i) => ({
    sceneId: s.id, purpose: i === 0 ? "hook" : i === 2 ? "summary" : "example", explanation: "Compare equivalent record representations.", confidence: "supported",
    visual: { sceneId: s.id, concept: i === 0 ? "hook" : i === 2 ? "summary" : "comparison", renderer: "graph", mode: "overview", heading: "Same data. Two formats.", labels: ["JSON", "XML"], note: "Illustrative record from the explanation",
      graph: { topic: "general", layout: "comparison", nodes: ["JSON", "XML"].map(label => ({ id: label.toLowerCase(), label, icon: "document", role: "item", evidence: s.narration })), edges: [], values: [],
        example: { name: "person", evidence: s.narration, fields: [{ key: "name", value: "Ana", evidence: s.narration }] },
        actions: [{ kind: "reveal", target: "json", start: 0, end: 0.15 }, { kind: "reveal", target: "xml", start: 0.15, end: 0.3 }, { kind: "highlight", target: "xml", start: 0.3, end: 0.5 }] } },
  })) });
}
const envelope = (data: unknown) => new Response(JSON.stringify({ done: true, message: { content: JSON.stringify(data) } }));
const fakeEncoder: VideoEncoder = async (_plan, file) => { writeFileSync(file, "mock encoded video - not an MP4"); };

test("model visual schema and source validation cover XML/JSON records, actions and malformed plans", () => {
  const source = script(), board = buildStoryboard(source), input = planFor(source);
  const valid = validateModelVisualPlan(input, board);
  const graph = valid.scenes[0].visual;
  assert.equal(graph.renderer, "graph"); if (graph.renderer !== "graph") return;
  const examples = recordRepresentations(graph.graph.example!);
  assert.deepEqual(JSON.parse(examples.json), { name: "Ana" });
  assert.ok(examples.xml.includes("<name>Ana</name>"));
  assert.throws(() => validateModelVisualPlan({ scenes: [] }, board));
  assert.throws(() => validateModelVisualPlan({ scenes: [...input.scenes].reverse() }, board), /order/);
  const bad = structuredClone(input); const first = bad.scenes[0].visual;
  if (first.renderer === "graph") first.graph.example!.fields[0].value = "Invented";
  assert.throws(() => validateModelVisualPlan(bad, board), /evidence/);
  assert.throws(() => graphActionSchema.parse({ kind: "eval", target: "json", start: 0, end: 1 }));
  assert.throws(() => graphActionSchema.parse({ kind: "reveal", target: "json", start: 0.8, end: 0.2 }));
  assert.throws(() => graphSchema.parse({ ...graph.graph, actions: [{ kind: "transfer", target: "json", start: 0, end: 1 }] }));
  assert.throws(() => modelVisualPlanSchema.parse({ ...input, javascript: "alert(1)" }));
  assert.doesNotThrow(() => z.toJSONSchema(modelVisualPlanSchema));
});

test("HTTP request and response use the same general schema with ordered declarative transfers", async () => {
  const source = script("Browser sends request to Server. Server sends response to Browser.");
  const board = buildStoryboard(source);
  const raw = planFor(script());
  for (const e of raw.scenes) {
    e.visual = { sceneId: e.sceneId, concept: "process", renderer: "graph", mode: "overview", heading: "Request, then response", labels: ["Browser", "Server"], note: "Ordered message transfer", graph: graphSchema.parse({
      topic: "general", layout: "sequence", nodes: ["Browser", "Server"].map(label => ({ id: label.toLowerCase(), label, icon: label.toLowerCase(), evidence: source.scenes[0].narration })),
      edges: [{ from: "browser", to: "server", meaning: "input", evidence: "Browser sends request to Server." }, { from: "server", to: "browser", meaning: "output", evidence: "Server sends response to Browser." }],
      actions: [{ kind: "reveal", target: "browser", start: 0, end: 0.1 }, { kind: "reveal", target: "server", start: 0, end: 0.1 }, { kind: "transfer", target: "browser->server", start: 0.15, end: 0.4 }, { kind: "transfer", target: "server->browser", start: 0.5, end: 0.8 }],
    }) };
  }
  const requestMock = mock.method(globalThis, "fetch", async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, process.env.OLLAMA_MODEL?.trim() || "qwen2.5:3b");
    assert.ok(body.format); assert.equal(body.stream, false);
    assert.ok(body.messages[1].content.includes(source.scenes[0].narration));
    return envelope(raw.scenes.find(e => e.sceneId === JSON.parse(body.messages[1].content).sceneId));
  });
  try {
    const plan = await generateModelVisualPlan(board);
    const visual = plan.scenes[0].visual; if (visual.renderer !== "graph") assert.fail();
    assert.equal(visual.graph.topic, "general");
    const g = visual.graph;
    assert.equal(plannedMotion(g, "server->browser", 30, 101).transfer, -1);
    assert.ok(plannedMotion(g, "browser->server", 30, 101).transfer! > 0);
    assert.ok(plannedMotion(g, "server->browser", 60, 101).transfer! > 0);
    assert.deepEqual(prepareRender(board, {}, modelSpecifications(plan)), prepareRender(board, {}, modelSpecifications(plan)));
  } finally { requestMock.mock.restore(); }
});

test("unfamiliar topic uses model overview without fabricated relationships or values", () => {
  const source = script("Quorums are a way to discuss agreement."), board = buildStoryboard(source), plan = planFor(script());
  for (const e of plan.scenes) {
    e.confidence = "overview";
    e.visual = { sceneId: e.sceneId, concept: "diagram", renderer: "graph", mode: "overview", heading: "Quorums", labels: ["Quorums"], note: "Conceptual overview", graph: graphSchema.parse({ topic: "general", layout: "overview", nodes: [{ id: "quorum", label: "Quorums", icon: "item", evidence: source.scenes[0].narration }], edges: [] }) };
  }
  assert.doesNotThrow(() => validateModelVisualPlan(plan, board));
  const v = plan.scenes[0].visual; if (v.renderer !== "graph") assert.fail();
  v.graph.layout = "sequence";
  assert.throws(() => validateModelVisualPlan(plan, board), /overviews/);
});

test("live generator path bypasses development fixtures; prompt stays user data; malformed provider results fail", async () => {
  const old = { node: process.env.NODE_ENV, fixture: process.env.VIDEO_GEN_USE_FIXTURE };
  process.env.NODE_ENV = "development"; process.env.VIDEO_GEN_USE_FIXTURE = "true";
  const prompt = 'Explain data; $(touch /tmp/never-run) <script>alert(1)</script>';
  const fetchMock = mock.method(globalThis, "fetch", async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(JSON.parse(body.messages[1].content).topic, prompt);
    assert.ok(!body.messages[0].content.includes(prompt));
    return envelope(script());
  });
  try {
    assert.deepEqual(await generateExplainerScript({ topic: prompt }, { live: true, visualPlanning: true }), script());
    assert.equal(fetchMock.mock.callCount(), 1);
    fetchMock.mock.mockImplementation(async () => new Response('{"done":true,"message":{"content":"<script>"}}'));
    await assert.rejects(generateModelVisualPlan(buildStoryboard(script())), /malformed JSON/);
    fetchMock.mock.mockImplementation(async () => envelope({ unexpected: true }));
    await assert.rejects(generateModelVisualPlan(buildStoryboard(script())), /unsupported fields/);
    fetchMock.mock.mockImplementation(async () => { throw new TypeError("connection refused"); });
    await assert.rejects(generateModelVisualPlan(buildStoryboard(script())), /existing local server/);
    fetchMock.mock.mockImplementation(async () => new Response("", { status: 404 }));
    await assert.rejects(generateModelVisualPlan(buildStoryboard(script())), /model or endpoint/);
    const timer = mock.method(AbortSignal, "timeout", () => AbortSignal.abort());
    try {
      fetchMock.mock.mockImplementation(async () => { throw new Error("aborted"); });
      await assert.rejects(generateOllamaJson(z.object({}), {}, "data"), /timed out/);
    } finally { timer.mock.restore(); }
  } finally {
    fetchMock.mock.restore();
    if (old.node === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = old.node;
    if (old.fixture === undefined) delete process.env.VIDEO_GEN_USE_FIXTURE; else process.env.VIDEO_GEN_USE_FIXTURE = old.fixture;
  }
});

test("direct pipeline has one final video/metadata, preserves provenance, and refuses overwrites before inference", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "explain-pipeline-test-"));
  let generation = 0;
  const source = script();
  const render: typeof renderStoryboard = (board, opts, specs, output, provenance) => renderStoryboard(board, opts, specs, output, provenance, fakeEncoder);
  const deps = { requestsDirectory: path.join(root, "requests"), generateScript: async () => { generation++; return source; }, planVisuals: async () => planFor(source), render };
  const output = path.join(root, "videos", "final.mp4");
  try {
    const result = await explain({ prompt: "Explain arbitrary data", output }, deps);
    assert.equal(generation, 1);
    assert.deepEqual(readdirSync(path.dirname(output)).sort(), ["final.mp4", "final.mp4.json"]);
    const metadata = JSON.parse(readFileSync(result.metadata, "utf8"));
    assert.deepEqual(metadata.storyboard.scenes.map((s: { narration: string }) => s.narration), source.scenes.map(s => s.narration));
    assert.deepEqual(metadata.provenance.modelVisualPlan, planFor(source));
    assert.equal(metadata.provenance.factChecked, false);
    await assert.rejects(explain({ prompt: "Explain arbitrary data", output }, deps), /already exists/);
    assert.equal(generation, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("duration rejection persists the exact script, resume needs approval and avoids repeated generation", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "explain-overrun-test-"));
  const source = script(Array(70).fill("JSON and XML represent person with name Ana.").join(" "));
  // The script schema permits this narration length but the estimate exceeds the soft target.
  source.scenes = source.scenes.map(s => ({ ...s, narration: Array(9).fill("JSON and XML represent person with name Ana.").join(" ") }));
  let called = 0, planned = 0;
  const output = path.join(root, "final.mp4");
  const deps = { requestsDirectory: path.join(root, "requests"), generateScript: async () => { called++; return source; }, planVisuals: async () => { planned++; return planFor(source); }, render: ((b, o, s, p, provenance) => renderStoryboard(b, o, s, p, provenance, fakeEncoder)) as typeof renderStoryboard };
  try {
    let receipt = "";
    try { await explain({ prompt: "Explain records", output, width: 960, height: 540, fps: 30 }, deps); assert.fail("must reject overrun"); }
    catch (error) { assert.ok(error instanceof PendingExplanation); receipt = error.receipt; }
    assert.equal(planned, 0); assert.ok(!existsSync(output));
    await assert.rejects(explain({ resume: receipt }, deps), /DURATION_APPROVAL_REQUIRED/);
    await explain({ resume: receipt, approveOverrun: true }, deps);
    assert.equal(called, 1); assert.equal(planned, 1);
    const metadata = JSON.parse(readFileSync(output + ".json", "utf8"));
    assert.deepEqual(metadata.provenance.originalScript, source);
    assert.equal(metadata.settings.approveOverrun, true);
    assert.equal(metadata.settings.width, 960); assert.equal(metadata.settings.height, 540); assert.equal(metadata.settings.fps, 30);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("renderer failures clean temporary output and locks and leave no final video/sidecar", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "explain-failure-test-"));
  const output = path.join(root, "final.mp4"); let temp = "";
  try {
    await assert.rejects(renderStoryboard(buildStoryboard(script()), {}, {}, output, {}, async (_p, file, dir) => {
      temp = dir; writeFileSync(file, "partial"); throw new Error("browser failed");
    }), /RENDER_FAILED.*browser failed/);
    assert.ok(!existsSync(temp)); assert.deepEqual(readdirSync(root), []);
    // A missing encoded file also cleans its newly created metadata and releases the lock.
    await assert.rejects(renderStoryboard(buildStoryboard(script()), {}, {}, output, {}, async () => {}), /RENDER_FAILED/);
    assert.deepEqual(readdirSync(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("CLI accepts raw quoted prompts and options, rejects malformed options without executing text", () => {
  const prompt = 'Explain <img src=x onerror=alert(1)>; $(touch /tmp/not-executed)';
  const parsed = parseExplainArgs([prompt, "--duration", "60", "--output", "/tmp/new/final.mp4"]);
  assert.equal(parsed.prompt, prompt); assert.equal(parsed.duration, 60);
  for (const args of [[], ["x", "--unknown"], ["x", "--duration", "NaN"], ["x", "--duration", "2"], ["x", "y"], ["x", "--resume", "receipt"], ["--resume", "receipt", "--duration", "30"]]) assert.throws(() => parseExplainArgs(args));
});

test("JSON/XML representations remain escaped text in the rendered comparison", async () => {
  const React = await import("react"), { renderToStaticMarkup } = await import("react-dom/server");
  const { GraphVisual } = await import("./remotion/GraphVisual");
  const source = script('JSON and XML represent person with name <img onerror=x>.');
  const plan = planFor(script()); const v = plan.scenes[0].visual; if (v.renderer !== "graph") assert.fail();
  v.graph.example!.fields[0] = { key: "name", value: "<img onerror=x>", evidence: source.scenes[0].narration };
  const text = recordRepresentations(v.graph.example!);
  assert.ok(text.xml.includes("&lt;img onerror=x&gt;"));
  const markup = renderToStaticMarkup(React.createElement(GraphVisual, { visual: v, frame: 90, fps: 15, scale: 1, durationInFrames: 180 }));
  assert.ok(markup.includes("record-comparison")); assert.ok(!markup.includes("<img")); assert.ok(!markup.includes("<person>"));
  assert.equal(markup, renderToStaticMarkup(React.createElement(GraphVisual, { visual: v, frame: 90, fps: 15, scale: 1, durationInFrames: 180 })));
});


test("CLI environment loader reads .env.local and preserves shell precedence", async () => {
  const { execFileSync } = await import("node:child_process");
  const root = mkdtempSync(path.join(tmpdir(), "explain-env-test-"));
  try {
    writeFileSync(path.join(root, ".env"), "EXPLAIN_ENV_TEST_VALUE=base\n");
    writeFileSync(path.join(root, ".env.local"), "EXPLAIN_ENV_TEST_VALUE=local\n");
    const program = `require(${JSON.stringify(require.resolve("./cli-environment"))}).loadCliEnvironment(${JSON.stringify(root)});process.stdout.write(process.env.EXPLAIN_ENV_TEST_VALUE)`;
    const env = { ...process.env, NODE_ENV: "development" };
    delete (env as Record<string, string | undefined>).EXPLAIN_ENV_TEST_VALUE;
    assert.equal(execFileSync(process.execPath, ["-e", program], { env, encoding: "utf8" }), "local");
    assert.equal(execFileSync(process.execPath, ["-e", program], { env: { ...env, EXPLAIN_ENV_TEST_VALUE: "shell" }, encoding: "utf8" }), "shell");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("complete raw-prompt workflow calls live script and visual planning in order; explicit specs win", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "explain-live-mocked-"));
  const source = script(), modelPlan = planFor(source), prompts: unknown[] = [];
  const first = modelPlan.scenes[0].visual;
  const explicit = path.join(root, "explicit.json");
  writeFileSync(explicit, JSON.stringify({ "scene-001": { ...first, heading: "Explicit authored heading" } }));
  const fetchMock = mock.method(globalThis, "fetch", async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)); prompts.push(JSON.parse(body.messages[1].content));
    return envelope(prompts.length === 1 ? source : modelPlan.scenes[prompts.length - 2]);
  });
  try {
    const result = await explain({ prompt: "Explain two representations for a beginner", output: path.join(root, "video/final.mp4"), visuals: explicit }, {
      requestsDirectory: path.join(root, "requests"),
      render: (b, o, s, p, provenance) => renderStoryboard(b, o, s, p, provenance, fakeEncoder),
    });
    assert.equal(fetchMock.mock.callCount(), 4);
    assert.equal((prompts[0] as { topic: string }).topic, "Explain two representations for a beginner");
    assert.equal((prompts[1] as { narration: string }).narration, source.scenes[0].narration);
    const m = JSON.parse(readFileSync(result.metadata, "utf8"));
    assert.equal(m.visuals[0].heading, "Explicit authored heading");
    assert.equal(m.provenance.modelVisualPlan.scenes[0].visual.heading, first.heading);
    assert.deepEqual(m.provenance.explicitOverrides, ["scene-001"]);
  } finally { fetchMock.mock.restore(); rmSync(root, { recursive: true, force: true }); }
});

test("model cannot add percentages, alter equivalent records, or substitute empty comparison boxes", () => {
  const source = script("JSON and XML represent person with name Ana or Bob."), board = buildStoryboard(source);
  const plan = planFor(source), changed = structuredClone(plan);
  const v = changed.scenes[1].visual; if (v.renderer !== "graph") assert.fail();
  v.graph.example!.fields[0].value = "Bob";
  assert.throws(() => validateModelVisualPlan(changed, board), /identical example/);
  const empty = structuredClone(plan), e = empty.scenes[0].visual; if (e.renderer !== "graph") assert.fail();
  delete e.graph.example;
  assert.throws(() => validateModelVisualPlan(empty, board), /shared example/);
  const numeric = structuredClone(empty), n = numeric.scenes[0].visual; if (n.renderer !== "graph") assert.fail();
  n.graph.layout = "bars";
  n.graph.values = n.graph.nodes.map((node, i) => ({ nodeId: node.id, value: i * 10 + 20, unit: "%", evidence: source.scenes[0].narration }));
  assert.throws(() => validateModelVisualPlan(numeric, board), /percentage/);
});

test("actual XML/JSON incident is rejected at model and resolved-render boundaries", async () => {
  const { modelSchemaForStoryboard } = await import("./model-visual-plan");
  const incident = JSON.parse(readFileSync("app/api/video_gen/fixtures/regressions/xml-json-bridge.json", "utf8"));
  const board = buildStoryboard(incident.script);
  // This is precisely the graph-free union branch which previously passed validation.
  assert.doesNotThrow(() => modelVisualPlanSchema.parse(incident.visualPlan));
  assert.throws(() => validateModelVisualPlan(incident.visualPlan, board), /VISUAL_DOMAIN_MISMATCH/);
  assert.equal(modelSchemaForStoryboard(board).safeParse(incident.visualPlan).success, false);
  const grammar = JSON.stringify(z.toJSONSchema(modelSchemaForStoryboard(board)));
  assert.ok(!grammar.includes('"const":"bridge"'));
  assert.throws(() => prepareRender(board, { approveOverrun: true }, modelSpecifications(incident.visualPlan)), /VISUAL_DOMAIN_MISMATCH/);
  assert.throws(() => prepareRender(board, {}, modelSpecifications(incident.visualPlan)), /DURATION_APPROVAL_REQUIRED/);
  const original = prepareRender(board, { approveOverrun: true });
  assert.ok(original.visuals.every(v => v.renderer === "graph"));
  assert.deepEqual(original.frames, incident.frames);
  assert.equal(original.durationInFrames, 4397);
  assert.equal(original.durationInFrames / original.settings.fps, 293.1333333333333);
});

test("real scene component consumes each resolved spec and visibly applies local-frame actions/fades", async () => {
  const React = await import("react"), { renderToStaticMarkup } = await import("react-dom/server");
  const { Explainer, SceneFrame } = await import("./remotion/Explainer");
  const source = script(), board = buildStoryboard(source), modelPlan = planFor(source);
  modelPlan.scenes.forEach((e, i) => { e.visual.heading = `Distinct visual ${i + 1}`; });
  const plan = prepareRender(board, {}, modelSpecifications(validateModelVisualPlan(modelPlan, board)));
  const composition = Explainer({ plan });
  const sequences = React.Children.toArray(composition.props.children) as React.ReactElement<{ from: number; durationInFrames: number; children: React.ReactElement<{ plan: typeof plan; index: number }> }>[];
  const sceneMarkup = (index: number, frame: number) => renderToStaticMarkup(React.createElement(SceneFrame, { plan, index, frame }));
  for (const [i, sequence] of sequences.entries()) {
    assert.equal(sequence.props.from, plan.frames[i].from);
    assert.equal(sequence.props.durationInFrames, plan.frames[i].durationInFrames);
    assert.equal(sequence.props.children.props.plan, plan);
    assert.equal(sequence.props.children.props.index, i);
    const markup = sceneMarkup(i, Math.floor(plan.frames[i].durationInFrames / 2));
    assert.ok(markup.includes(`Distinct visual ${i + 1}`));
    assert.ok(markup.includes('data-visual="record-comparison"'));
    assert.ok(!markup.includes('data-component="bridge"'));
    assert.ok(!markup.includes(source.scenes[i].narration));
    for (let j = 0; j < sequences.length; j++) if (i !== j) assert.ok(!markup.includes(`Distinct visual ${j + 1}`));
  }
  // Check actual visible attributes/content, not just a timestamp that always changes.
  const duration = plan.frames[1].durationInFrames;
  const early = sceneMarkup(1, Math.floor(duration * 0.1));
  const highlight = sceneMarkup(1, Math.floor(duration * 0.4));
  const later = sceneMarkup(1, Math.floor(duration * 0.7));
  assert.ok(early.includes("opacity:0;")); // second representation not yet revealed
  assert.ok(highlight.includes("#ffcc66")); // planned yellow border highlight
  assert.ok(!later.includes("#ffcc66"));
  assert.ok(sceneMarkup(1, 0).includes("opacity:0;"));
  assert.ok(sceneMarkup(1, 8).includes("opacity:1;")); // scene-relative entry fade finished
  assert.ok(!sceneMarkup(1, duration - 1).includes('inset:40px;opacity:1;'));
  const bad = structuredClone(plan); bad.visuals[1].sceneId = "scene-999";
  assert.throws(() => renderToStaticMarkup(React.createElement(SceneFrame, { plan: bad, index: 1, frame: 10 })), /RENDER_PLAN/);
  const missing = structuredClone(plan); missing.visuals = [];
  assert.throws(() => renderToStaticMarkup(React.createElement(SceneFrame, { plan: missing, index: 0, frame: 10 })), /RENDER_PLAN/);
});

test("invalid cached plans fail without a model call; explicit replan forks source and inspect never encodes", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "explain-incident-replan-"));
  const source = script(), invalidPlan = planFor(source);
  invalidPlan.scenes.forEach(e => { e.visual = { sceneId: e.sceneId, renderer: "bridge", concept: "comparison", mode: "overview", heading: "Wrong domain", labels: ["JSON", "XML"], note: "Unsupported physical schematic" }; });
  const receipt = path.join(root, "original.json"), output = path.join(root, "final.mp4");
  const raw = JSON.stringify({ version: 1, request: { topic: "Compare data representations", targetAudience: "Beginners", durationSeconds: 45 }, script: source, visualPlan: invalidPlan, model: "qwen2.5:3b", generatedAt: new Date().toISOString(), output });
  writeFileSync(receipt, raw);
  let planned = 0, encoded = 0;
  const deps = { requestsDirectory: path.join(root, "requests"), generateScript: async () => { assert.fail("must reuse original script"); }, planVisuals: async () => { planned++; return planFor(source); }, render: (async () => { encoded++; assert.fail("inspection must never render"); }) as typeof renderStoryboard };
  try {
    await assert.rejects(explain({ resume: receipt, inspect: true }, deps), /VISUAL_DOMAIN_MISMATCH/);
    assert.equal(planned, 0); assert.equal(encoded, 0);
    const inspection = await explain({ resume: receipt, replan: true, inspect: true }, deps);
    assert.equal(planned, 1); assert.equal(encoded, 0);
    assert.equal(readFileSync(receipt, "utf8"), raw);
    assert.notEqual(inspection.requestReceipt, receipt);
    assert.ok("inspectionFile" in inspection && existsSync(inspection.inspectionFile));
    const fork = JSON.parse(readFileSync(inspection.requestReceipt!, "utf8"));
    assert.deepEqual(fork.script, source);
    assert.ok(fork.visualPlan.scenes.every((s: { visual: { renderer: string } }) => s.visual.renderer === "graph"));
    await explain({ resume: inspection.requestReceipt, inspect: true }, deps);
    assert.equal(planned, 1); assert.ok(!existsSync(output)); assert.ok(!existsSync(output + ".json"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
