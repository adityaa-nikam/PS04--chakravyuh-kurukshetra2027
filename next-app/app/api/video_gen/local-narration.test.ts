import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStoryboard } from "./storyboard";
import { getExplainerScriptFixture } from "./fixture";
import { prepareRender } from "./render-plan";
import { applyNarrationTiming, muxLocalNarration, runLocalTool } from "./local-narration";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const planFor = () => prepareRender(buildStoryboard(getExplainerScriptFixture()), { approveOverrun: true });
test("measured speech extends scenes without shortening reading time or changing narration", () => {
  const plan = planFor(), original = structuredClone(plan);
  const durations = plan.frames.map((f, i) => i === 1 ? f.durationInFrames / plan.settings.fps + 3 : 0.1);
  applyNarrationTiming(plan, durations, "test-voice");
  let cursor = 0;
  for (const [i, frame] of plan.frames.entries()) {
    assert.equal(frame.from, cursor);
    assert.ok(frame.durationInFrames >= original.frames[i].durationInFrames);
    assert.ok(frame.durationInFrames / plan.settings.fps >= durations[i] + 0.35);
    cursor += frame.durationInFrames;
  }
  assert.equal(plan.durationInFrames, cursor);
  assert.deepEqual(plan.storyboard, original.storyboard);
  assert.deepEqual(plan.visuals, original.visuals);
  assert.deepEqual(plan.narration, { engine: "piper", voice: "test-voice", seconds: durations });
});
test("invalid measured durations and unapproved extensions fail before mutation", () => {
  for (const durations of [[], [NaN], [0], [Infinity]]) assert.throws(() => applyNarrationTiming(planFor(), durations, "voice"), /invalid scene audio/);
  const plan = planFor(); plan.settings.approveOverrun = false;
  const before = structuredClone(plan);
  assert.throws(() => applyNarrationTiming(plan, plan.frames.map(f => f.durationInFrames), "voice"), /DURATION_APPROVAL_REQUIRED/);
  assert.deepEqual(plan, before);
});
test("real FFmpeg audio concat preserves scene slots without a video render", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "astra-speech-test-"));
  try {
    const plan = planFor(); plan.settings.fps = 15;
    plan.frames = plan.frames.map((f, i) => ({ ...f, from: i * 15, durationInFrames: 15 }));
    plan.durationInFrames = plan.frames.length * 15;
    // A still PNG video codec exercises actual stream copy/mux, not Remotion.
    const silent = path.join(directory, "silent.mov"), output = path.join(directory, "audio.mov");
    await runLocalTool("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=s=16x16:r=15", "-t", String(plan.frames.length), "-c:v", "png", silent]);
    const files = [];
    for (let i = 0; i < plan.frames.length; i++) {
      const file = path.join(directory, `voice-${i}.wav`); files.push(file);
      await runLocalTool("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `sine=frequency=${440 + i * 100}:duration=0.3`, file]);
    }
    await muxLocalNarration(plan, files, silent, output);
    const probe = JSON.parse(await runLocalTool("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", output]));
    assert.equal(probe.streams.filter((s: { codec_type: string }) => s.codec_type === "audio").length, 1);
    assert.ok(Math.abs(Number(probe.format.duration) - plan.frames.length) < 0.1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("applyNarrationTiming faithfully aligns video length to declared target duration (60s and 45s)", () => {
  // Test 1: 60-second declared target with shorter spoken narration (e.g. 40.2s across 3 scenes)
  const script60 = {
    title: "Python vs Java",
    targetAudience: "Beginners",
    estimatedDurationSeconds: 60,
    scenes: [
      { narration: "What makes Python and Java so different in practice?", visualDirection: "Split screen" },
      { narration: "Python is dynamically typed and great for fast scripting, while Java uses strict static types and compile-time checks.", visualDirection: "Side by side" },
      { narration: "Choose Python for rapid experimentation, or Java for robust enterprise systems.", visualDirection: "Takeaway" },
    ],
  };
  const plan60 = prepareRender(buildStoryboard(script60), { approveOverrun: true, fps: 15 });
  // Spoken audio is 40.24s total: 5.76s + 24.64s + 9.84s
  const spoken60 = [5.76, 24.64, 9.84];
  applyNarrationTiming(plan60, spoken60, "eleven-rachel", "elevenlabs");

  // Video duration must equal declared 60s (900 frames at 15fps)
  assert.equal(plan60.durationInFrames, 900);
  assert.equal(plan60.durationInFrames / plan60.settings.fps, 60);
  let cursor = 0;
  for (let i = 0; i < plan60.frames.length; i++) {
    const f = plan60.frames[i];
    assert.equal(f.from, cursor);
    // Every scene must fit its audio plus breathing room
    assert.ok(f.durationInFrames / 15 >= spoken60[i] + 0.35);
    cursor += f.durationInFrames;
  }
  assert.equal(cursor, 900);

  // Test 2: 45-second declared target with 21s spoken narration
  const script45 = {
    title: "Model Context Protocol",
    targetAudience: "Beginners",
    estimatedDurationSeconds: 45,
    scenes: [
      { narration: "What connects AI models to live context?", visualDirection: "Title diagram" },
      { narration: "MCP standardizes data exchange between LLMs and external knowledge tools.", visualDirection: "Protocol diagram" },
      { narration: "It creates a universal open bridge for intelligent applications.", visualDirection: "Takeaway" },
    ],
  };
  const plan45 = prepareRender(buildStoryboard(script45), { approveOverrun: true, fps: 15 });
  const spoken45 = [2.64, 12.0, 5.84]; // 20.48s total
  applyNarrationTiming(plan45, spoken45, "eleven-rachel", "elevenlabs");

  // Video duration must equal declared 45s (675 frames at 15fps)
  assert.equal(plan45.durationInFrames, 675);
  assert.equal(plan45.durationInFrames / plan45.settings.fps, 45);
  cursor = 0;
  for (let i = 0; i < plan45.frames.length; i++) {
    const f = plan45.frames[i];
    assert.equal(f.from, cursor);
    assert.ok(f.durationInFrames / 15 >= spoken45[i] + 0.35);
    cursor += f.durationInFrames;
  }
  assert.equal(cursor, 675);
});

