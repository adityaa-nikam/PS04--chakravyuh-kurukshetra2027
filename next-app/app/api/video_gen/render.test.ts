import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareRender } from "./render-plan";
import { buildStoryboard } from "./storyboard";
import { getExplainerScriptFixture } from "./fixture";
import { rendererEnvironment } from "./render-worker";
import { graphNodeLayouts, graphSchema } from "./visual-graph";

test("graph labels use available column width and dense rows reserve three readable lines", () => {
  const nodes = Array.from({ length: 6 }, (_, i) => ({ id: `node-${i}`, label: "W".repeat(28), icon: "item" as const, evidence: "W".repeat(28) }));
  for (const count of [1, 2, 3, 4, 5, 6]) {
    const graph = graphSchema.parse({ topic: "general", layout: "overview", nodes: nodes.slice(0, count), edges: [] });
    const boxes = graphNodeLayouts(graph);
    boxes.forEach((box, i) => {
      assert.ok(box.label.x >= 0 && box.label.x + box.label.width <= 640);
      assert.ok(box.label.y + box.label.height <= 520);
      assert.ok(box.label.y >= box.y + 54 * box.symbolScale);
      if (count <= 3) assert.equal(box.label.width, 480);
      else { assert.equal(box.label.height, 78); assert.equal(box.symbolScale, 0.74); }
      const nextRow = boxes[i + 2];
      if (count > 3 && nextRow) assert.ok(box.label.y + box.label.height < nextRow.y - 54 * nextRow.symbolScale);
    });
  }
  const flow = graphSchema.parse({ topic: "general", layout: "flow", nodes: nodes.map((n, i) => ({ ...n, role: i < 3 ? "input" : i === 3 ? "core" : "output" })), edges: [] });
  for (const box of graphNodeLayouts(flow)) {
    assert.equal(box.label.width, 190); assert.equal(box.label.height, 78);
    assert.ok(box.label.y + box.label.height <= 520);
  }
});

test("XML fragment regression remains intact in the wider real graph label", async () => {
  const React = await import("react"), { renderToStaticMarkup } = await import("react-dom/server");
  const { GraphVisual } = await import("./remotion/GraphVisual");
  const { visualSceneSchema } = await import("./visual-plan");
  const label = "book><title>Example</title><";
  const graph = graphSchema.parse({ topic: "general", layout: "overview", nodes: [{ id: "item-0", label, icon: "item", evidence: label }, { id: "item-1", label: "JSON", icon: "document", evidence: "JSON" }], edges: [] });
  const visual = visualSceneSchema.parse({ sceneId: "scene-002", concept: "diagram", renderer: "graph", mode: "overview", heading: "XML vs JSON", labels: [label, "JSON"], note: "Conceptual overview", graph });
  const markup = renderToStaticMarkup(React.createElement(GraphVisual, { visual, frame: 100, fps: 15, scale: 1 }));
  assert.match(markup, /data-node-label="item-0"/); assert.match(markup, /width:75%/);
  assert.match(markup, /book&gt;&lt;title&gt;Example&lt;\/title&gt;&lt;/);
  assert.match(markup, /font-size:23px/); // unchanged preferred/minimum typography
});

test("renderer child removes IDE preload/bootstrap hooks without mutating server environment", () => {
  const source = { LD_PRELOAD: "/lib/keep.so:/ide/console-ninja-fs-hooks.node /lib/other.so", NODE_OPTIONS: "--require /ide/console-ninja/hook.js", PATH: "/usr/bin", VIDEO_GEN_PROVIDER: "openrouter" };
  const before = { ...source };
  assert.deepEqual(rendererEnvironment(source), { LD_PRELOAD: "/lib/keep.so:/lib/other.so", PATH: "/usr/bin", VIDEO_GEN_PROVIDER: "openrouter" });
  assert.deepEqual(source, before);
  assert.equal(rendererEnvironment({ LD_PRELOAD: "/ide/console-ninja-fs-hooks.node" }).LD_PRELOAD, undefined);
  assert.deepEqual(rendererEnvironment({ PATH: "/usr/bin" }), { PATH: "/usr/bin" });
});

test("frame allocation preserves order, duration, and narration", () => {
  const board = buildStoryboard(getExplainerScriptFixture());
  const plan = prepareRender(board, { approveOverrun: true });
  let cursor = 0;
  plan.frames.forEach((f, i) => {
    assert.equal(f.id, board.scenes[i].id); assert.equal(f.from, cursor);
    assert.ok(f.durationInFrames / 15 >= board.scenes[i].estimatedDurationSeconds);
    assert.ok(f.durationInFrames / 15 - board.scenes[i].estimatedDurationSeconds < 1 / 15);
    cursor += f.durationInFrames;
  });
  assert.equal(plan.durationInFrames, cursor); assert.deepEqual(plan.storyboard, board);
  assert.deepEqual(plan, prepareRender(board, { approveOverrun: true }));
});
test("requires_revision needs explicit boolean approval", () => {
  const script = getExplainerScriptFixture(); script.estimatedDurationSeconds = 15;
  const board = buildStoryboard(script); assert.equal(board.durationPolicy.classification, "requires_revision");
  assert.throws(() => prepareRender(board), /DURATION_APPROVAL_REQUIRED/);
  assert.doesNotThrow(() => prepareRender(board, { approveOverrun: true }));
  assert.throws(() => prepareRender(board, { approveOverrun: "true" } as never));
});
test("unknown visual type falls back without mutating original or weakening other fields", () => {
  const board = buildStoryboard(getExplainerScriptFixture());
  const unknown = structuredClone(board); Reflect.set(unknown.scenes[1], "visualType", "future-widget");
  const plan = prepareRender(unknown, { approveOverrun: true });
  assert.equal(plan.storyboard.scenes[1].visualType, "diagram");
  assert.equal(unknown.scenes[1].visualType, "future-widget");
  assert.deepEqual(plan.fallbackSceneIndexes, [1]);
  assert.throws(() => prepareRender({ ...unknown, scenes: [] }, { approveOverrun: true }));
  assert.throws(() => prepareRender(board, { width: 641 }));
});

test("text fitting selects the largest fitting candidate without crossing the readable floor", async () => {
  const { fitText } = await import("./remotion/text-layout");
  const tried: number[] = [];
  const font = fitText("scene-001", "narration", 30, 18, size => {
    tried.push(size);
    return { width: 400, height: 100, scrollWidth: 400, scrollHeight: size > 24 ? 130 : 100 };
  });
  assert.equal(font, 24);
  assert.deepEqual(tried, [30, 29, 28, 27, 26, 25, 24]);
  const minimums: number[] = [];
  assert.throws(() => fitText("scene-002", "visual_direction", 19.5, 18, size => {
    minimums.push(size);
    return { width: 400, height: 100, scrollWidth: 401, scrollHeight: 102 };
  }), /TEXT_OVERFLOW: scene=scene-002 role=visual_direction;.*minimumFont=18px/);
  assert.deepEqual(minimums, [19.5, 18.5, 18]);
});

test("zero layout boxes and horizontal overflow fail instead of clipping", async () => {
  const { fitText, textFits } = await import("./remotion/text-layout");
  assert.equal(textFits({ width: 0, height: 59, scrollWidth: 8, scrollHeight: 322 }), false);
  assert.throws(() => fitText("scene-001", "heading", 20, 20,
    () => ({ width: 0, height: 59, scrollWidth: 8, scrollHeight: 322 })), /scene=scene-001 role=heading/);
  assert.equal(textFits({ width: 100, height: 100, scrollWidth: 102, scrollHeight: 80 }), false);
  assert.equal(textFits({ width: 100, height: 100, scrollWidth: 101, scrollHeight: 101 }), true);
});

test("responsive panel allocation and fonts retain readable minimums", async () => {
  const { narrationShare, textSizes } = await import("./remotion/text-layout");
  assert.equal(narrationShare("a".repeat(1200), "short"), 0.75);
  assert.equal(narrationShare("short", "a".repeat(400)), 0.55);
  assert.ok(narrationShare("a".repeat(100), "b".repeat(100)) > 0.55);
  for (const scale of [0.5, 0.75, 1, 1.5]) {
    for (const role of ["heading", "narration", "visual_direction"] as const) {
      const sizes = textSizes(role, scale);
      assert.ok(sizes.minimum >= (role === "heading" ? 20 : 16));
      assert.ok(sizes.preferred >= sizes.minimum);
    }
  }
});

test("visual registry is explicit, with a safe fallback for unknown and prototype keys", async () => {
  const { selectVisualConcept, visualSceneSchema } = await import("./visual-plan");
  assert.equal(selectVisualConcept("title"), "hook");
  for (const type of ["process", "diagram", "comparison", "summary"]) assert.equal(selectVisualConcept(type), type);
  for (const type of ["statistic", "new-type", "__proto__", "constructor"]) assert.equal(selectVisualConcept(type), "diagram");
  assert.equal(visualSceneSchema.safeParse({ renderer: "<script>alert(1)</script>" }).success, false);
});

test("bridge content selects real graphics while preserving all source narration", async () => {
  const { adaptVisualScene } = await import("./visual-plan");
  const board = buildStoryboard(getExplainerScriptFixture());
  const scene = board.scenes[1];
  for (const [text, mode] of [
    ["Wind causes a bridge to vibrate.", "wind"],
    ["Cars create vibration on the bridge.", "traffic"],
    ["Wind and traffic both shake the bridge.", "combined"],
    ["A bridge transfers weight to its foundations.", "load"],
  ] as const) {
    const visual = adaptVisualScene({ ...scene, visualType: "diagram", narration: text, visualDirection: "Show a bridge." }, board.title);
    assert.equal(visual.renderer, "bridge");
    assert.equal(visual.mode, mode);
    assert.notEqual(visual.heading, text);
    assert.ok(!JSON.stringify(visual).includes("Show a bridge."));
  }
  const comparison = adaptVisualScene({ ...scene, visualType: "comparison", narration: "Compare bridge wind and traffic.", visualDirection: "Show both." }, board.title);
  assert.equal(comparison.mode, "comparison");
  const plan = prepareRender(board, { approveOverrun: true });
  assert.deepEqual(plan.storyboard, board);
  assert.deepEqual(plan.visuals.map(v => v.sceneId), plan.frames.map(f => f.id));
});

test("portrait defaults, landscape option, approval guard, and repeatable scene-relative motion", async () => {
  const { visualMotion } = await import("./visual-plan");
  const board = buildStoryboard(getExplainerScriptFixture());
  const plan = prepareRender(board, { approveOverrun: true });
  assert.equal(plan.settings.width, 720); assert.equal(plan.settings.height, 1280);
  assert.equal(plan.settings.width / plan.settings.height, 9 / 16);
  const landscape = prepareRender(board, { approveOverrun: true, width: 960, height: 540 });
  assert.deepEqual(plan.frames, landscape.frames);
  assert.deepEqual(plan.visuals, landscape.visuals);
  assert.deepEqual(visualMotion(17, 15), visualMotion(17, 15));
  assert.notDeepEqual(visualMotion(17, 15), visualMotion(18, 15));
  assert.deepEqual(visualMotion(30, 15), visualMotion(60, 30));
  for (const f of plan.frames) assert.deepEqual(visualMotion(f.from - f.from, 15), visualMotion(0, 15));
});

test("rendered visuals contain authored shapes, never executable model markup or narration panels", async () => {
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { visualComponents } = await import("./remotion/Visuals");
  const { adaptVisualScene, visualSceneSchema } = await import("./visual-plan");
  const board = buildStoryboard(getExplainerScriptFixture());
  const source = { ...board.scenes[1], visualType: "diagram" as const,
    narration: "Wind and vehicles cause a bridge to vibrate.",
    visualDirection: '<script>alert("bad")</script><img src=x onerror=alert(1)>' };
  const visual = adaptVisualScene(source, board.title);
  assert.ok(visual.renderer === "bridge");
  const markup = renderToStaticMarkup(React.createElement(visualComponents.bridge, { visual, frame: 17, fps: 15, scale: 1 }));
  for (const component of ["bridge", "wind", "vehicle", "vibration"]) assert.ok(markup.includes(`data-component="${component}"`));
  assert.ok(markup.includes("<svg"));
  assert.ok(!markup.includes(source.narration)); assert.ok(!markup.includes(source.visualDirection));
  const malicious = '<img src=x onerror=alert(1)>';
  const safeData = visualSceneSchema.parse({ ...visual, renderer: "abstract", concept: "comparison", labels: [malicious, "B"] });
  const escaped = renderToStaticMarkup(React.createElement(visualComponents.abstract, { visual: safeData, frame: 17, fps: 15, scale: 1 }));
  assert.ok(escaped.includes("&lt;img")); assert.ok(!escaped.includes("<img"));
  assert.throws(() => visualSceneSchema.parse({ ...safeData, html: malicious }));
  const load = renderToStaticMarkup(React.createElement(visualComponents.bridge, { visual: { ...visual, mode: "load" }, frame: 17, fps: 15, scale: 1 }));
  assert.ok(load.includes('data-component="load-path"'));
});


test("bridge context persists across pronouns and hooks do not invent force sources", async () => {
  const { adaptVisualScene } = await import("./visual-plan");
  const scene = buildStoryboard(getExplainerScriptFixture()).scenes[1];
  const deck = adaptVisualScene({ ...scene, visualType: "diagram", narration: "Its deck transfers weight to the foundations.", visualDirection: "Highlight the supports." }, "How a bridge carries weight");
  assert.equal(deck.renderer, "bridge");
  assert.equal(deck.mode, "load");
  const hook = adaptVisualScene({ ...scene, visualType: "title", narration: "Why does a bridge vibrate?", visualDirection: "Show a bridge." }, "Bridge motion");
  assert.equal(hook.mode, "vibration");
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { BridgeVisual } = await import("./remotion/Visuals");
  const markup = renderToStaticMarkup(React.createElement(BridgeVisual, { visual: hook, frame: 20, fps: 15, scale: 1 }));
  assert.ok(markup.includes('data-component="vibration"'));
  assert.ok(!markup.includes('data-component="wind"'));
  assert.ok(!markup.includes('data-component="vehicle"'));
});

test("general visual adapters select grounded biological and computing primitives", async () => {
  const { adaptVisualScene } = await import("./visual-plan");
  const base = buildStoryboard(getExplainerScriptFixture()).scenes[1];
  const photosynthesis = adaptVisualScene({ ...base, narration: "Plants use sunlight, water and carbon dioxide to produce glucose and release oxygen during photosynthesis.", visualDirection: "Show a leaf with labeled inputs and products." }, "How photosynthesis works");
  assert.equal(photosynthesis.renderer, "graph");
  if (photosynthesis.renderer !== "graph") return;
  assert.equal(photosynthesis.graph.topic, "photosynthesis");
  assert.deepEqual(photosynthesis.graph.nodes.map(n => n.id), ["plant", "sunlight", "water", "carbon-dioxide", "sugar", "oxygen"]);
  assert.equal(photosynthesis.graph.edges.length, 5);
  assert.equal(photosynthesis.graph.values.length, 0);
  const cpu = adaptVisualScene({ ...base, narration: "The CPU first fetches an instruction, then decodes it, and finally executes it. The cycle repeats.", visualDirection: "Show the instruction cycle." }, "CPU instructions");
  assert.equal(cpu.renderer, "graph");
  if (cpu.renderer !== "graph") return;
  assert.equal(cpu.graph.topic, "cpu");
  assert.deepEqual(cpu.graph.nodes.map(n => n.id), ["fetch", "decode", "execute"]);
  assert.deepEqual(cpu.graph.edges.map(e => e.meaning), ["order", "order", "cycle"]);
  assert.deepEqual(cpu, adaptVisualScene({ ...base, narration: "The CPU first fetches an instruction, then decodes it, and finally executes it. The cycle repeats.", visualDirection: "Show the instruction cycle." }, "CPU instructions"));
});

test("uncertain statements, generic words, and numbers do not fabricate diagrams or data", async () => {
  const { adaptConceptGraph } = await import("./concept-adapter");
  const base = buildStoryboard(getExplainerScriptFixture()).scenes[1];
  const adapt = (text: string, title = "An unfamiliar subject") => adaptConceptGraph({ ...base, narration: text, visualDirection: "Illustrate the explanation." }, title);
  const fallback = adapt("We decode a poem and execute a dance.");
  assert.equal(fallback.topic, "general"); assert.equal(fallback.layout, "overview");
  assert.equal(fallback.edges.length, 0); assert.equal(fallback.values.length, 0);
  assert.ok(fallback.nodes.every(n => n.evidence.includes(n.label.replace(/…$/, ""))));
  for (const text of ["This uses 25% of energy.", "A: 140%; B: 25%.", "A: -20%; B: 25%.", "A: 20%; B: unknown."]) assert.equal(adapt(text).values.length, 0);
  const chart = adapt("A: 20%; B: 35%.");
  assert.equal(chart.layout, "bars"); assert.deepEqual(chart.values.map(v => v.value), [20, 35]);
  assert.equal(adapt("Photosynthesis does not use water or sunlight.", "Photosynthesis").edges.length, 0);
  assert.equal(adapt("Plants use glucose and release oxygen in photosynthesis.", "Photosynthesis").edges.some(e => e.to === "sugar"), false);
  assert.equal(adapt("The CPU can decode an instruction or execute it.", "CPU instructions").edges.length, 0);
});

test("source relationships, comparisons and ordered procedures use reusable graphs", async () => {
  const { adaptConceptGraph } = await import("./concept-adapter");
  const base = buildStoryboard(getExplainerScriptFixture()).scenes[1];
  const adapt = (text: string) => adaptConceptGraph({ ...base, narration: text, visualDirection: "Show the concept." }, "General explanation");
  assert.equal(adapt("Heating causes expansion.").layout, "cause");
  assert.equal(adapt("Heating might cause expansion.").edges.length, 0);
  assert.equal(adapt("Local storage versus cloud storage.").layout, "comparison");
  const sequence = adapt("First wash the container. Then add water. Finally close the lid.");
  assert.equal(sequence.layout, "sequence"); assert.equal(sequence.edges.length, 2);
});

test("explicit visual specs win over keywords and reject invalid references or evidence", async () => {
  const { adaptVisualScene, visualSceneSchema } = await import("./visual-plan");
  const { graphSchema, graphPositions, graphMotion } = await import("./visual-graph");
  const board = buildStoryboard(getExplainerScriptFixture());
  const visual = adaptVisualScene(board.scenes[0], board.title);
  const explicit = { ...visual, heading: "Chosen heading" };
  const plan = prepareRender(board, { approveOverrun: true }, { "scene-001": explicit });
  assert.equal(plan.visuals[0].heading, "Chosen heading");
  assert.deepEqual(plan.explicitVisualSceneIds, ["scene-001"]);
  assert.throws(() => prepareRender(board, { approveOverrun: true }, { "scene-999": explicit }), /VISUAL_SPEC/);
  assert.throws(() => visualSceneSchema.parse({ ...visual, renderer: "graph", graph: undefined }));
  const graph = graphSchema.parse({ topic: "general", layout: "overview", nodes: [{ id: "point", label: "A claim", icon: "item", evidence: "not in source" }], edges: [] });
  assert.throws(() => prepareRender(board, { approveOverrun: true }, { "scene-001": { ...visual, renderer: "graph", graph } }), /evidence/);
  assert.throws(() => graphSchema.parse({ ...graph, edges: [{ from: "point", to: "missing", meaning: "cause", evidence: "x" }] }));
  assert.throws(() => graphSchema.parse({ ...graph, nodes: [...graph.nodes, graph.nodes[0]] }));
  assert.throws(() => graphSchema.parse({ ...graph, layout: "bars", values: [] }));
  for (const p of graphPositions(graph)) assert.ok(p.x >= 0 && p.x <= 640 && p.y + 116 <= 520);
  assert.deepEqual(graphMotion(30, 15, 1), graphMotion(60, 30, 1));
});

test("graph graphics escape untrusted strings and animate authored shapes deterministically", async () => {
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { GraphVisual } = await import("./remotion/GraphVisual");
  const { adaptVisualScene } = await import("./visual-plan");
  const base = buildStoryboard(getExplainerScriptFixture()).scenes[1];
  const v = adaptVisualScene({ ...base, narration: "Plants use sunlight and water in photosynthesis.", visualDirection: "Show a leaf." }, "Photosynthesis");
  if (v.renderer !== "graph") assert.fail("expected graph");
  v.graph.nodes[0].label = '<script>alert(1)</script>';
  const render = (frame: number) => renderToStaticMarkup(React.createElement(GraphVisual, { visual: v, frame, fps: 15, scale: 1 }));
  const markup = render(30);
  assert.ok(markup.includes('data-component="leaf"')); assert.ok(markup.includes('data-component="sun"'));
  assert.ok(markup.includes("&lt;script&gt;")); assert.ok(!markup.includes("<script>"));
  assert.equal(markup, render(30)); assert.notEqual(markup, render(31));
});

test("one request publishes exactly one final MP4 and sidecar, refusing collisions", async () => {
  const { outputPaths, reserveOutput, publishOutput } = await import("./output-path");
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "explainer-output-test-"));
  try {
    const paths = outputPaths("CPU / instructions?", undefined, root);
    assert.equal(path.basename(paths.video), "final.mp4");
    assert.equal(path.basename(path.dirname(paths.video)), "cpu-instructions");
    const temp = path.join(root, "temporary-video"); fs.writeFileSync(temp, "test-video");
    const release = reserveOutput(paths);
    assert.throws(() => reserveOutput(paths));
    publishOutput(paths, temp, { narration: "unchanged" }); release();
    assert.deepEqual(fs.readdirSync(path.dirname(paths.video)).sort(), ["final.mp4", "final.mp4.json"]);
    assert.throws(() => reserveOutput(paths), /already exists/);
    assert.throws(() => publishOutput(paths, temp, {}));
    assert.equal(fs.readFileSync(paths.video, "utf8"), "test-video");
    assert.equal(JSON.parse(fs.readFileSync(paths.metadata, "utf8")).narration, "unchanged");
    assert.throws(() => outputPaths("x", path.join(root, "x.webm")));
    assert.ok(outputPaths("../../", undefined, root).video.startsWith(root + path.sep));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("saved live representative scripts retain source and map every scene meaningfully", async () => {
  const { readFileSync } = await import("node:fs");
  for (const topic of ["bridge", "photosynthesis", "cpu"]) {
    const source = JSON.parse(readFileSync(`app/api/video_gen/fixtures/block05/${topic}.script.json`, "utf8"));
    const board = buildStoryboard(source);
    const plan = prepareRender(board, { approveOverrun: topic !== "bridge" });
    assert.deepEqual(plan.storyboard.scenes.map(s => s.narration), source.scenes.map((s: { narration: string }) => s.narration));
    assert.deepEqual(plan.visuals.map(v => v.sceneId), board.scenes.map(s => s.id));
    for (const v of plan.visuals) {
      assert.equal(v.renderer, topic === "bridge" ? "bridge" : "graph");
      if (v.renderer === "graph") { assert.equal(v.graph.topic, topic); assert.equal(v.graph.values.length, 0); }
    }
    if (topic === "photosynthesis") {
      const reaction = plan.visuals[4];
      assert.ok(reaction.renderer === "graph" && reaction.graph.edges.length === 5);
    }
    if (topic === "cpu") {
      const repeat = plan.visuals.at(-1)!;
      assert.ok(repeat.renderer === "graph" && repeat.graph.edges.some(e => e.meaning === "cycle"));
    }
  }
});
