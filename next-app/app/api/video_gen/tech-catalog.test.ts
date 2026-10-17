import { test, mock } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildStoryboard } from "./storyboard";
import { compileActions, generateVisualActions, type VisualAction } from "./visual-actions";
import { illustrateSubject, illustratedSubjects } from "./subject-plan";
import { availableTechSubjects, sceneTechSubjects, techVisual, techCatalog, type TechSubject } from "./tech-catalog";
import { modelSpecifications, validateModelVisualPlan } from "./model-visual-plan";
import { prepareRender } from "./render-plan";
import { SceneFrame } from "./remotion/Explainer";
import { TechSymbol, techSymbolIcons } from "./remotion/TechSymbols";
import { plannedMotion } from "./visual-graph";

const examples: Record<TechSubject, { title: string; narration: string; component: string }> = {
  rag: { title: "RAG: retrieval augmented generation", narration: "A question triggers a retriever. The retriever searches documents. Documents feed a language model. The language model generates an answer.", component: "language-model" },
  graphql: { title: "GraphQL requests", narration: "The client sends a query. The query requests GraphQL. GraphQL uses a schema. A resolver returns JSON.", component: "graphql" },
  book: { title: "How a book is organized", narration: "A book contains chapters. Chapters contain pages. A reader uses an index.", component: "book" },
  json: { title: "JSON objects", narration: "A JSON object contains keys. Keys have values. JSON also supports arrays.", component: "json" },
  xml: { title: "XML documents", narration: "An XML document contains elements. Elements contain text. Elements also support attributes.", component: "xml" },
};
function boardFor(subject: TechSubject, narration = examples[subject].narration) {
  return buildStoryboard({ title: examples[subject].title, targetAudience: "Beginners", estimatedDurationSeconds: 45,
    scenes: Array.from({ length: 3 }, () => ({ narration, visualDirection: "Use the reusable authored components." })) });
}

test("all five new prompt subjects compile through both validators into recognizable rendered components", () => {
  for (const subject of Object.keys(examples) as TechSubject[]) {
    const board = boardFor(subject), before = JSON.stringify(board);
    const actions: VisualAction[] = board.scenes.map(s => ({ sceneId: s.id, action: "subject_scene", subject }));
    const plan = compileActions(actions, board);
    assert.equal(JSON.stringify(board), before);
    assert.doesNotThrow(() => validateModelVisualPlan(plan, board));
    const resolved = prepareRender(board, {}, modelSpecifications(plan));
    const markup = renderToStaticMarkup(React.createElement(SceneFrame, { plan: resolved, index: 1, frame: Math.floor(resolved.frames[1].durationInFrames * 0.5) }));
    assert.match(markup, new RegExp(`data-component="${examples[subject].component}"`));
    assert.doesNotMatch(markup, /data-component="source-point"/);
    for (const entry of plan.scenes) {
      if (entry.visual.renderer !== "graph") assert.fail();
      assert.equal(entry.visual.graph.topic, subject);
      assert.ok(entry.visual.graph.edges.length > 0);
      for (const edge of entry.visual.graph.edges) {
        assert.ok(examples[subject].narration.includes(edge.evidence));
        assert.ok(edge.evidence.toLowerCase().includes(edge.label!.toLowerCase()));
        assert.ok(entry.visual.graph.actions.some(a => a.kind === "transfer" && a.target === `${edge.from}->${edge.to}`));
      }
    }
  }
});

test("co-occurrence, uncertainty, reverse phrasing and directions cannot invent a relationship", () => {
  for (const narration of ["The retriever and documents are components.", "The retriever may search documents.", "The retriever does not search documents.", "Documents are searched by a retriever."]) {
    const board = boardFor("rag", narration), entry = illustrateSubject(board, board.scenes[0], "rag", 0);
    assert.equal(entry.confidence, "overview");
    if (entry.visual.renderer !== "graph") assert.fail();
    assert.deepEqual(entry.visual.graph.edges, []);
    assert.match(entry.visual.note, /overview/);
  }
  const board = buildStoryboard({ title: "Unrelated systems", targetAudience: "Beginners", estimatedDurationSeconds: 45, scenes: Array.from({ length: 3 }, () => ({ narration: "These concepts need more context.", visualDirection: "Show RAG, GraphQL, JSON, XML and a book." })) });
  assert.deepEqual(illustratedSubjects(board, board.scenes[0]), []);
  assert.throws(() => techVisual(board.scenes[0], board.title, "rag"), /absent/);
  const forged = techVisual(boardFor("rag").scenes[0], examples.rag.title, "rag");
  assert.throws(() => prepareRender(board, {}, { "scene-001": forged }), /source context/);
});

test("dedicated JSON/XML record comparisons retain priority, while GraphQL keeps its own context", () => {
  assert.deepEqual(availableTechSubjects("Compare JSON and XML using a book record"), []);
  assert.deepEqual(availableTechSubjects("GraphQL returns JSON"), ["graphql"]);
  assert.deepEqual(availableTechSubjects("RAG uses a knowledge base"), ["rag"]);
  assert.deepEqual(sceneTechSubjects("Why bridges vibrate", "A book is an analogy."), []);
  assert.deepEqual(sceneTechSubjects("CPU instructions", "The instruction is like a JSON record."), []);
});

test("a brief subject introduction remains a valid illustrated overview without inventing parts", () => {
  const board = buildStoryboard({ title: "RAG", targetAudience: "Beginners", estimatedDurationSeconds: 45,
    scenes: Array.from({ length: 3 }, () => ({ narration: "Let us introduce RAG.", visualDirection: "Show the subject." })) });
  const plan = compileActions(board.scenes.map(s => ({ sceneId: s.id, action: "subject_scene", subject: "rag" })), board);
  for (const entry of plan.scenes) {
    assert.equal(entry.confidence, "overview");
    if (entry.visual.renderer !== "graph") assert.fail();
    assert.equal(entry.visual.graph.nodes.length, 1); assert.deepEqual(entry.visual.graph.edges, []);
  }
});

test("every reusable symbol is inert, deterministic and visually changes only with its supplied phase", () => {
  for (const icon of techSymbolIcons) {
    const render = (phase: number) => renderToStaticMarkup(React.createElement("svg", null, React.createElement(TechSymbol, { icon, phase })));
    assert.equal(render(0.4), render(0.4));
    assert.match(render(0.4), /data-component=/);
    assert.doesNotMatch(render(0.4), /<script|<foreignObject|https?:\/\//);
  }
  const book = (phase: number) => renderToStaticMarkup(React.createElement("svg", null, React.createElement(TechSymbol, { icon: "book", phase })));
  assert.notEqual(book(0), book(0.5));
});

test("transfer intervals remain scene-relative, ordered and after endpoint reveals", () => {
  const board = boardFor("rag"), entry = illustrateSubject(board, board.scenes[0], "rag", 0);
  if (entry.visual.renderer !== "graph") assert.fail();
  const graph = entry.visual.graph;
  const transfers = graph.actions.filter(a => a.kind === "transfer");
  transfers.forEach((a, i) => {
    assert.ok(a.start >= 0.28 && a.end <= 0.85);
    if (i) assert.ok(a.start >= transfers[i - 1].end - 1e-12);
    const progress = (a.start + a.end) / 2;
    assert.ok(Math.abs(plannedMotion(graph, a.target, progress * 300, 301).transfer! - 0.5) < 1e-10);
    const edge = graph.edges.find(e => `${e.from}->${e.to}` === a.target)!;
    assert.equal(plannedMotion(graph, edge.to, progress * 300, 301).highlight, true);
  });
});

test("OpenRouter compact planner receives available tech subjects and returns validated illustrations", async () => {
  const previous = { provider: process.env.VIDEO_GEN_PROVIDER, key: process.env.OPENROUTER_API_KEY };
  process.env.VIDEO_GEN_PROVIDER = "openrouter"; process.env.OPENROUTER_API_KEY = "mock-test-key";
  const board = boardFor("rag"); let calls = 0;
  const transport = mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)), input = JSON.parse(body.messages[1].content);
    assert.deepEqual(input.availableSubjects, ["rag"]); calls++;
    return new Response(JSON.stringify({ model: "mock-openrouter", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ sceneId: input.sceneId, action: "subject_scene", subject: "rag" }) } }] }));
  });
  try { const result = await generateVisualActions(board); assert.equal(calls, 3); assert.equal(result.plan.scenes.length, 3); }
  finally {
    transport.mock.restore();
    if (previous.provider === undefined) delete process.env.VIDEO_GEN_PROVIDER; else process.env.VIDEO_GEN_PROVIDER = previous.provider;
    if (previous.key === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previous.key;
  }
  assert.equal(Object.keys(techCatalog).length, 5);
});
