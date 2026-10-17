import { evaluateDurationPolicy, resolveDurationPolicy } from "./duration-policy";
import { test } from "node:test";
import assert from "node:assert/strict";
import { getExplainerScriptFixture } from "./fixture";
import { normalizeScript, ScriptNormalizationError } from "./normalize";
import { buildStoryboard, storyboardSchema } from "./storyboard";

test("normalization preserves content and input; reports whitespace", () => {
  const script = getExplainerScriptFixture(); script.scenes[0].narration = "  Hello\n world.  ";
  const before = JSON.stringify(script); const n = normalizeScript(script);
  assert.equal(n.scenes[0].narration, "Hello world.");
  assert.equal(JSON.stringify(script), before);
  assert.ok(n.warnings.some(w => w.code === "WHITESPACE_NORMALIZED"));
});

test("scene count, empty/missing fields, lengths, and declared duration are rejected", () => {
  const mutations = [
    (s: ReturnType<typeof getExplainerScriptFixture>) => { s.scenes = s.scenes.slice(0, 2); },
    (s: ReturnType<typeof getExplainerScriptFixture>) => { s.scenes = Array.from({ length: 9 }, () => s.scenes[0]); },
    (s: ReturnType<typeof getExplainerScriptFixture>) => { s.scenes[0].narration = " "; },
    (s: ReturnType<typeof getExplainerScriptFixture>) => { s.scenes[0].narration = "a".repeat(1201); },
    (s: ReturnType<typeof getExplainerScriptFixture>) => { s.scenes[0].visualDirection = ""; },
    (s: ReturnType<typeof getExplainerScriptFixture>) => { Reflect.deleteProperty(s.scenes[0], "visualDirection"); },
    (s: ReturnType<typeof getExplainerScriptFixture>) => { s.estimatedDurationSeconds = 121; },
    (s: ReturnType<typeof getExplainerScriptFixture>) => { s.estimatedDurationSeconds = 14; },
  ];
  for (const mutate of mutations) { const s = getExplainerScriptFixture(); mutate(s); assert.throws(() => normalizeScript(s), ScriptNormalizationError); }
  for (const count of [3, 8]) { const s = getExplainerScriptFixture(); s.scenes = Array.from({ length: count }, () => s.scenes[0]); assert.equal(normalizeScript(s).scenes.length, count); }
});

test("130 words estimate 60 seconds; estimates warn rather than clamp", () => {
  const s = getExplainerScriptFixture(); s.scenes[0].narration = Array(130).fill("word").join(" ");
  assert.equal(normalizeScript(s).scenes[0].estimatedDurationSeconds, 60);
  s.scenes = Array.from({ length: 3 }, () => ({ narration: "word", visualDirection: "Show text." }));
  const n = normalizeScript(s); assert.equal(n.estimatedDurationSeconds, 1.386);
  assert.ok(n.warnings.some(w => w.code === "DURATION_OUT_OF_RANGE"));
  assert.equal(n.durationPolicy.classification, "within_target");
  assert.equal(n.durationPolicy.overrunSeconds, 0);
});

test("text safety rejects controls but preserves markup as inert text", () => {
  const s = getExplainerScriptFixture(); s.scenes[0].narration = "Hello\u202eworld";
  assert.throws(() => normalizeScript(s), ScriptNormalizationError);
  s.scenes[0].narration = "!!!"; assert.throws(() => normalizeScript(s), ScriptNormalizationError);
  s.scenes[0].narration = "Explain <book> XML tags.";
  const n = normalizeScript(s); assert.equal(n.scenes[0].narration, s.scenes[0].narration);
  assert.ok(n.warnings.some(w => w.code === "MARKUP_AS_TEXT"));
});

test("content rules cover comparison, process, statistics, and default diagrams", () => {
  for (const [content, expected] of [
    ["Compare JSON versus XML.", "comparison"],
    ["Photosynthesis is a process. First absorb light, then make sugar.", "process"],
    ["The survey reports 25 percent.", "statistic"],
    ["Gravity attracts objects with mass.", "diagram"],
    ["Compare 25 percent versus 50 percent, then explain.", "comparison"],
  ]) {
    const s = getExplainerScriptFixture(); s.scenes[1] = { narration: content, visualDirection: "Show the idea." };
    const board = buildStoryboard(s); assert.equal(board.scenes[1].visualType, expected);
    assert.equal(board.scenes[0].visualType, "title"); assert.equal(board.scenes.at(-1)?.visualType, "summary");
  }
});

test("IDs and output stable across calls; output schema rejects inconsistent data", () => {
  const s = getExplainerScriptFixture(); const a = buildStoryboard(s);
  assert.deepEqual(a, buildStoryboard(s)); assert.equal(a.scenes[0].id, "scene-001");
  assert.equal(storyboardSchema.safeParse(a).success, true);
  const duplicate = structuredClone(a); duplicate.scenes[1].id = duplicate.scenes[0].id;
  assert.equal(storyboardSchema.safeParse(duplicate).success, false);
  const bad = structuredClone(a); bad.estimatedDurationSeconds += 10;
  assert.equal(storyboardSchema.safeParse(bad).success, false);
  const animation = structuredClone(a); animation.scenes[0].animation.enterSeconds = 999;
  assert.equal(storyboardSchema.safeParse(animation).success, false);
  assert.equal(storyboardSchema.safeParse({ ...a, scenes: [] }).success, false);
});


test("duration policy thresholds are inclusive and based on target", () => {
  for (const [target, estimate, expected] of [
    [45, 54, "within_target"], [45, 54.001, "soft_overrun"],
    [45, 60.75, "soft_overrun"], [45, 60.751, "requires_revision"],
    [15, 20, "within_target"], [15, 25, "soft_overrun"],
    [120, 144, "within_target"], [120, 162, "soft_overrun"],
    [120, 162.001, "requires_revision"],
  ] as const) assert.equal(evaluateDurationPolicy(target, estimate).classification, expected);
  const bridge = evaluateDurationPolicy(45, 79.384);
  assert.equal(bridge.overrunSeconds, 34.384); assert.equal(bridge.overrunPercent, 76.409);
  assert.equal(bridge.classification, "requires_revision");
  assert.equal(evaluateDurationPolicy(45, 30).overrunPercent, 0);
});

test("custom policy configuration validates defaults and rejects invalid input", () => {
  assert.equal(resolveDurationPolicy().wordsPerMinute, 130);
  assert.equal(evaluateDurationPolicy(45, 55, { toleranceSeconds: 10 }).classification, "within_target");
  for (const config of [{ wordsPerMinute: 0 }, { tolerancePercent: -1 }, { revisionSeconds: 2 },
    { toleranceSeconds: Number.NaN }, { revisionPercent: Infinity }, { wordsPerMinute: 241 }]) {
    assert.throws(() => resolveDurationPolicy(config));
  }
  assert.throws(() => resolveDurationPolicy({ unknown: true } as never));
  const s = getExplainerScriptFixture(); s.scenes[0].narration = Array(130).fill("word").join(" ");
  const n = normalizeScript(s, { wordsPerMinute: 120 });
  assert.equal(n.scenes[0].estimatedDurationSeconds, 65);
  assert.equal(buildStoryboard(s, { wordsPerMinute: 120 }).wordsPerMinute, 120);
});

test("every classification preserves narration and is deterministic", () => {
  for (const [words, classification] of [[100, "within_target"], [125, "soft_overrun"], [172, "requires_revision"]] as const) {
    const s = getExplainerScriptFixture();
    s.scenes = [0, 1, 2].map(i => ({ narration: Array(Math.floor(words / 3) + (i < words % 3 ? 1 : 0)).fill("word").join(" "), visualDirection: "Show text." }));
    const n = normalizeScript(s); const b = buildStoryboard(s);
    assert.equal(n.durationPolicy.classification, classification);
    assert.deepEqual(n.scenes.map(x => x.narration), s.scenes.map(x => x.narration));
    assert.deepEqual(b.scenes.map(x => x.narration), n.scenes.map(x => x.narration));
    assert.deepEqual(n, normalizeScript(s)); assert.deepEqual(b, buildStoryboard(s));
    assert.deepEqual(b.durationPolicy, n.durationPolicy);
    const corrupt = structuredClone(b); corrupt.durationPolicy.classification = "soft_overrun";
    corrupt.durationPolicy.overrunSeconds += 1;
    assert.equal(storyboardSchema.safeParse(corrupt).success, false);
  }
});
