import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { JobService, verifyVideo } from "./service";
import { jobInputSchema } from "./contracts";
import { createJob, jobStatus, resumeJob, jobVideo, preflight } from "./http";
import { access } from "./security";
import { type ExplainerScript } from "../video_gen/schema";
import { generateJson } from "../video_gen/inference";
import { z } from "zod";
import { buildStoryboard } from "../video_gen/storyboard";
import { modelVisualPlanSchema } from "../video_gen/model-visual-plan";
import { renderStoryboard } from "../video_gen/render-service";
import { explain } from "../video_gen/explain-pipeline";

const token = "test-server-token-not-a-real-secret-123456";
process.env.ASTRA_ACCESS_TOKEN = token;
function request(route: string, body?: unknown, auth = true, origin?: string) {
  return new Request(`http://localhost:3000${route}`, { method: body === undefined ? "GET" : "POST", headers: { ...(auth ? { Authorization: `Bearer ${token}` } : {}), ...(origin ? { Origin: origin } : {}), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
}
function source(topic = "A simple topic"): ExplainerScript {
  return { title: topic, targetAudience: "Beginners", estimatedDurationSeconds: 45, scenes: ["Start with a concept.", "Explain the idea clearly.", "Remember the useful takeaway."].map(narration => ({ narration, visualDirection: "Show a source based overview." })) };
}
function setup(overrides: ConstructorParameters<typeof JobService>[3] = {}, capacity = 4) {
  const root = mkdtempSync(path.join(tmpdir(), "astra-jobs-"));
  const fixtures = path.join(root, "fixtures");
  const service = new JobService(path.join(root, "jobs"), fixtures, capacity, {
    generate: async input => source(input.topic),
    run: async (options, deps) => {
      const receipt = JSON.parse(readFileSync(options.resume!, "utf8"));
      const board = buildStoryboard(receipt.script);
      const plan = modelVisualPlanSchema.parse({ scenes: board.scenes.map(s => ({ sceneId: s.id, purpose: "explanation", explanation: "Show the concept", confidence: "overview", visual: { sceneId: s.id, renderer: "graph", concept: "diagram", mode: "overview", heading: "Concept", labels: ["concept"], note: "Conceptual overview", graph: { topic: "general", layout: "overview", nodes: [{ id: "concept", label: "concept", icon: "item", evidence: "concept" }], edges: [], values: [], actions: [] } } })) });
      // Exercise service render-stage observability without a real encoder.
      await deps!.render!(board, {}, {}, options.output);
      void plan;
      writeFileSync(options.output!, "mock-video-bytes"); writeFileSync(`${options.output}.json`, JSON.stringify({ mock: true }));
      return { output: options.output!, metadata: `${options.output}.json`, elapsedSeconds: 0, frames: 1, durationSeconds: 1, width: 720, height: 1280, fps: 15, warnings: [], scenes: [], requestReceipt: options.resume, planning: "mock", factChecked: false };
    },
    render: (async () => ({ output: "", metadata: "", elapsedSeconds: 0, frames: 1, durationSeconds: 1, width: 720, height: 1280, fps: 15, warnings: [], scenes: [] })) as typeof renderStoryboard,
    verify: async (video, metadata) => { assert.ok(existsSync(video) && existsSync(metadata)); },
    ...overrides,
  });
  return { root, fixtures, service, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("strict prompts/options and API authentication/origin/body limits reject unsafe requests before enqueue", async () => {
  const s = setup();
  try {
    for (const input of [{ topic: "" }, { topic: "x", durationSeconds: 4 }, { topic: "x", output: "/etc/passwd" }, { topic: "x", model: "arbitrary" }, { topic: "x", approveOverrun: true }]) {
      assert.equal(jobInputSchema.safeParse(input).success, false);
      assert.equal((await createJob(request("/api/generate", input), () => s.service)).status, 400);
    }
    assert.equal((await createJob(request("/api/generate", { topic: "x" }, false), () => s.service)).status, 401);
    assert.equal((await createJob(request("/api/generate", { topic: "x" }, true, "http://evil.example"), () => s.service)).status, 403);
    const large = new Request("http://localhost:3000/api/generate", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ topic: "x".repeat(9000) }) });
    assert.equal((await createJob(large, () => s.service)).status, 413);
    assert.equal(preflight(request("/api/generate", undefined, false, "http://evil.example")).status, 403);
    process.env.ASTRA_ALLOWED_ORIGINS = "http://trusted.example";
    assert.equal(preflight(request("/api/generate", undefined, false, "http://trusted.example")).headers.get("Access-Control-Allow-Origin"), "http://trusted.example");
    delete process.env.ASTRA_ALLOWED_ORIGINS;
    const saved = process.env.ASTRA_ACCESS_TOKEN; delete process.env.ASTRA_ACCESS_TOKEN;
    try { assert.throws(() => access(request("/api/generate")), /configure/); }
    finally { process.env.ASTRA_ACCESS_TOKEN = saved; }
    assert.equal(readdirSync(path.join(s.root, "jobs")).length, 0);
  } finally { s.cleanup(); }
});

test("unique live-prompt fixtures, output paths, queue bounds, sequential stages and duplicate prevention", async () => {
  let calls = 0, active = 0, peak = 0; const statuses: string[] = [];
  const s = setup({ generate: async input => {
    active++; peak = Math.max(peak, active); calls++;
    await new Promise(resolve => setTimeout(resolve, 5)); active--; return source(input.topic);
  } }, 2);
  try {
    const response = await createJob(request("/api/generate", { topic: "Bridge prompt" }), () => s.service);
    assert.equal(response.status, 202); const first = await response.json(); assert.equal(first.status, "queued");
    const second = s.service.create({ topic: "CPU prompt" });
    assert.throws(() => s.service.create({ topic: "Third" }), /queue is full/);
    assert.throws(() => s.service.resume(first.id, false), /Only failed/);
    const poll = setInterval(() => { statuses.push(s.service.get(first.id).status); }, 1);
    await s.service.drain(); clearInterval(poll);
    assert.equal(peak, 1); assert.equal(calls, 2);
    assert.equal(s.service.get(first.id).status, "completed"); assert.equal(s.service.get(second.id).status, "completed");
    assert.notEqual(s.service.files(first.id).video, s.service.files(second.id).video);
    assert.ok(statuses.includes("script_generation"));
    assert.equal(JSON.parse(readFileSync(s.service.files(first.id).fixture, "utf8")).title, "Bridge prompt");
    assert.equal(JSON.parse(readFileSync(s.service.files(second.id).fixture, "utf8")).title, "CPU prompt");
    await Promise.all([s.service.drain(), s.service.drain()]); assert.equal(calls, 2);
    const another = new JobService(path.join(s.root, "jobs"), s.fixtures, 2, { generate: async () => assert.fail("do not regenerate completed jobs") });
    await another.drain(); assert.equal(calls, 2);
  } finally { s.cleanup(); }
});

test("invalid generated scripts fail without fixture/video; sanitized status does not reveal private failure", async () => {
  const s = setup({ generate: async () => ({ bad: true }) as unknown as ExplainerScript });
  try {
    const job = s.service.create({ topic: "topic" }); await s.service.drain();
    const view = s.service.get(job.id); assert.equal(view.status, "failed"); assert.ok(!view.downloadUrl);
    assert.ok(!existsSync(s.service.files(job.id).fixture)); assert.throws(() => s.service.video(job.id), /No verified/);
    assert.ok(!JSON.stringify(view).includes(s.root));
  } finally { s.cleanup(); }
});

test("failed planning preserves exact script/checkpoint and resumes without another script call", async () => {
  let generated = 0, runs = 0;
  const s = setup({ generate: async () => { generated++; return source(); }, run: async options => {
    runs++; const r = JSON.parse(readFileSync(options.resume!, "utf8"));
    if (runs === 1) { r.checkpointTest = "preserved"; writeFileSync(options.resume!, JSON.stringify(r)); throw new Error("VISUAL_PLAN /private/path secret should never reach browser"); }
    assert.equal(r.checkpointTest, "preserved"); throw new Error("RENDER_FAILED: test encoder failure");
  } });
  try {
    const job = s.service.create({ topic: "topic" }); await s.service.drain();
    assert.equal(s.service.get(job.id).code, "VISUAL_PLAN");
    assert.ok(!JSON.stringify(s.service.get(job.id)).includes("/private/path"));
    const fixture = readFileSync(s.service.files(job.id).fixture, "utf8");
    assert.equal((await resumeJob(request(`/api/jobs/${job.id}/resume`, { approveOverrun: false }), job.id, () => s.service)).status, 202);
    await s.service.drain(); assert.equal(generated, 1); assert.equal(runs, 2);
    assert.equal(readFileSync(s.service.files(job.id).fixture, "utf8"), fixture); assert.equal(s.service.get(job.id).status, "failed");
    assert.throws(() => s.service.video(job.id), /No verified/);
  } finally { s.cleanup(); }
});

test("real pipeline duration guard runs before visuals; explicit saved-script approval resumes without regenerating", async () => {
  let generated = 0, planned = 0;
  const long = source(); long.scenes.forEach(scene => { scene.narration = Array(20).fill("Words in this long narration.").join(" "); });
  const s = setup({ generate: async () => { generated++; return long; }, run: (options, deps) => explain(options, { ...deps, planVisuals: async () => { planned++; throw new Error("VISUAL_PLAN test stop after approval"); } }) });
  try {
    const job = s.service.create({ topic: "long topic" }); await s.service.drain();
    assert.equal(s.service.get(job.id).code, "DURATION_APPROVAL_REQUIRED"); assert.equal(planned, 0);
    s.service.resume(job.id, false); await s.service.drain(); assert.equal(planned, 0);
    s.service.resume(job.id, true); await s.service.drain(); assert.equal(planned, 1); assert.equal(generated, 1);
  } finally { s.cleanup(); }
});

test("downloads reject unknown/incomplete/traversal/unauthorized access and support bounded byte streaming", async () => {
  const s = setup();
  try {
    const job = s.service.create({ topic: "topic" });
    assert.equal(jobVideo(request("/api/video"), job.id, () => s.service).status, 409);
    assert.equal(jobVideo(request("/api/video", undefined, false), job.id, () => s.service).status, 401);
    for (const id of ["../../.env.local", "%2e%2e", "anything.mp4", "/etc/passwd"]) assert.equal(jobVideo(request("/api/video"), id, () => s.service).status, 400);
    assert.equal((await jobStatus(request("/api/jobs/x"), "00000000-0000-4000-8000-000000000000", () => s.service)).status, 404);
    await s.service.drain();
    const download = jobVideo(request("/api/video"), job.id, () => s.service);
    assert.equal(download.status, 200); assert.equal(download.headers.get("Content-Type"), "video/mp4"); assert.equal(await download.text(), "mock-video-bytes");
    const range = new Request("http://localhost:3000/api/video", { headers: { Authorization: `Bearer ${token}`, Range: "bytes=0-3" } });
    const partial = jobVideo(range, job.id, () => s.service); assert.equal(partial.status, 206); assert.equal(await partial.text(), "mock");
    const invalid = new Request("http://localhost:3000/api/video", { headers: { Authorization: `Bearer ${token}`, Range: "bytes=99999-" } });
    assert.equal(jobVideo(invalid, job.id, () => s.service).status, 416);
    assert.throws(() => s.service.resume(job.id, false), /Only failed/);
  } finally { s.cleanup(); }
});

test("interrupted active jobs become failed on restart; finalized pairs are verified before recovered completion", async () => {
  const s = setup();
  try {
    const job = s.service.create({ topic: "topic" });
    const file = s.service.files(job.id).record; const record = JSON.parse(readFileSync(file, "utf8"));
    record.status = "rendering"; writeFileSync(file, JSON.stringify(record));
    const restarted = new JobService(path.join(s.root, "jobs"), s.fixtures, 4, { verify: async () => { throw new Error("bad finalized file"); } });
    assert.equal(restarted.get(job.id).status, "failed"); assert.equal(restarted.get(job.id).code, "INTERRUPTED");
    writeFileSync(restarted.files(job.id).video, "partial"); writeFileSync(restarted.files(job.id).metadata, "{}");
    restarted.resume(job.id, false); await restarted.drain(); assert.equal(restarted.get(job.id).status, "failed");
    assert.throws(() => restarted.video(job.id), /No verified/);
    await assert.rejects(verifyVideo(restarted.files(job.id).video, restarted.files(job.id).metadata));
  } finally { s.cleanup(); }
});

test("job provider override uses Ollama even when the CLI default is OpenRouter", async () => {
  const old = process.env.VIDEO_GEN_PROVIDER; process.env.VIDEO_GEN_PROVIDER = "openrouter";
  const provider = mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    assert.ok(String(url).endsWith("/api/chat")); const body = JSON.parse(String(init?.body)); assert.equal(body.model, process.env.OLLAMA_MODEL || "qwen2.5:3b");
    assert.equal((init?.headers as Record<string, string>).Authorization, undefined);
    return new Response(JSON.stringify({ done: true, message: { content: '{"ok":true}' } }));
  });
  try { assert.deepEqual(await generateJson(z.object({ ok: z.boolean() }), {}, "data", 512, { provider: "ollama" }), { ok: true }); }
  finally { provider.mock.restore(); if (old === undefined) delete process.env.VIDEO_GEN_PROVIDER; else process.env.VIDEO_GEN_PROVIDER = old; }
});

test("minimal website contains one prompt form, access control, progress, review and download controls", async () => {
  const React = await import("react"), { renderToStaticMarkup } = await import("react-dom/server"), { default: Home } = await import("../../page");
  const markup = renderToStaticMarkup(React.createElement(Home));
  assert.equal((markup.match(/<form/g) || []).length, 1);
  assert.match(markup, /Astra Studio/); assert.match(markup, /type="password"/);
  assert.match(markup, /Your job/); assert.match(markup, /Saved job ID/);
  assert.match(markup, /Generate video/); assert.ok(!markup.includes(token));
});
