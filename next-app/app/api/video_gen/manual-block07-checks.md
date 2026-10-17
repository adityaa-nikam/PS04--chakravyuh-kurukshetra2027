# Block 07: reliable local inference and manual review

Implementation is complete; the live run and video review below are pending the
user. No live generation or video render was run during this block. Run only one
inference workflow at a time, with the existing Ollama service/model available.
Commands run from `next-app/`. Do not delete or overwrite `xml-json-live` artifacts.

## Diagnosis and limits

The old `/api/chat` call used `stream:false`, a JSON Schema `format`, temperature 0,
a fixed 180,000 ms abort timeout, script cap 2,048 output tokens, and a whole-storyboard
visual cap 6,144 tokens. The latter selected an explicit 8,192-token context; the
script left context at the server default. No retry, quality check, per-scene
checkpoint, provider timings, or output counts existed. An abort exposed only a
provider timeout, not whether loading, prompt processing, swapping, or output
prediction consumed the time. Historical 92-second generation and repeated
180-second planning failures are user observations, not timings reconstructed here.

The saved failed script contains 635 counted words against a 45-second target
(~97 words at the unchanged 130 wpm). Narrations are 1,200/1,196/1,199 characters,
near the original schema ceilings; the old implementation accepted repetition and
used actual narration duration. Its all-scene user payload was 4,244 UTF-8 bytes
(before system text/schema). The same source is ~1,504/1,496/1,499 bytes per call
now (without an optional shared record). This is not evidence that prompt size
alone caused the timeout. Schema size, cold loading, context allocation, generation
length, CPU speed, and RAM pressure also matter. Per-scene planning bounds each
request but is not guaranteed to reduce total runtime because it makes more calls.

Read-only server inspection returned Ollama **0.40.5**, installed `qwen2.5:3b`
**3.1B Q4_K_M**, declared model context capacity 32,768, and no loaded model in
`/api/ps`. This capacity is not the configured runtime context. Host memory samples
showed ~1.0–2.5 GiB available of 7.3 GiB RAM, with ~3.3–3.6 GiB of 4 GiB swap
occupied; brief vmstat samples showed some swap-ins. These are current samples,
not proof of the historical timeout cause. The reported historical 2.4 GB model
RSS was not measurable while the model was unloaded. Other desktop applications
also consume RAM. There was no model/service restart, download, or dependency install.

The request fields/options and nanosecond response metrics were checked against
[the installed-version Ollama API definitions](https://github.com/ollama/ollama/blob/v0.40.5/api/types.go)
and [the chat API](https://docs.ollama.com/api/chat). Existing configuration
`OLLAMA_BASE_URL` and `OLLAMA_MODEL` still applies. New optional environment settings
(shell or `.env.local`, with shell taking precedence):

| Setting | Default | Accepted range |
| --- | --- | --- |
| `OLLAMA_SCRIPT_TIMEOUT_MS` | 180000 | 1000–600000 |
| `OLLAMA_VISUAL_TIMEOUT_MS` | 180000 per scene | 1000–600000 |
| `OLLAMA_NUM_CTX` | 4096 | 2048–8192 |
| `OLLAMA_SCRIPT_MAX_TOKENS` | duration-derived, 384 + 5 × target words, capped 2048 | 256–4096 |
| `OLLAMA_VISUAL_MAX_TOKENS` | 1536 per scene | 256–4096 |

All are validated integers. The output cap must leave context space for input.
The prompt-size estimate is UTF-8 bytes/4, **not** an exact tokenizer; schema bytes
are reported separately (grammar is sent in `format`). Server truncation is disabled.
Actual prompt/evaluation token counts are recorded when the server supplies them.
`keep_alive:1m` retains the model between nearby sequential scenes without keeping
it resident indefinitely; temperature 0, repeat penalty 1.1, repeat window 128.
No default timeout was raised. A low output cap causes a clear failure, not a
silently shortened plan. Do not raise context/output limits blindly under RAM pressure.

Fresh scripts use exactly 3 scenes up to 60 seconds, 4 up to 90, 5 up to 120.
Total narration budget is floor(target seconds × 130/60), distributed by purpose;
45 seconds allocates 24/48/25 words. Small counting tolerances are +10% overall
and +15% per scene (minimum 3 words). Repeated sentences of six or more words or
repeated 16-word passages are rejected. This detects literal repetition, not every
semantic paraphrase. No automatic regeneration or truncation occurs. An invalid
fresh script stops before visual planning. Saved older narration is preserved and
still governed by the existing duration approval policy, not rewritten to fit new
budgets. Evidence/schema checks are not factual verification (`factChecked:false`).

Each visual call contains title, audience, one local scene, position, and optionally
one compact previously validated example. Validated prefixes are checkpointed in
`request.json` as `completedScenes`; resume revalidates them against current source
and continues with the first missing scene. The complete plan is revalidated using
the same domain/evidence/example/action rules. One process serializes all its model
calls; separate CLI processes/external clients must still be run sequentially.
Only connection failures and HTTP 429/503 get one 250 ms delayed retry. Malformed
JSON/schema/semantic failures, output-limit failures and timeouts are not retried.
`--replan` explicitly forks a receipt and starts fresh scene planning, preserving
its original receipt and narration. It is not the normal recovery for a timeout.

## One fresh live request: inspection first

First check resources without loading the model:

```sh
free -h
vmstat 1 5
curl --max-time 5 -sS http://localhost:11434/api/version
curl --max-time 5 -sS http://localhost:11434/api/ps
```

Use a fresh directory name if `xml-json-block07` already exists. The following
command performs live script generation and sequential visual planning, validates,
and saves the resolved plan; **it does not encode or publish a video**:

```sh
npm run explain -- 'Explain XML vs JSON to a beginner. Show the same small data structure represented in both formats, compare their structure, and explain when each is useful. Use one short illustrative record, clearly identified as an example, with a root name and literal field names and values. Develop each scene without repeating explanations.' --duration 45 --inspect --output artifacts/videos/xml-json-block07/final.mp4
```

Inspect `[video_gen] script_quality` (budgets and actual word counts) and the
printed receipt/inspection paths. If script validation fails, stop and review the
reason. There is no saved valid script to resume in that case; a new invocation
is an explicit new generation, not an automatic retry. For a scene failure, use
the printed saved receipt with `--resume ... --inspect`; it preserves the script
and all validated scenes. Do not start another raw-prompt generation as recovery.
If a saved older script needs overrun approval, inspect the duration and add
`--approve-overrun` only if you approve that exact script, on every invocation that
needs it. Never approve repetition merely to bypass fresh-script quality validation.

Set this to the **actual receipt printed above**, not a receipt from an older run:

```sh
request_receipt='artifacts/requests/request-ID/request.json'
node - "$request_receipt" <<'NODE'
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const receipt = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const report = JSON.parse(fs.readFileSync(path.join(path.dirname(process.argv[2]), 'resolved-plan.json'), 'utf8'));
assert.equal(report.mode, 'inspection-only'); assert.equal(report.published, false);
assert.equal(report.settings.width, 720); assert.equal(report.settings.height, 1280);
assert.ok(!fs.existsSync(report.output)); assert.ok(!fs.existsSync(report.metadata));
assert.deepEqual(report.storyboard.scenes.map(s => s.narration), receipt.script.scenes.map(s => s.narration));
assert.deepEqual(report.visuals, receipt.visualPlan.scenes.map(s => s.visual));
assert.deepEqual(report.visuals.map(v => v.sceneId), report.storyboard.scenes.map(s => s.id));
assert.ok(report.visuals.every(v => v.renderer === 'graph'));
assert.ok(report.visuals.some(v => v.graph.layout === 'comparison' && v.graph.example));
assert.ok(report.visuals.every(v => v.graph.actions.length > 0));
console.table(report.storyboard.scenes.map((s, i) => ({ id:s.id, words:(s.narration.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)||[]).length, seconds:s.estimatedDurationSeconds, layout:report.visuals[i].graph.layout, heading:report.visuals[i].heading })));
console.table(receipt.inferenceDiagnostics.map(d => ({ stage:d.stage, scene:d.sceneId, attempt:d.attempt, status:d.status, reason:d.reason, elapsedMs:d.elapsedMs, inputBytes:d.inputBytes, schemaBytes:d.schemaBytes, estimatedInputTokens:d.estimatedInputTokens, outputBytes:d.outputBytes, outputTokens:d.outputTokens, promptTokens:d.promptTokens, loadMs:d.loadMs, promptEvalMs:d.promptEvalMs, evalMs:d.evalMs, providerTotalMs:d.providerTotalMs })));
console.log(JSON.stringify({ durationSeconds:report.durationSeconds, policy:report.storyboard.durationPolicy, visuals:report.visuals, factChecked:report.factChecked }, null, 2));
NODE
```

Read all narration and visual evidence. Confirm progressive scene purposes, no
repetition, a meaningful comparison, one identical source-backed example on both
sides, and intended reveal/highlight/transfer timing. An all-overview plan can be
safe but is not an adequate result for this requested comparison; stop and report
it rather than rendering a misleading success. `graph.example` is one record from
which both escaped JSON/XML representations are derived. No model code executes.

## Render the inspected saved request, then review

Only after the preceding checks pass, use the same receipt and fresh intended path:

```sh
npm run explain -- --resume "$request_receipt" --output artifacts/videos/xml-json-block07/final.mp4
node app/api/video_gen/inspect-render.mjs artifacts/videos/xml-json-block07/final.mp4 artifacts/tests/block07/xml-json-frames --progress
ffplay -autoexit artifacts/videos/xml-json-block07/final.mp4
```

The resume must log `reusing_saved_visual_plan`, with **no inference_start events**.
It renders exactly one final MP4 and `final.mp4.json`; the sidecar preserves original
narration, resolved visuals, per-scene frame allocation and inference diagnostics.
The frame helper probes duration/dimensions/narration/scene order and extracts every
scene midpoint plus early/highlight/late/boundary frames. Open **every PNG**, compare
planned action times to visible states, and watch the entire video. Verify 9:16,
legible escaped examples/labels, changing scene content and purposeful motion,
no bridge, no full narration paragraphs/raw directions, and no audio. Inspect
`provenance.inferenceDiagnostics` and `provenance.factChecked:false` in the sidecar.

Verify overwrite protection without running inference again:

```sh
npm run explain -- --resume "$request_receipt" --output artifacts/videos/xml-json-block07/final.mp4
```

Expected: `Output already exists or is locked`, no model calls, no changes to the
published pair. Automated tests cover duration refusal before planning, explicit
approval on resume, output collisions, failed encoder cleanup, and no publication
on invalid plans; do not deliberately corrupt a live model result or kill an encode
merely to test cleanup. An abrupt kill can leave a lock; inspect it before removal.

Report the actual paths, stage/scene elapsed times, load/prompt/eval times, token
counts and any failed attempts, then your assessment of all frames and playback.
Those live measurements are pending; mocked millisecond timings are not benchmarks.
Do not proceed to TTS or another block before manual approval.

## Automated verification

```sh
npm run test:storyboard
npm run test:render
npm run lint
node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module commonjs --moduleResolution node --jsx react-jsx --strict --skipLibCheck --esModuleInterop --types node app/api/video_gen/explain-cli.ts app/api/video_gen/explain.test.ts app/api/video_gen/inference.test.ts app/api/video_gen/generate-script-cli.ts app/api/video_gen/render-cli.ts app/api/video_gen/render.test.ts app/api/video_gen/remotion/index.tsx app/api/video_gen/route.ts
git diff --check
```

The render suite includes 18 existing render/bridge/photosynthesis/CPU cases,
15 planner/CLI/domain/provenance cases and 5 mocked inference/resource/recovery
cases. Mocked encoders do not create real MP4s. The subprocess environment-loader
check requires permission to launch Node outside restrictive tool sandboxes.

Completed checks: storyboard **9/9**, render/planner/inference **38/38**, lint,
scoped TypeScript and `git diff --check` passed. Logs: `/home/maithili-wagh/Desktop/PS04--chakravyuh-kurukshetra2027/next-app/artifacts/tests/block07/checks-rw1lej6v`.
Original failed MP4, sidecar and request receipt SHA-256 hashes remain unchanged.
Live inference timings and visual review remain pending the manual procedure above.
