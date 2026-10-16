# Block 01: local explainer scripts

POST `/api/video_gen` generates topic-dependent script JSON with Ollama's native
HTTP `/api/chat` endpoint. No cloud key, Python service, rendering, or TTS is used.
The output format is JSON Schema derived with `z.toJSONSchema` from the existing
Zod schema; generated JSON is parsed and validated with that same schema.

## Run locally

Keep Ollama running. If its desktop app or system service already serves port
11434, leave it running; otherwise run `ollama serve` in a separate terminal.
Check `curl http://localhost:11434/api/version` and `ollama list`.
The installed model is `qwen2.5:3b`; only if missing, run `ollama pull qwen2.5:3b`.
`ollama run qwen2.5:3b` is optional for an interactive check, not required per API request.

Set server-only configuration in ignored `next-app/.env.local`:

```dotenv
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:3b
VIDEO_GEN_USE_FIXTURE=false
```

The URL and model above are defaults. Supply a base URL, not `/api/chat`.
Do not use `NEXT_PUBLIC_` variables. Google variables are no longer read.
Restart Next.js (Ctrl-C in its terminal, then `npm run dev` from `next-app/`).
Run these requests sequentially:

```sh
curl --max-time 195 -i http://localhost:3000/api/video_gen \
  -H 'Content-Type: application/json' \
  -d '{"topic":"JSON vs XML","targetAudience":"Beginners","durationSeconds":45}'

curl --max-time 195 -i http://localhost:3000/api/video_gen \
  -H 'Content-Type: application/json' \
  -d '{"topic":"How photosynthesis works","targetAudience":"Middle school students","durationSeconds":45}'
```

Expect topic-specific titles and narration. After HTTP inference and schema
validation succeed, Next logs `[video_gen] ollama_generation_success` with elapsed
milliseconds and scene count. Fixture requests instead log `fixture mode` and
never log generation success. `ollama ps` can show the loaded model during requests.
No generated text, raw provider error, or environment value is logged.

## Contract and troubleshooting

Only topic is required (1–500 characters). Optional targetAudience is 1–120
characters, default Beginners. Optional durationSeconds is an integer from 15 to
120, default 45. Unknown fields are rejected; body limit is 8 KB. Success remains
an object with title, targetAudience, estimatedDurationSeconds, and 3–8 ordered
scenes containing narration and visualDirection. Duration is an estimate, not
measured audio. Treat model output as text, never executable code or raw HTML.

Errors retain `{ "error": { "code": "...", "message": "..." } }`:

- 400 INVALID_JSON/INVALID_INPUT: fix request syntax or fields.
- 413 BODY_TOO_LARGE: reduce the request body.
- 503 PROVIDER_CONFIGURATION: invalid base URL, denied endpoint access, or HTTP
  404 (missing model/endpoint). Check `ollama list`, the configured model, and URL.
- 502 PROVIDER_FAILURE: unavailable runtime, connection failure, or upstream
  error. Check Ollama is running and inspect its server logs.
- 502 INVALID_OUTPUT: malformed JSON, incomplete envelope, or schema violation.
- 429 PROVIDER_RATE_LIMIT: wait before retrying.
- 504 PROVIDER_TIMEOUT: local loading/inference exceeded 180 seconds. Check RAM,
  CPU/GPU load, and model readiness. Send requests sequentially on limited hardware.
- 500 INTERNAL_ERROR: unexpected application failure.

Calls use `stream: false`, temperature 0, a 2048-token generation cap, a 180-second
abort timeout, and no automatic retries. Failures never fall back to sample data.
A deployed Next server must be able to reach its configured Ollama runtime;
localhost refers to that server, not the developer's laptop.

No test framework was added. Mocked transport checks are distinct from real
inference through the POST endpoint.

## Development fixture

For downstream local development, add this server-only switch to the ignored
`next-app/.env.local` (do not commit that file):

```dotenv
VIDEO_GEN_USE_FIXTURE=true
```

Restart with `npm run dev` from `next-app/`, then request:

```sh
curl -i http://localhost:3000/api/video_gen \
  -H 'Content-Type: application/json' \
  -d '{"topic":"JSON vs XML","durationSeconds":45}'
```

Expect HTTP 200 with the fixed title `JSON vs XML: Two Ways to Structure Data`,
audience `Beginners`, estimated duration 45 seconds, and four ordered scenes.
The server logs `[video_gen] fixture mode: returning deterministic JSON vs XML sample; no provider call.`
No API key is needed in this mode. Input validation still runs first; an empty
topic returns the existing 400 `INVALID_INPUT` error and malformed JSON returns
400 `INVALID_JSON`.

Activation requires BOTH `NODE_ENV === "development"` (set by `next dev`) and
`VIDEO_GEN_USE_FIXTURE === "true"`. Never prefix the switch with `NEXT_PUBLIC_`.
The switch is ignored in production and all other environments, where the
normal provider path and its errors remain active. It is never an error fallback.

To disable, remove the switch or set `VIDEO_GEN_USE_FIXTURE=false`, then restart
the dev server. Real generation again requires a running Ollama instance and the configured model.

This is deterministic sample content, not AI generation. Every valid request
returns the same JSON vs XML script regardless of topic, audience, or duration.
It uses the same output schema as real responses and changes no response fields.
The estimated duration is illustrative, not measured audio timing. Fixture success
does not establish live provider availability or successful AI integration.

## Blocks 02 and 03: normalization and storyboard

`normalizeScript(script)` and `buildStoryboard(script)` are pure functions.
`createStoryboard(normalizedScript)` accepts the normalized intermediate form.
They do not call Ollama or read environment configuration. The existing POST
response is unchanged. Generate once and save its JSON, then reuse it:

```sh
# From next-app/, with Next and Ollama running and fixtures disabled:
curl --fail-with-body --max-time 195 -sS http://localhost:3000/api/video_gen \
  -H 'Content-Type: application/json' \
  -d '{"topic":"JSON vs XML","durationSeconds":45}' -o /tmp/explainer-script.json
npm run --silent storyboard -- /tmp/explainer-script.json > /tmp/storyboard.json
npm run test:storyboard
```

The CLI compiles only the pure modules with the installed TypeScript compiler
into a temporary directory, runs them, then removes that directory. Tests use
Node's built-in test runner; no extra dependency or provider call is needed.

Normalization reuses the original script schema (3–8 scenes, 1200 narration
characters, 400 visual-direction characters, declared duration 15–120 seconds).
It collapses whitespace with a warning, rejects hidden control/bidi override
characters and narration without words, and retains markup-like text with a
warning. Consumers MUST render elements as plain text, never HTML or executable
instructions. This is basic text hygiene, not a sanitizer or factual verification.
`ScriptNormalizationError.issues` supplies field paths and validation messages.

Timing counts Unicode letter/number words, with internal apostrophes retained,
at 130 words/minute. Each scene estimate is rounded to milliseconds; total is
the sum. `timing: "estimated_narration"` is NOT measured TTS/audio timing and does
not account for pauses or transitions. Word segmentation is approximate and
best suited to space-separated languages. No narration is truncated or stretched.
Warnings flag a total outside 15–120 seconds and overruns according to the soft-target policy below. The original declared
estimate remains in the normalized representation.

Storyboard schema version 1 includes title, audience, timing basis, warnings,
1280x720 canvas at 30 fps, and ordered scenes. Each scene contains `id`, narration,
visualDirection, estimatedDurationSeconds, visualType, elements, layout, animation.
IDs are positional (`scene-001`, `scene-001-element-01`), stable for identical
ordered input; insertion/reordering changes positional identity.

Rules in priority order: first scene title; last summary; interior comparison
keywords; numeric percentages/statistic keywords; process/sequence keywords;
otherwise diagram. Rules inspect narration and visual direction, use English
keywords, and do not classify topic truth or invent visual facts.

Each template currently has three typed plain-text elements: heading/header,
narration/body, visual_direction/footer. Visual direction is renderer guidance;
a future renderer may omit that element from the visible composition. No chart
values, images, comparison sides, or process steps are fabricated. Templates
provide fixed padding 64, gap 24, left alignment, and fade entry/exit each lasting
min(0.3 seconds, scene duration / 4). This is a deterministic rendering contract,
not an implemented renderer or detailed automatically drawn diagram.

## Soft duration-target policy

The declared duration is a soft target. No narration is shortened, regenerated,
sped up, or spread evenly across a requested duration. Whitespace normalization
continues as documented; all words and punctuation remain intact. Timing remains
`estimated_narration`, not measured audio. This policy does not fact-check text.

`duration-policy.ts` is the single typed configuration source. Defaults:

- wordsPerMinute: 130
- toleranceSeconds: 5; tolerancePercent: 20
- revisionSeconds: 10; revisionPercent: 35

Overrun = max(0, estimated narration seconds - target). Percentage uses the
TARGET as denominator. Applied tolerance = max(toleranceSeconds,
target * tolerancePercent / 100); revision threshold is calculated similarly.
Overrun <= tolerance is `within_target`; overrun > tolerance but <= revision
threshold is `soft_overrun`; anything higher is `requires_revision`.
Comparison uses unrounded values; displayed metadata is rounded to milliseconds
and three decimal percentage points. Exact equality stays in the lower category.

Both normalized and storyboard output add `durationPolicy` with target, estimate,
overrun seconds/percent, applied thresholds, classification, nullable reason,
and resolved config. Existing fields remain. `DURATION_MISMATCH` now describes
only warning/revision-level OVERRUN, with a reason matching the classification.
The separate `DURATION_OUT_OF_RANGE` warning still describes the 15–120-second
MVP estimate range, even for an underrun. Short scripts are not automatically padded.

Call `normalizeScript(script, overrides)` or `buildStoryboard(script, overrides)`
for deterministic partial overrides. CLI overrides use `--policy /path/config.json`:

```json
{"wordsPerMinute":130,"toleranceSeconds":5,"tolerancePercent":20,"revisionSeconds":10,"revisionPercent":35}
```

Missing fields use defaults. Invalid/unknown fields fail with validation errors;
no silent fallback. WPM must be finite and 60–240, seconds 0–120, percentages
0–100. Each revision threshold must be >= its corresponding tolerance value.
The CLI accepts `--inspect` to output `{normalized, storyboard}`; without it,
it still outputs the storyboard directly. No process environment is read for policy.

**Future rendering contract:** a renderer must refuse `requires_revision` unless
the user explicitly approves that overrun or provides a revised script. Producing
a storyboard does not grant approval. No renderer or approval bypass is implemented.

See [manual-duration-checks.md](./manual-duration-checks.md) for reproducible saved
bridge, synthetic-script, narration-preservation, and repeatability commands.

## Block 04: silent local MP4

Use `npm run render:storyboard -- storyboard.json output.mp4` after saving a
storyboard. This CLI uses Remotion 4.0.536, the existing Chrome binary, and H.264
encoding with no audio track. No change to the script-generation POST endpoint.
See [manual-render-checks.md](./manual-render-checks.md) for exact bridge/within-target
commands, approval rejection checks, ffprobe, per-scene extraction, and text review.

`prepareRender` validates the existing storyboard and duration policy. Unknown
nonempty visual-type names alone are adapted to the diagram fallback; malformed
other fields are still rejected. The original storyboard is preserved in
`output.mp4.json`, together with the resolved render plan, explicit approval,
fallback indexes, scene frame allocations, and elapsed render time.

Block 04B replaces the text slides with a validated visual adapter (`visual-plan.ts`)
and authored SVG/React graphics (`remotion/Visuals.tsx`). Title/hook, process,
labeled diagram, comparison, and summary concepts use deterministic scene-relative
motion. Bridge scenes support wind, traffic, vibration, and highlighted load paths;
title context carries through scenes using pronouns. Unknown topics use an explicitly
labeled abstract concept view, not a claim to have generated realistic imagery.
The registry accepts only fixed renderer names and typed props. Model strings are
React text/data, never HTML, SVG source, scripts, or URLs to execute or fetch.

Visible copy consists of short headings and labels. Neither the narration paragraph
nor raw visual instructions are printed. Full narration, directions, and storyboard
text elements remain verbatim in the JSON sidecar. Display copy is separate metadata,
not a rewrite of the source narration. The adapter is a bounded English keyword
heuristic; it does not interpret arbitrary visual requests or fact-check narration.
Bridge schematics exaggerate motion and are not engineering simulations.

The guard rejects `requires_revision` before browser/bundle/output work unless
`--approve-overrun` is explicitly passed. There is no saved implicit approval or
narration truncation. Each duration uses ceiling(seconds * fps), preserving scene
order and estimates with under one additional frame per scene. Defaults: **720x1280
(9:16)**, 15 fps, one worker. `--width 960 --height 540` retains landscape output.
Scene entry/exit uses the existing fade metadata without overlapping scenes.
Text measurement still fails explicitly if copy cannot fit at a readable minimum.
No TTS, music, captions, downloads, APIs, or new dependencies were added for 04B.

## Block 05: reusable source-grounded visual graphs

The visual adapter now composes typed components and evidence-backed connections
for photosynthesis and CPU instruction/memory flow, alongside the preserved bridge
renderer. Shared templates cover flows, sequences/cycles, cause/effect, comparisons,
source-provided percentage bars, and a source-based overview for uncertain topics.
Explicit validated specs via `--visuals` take precedence over heuristic mappings.
No source-provided HTML, SVG paths, JS, assets or URLs are executed or fetched.

One render invocation produces one final MP4 and its JSON metadata sidecar. Output
is optional: it defaults to `artifacts/videos/<title-slug>/final.mp4`. Existing files
and concurrent writers are refused. Test scripts/renders/frames stay separately
under `artifacts/tests/`, and all artifacts are ignored by Git. No test fixture video
is generated as a side effect of a normal request. Duration approval still applies.

See [manual-block05-checks.md](./manual-block05-checks.md) for exact commands,
completed review paths, expected visual meaning, known limitations, extension
instructions, saved live script provenance, and the TTS review gate.

## Block 06: one terminal prompt, live Qwen planning, one final MP4

```sh
npm run explain -- "Explain XML vs JSON to a beginner"
```

The CLI loads `.env.local` with Next's existing environment loader, runs the local
Ollama script generator, normalizes/builds the storyboard, then asks Qwen for a
schema-validated visual plan. Complete Qwen specifications drive the existing
Remotion renderer; keyword adapters remain available for legacy storyboards and
never override explicit specifications. The CLI always requests live inference,
ignoring the development fixture switch. No Codex runtime or frontend is needed.

The shared graph schema now supports declarative reveal/highlight/transfer/hide
instructions at normalized scene times, authored browser/server/document/database
icons, and equivalent JSON/XML examples derived from a single narration-backed
record. All model content remains inert data. Evidence validation is not fact-checking.

Default output: `artifacts/videos/<safe-prompt-slug>/final.mp4`, plus its metadata
sidecar; `--output` selects an explicit path. Pending overruns preserve the exact
script in `artifacts/requests/` and print a `--resume ... --approve-overrun` command.
A resumed render reuses saved source/plans rather than rerunning generation.
Exclusive publication, collision handling, locks, and failed-render cleanup are
shared with `render:storyboard`. No second demonstration video is generated.

See [manual-block06-checks.md](./manual-block06-checks.md) for the required raw-prompt
live test, expected paths, ffprobe/playback/frame commands, limitations, and review gate.
The earlier Block 05 gate is superseded only for this explicitly requested visual/CLI
work; audio/TTS still requires a separate user instruction after manual review.

## Block 07: bounded local inference

Fresh scripts now receive duration-derived total/per-scene word budgets and reject
literal repetition or excess narration without truncation. Visual planning runs
one scene at a time, checkpoints validated progress, and resumes without repeating
script generation or completed scenes. Local calls share a process-wide serial
lane, with one retry only for transient connection/busy failures. Default context
is 4096 tokens, visual output is capped at 1536 tokens per scene, and timeouts stay
180 seconds. Stage/scene sizes, elapsed times and Ollama token/load/evaluation
metrics are logged and saved with receipts and render provenance. No full prompts
are logged. See [manual-block07-checks.md](./manual-block07-checks.md) for verified
configuration, resource diagnosis, one fresh inspection-first live test, recovery,
frame review/playback, and the manual approval gate. Earlier artifacts stay intact.

## Block 08: opt-in compact visual actions

`--visual-actions` selects a compact action planner; graph planning remains the
default. V1 supports `format_comparison` (one code-owned illustrative XML/JSON record,
structure/field emphasis) and source-grounded uncertain `concept_overview`.
TypeScript constructs the existing validated renderer plan. Model output contains
no graph mechanics or timing, with a 384-token per-scene default cap. Switching a
saved graph receipt requires `--visual-actions --replan`, which forks it without
regenerating narration. Resume retains the fork's saved planner and action prefix.
See [manual-block08-checks.md](./manual-block08-checks.md) for the exact saved-script
live inspection/render commands, example provenance, diagnostics and review gate.
No performance or visual-quality improvement is claimed before that manual test.
