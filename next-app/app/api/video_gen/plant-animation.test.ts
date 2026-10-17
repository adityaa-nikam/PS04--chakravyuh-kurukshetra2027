import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildStoryboard } from "./storyboard";
import { getExplainerScriptFixture } from "./fixture";
import { adaptVisualScene } from "./visual-plan";
import { GraphVisual } from "./remotion/GraphVisual";

function visual(narration: string) {
  return adaptVisualScene({ ...buildStoryboard(getExplainerScriptFixture()).scenes[1], narration, visualDirection: "Show the plant." }, "Photosynthesis");
}
test("plant anatomy uses source-supported transfers with deterministic scene-local motion", () => {
  const v = visual("Plants use sunlight, water and carbon dioxide to produce glucose and release oxygen during photosynthesis.");
  assert.equal(v.renderer, "graph"); if (v.renderer !== "graph") return;
  v.graph.actions = [{ kind: "transfer", target: "water->plant", start: 0.2, end: 0.6 }];
  const render = (frame: number) => renderToStaticMarkup(React.createElement(GraphVisual, { visual: v, frame, fps: 15, scale: 1, durationInFrames: 150 }));
  const markup = render(60);
  assert.match(markup, /data-component="plant-anatomy"/);
  assert.equal((markup.match(/data-plant-transfer=/g) ?? []).length, 5);
  assert.equal((markup.match(/data-plant-label=/g) ?? []).length, 6);
  assert.match(markup, /data-component="resource-in-transit"/);
  assert.equal(markup, render(60)); assert.notEqual(markup, render(61));
});
test("a negated mechanism has no animated transfer or invented product", () => {
  const v = visual("Plants do not use water in photosynthesis.");
  const markup = renderToStaticMarkup(React.createElement(GraphVisual, { visual: v, frame: 60, fps: 15, scale: 1, durationInFrames: 150 }));
  assert.match(markup, /data-component="plant-anatomy"/);
  assert.doesNotMatch(markup, /data-plant-transfer=|resource-in-transit|data-plant-resource="oxygen"/);
});

test("nonstandard validated photosynthesis relationships retain the general graph renderer", () => {
  const v = visual("Plants use sunlight and water in photosynthesis.");
  if (v.renderer !== "graph") assert.fail();
  v.graph.edges = [{ from: "sunlight", to: "water", meaning: "input", evidence: "Plants use sunlight and water in photosynthesis." }];
  const markup = renderToStaticMarkup(React.createElement(GraphVisual, { visual: v, frame: 60, fps: 15, scale: 1, durationInFrames: 150 }));
  assert.match(markup, /data-visual="graph"/);
  assert.match(markup, /data-component="connection"/);
});
