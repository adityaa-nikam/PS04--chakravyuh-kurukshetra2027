# Local narration and plant illustration

Final exports now use local Piper narration by default. OpenRouter still handles
script and visual planning. Piper runs on CPU with one voice loaded per render;
no speech API key or paid speech service is used. It speaks the complete validated
scene narration and measures each WAV with ffprobe. Scene allocations retain their
existing reading time and extend if speech plus a 350ms pause needs more frames.
An extension requires the existing `--approve-overrun` approval. The final MP4
contains H.264 video and AAC audio; a speech failure prevents publication rather
than silently exporting without narration. Existing MP4s are unchanged.

Initial setup from `next-app` (installed locally for this workspace):

```sh
python3 -m venv .venv-tts
.venv-tts/bin/pip install piper-tts==1.4.2
.venv-tts/bin/python -m piper.download_voices en_US-lessac-medium --data-dir artifacts/voices
```

`PIPER_PYTHON` and `PIPER_MODEL` may override the executable and ONNX paths.
`VIDEO_GEN_TTS=off` explicitly requests a silent export; the default is `piper`.
FFmpeg and ffprobe must be available. Include `piper-worker.py` and the local
voice/environment in deployments. See [Piper installation and voices](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/CLI.md).

Photosynthesis flow plans now use `remotion/PlantVisual.tsx`: a full plant with
leaves, stem and roots, stable resource positions, and authored transport routes.
Only source-backed graph edges enable movement. Water travels through roots and
stem; light reaches the leaf; product paths lead out from the plant. Labels remain
visible after introduction. Unsupported/negated relationships add no transfer.
Other subjects keep their existing renderers. This does not invent new teaching
steps or replace the saved script; a short saved script still has few scenes.

Offline verification: `npm run test:animation` and `npm run test:tech`.
Manual review of the latest saved photosynthesis request, without any model call:

```sh
npm run explain -- --resume artifacts/requests/request-y7KAtY/request.json --approve-overrun --output artifacts/videos/photosynthesis-local-voice-review/final.mp4
node app/api/video_gen/inspect-render.mjs artifacts/videos/photosynthesis-local-voice-review/final.mp4 artifacts/tests/photosynthesis-local-voice-review --progress
ffplay -autoexit artifacts/videos/photosynthesis-local-voice-review/final.mp4
```

Review every scene for readable labels, visible inputs/products, source-correct
transfer direction, full narration, pauses, and scene changes after the spoken
sentence. No live OpenRouter call or explainer MP4 render was run for this change.

# Active configuration: OpenRouter for script and all visual planning

The [technical component library](./TECH_COMPONENT_LIBRARY.md) adds reusable RAG,
GraphQL, book, JSON and XML illustrations alongside the existing subjects. It
documents the saved components, supported prompt semantics, inspection/render
commands, limits and extension process. Run `npm run test:tech` for its offline
tests; all generation stages continue to use the configured OpenRouter provider.

The compact visual-action planner now supports `subject_scene` for physical
bridges, photosynthesis and CPU instructions. These choices reuse the authored
bridge/plant/processor graphics from the earlier Block 05 videos. The model is
given only the subjects supported by the scene's narration/title; a generic
overview response is retried when a supported illustration is available.
Illustration directions alone cannot enable a subject or factual relationship.
Source-backed graph connections receive ordered transfer animations and retain
the existing model-plan/render-plan evidence and uncertainty validation.
XML/JSON comparisons retain their dedicated progressive record animation.
New requests can use these choices immediately. Complete saved plans are replayed
unchanged; to improve an older plan, explicitly fork it with:

```sh
npm run explain -- --resume artifacts/requests/request-ID/request.json --visual-actions --replan --inspect --output artifacts/videos/subject-review/final.mp4
```

This uses OpenRouter for visual planning only and preserves the saved narration.
Review the new receipt and resolved plan before rendering. Unknown subjects remain
honest conceptual overviews until an authored illustration is available.

Rendering now runs in `remotion-worker.mjs`, launched by `render-worker.ts` with a
private validated job file and a separate child environment. Console Ninja entries
are removed from `LD_PRELOAD`, and inherited `NODE_OPTIONS` bootstrap hooks are
omitted for this child only. The Next server's environment is unchanged. This
prevents Node-only native hooks from reaching `setpriv`, Chrome and the encoder.
The worker reuses one browser for composition selection and rendering and closes
it on completion/failure. Existing output locks/publication/cleanup still apply.
The worker source must be included alongside the application when deploying.

Use the existing OpenRouter configuration for both the website and CLI. Script,
graph-plan and compact-action generation all use `inference.ts`; no Ollama process
is needed for this configuration. The server-only `.env.local` selects
`VIDEO_GEN_PROVIDER=openrouter` and disables development fixtures. Historical
Ollama examples below are implementation history, not the current run instructions.
Saved artifacts retain their original provenance; replay does not relabel them.

```sh
npm run explain -- "Explain XML versus JSON using one illustrative person record with name Ana" --visual-actions --inspect --output artifacts/videos/xml-json-openrouter-review/final.mp4
```

This command makes live OpenRouter requests but does not render. Review its saved
script/plan, then resume the printed receipt to render. No live request or render
was run while making this change.

Reusable animation components now live in `remotion/AnimationPrimitives.tsx`:
`WipeReveal`, `HighlightBand`, and `TracePath`. The XML/JSON comparison uses these
components. `TracePath` uses the version-matched `@remotion/paths` library for
path drawing and point sampling, driven by deterministic scene progress.
Official reusable libraries: [paths](https://www.remotion.dev/docs/paths/),
[shapes](https://www.remotion.dev/docs/shapes/), and
[transitions](https://www.remotion.dev/docs/transitions/). Only paths is added as
a direct dependency here; scene allocations and other visual types are unchanged.

# Current model: NVIDIA Nemotron 3 Super through OpenRouter

The latest selected default is **`nvidia/nemotron-3-super-120b-a12b:free`**.
This supersedes the earlier `openrouter/free` router selection described below.
Both `.env.local` and the code default now pin this NVIDIA model. Keep the same
OPENROUTER_API_KEY; no NVIDIA-specific key, model download or local GPU is needed.

```dotenv
VIDEO_GEN_PROVIDER=openrouter
OPENROUTER_MODEL=nvidia/nemotron-3-super-120b-a12b:free
OPENROUTER_SCRIPT_MAX_TOKENS=4096
```

The 4096 script cap above is the existing troubleshooting setting; this model
change does not increase it. API keys are not shown. Requests still disable
reasoning, require JSON-schema support, and run the same validators and guards.
OpenRouter's public catalogue was checked on 2026-10-17: this model lists
response_format, structured_outputs and reasoning support, with reasoning
mandatory:false. Its documented supported reasoning efforts include none.
Free prompt/completion pricing is listed as zero, but availability/rate limits
and actual script/visual quality require live evaluation. No live request or MP4
render was run for this change. Smaller Lightning/Nano Omni free endpoints did
not list response_format support in that catalogue, so they were not selected.
Sources: [model](https://openrouter.ai/nvidia/nemotron-3-super-120b-a12b:free),
[public catalogue](https://openrouter.ai/api/v1/models).

Restart the Next server after this configuration change, then rerun the same
POST /api/video_gen curl test. This selects an NVIDIA model hosted through
OpenRouter, not the separate NVIDIA NIM API. Existing saved scripts/plans remain
unchanged; use an explicit --replan to regenerate old saved visuals as before.

---

# Current provider: OpenRouter Free Router

The latest user-authorized default is **OpenRouter**, model **`openrouter/free`**.
Earlier block sections below document the Ollama implementation history; their
local-only provider statements are superseded by this section. Rendering is still
local and unchanged; scripts/visual planning now use OpenRouter unless explicitly
configured otherwise. No API key is committed or displayed.

Add your own key to the ignored `next-app/.env.local`:

```dotenv
VIDEO_GEN_PROVIDER=openrouter
OPENROUTER_MODEL=openrouter/free
OPENROUTER_API_KEY=your_key_here
VIDEO_GEN_USE_FIXTURE=false
```

The CLI and Next use server-side configuration; restart an existing Next dev server
after editing it. Do not use NEXT_PUBLIC_ for the API key. No OpenRouter SDK or new
dependency was added. The correct router ID is `openrouter/free` (with **openrouter**
spelled in full), per the [official router guide](https://openrouter.ai/docs/guides/routing/routers/free-router).

`inference.ts` routes script, graph-plan and visual-action calls through the same
provider abstraction. OpenRouter uses HTTPS chat completions, Bearer auth and
[JSON-schema structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs)
with `provider.require_parameters:true`. The same local Zod parsing and all semantic,
duration/publication checks remain active. Unsupported free routes fail clearly;
there is no silent local, paid-model, plain-text or weakened-schema fallback.
Requests now send their prompt/script content to OpenRouter and its selected model.

The free router can select a different underlying free model on different calls.
Diagnostics record provider, requested model and `resolvedModel` from the response,
plus token counts. Original saved Qwen scripts retain their model provenance;
`plannerProvider`/`plannerModel` identify newly generated visuals separately.
Existing complete saved plans are reused, so use explicit `--replan` if you want
new OpenRouter visual inference rather than replaying old plans.

Nullable-content recovery: OpenRouter may return null/absent message content.
The adapter checks finish_reason before parsing output and preserves the envelope
for empty completions. OUTPUT_LIMIT, PROVIDER_REFUSAL, INCOMPLETE_OUTPUT and
EMPTY_OUTPUT are distinct from syntax/structure errors. Reasoning text is never
used as script JSON; finishReason and reasoningTokens are recorded in diagnostics.
The historical null-content error alone does not establish its cause. If a retest
reports OUTPUT_LIMIT, explicitly consider OPENROUTER_SCRIPT_MAX_TOKENS=4096;
[reasoning can consume the completion budget](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).
This changes the provider token cap, not narration length or validation.
A subsequent user test still exhausted 4096 tokens on the same routed model.
Do not keep increasing limits without inspecting usage: OpenRouter requests now
include `reasoning: { enabled: false }`, and OUTPUT_LIMIT reports completion tokens,
reasoning tokens (or unreported) and visible bytes. This is a request to disable
reasoning, not proof that every free endpoint honors it. Unsupported controls can
fail provider routing/configuration; there is no automatic dropped parameter or
model switch. The reported failures alone establish exhaustion, not whether tokens
went to reasoning or visible JSON. Restart the server and retest the same request
with the existing 4096 cap; no additional live test was sent during this fix. A model
returned by the free router can differ between requests. Nullable-content repair
verification: 56 combined mocked regression tests, lint, scoped TypeScript and
git diff --check passed; no live request was sent.

OpenRouter settings (separate from OLLAMA_*):

- `OPENROUTER_TIMEOUT_MS`: default 180000, integer 1000–600000.
- `OPENROUTER_SCRIPT_MAX_TOKENS`: default existing duration-derived script cap;
  integer 256–8192 when overridden.
- `OPENROUTER_VISUAL_MAX_TOKENS`: default 1536 for graph plans, 384 for compact actions;
  integer 256–8192 when overridden.
- `OPENROUTER_MODEL`: default openrouter/free. Changing it is an explicit model choice.

There is no local num_ctx allocation on OpenRouter; cloud diagnostics omit that
field rather than inventing a context size. Calls remain sequential; one transient
retry is allowed for connection failures or HTTP 429/502/503. JSON/schema errors,
auth/configuration errors, timeouts and length limits are not transport-retried.
Existing planners retain their bounded corrective validation retry. Rate limits,
free availability, model quality and actual live latency still require evaluation.
To deliberately use local Qwen again, set `VIDEO_GEN_PROVIDER=ollama`; original
OLLAMA_* configuration remains supported.

After adding the key, inspect OpenRouter action planning with the saved script:

```sh
npm run explain -- --resume artifacts/requests/request-ObyOtP/request.json --visual-actions --replan --inspect --output artifacts/videos/xml-json-openrouter/final.mp4
```

This forks a new receipt and preserves the old script. Use the NEW receipt path
printed by the command for subsequent inspection/render; ordinary recovery uses
`--resume` without `--replan`. Review the plan before rendering. See
[manual-block08-checks.md](./manual-block08-checks.md) for inspection/frame/playback
steps, substituting the new receipt and `xml-json-openrouter` output path.
Provider migration checks: **9 storyboard + 55 render/planner/inference/action/provider tests passed**; lint, scoped TypeScript and git diff --check passed. Logs: `/home/maithili-wagh/Desktop/PS04--chakravyuh-kurukshetra2027/next-app/artifacts/tests/openrouter/checks-o9kvesdb`.
No live OpenRouter call or actual video was run as part of the provider change.

---

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
