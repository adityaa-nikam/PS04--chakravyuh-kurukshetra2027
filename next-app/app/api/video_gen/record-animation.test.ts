import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { frameProgress, motionWindow, staggeredReveal, recordComparisonMotion } from "./record-animation";
import { buildStoryboard } from "./storyboard";
import { compileActions, type VisualAction } from "./visual-actions";
import { ACTION_EVIDENCE } from "./action-catalog";
import { modelSpecifications, validateModelVisualPlan } from "./model-visual-plan";
import { prepareRender } from "./render-plan";
import { recordRepresentations, graphSchema } from "./visual-graph";
import { SceneFrame } from "./remotion/Explainer";
import { GraphVisual } from "./remotion/GraphVisual";
import { HighlightBand, TracePath, WipeReveal } from "./remotion/AnimationPrimitives";

test("shared path tracing follows corners deterministically and clamps endpoints", () => {
  const trace = (progress: number) => renderToStaticMarkup(React.createElement("svg", null,
    React.createElement(TracePath, { path: "M0 0 H100 V100", progress })));
  assert.match(trace(0.75), /cx="100" cy="50"/);
  assert.equal(trace(0.75), trace(0.75));
  assert.doesNotMatch(trace(-1), /trace-head/);
  assert.doesNotMatch(trace(2), /trace-head/);
  assert.match(trace(2), /stroke-dashoffset="0"/);
});

test("shared reveals and highlight bands retain content without timers", () => {
  const reveal = renderToStaticMarkup(React.createElement(WipeReveal, { progress: 0.5, distance: 20 }, "name: Ana"));
  assert.match(reveal, /inset\(0 50% 0 0\)/); assert.match(reveal, /translateX\(10px\)/);
  assert.match(reveal, /name: Ana/);
  const highlighted = renderToStaticMarkup(React.createElement(HighlightBand, { active: true, color: "#ffcc66" }, "Ana"));
  assert.match(highlighted, /inset 3px 0 #ffcc66/); assert.match(highlighted, /Ana/);
});

const board = buildStoryboard({ title: "XML and JSON", targetAudience: "Beginners", estimatedDurationSeconds: 45, scenes: [
  { narration: "XML and JSON can represent the same illustrative person record with name Ana. We will build both representations from one record and compare their notation.", visualDirection: "Introduce one record." },
  { narration: "For example, XML uses <person><name>Ana</name></person> for this record. JSON uses a name key with the same string value Ana. Match the field in both.", visualDirection: "Build both formats and match the field." },
  { narration: "XML and JSON preserve the name Ana in our person example. Tags and object notation differ. Choose a format for your system's requirements rather than assuming either is universally better.", visualDirection: "Compare without ranking." },
] });
const actions: VisualAction[] = board.scenes.map((scene, i) => ({ sceneId: scene.id, action: "format_comparison", exampleId: "record-001", focus: i === 1 ? "fields" : "structure" }));
const modelPlan = compileActions(actions, board);
const plan = prepareRender(board, {}, modelSpecifications(modelPlan), ACTION_EVIDENCE);

test("motion windows clamp and ease; sequential reveals finish in source order", () => {
  assert.equal(frameProgress(-10, 151), 0); assert.equal(frameProgress(200, 151), 1);
  assert.equal(frameProgress(0, 1), 0); assert.equal(frameProgress(0, 0), 0);
  assert.equal(motionWindow(0.5, 0, 1), 0.5);
  assert.throws(() => motionWindow(0.5, 1, 1), /positive duration/);
  const reveals = staggeredReveal(0.5, 0, 1, 3);
  assert.equal(reveals[0], 1); assert.ok(Math.abs(reveals[1] - 0.5) < 1e-12); assert.equal(reveals[2], 0);
  assert.throws(() => staggeredReveal(0, 0, 1, 0), /at least one/);
});

test("record precedes XML, then JSON; completed rows stay visible through the final hold", () => {
  const at = (p: number) => recordComparisonMotion(p * 1000, 1001, 1, "fields");
  assert.equal(at(0.1).record, 1); assert.deepEqual(at(0.1).xml, [0, 0, 0]);
  assert.deepEqual(at(0.3).xml, [1, 1, 1]); assert.deepEqual(at(0.3).json, [0, 0, 0]);
  assert.deepEqual(at(0.49).json, [1, 1, 1]);
  for (const p of [0.6, 0.8, 0.95, 1]) {
    assert.deepEqual(at(p).xml, [1, 1, 1]); assert.deepEqual(at(p).json, [1, 1, 1]);
  }
  assert.equal(at(0.6).activeField, 0); assert.equal(at(0.8).structure, true);
  assert.equal(at(0.95).settle, 1); assert.equal(at(0.95).activeField, -1);
});

test("each field receives its own paired highlight and connector; timing scales with allocated frames", () => {
  for (const focus of ["fields", "structure"] as const) {
    const end = focus === "fields" ? 0.76 : 0.66;
    for (let i = 0; i < 3; i++) {
      const progress = 0.5 + (i + 0.5) * (end - 0.5) / 3;
      const state = recordComparisonMotion(progress * 300, 301, 3, focus);
      assert.equal(state.activeField, i); assert.equal(state.correspondence, 1);
      assert.deepEqual(state, recordComparisonMotion(progress * 600, 601, 3, focus));
    }
  }
  for (const count of [1, 2, 3]) for (let frame = 0; frame < 151; frame++) {
    const state = recordComparisonMotion(frame, 151, count, "fields");
    assert.ok(state.activeField >= -1 && state.activeField < count);
    assert.ok([...state.xml, ...state.json, state.settle].every(n => Number.isFinite(n) && n >= 0 && n <= 1));
  }
});

test("validated action plan reaches real scene renderer with unchanged record, narration and allocation", () => {
  assert.doesNotThrow(() => validateModelVisualPlan(modelPlan, board, ACTION_EVIDENCE));
  for (const [index, allocation] of plan.frames.entries()) {
    const markup = renderToStaticMarkup(React.createElement(SceneFrame, { plan, index, frame: Math.floor((allocation.durationInFrames - 1) * 0.6) }));
    assert.match(markup, /data-sequence="record-correspondence"/);
    assert.equal((markup.match(/data-emphasis="active"/g) ?? []).length, 2);
    assert.equal((markup.match(/data-field-key="name"/g) ?? []).length, 2);
    assert.match(markup, /data-component="field-correspondence"/);
    assert.ok(!markup.includes(board.scenes[index].narration));
    assert.equal(allocation.durationInFrames, Math.ceil(board.scenes[index].estimatedDurationSeconds * plan.settings.fps));
  }
});

test("three distinct fields map by row identity, not substring matching; syntax is inert and values agree", () => {
  const visual = structuredClone(plan.visuals[1]); if (visual.renderer !== "graph") assert.fail();
  const evidence = "person name Ana username Ana age 7";
  visual.graph.example = { name: "person", evidence, fields: [{ key: "name", value: "Ana", evidence }, { key: "username", value: "Ana", evidence }, { key: "age", value: "7", evidence }] };
  graphSchema.parse(visual.graph);
  assert.deepEqual(JSON.parse(recordRepresentations(visual.graph.example).json), { name: "Ana", username: "Ana", age: "7" });
  for (const [index, key] of ["name", "username", "age"].entries()) {
    const frame = (0.5 + (index + 0.5) * 0.26 / 3) * 1000;
    const markup = renderToStaticMarkup(React.createElement(GraphVisual, { visual, frame, durationInFrames: 1001, fps: 15, scale: 1 }));
    assert.equal((markup.match(new RegExp(`data-field-key="${key}" data-comparison-line="field" data-emphasis="active"`, "g")) ?? []).length, 2);
    assert.equal((markup.match(/data-emphasis="active"/g) ?? []).length, 2);
  }
  visual.graph.example.fields[0].value = "<img onerror=x>";
  const markup = renderToStaticMarkup(React.createElement(GraphVisual, { visual, frame: 800, durationInFrames: 1001, fps: 15, scale: 1 }));
  assert.ok(!markup.includes("<img")); assert.ok(!markup.includes("<person>"));
  assert.match(markup, /data-syntax-token="true"/); assert.match(markup, /data-emphasis="structure"/);
});

test("existing node hide actions remain authoritative; legacy record comparisons retain their renderer", () => {
  const visual = structuredClone(plan.visuals[1]); if (visual.renderer !== "graph") assert.fail();
  visual.graph.actions.push({ kind: "hide", target: "xml", start: 0.8, end: 0.9 });
  const render = () => renderToStaticMarkup(React.createElement(GraphVisual, { visual, frame: 950, durationInFrames: 1001, fps: 15, scale: 1 }));
  assert.match(render(), /data-format="xml" style="[^"]*opacity:0/);
  delete visual.graph.comparisonFocus;
  assert.doesNotMatch(render(), /data-sequence="record-correspondence"/);
  assert.match(render(), /data-visual="record-comparison"/);
});
