# Block 09: local website jobs and manual review

Implementation is automated-test verified only. No live inference or video encoding was run for this block. Run the following tests manually before treating website generation as reviewed. Videos remain silent; no TTS was added.

## Inspection and architecture

The actual fixture directory is `app/api/video_gen/fixtures/block05/`. Its existing `explainerScriptSchema` requires title, audience, declared target duration and 3–8 ordered narration/visual-direction scenes, with strict fields and length limits. Runtime answers are newly generated; existing example fixtures are not substituted.

The existing supported renderer entry point is `explain()` in `explain-pipeline.ts` (CLI: `npm run explain -- ...`). It supports saved scripts, visual checkpoints, bounded sequential planning, evidence/uncertainty validation, duration approval, and exclusive publication of one MP4 plus its JSON sidecar. The old `/api/video_gen` route generates only a script. The inspected homepage was the Next starter page, with no video submission form.

New jobs call those TypeScript functions directly, without shell commands. Each job explicitly selects the existing local Ollama provider for script and visual inference, regardless of `VIDEO_GEN_PROVIDER`. Existing CLI defaults remain unchanged, including configured OpenRouter/NVIDIA use. This block adds no cloud API. The legacy script-only API now also requires server authentication so it cannot become an unauthenticated generation backdoor when LAN binding is enabled.

Next loads `@remotion/bundler` and `@remotion/renderer` as server-external packages. The real dev-server smoke check caught Turbopack trying to compile a native-tool README before this configuration fix; the corrected routes now compile and fail closed on missing server authentication configuration.

API contract (all requests except OPTIONS require `Authorization: Bearer <ASTRA_ACCESS_TOKEN>`):

- `POST /api/generate`: strict `{topic, targetAudience?, durationSeconds?, orientation?, visualActions?}`. Topic 1–500 characters, audience 1–120, integer duration 15–120 seconds. Orientation defaults to portrait; visual actions default off. No client paths, commands, models or overrun approvals. Returns HTTP 202 and job record.
- `GET /api/jobs/<UUID>`: safe status, saved narration when available, estimated duration, sanitized error code. States: `queued`, `script_generation`, `visual_planning`, `rendering`, `completed`, `failed`.
- `POST /api/jobs/<UUID>/resume`: strict `{approveOverrun:false}` by default. Only failed jobs can resume. Explicit `true` is required to approve a saved script's overrun; inspect its narration first. Completed/active jobs cannot be processed twice.
- `GET /api/jobs/<UUID>/video`: authenticated finalized MP4, attachment filename and single-range streaming support. Unknown/incomplete jobs and invalid IDs cannot select arbitrary files.

Queue capacity is four total queued/active jobs, processed one at a time. A process-wide service plus PID file lock prevents duplicate workers; no parallel model/render execution is started by the queue. Records live on disk, without retained unbounded job history in memory. Restart recovers interrupted jobs as failed `INTERRUPTED`; queued jobs restart when an authenticated request initializes the service. Use resume for failed jobs. Valid saved scripts and completed scene checkpoints are reused. A failure before any valid script exists necessarily needs script generation on retry.

Per-job files, relative to `next-app/`:

```text
app/api/video_gen/fixtures/block05/generated-<UUID>.script.json
artifacts/jobs/<UUID>/job.json
artifacts/jobs/<UUID>/events.ndjson
artifacts/jobs/<UUID>/request.json
artifacts/jobs/<UUID>/final.mp4
artifacts/jobs/<UUID>/final.mp4.json
```

The existing planner also writes its diagnostic artifacts/checkpoints beside the request receipt. Script metrics and sanitized failure codes go to `events.ndjson`; model planning diagnostics use the existing redaction mechanism. No token is logged. Completion requires finalized files plus ffprobe verification of codec, frame count, duration and dimensions against the sidecar. An invalid existing output pair is preserved and fails verification; it is never overwritten as a recovery shortcut.

## 1. Configure and start the laptop

From the repository root:

```bash
cd next-app
```

Generate a dedicated server access token locally, then put its value into the ignored `.env.local`. Do not reuse or expose your OpenRouter key:

```bash
node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex") + "\n")'
```

Add these settings to `.env.local` (replace the token placeholder). Keep existing provider credentials private. Do not use `NEXT_PUBLIC_` for secrets:

```dotenv
ASTRA_ACCESS_TOKEN=replace_with_generated_token
ASTRA_ALLOWED_ORIGINS=http://127.0.0.1:3000,http://localhost:3000
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:3b
```

The token must contain at least 24 characters. With no configured token the API fails closed with 503. Start your already installed local Ollama service if necessary; check the model without downloading another model:

```bash
ollama list
ffprobe -version
npm run dev
```

Rendering also needs the existing installed Chrome executable. The renderer uses `REMOTION_BROWSER_EXECUTABLE` if configured, otherwise `/usr/bin/google-chrome`; point that variable to your installed compatible browser if needed. This integration does not download a browser.

The default dev/start scripts bind only `127.0.0.1`. Keep this persistent server running; this is a single-laptop worker, not a serverless deployment. Do not run a second server or manual generation CLI concurrently on this low-memory machine.

## 2. Submit one prompt on the laptop

Open `http://127.0.0.1:3000`. Enter the **server access token**, a prompt such as “Why do bridges vibrate? Explain wind and traffic for beginners,” and 45 seconds. Leave experimental visual actions off for general topics. Submit once, keep the UUID, and observe stages. Fast stages may finish between two-second polls. Closing the browser does not cancel the server job.

The target duration is not an automatic permission to truncate narration. If duration approval is required, review the saved narration and explicitly press the approval/resume button. Other failures show sanitized codes; inspect local diagnostics before resuming. A passing automated test does not establish Qwen's live factual or visual quality.

Optional API equivalent in another laptop terminal, still inside `next-app/`:

```bash
read -rs -p 'Server access token: ' ASTRA_TOKEN
printf '\n'
curl --fail-with-body http://127.0.0.1:3000/api/generate \
  -H "Authorization: Bearer $ASTRA_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"topic":"Why do bridges vibrate? Explain wind and traffic for beginners.","targetAudience":"Beginners","durationSeconds":45}' \
  -o /tmp/astra-job.json
job_id=$(node -p 'JSON.parse(require("node:fs").readFileSync("/tmp/astra-job.json","utf8")).id')
printf 'Job: %s\n' "$job_id"
curl --fail-with-body -H "Authorization: Bearer $ASTRA_TOKEN" \
  "http://127.0.0.1:3000/api/jobs/$job_id"
```

Run the status request again as needed. HTTP 202 acknowledges queuing, not a completed video. HTTP 429 means the bounded queue is full. Do not resubmit a prompt merely because the browser lost its connection: reopen its UUID first.

## 3. Use a second computer on the same trusted LAN

Find the laptop's LAN IP with `hostname -I` and choose the Wi-Fi/Ethernet address, for example `192.168.1.50`. Stop the local server when idle. Add its exact browser origin to `.env.local`:

```dotenv
ASTRA_ALLOWED_ORIGINS=http://127.0.0.1:3000,http://localhost:3000,http://192.168.1.50:3000
```

Restart with explicit LAN binding:

```bash
npm run dev:lan
```

On the second computer, visit `http://192.168.1.50:3000`, enter the shared server token privately, and use the same form. The site makes same-origin API requests. Allow port 3000 only on your trusted local network if your firewall requires it. Keep Ollama on laptop loopback; do not expose port 11434 or port-forward this server to the internet. Plain HTTP LAN access is intended for a trusted network; public hosting would need a separate TLS/auth/deployment design.

For an independently hosted frontend, explicitly allow its exact origin (including scheme/port) in `ASTRA_ALLOWED_ORIGINS`; no wildcard CORS is supported. This implementation's supplied page uses relative API URLs. Next's development asset allowlist is derived from the configured origin hostnames. Restart after env changes. `npm run start:lan` is the explicit production LAN bind after a successful local build; no production build/deployment was performed in this block.

The shared token grants access to all jobs; there is no per-user ownership system. It stays only in browser memory, while the last UUID alone is stored locally. Refreshing requires reentering the token and reopening the saved job.

## 4. Inspect saved script, progress, and logs

Set `job_id` to your returned UUID if using the browser instead of curl:

```bash
job_id='replace-with-returned-UUID'
cat "app/api/video_gen/fixtures/block05/generated-$job_id.script.json"
cat "artifacts/jobs/$job_id/job.json"
cat "artifacts/jobs/$job_id/events.ndjson"
node -e 'const fs=require("node:fs");const p="artifacts/jobs/"+process.argv[1]+"/request.json";console.log(JSON.stringify(JSON.parse(fs.readFileSync(p,"utf8")),null,2))' "$job_id"
```

The fixture appears only after a valid live-generated script is saved. Check that it addresses your submitted prompt and preserves narration, and that request provenance reports Ollama. Inspect visual attempts/failure diagnostics in the receipt when planning fails. The server terminal logs job UUID, state and sanitized code. Treat prompt/script/diagnostic artifacts as private project data; don't share `.env.local`.

## 5. Download, play, and inspect the completed video

In the website, completion enables **Load preview and download**, then a player and **Download MP4**. This loads the authorized MP4 as a browser blob so the token never appears in its URL. It temporarily uses browser memory proportional to file size.

On the laptop, the finalized output is directly playable:

```bash
ffprobe -v error -show_entries stream=codec_name,width,height,nb_frames:format=duration \
  -of json "artifacts/jobs/$job_id/final.mp4"
ffplay -autoexit "artifacts/jobs/$job_id/final.mp4"
```

To test authenticated downloading from either computer, use the laptop address reachable from that computer (loopback below is only for the laptop). These commands keep HTTP failures out of an apparent final MP4:

```bash
mkdir -p artifacts/tests/block09/manual
if curl --fail-with-body -H "Authorization: Bearer $ASTRA_TOKEN" \
  "http://127.0.0.1:3000/api/jobs/$job_id/video" \
  -o "/tmp/astra-$job_id.download"; then
  mv -n "/tmp/astra-$job_id.download" "artifacts/tests/block09/manual/astra-$job_id.mp4"
fi
ffplay -autoexit "artifacts/tests/block09/manual/astra-$job_id.mp4"
```

Review every scene for topic relevance, visible progression, readable labels and correct order. Compare sidecar narration with the saved script; confirm portrait dimensions unless landscape was explicitly requested. The silent output has no audio/caption synchronization. Keep the UUID and report any live validation, rendering, LAN or playback failures before starting another block.

## 6. Failure and recovery checks

First test safe rejection: missing Authorization must return 401, empty topic must return 400 with no job, an unknown UUID must return 404 after authentication, and a queued/failed UUID's video must return 409 rather than a finalized MP4. The automated suite covers traversal, body limits, serial processing, duplicate resumes and queue saturation.

For an accepted job that deterministically fails without model generation, stop the idle server and temporarily launch with an unreachable local Ollama port:

```bash
OLLAMA_BASE_URL=http://127.0.0.1:1 npm run dev
```

Submit one valid prompt. Observe `failed` (sanitized provider error), no completed preview/download button, and video endpoint rejection:

```bash
curl -i -H "Authorization: Bearer $ASTRA_TOKEN" \
  "http://127.0.0.1:3000/api/jobs/$job_id/video"
```

Use that failed job's UUID, not a prior successful one. Inspect its `job.json` and `events.ndjson`; no valid script/final video should have been published. Stop this server and restart normally with `npm run dev` (or `dev:lan`). Resume through the website, or:

```bash
curl --fail-with-body -X POST -H "Authorization: Bearer $ASTRA_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"approveOverrun":false}' \
  "http://127.0.0.1:3000/api/jobs/$job_id/resume"
```

This retry legitimately generates a script because the unreachable-provider attempt never produced one. For real planning failures after a script exists, compare the fixture before/after resume: it must be reused, with completed visual checkpoints preserved. Never set `approveOverrun:true` without reviewing that saved script.

If the process is killed during work, restart and reopen the UUID. The worker marks interrupted active work failed; explicit resume reuses its artifacts. Dead worker PID locks are recovered. A corrupt lock, reused PID, or an existing exclusive render-publication lock can require owner investigation; do not blindly remove locks or output files. The queue is a single persistent local process, not a distributed transactional worker. Disk records accumulate intentionally; no automatic retention/deletion policy was added.

## Automated verification and exact changed files

Executed: `npm run test:storyboard` (9 pass); `npm run test:render` (66 pass: render 18, pipeline 15, inference 12, actions 6, OpenRouter 6, jobs/UI 9); `npm run lint`; scoped strict TypeScript covering CLI, planner/tests, renderer, job routes, homepage and Next config; `git diff --check`. Tests inject fake inference/rendering or exercise validation only; no live model call or real encode is required. Browser interaction, live Qwen output, actual MP4 verification/playback and second-computer access remain manual.

HTTP smoke checks against the existing dev server: homepage 200 with the new form; generation/status routes 503 `SERVER_CONFIGURATION` because `ASTRA_ACCESS_TOKEN` is not configured yet. No job was enqueued. The separately attempted port-3109 dev server was refused by Next's existing-server lock; the user's existing server was left running.

Reproduce the scoped TypeScript checks from `next-app/`:

```bash
node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module commonjs \
  --moduleResolution node --jsx react-jsx --strict --skipLibCheck --esModuleInterop --types node \
  app/api/video_gen/explain-cli.ts app/api/video_gen/explain.test.ts \
  app/api/video_gen/inference.test.ts app/api/video_gen/openrouter.test.ts \
  app/api/video_gen/visual-actions.test.ts app/api/video_gen/generate-script-cli.ts \
  app/api/video_gen/render-cli.ts app/api/video_gen/render.test.ts \
  app/api/video_gen/remotion/index.tsx app/api/jobs/jobs.test.ts \
  app/api/generate/route.ts 'app/api/jobs/[id]/route.ts' \
  'app/api/jobs/[id]/video/route.ts' 'app/api/jobs/[id]/resume/route.ts' \
  app/api/video_gen/route.ts app/page.tsx
node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module commonjs \
  --moduleResolution node --strict --skipLibCheck --esModuleInterop --types node next.config.ts
```

These are separate scopes: importing Next config also loads Next's readonly `NODE_ENV` type augmentation, which conflicts with existing environment-mutation test code if combined into a single scope. Both scopes pass separately; this is not a claim of a full Next production build.

Added:

- `app/api/generate/route.ts`
- `app/api/jobs/contracts.ts`, `security.ts`, `service.ts`, `http.ts`, `jobs.test.ts`
- `app/api/jobs/[id]/route.ts`, `[id]/resume/route.ts`, `[id]/video/route.ts`
- `app/api/video_gen/manual-block09-checks.md`

Modified:

- `app/page.tsx`, `app/layout.tsx`
- `app/api/video_gen/ollama.ts`, `inference.ts`, `script-generator.ts`, `model-visual-plan.ts`, `visual-actions.ts`, `explain-pipeline.ts` (explicit provider override; CLI defaults preserved)
- `app/api/video_gen/route.ts` (authenticate existing script-only endpoint)
- `app/api/video_gen/run-storyboard.mjs` (stable compiler root and job suite)
- `package.json`, `next.config.ts`, `.gitignore`
- `app/api/video_gen/README.md`
- repository-root `ASTRA STUDIO EXPLAINER CONTEXT.md`

No model/dependency installation, TTS, commit or push was performed. Stop here pending manual review.
