import { existsSync, mkdirSync, openSync, closeSync, unlinkSync, writeFileSync, copyFileSync, linkSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";

export function outputPaths(title: string, requested?: string, root = "artifacts/videos") {
  const slug = title.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "explainer";
  const video = path.resolve(requested ?? path.join(root, slug, "final.mp4"));
  if (path.extname(video) !== ".mp4") throw new Error("Output must end in .mp4");
  return { video, metadata: `${video}.json`, lock: `${video}.lock` };
}

// A lock prevents two requests from racing to publish the same final filename.
export function reserveOutput(paths: ReturnType<typeof outputPaths>) {
  mkdirSync(path.dirname(paths.video), { recursive: true });
  const handle = openSync(paths.lock, "wx");
  const release = () => { closeSync(handle); unlinkSync(paths.lock); };
  if (existsSync(paths.video) || existsSync(paths.metadata)) {
    release();
    throw new Error("Output already exists; choose a new filename. Nothing was overwritten.");
  }
  return release;
}

export function publishOutput(paths: ReturnType<typeof outputPaths>, temporaryVideo: string, metadata: unknown) {
  if (existsSync(paths.video) || existsSync(paths.metadata)) throw new Error("Output already exists; nothing was overwritten.");
  // Stage a complete pair on the destination filesystem. Exclusive hard links
  // publish complete files atomically, even when /tmp is a different filesystem.
  const staging = mkdtempSync(path.join(path.dirname(paths.video), ".publish-"));
  let videoPublished = false;
  try {
    const stagedVideo = path.join(staging, "final.mp4"), stagedMetadata = path.join(staging, "final.mp4.json");
    copyFileSync(temporaryVideo, stagedVideo);
    writeFileSync(stagedMetadata, JSON.stringify(metadata, null, 2));
    linkSync(stagedVideo, paths.video); videoPublished = true;
    try { linkSync(stagedMetadata, paths.metadata); }
    catch (error) { if (videoPublished) unlinkSync(paths.video); throw error; }
  } finally { rmSync(staging, { recursive: true, force: true }); }
}
