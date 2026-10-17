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
