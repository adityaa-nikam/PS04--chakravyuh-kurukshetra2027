// Offline manual-review helper. Extracts evidence; a person/agent still inspects frames/playback.
import { readFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import path from "node:path";
const [video, directory, progressFlag, ...extra] = process.argv.slice(2);
if (extra.length || (progressFlag && progressFlag !== "--progress")) throw new Error("Only the optional --progress flag is supported.");
if (!video || !directory) throw new Error("Usage: node app/api/video_gen/inspect-render.mjs final.mp4 separate-review-directory [--progress]");
const metadata = JSON.parse(readFileSync(`${video}.json`, "utf8"));
const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,codec_type,width,height,r_frame_rate,nb_frames:format=duration", "-of", "json", video], { encoding: "utf8" }));
assert.equal(probe.streams.length, 1);
const stream = probe.streams[0];
assert.equal(stream.codec_type, "video"); assert.equal(stream.codec_name, "h264");
const [rate, denominator] = stream.r_frame_rate.split("/").map(Number);
assert.equal(rate / denominator, metadata.settings.fps);
assert.equal(stream.width, metadata.settings.width); assert.equal(stream.height, metadata.settings.height);
assert.equal(Number(stream.nb_frames), metadata.durationInFrames);
assert.ok(Math.abs(Number(probe.format.duration) - metadata.durationInFrames / metadata.settings.fps) < 0.1);
assert.deepEqual(metadata.storyboard.scenes.map(s => s.narration), metadata.originalStoryboard.scenes.map(s => s.narration));
mkdirSync(directory, { recursive: true });
let cursor = 0;
for (const [i, frame] of metadata.frames.entries()) {
  const scene = metadata.storyboard.scenes[i];
  assert.equal(frame.from, cursor); assert.equal(frame.id, scene.id);
  cursor += frame.durationInFrames;
  assert.equal(frame.durationInFrames, Math.max(1, Math.ceil(scene.estimatedDurationSeconds * metadata.settings.fps)));
  const seconds = (frame.from + Math.floor(frame.durationInFrames / 2)) / metadata.settings.fps;
  const file = path.resolve(directory, `${scene.id}.png`);
  execFileSync("ffmpeg", ["-v", "error", "-n", "-ss", String(seconds), "-i", video, "-frames:v", "1", file]);
  const visual = metadata.visuals[i];
  if (progressFlag) {
    const samples = new Set([Math.min(2, frame.durationInFrames - 1), ...[0.1, 0.4, 0.7, 0.9].map(fraction => Math.floor((frame.durationInFrames - 1) * fraction)), frame.durationInFrames - 1]);
    for (const localFrame of samples) {
      const at = (frame.from + localFrame) / metadata.settings.fps;
      const image = path.resolve(directory, `${scene.id}-frame-${localFrame}.png`);
      execFileSync("ffmpeg", ["-v", "error", "-n", "-ss", String(at), "-i", video, "-frames:v", "1", image]);
      console.log(JSON.stringify({ scene: frame.id, localFrame, seconds: at, file: image }));
    }
  }
  console.log(JSON.stringify({ scene: frame.id, midpoint: seconds, renderer: visual.renderer, mode: visual.graph?.layout ?? visual.mode, topic: visual.graph?.topic ?? visual.renderer, actions: visual.graph?.actions, example: visual.graph?.example, heading: visual.heading, nodes: visual.graph?.nodes, edges: visual.graph?.edges, file }));
}
assert.equal(cursor, metadata.durationInFrames);
console.log(JSON.stringify({ probe, narrationPreserved: true, sceneOrderVerified: true, durationPolicy: metadata.storyboard.durationPolicy.classification, approved: metadata.settings.approveOverrun }));
