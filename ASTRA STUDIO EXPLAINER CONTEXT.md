# ASTRA STUDIO — EXPLAINER MASTER CONTEXT

**Purpose:** A standalone start-to-current-state handoff for a teammate or coding assistant continuing this project.

**Snapshot:** 17 October 2026. This document describes the inspected working tree and recorded implementation/test history. It does not claim that pending live tests or future features have passed.

**Repository:** `PS04--chakravyuh-kurukshetra2027`

**Application directory:** `next-app/`

**Working branch:** `feat/maithili-explainer`

**Current milestone:** Block 09 website job integration implemented and automatically tested; live Qwen, browser/LAN and MP4 manual review are pending. Block 08 visual actions remain opt-in.

---

## Block 09 — local website job integration

The inspected homepage was the Next starter page. It now has a prompt form,
progress/error display, saved-job recovery, narration review, and authenticated
MP4 preview/download. `POST /api/generate` creates a UUID job; authenticated
`GET /api/jobs/[id]` polls status, `POST /api/jobs/[id]/resume` resumes failures,
and `GET /api/jobs/[id]/video` streams only a finalized, verified job output.

Website jobs explicitly select existing local Ollama (`qwen2.5:3b` by default)
for scripts and visuals. They validate and exclusively save live-generated
`next-app/app/api/video_gen/fixtures/block05/generated-<UUID>.script.json`,
then reuse `explain()` directly with a saved receipt and checkpoints.
One bounded, sequential worker handles up to four queued/active jobs. Records,
diagnostics, receipt and the single final MP4/sidecar live under
`next-app/artifacts/jobs/<UUID>/`. Evidence, uncertainty, narration, duration
approval and publication guards remain active. No shell command is built from
client input. Completion requires ffprobe verification against metadata.

The shared `ASTRA_ACCESS_TOKEN` must be configured server-side (24+ characters).
It is distinct from model keys and grants access to all jobs, without per-user
ownership. The legacy `/api/video_gen` script endpoint now also requires Bearer
authentication. Default dev/start bind loopback; LAN binding is explicit through
`dev:lan`/`start:lan`, with exact trusted origins in `ASTRA_ALLOWED_ORIGINS`.
Do not expose raw Ollama or forward this trusted-LAN service publicly.

The existing CLI/provider defaults remain NVIDIA through OpenRouter as described
below; the job-specific override does not migrate or regenerate old requests.
No new cloud integration, TTS, live inference, video encode, commit or push was
performed for Block 09. This is a persistent single-laptop worker, not a
distributed/serverless queue; disk history has no automatic deletion policy.

Automated verification: storyboard 9; combined render/pipeline/inference/actions/
OpenRouter/jobs suite 66; lint; scoped strict TypeScript; diff whitespace check.
Browser interaction, live Qwen quality, final MP4 playback and second-computer
connectivity still need manual review. Full architecture, exact changed files,
setup and manual commands:
[manual-block09-checks.md](next-app/app/api/video_gen/manual-block09-checks.md).

## Latest CLI model selection — NVIDIA Nemotron 3 Super via OpenRouter

The latest user-requested switch pins **nvidia/nemotron-3-super-120b-a12b:free**
in `.env.local` and the code default. The provider remains OpenRouter, using the
existing OPENROUTER_API_KEY. Earlier openrouter/free defaults below are historical.
This hosted model requires no local model installation or additional NVIDIA key.
The public model catalogue lists structured JSON output and optional reasoning;
our request disables reasoning and preserves strict schema/source/duration checks.
Lightning/Nano Omni free endpoints lacked response_format support in that snapshot.
Restart Next before the next API test; existing saved plans are not regenerated.
No live inference/MP4 render was performed for this model selection. Free endpoint
availability, latency and quality still require manual testing.

## Provider migration update — OpenRouter (latest user instruction)

This update supersedes older local-only/default-Qwen statements below. The user
explicitly requested moving script and visual inference to **OpenRouter** using
**`openrouter/free`**. Local Remotion rendering and all schema/evidence/duration/
publication checks remain in place. The Block 08 action path is still opt-in.

- New server transport selector: `next-app/app/api/video_gen/inference.ts`.
- Default provider: `VIDEO_GEN_PROVIDER=openrouter`; default model `OPENROUTER_MODEL=openrouter/free`.
- User supplies `OPENROUTER_API_KEY` in ignored `next-app/.env.local`; never include the real key in a handoff.
- `VIDEO_GEN_USE_FIXTURE=false` ensures the script API is not using development sample data.
- `OPENROUTER_TIMEOUT_MS` defaults to 180000. OPENROUTER_SCRIPT_MAX_TOKENS and OPENROUTER_VISUAL_MAX_TOKENS optionally override the existing stage output budgets.
- Requests use OpenRouter HTTPS chat completions, Bearer auth, JSON Schema and required parameter support. The same local structural/semantic validators still enforce correctness.
- `openrouter/free` is a router, not one fixed model: per-call diagnostics retain `resolvedModel` and usage. Availability, output quality and latency are not guaranteed by mocked tests.
- There is no hidden fallback to local Ollama, a paid model or weaker output validation. `VIDEO_GEN_PROVIDER=ollama` is an explicit opt-in to the preserved local implementation.
- Prompts and script content now leave the machine for OpenRouter inference, as requested; rendering remains offline/local.
- Old saved scripts keep original Qwen provenance. New visuals record plannerProvider/plannerModel separately. Existing completed plans are reused unless an explicit replan is requested.
- Migration verification: **9 storyboard + 55 combined render/planner/inference/action/provider tests passed**, plus lint, scoped TypeScript and git diff --check.
- No live provider call or actual MP4 render was performed during this migration; the user will add the key and run manual validation.

Current saved-script inspection command, after adding the key:

```sh
npm run explain -- --resume artifacts/requests/request-ObyOtP/request.json --visual-actions --replan --inspect --output artifacts/videos/xml-json-openrouter/final.mp4
```

Use the new printed receipt for subsequent resume/render, and substitute this
output directory in the detailed Block 08 review commands later in this document.
The current setup details are also at the top of `next-app/app/api/video_gen/README.md`.

---

## 1. What we are building

A local prompt-to-educational-explainer-video pipeline. A user supplies a topic, audience and target duration. Local Qwen generates narration and visual directions. The application validates and normalizes that script, builds an ordered storyboard, plans visuals, and renders a silent MP4 with Remotion.

The intended output is an actual visual explanation: diagrams, components, arrows, structural comparisons and meaningful movement. A narration paragraph on a slide, or printing “show a picture of…” on screen, does not satisfy the goal.

The current product interface is primarily a CLI plus a script-generation API. The browser homepage is still the Next.js starter screen. There is no completed video-generation frontend, TTS, music, captions, audio synchronization, cloud inference service or production deployment workflow.

The latest architectural direction is:

> Qwen chooses what to communicate; deterministic TypeScript constructs how it is rendered.

That direction is an **opt-in experiment**, not a replacement for all existing visual planning.

## 2. What exists, what is pending

| Area | Current state |
| --- | --- |
| Local script generation | Implemented using Ollama `/api/chat`, default model `qwen2.5:3b` |
| Schema validation | Implemented with strict Zod schemas |
| Normalization | Implemented; whitespace/text hygiene, word counts and estimated timing |
| Duration policy | Implemented; excessive saved narration requires explicit approval before rendering |
| Deterministic storyboard | Implemented; stable ordered scene IDs and frame allocation |
| Procedural visuals | Implemented; offline React/SVG/CSS graphics |
| Bridge visuals | Specialized procedural bridge/wind/traffic/vibration/support graphics implemented and reviewed in earlier work |
| Broader graphs | Reusable flow, sequence, cause, cycle, comparison, percentage-bar and overview structures; photosynthesis and CPU examples |
| Model-driven graph planner | Default path; sequential per-scene inference, evidence validation, bounded recovery |
| Compact visual-action planner | Block 08 opt-in; currently XML/JSON format comparison and uncertain concept overview |
| Silent MP4 | Implemented using Remotion, existing Chrome and H.264 |
| Single final deliverable workflow | One final MP4 plus one JSON metadata sidecar |
| Checkpoint/resume | Implemented; scripts and validated visual progress are reused |
| Diagnostics | Raw-response/schema/parser/semantic artifacts, secret redaction and inference metrics |
| Automated checks | Latest Block 08 report: 9 storyboard tests and 51 render/planner/inference/action tests passed, plus lint/scoped TypeScript/diff checks |
| Block 08 live performance/visual quality | **Pending manual evaluation**; tests alone do not prove improvement |
| Spoken narration/TTS | **Not implemented; do not start without separate user approval** |

## 3. Critical handoff: the implementation is not all committed

At the time this document was created, `git status` showed modified tracked files and many **untracked** files containing the explainer implementation. Previous blocks explicitly prohibited commits and pushes, and none were made by the implementation work.

**A teammate cloning/checking out the remote branch may NOT receive this implementation.** Transfer the actual working source tree, including untracked `next-app/app/api/video_gen/` files and the modified package files, or arrange a separately authorized source-control handoff.

Share these items deliberately:

- This master context file.
- The actual `next-app/` source, `package.json`, `package-lock.json`, configuration files and explainer fixtures/tests/docs.
- Selected saved request receipts and relevant diagnostic artifacts if the teammate needs to reproduce the current failure/review.
- Selected videos/frame evidence if visual comparison is necessary.

Do not include `.env.local`, credentials, `node_modules/`, `.next/` or all generated artifacts by default. `next-app/artifacts/` and environment files are Git-ignored. Saved request files can contain the user's prompts/narration, and local artifacts can contain absolute paths; review them before external sharing. Diagnostic redaction is not a guarantee that every private detail is removed.

No sharing, upload, email or commit is performed by this document itself.

## 4. Stack and local resource assumptions

Versions declared in the inspected package file:

| Component | Version |
| --- | --- |
| Next.js | 16.4.2 |
| React / React DOM | 19.3.0 |
| Zod | 4.6.7 |
| Remotion / bundler / renderer | 4.0.536 |
| TypeScript | ^5 |
| Tailwind CSS | ^4 |
| `ai` dependency | 7.0.142; the explainer transport uses native Ollama HTTP rather than requiring this SDK |

The inspected development shell runs Node **22.23.2**, npm **10.9.8**. Use compatible project tooling; no separate pinned runtime guarantee is claimed.

Hardware context: approximately **7.3 GiB RAM**, with memory pressure and active swap observed during diagnosis. Historical read-only checks returned Ollama **0.40.5**, Qwen **3.1B Q4_K_M**, and model capacity 32,768 tokens. Those are historical observations, not a fresh server probe on the teammate's machine. Model capacity is not the configured inference context.

Avoid running multiple live inference workflows concurrently. The application serializes calls **within one process**; it cannot prevent another CLI process or external client from using Ollama simultaneously.

Required external local tools for manual rendering/review:

- Existing Ollama service and installed `qwen2.5:3b`.
- An existing Chrome/Chromium executable accepted by Remotion. Default path is `/usr/bin/google-chrome`.
- `ffmpeg`, `ffprobe`, and `ffplay` for review commands.

The implementation does not automatically download models, browsers or visual assets. Do not change models or add large dependencies simply to avoid debugging the current path.

`next-app/AGENTS.md` requires coding assistants to read the relevant installed Next documentation under `node_modules/next/dist/docs/` before making code changes. The project uses a newer Next version; do not assume older framework conventions.

## 5. Project layout and ownership

Paths below are relative to `next-app/`.

| File / directory | Responsibility |
| --- | --- |
| `app/page.tsx`, `app/layout.tsx`, `app/globals.css` | Starter web shell; not an implemented explainer editor |
| `app/api/video_gen/route.ts` | POST endpoint generating script JSON only; not the full MP4 workflow |
| `app/api/upload/route.ts` | Empty placeholder at inspection |
| `app/api/cropping/route.ts` | Empty placeholder at inspection |
| `app/api/video_gen/schema.ts` | Request/script contracts |
| `ollama.ts` | Native HTTP, model/configuration, serial lane, transient retries, size/timing metrics, raw reports and redaction |
| `script-generator.ts` | Local script generation and development-fixture switch |
| `script-quality.ts` | Duration-derived scene/word budgets and literal-repetition rejection |
| `normalize.ts` | Text hygiene, word counting, estimated scene durations and warnings |
| `duration-policy.ts` | Single duration policy/configuration source |
| `storyboard.ts` | Deterministic ordered storyboard and positional IDs |
| `concept-adapter.ts`, `visual-plan.ts` | Legacy source-to-visual adaptation, typed visual registry and domain checks |
| `visual-graph.ts` | Structural/refined graph schemas, fixed graph positions, animation primitives, canonical-record serialization |
| `model-visual-plan.ts` | Default per-scene graph generation, semantic/evidence validation, uncertainty repair and corrective recovery |
| `action-catalog.ts` | Code-owned, deterministic example catalogue and narrowly scoped illustrative-evidence context |
| `visual-actions.ts` | Block 08 compact action schemas, action planner and deterministic compiler into existing visual plans |
| `explain-options.ts`, `explain-cli.ts` | CLI parsing/help/entry point |
| `explain-pipeline.ts` | Script/plan orchestration, receipt storage, resume/replan, inspection, provenance and final render |
| `cli-environment.ts` | Existing Next environment loader for CLI use |
| `render-plan.ts` | Validates storyboard/specs, enforces duration approval, resolves visuals/settings/frames |
| `render-service.ts` | Bundles Remotion, uses installed browser, encodes, publishes and cleans up |
| `output-path.ts` | Safe slug/path selection, exclusive lock and staged publication |
| `remotion/index.tsx` | Registers the `Explainer` composition from a validated render plan |
| `remotion/Explainer.tsx` | Scene sequencing and actual scene presentation using local frame timing |
| `remotion/Visuals.tsx` | Procedural registry and specialized graphics, including bridge |
| `remotion/GraphVisual.tsx` | General graphs and equivalent XML/JSON comparison, with opt-in line emphasis |
| `remotion/FitText.tsx`, `remotion/text-layout.ts` | Legible text sizing and overflow failures |
| `run-storyboard.mjs` | Compiles scoped TypeScript into an isolated temp directory and runs CLI/tests |
| `storyboard-cli.ts`, `generate-script-cli.ts`, `render-cli.ts` | Separate-stage workflows |
| `inspect-render.mjs` | Probes actual MP4, verifies metadata consistency and extracts each scene's frames |
| `*.test.ts` | Node built-in test suites; no live model calls/long video encoding |
| `fixtures/block05/` | Saved bridge, photosynthesis and CPU scripts |
| `fixtures/regressions/` | Historical XML/JSON failures for offline regression |

## 6. Pipeline from start to final MP4

### Default graph path

```text
Raw CLI prompt or saved request
  → strict request validation
  → live local script generation, unless resuming
  → script schema + fresh-generation word/repetition checks
  → normalization and duration classification
  → deterministic storyboard
  → duration approval guard
  → sequential per-scene graph planning, unless a valid saved plan exists
  → structural parsing
  → graph/domain/source/uncertainty/example/animation validation
  → validated checkpoints and completed visual plan
  → resolved render plan
  → --inspect saves internal report and stops, OR
  → Remotion encoding in isolated temporary work directory
  → exclusive publication of final.mp4 and final.mp4.json
```

### Opt-in Block 08 action path

```text
Same saved/generated script and storyboard
  → Qwen selects compact per-scene semantic action
  → strict action schema and source/reference validation
  → deterministic TypeScript compiler owns graph/layout/animations
  → existing full visual-plan validation, with scoped illustrative-record provenance
  → action checkpoint + compiled renderer plan
  → same inspection/render/publication machinery
```

Remotion does not call Ollama. Model output remains inert data and never becomes executed HTML, SVG source, JavaScript, URLs, styles or arbitrary renderer instructions.

### API versus CLI

`POST /api/video_gen` returns a script, not a video. Use `npm run explain` for the complete local workflow. The CLI does not require the Next development server to be running, but live generation requires Ollama.

## 7. Contracts and narration preservation

Request:

```json
{
  "topic": "Explain XML vs JSON to a beginner",
  "targetAudience": "Beginners",
  "durationSeconds": 45
}
```

- Topic: 1–500 characters, required.
- Audience: 1–120 characters, default Beginners.
- Duration: integer 15–120 seconds, default 45.
- Unknown fields are rejected; API request body is bounded to 8 KB.

Script:

```json
{
  "title": "Example title",
  "targetAudience": "Beginners",
  "estimatedDurationSeconds": 45,
  "scenes": [
    {"narration": "Scene narration.", "visualDirection": "Plain-language visual guidance."}
  ]
}
```

The abbreviated example shows the shape; valid scripts require **3–8** scenes. Title <=160 characters, narration <=1200 characters per scene, direction <=400. The declared duration must match the requested target in the direct workflow.

The source script is retained in receipts and render provenance (`originalScript`). Normalization can collapse whitespace and reports changes; do not confuse normalized narration with byte-for-byte original whitespace. Words/punctuation are not silently shortened. Markup-like content remains text. Hidden control/bidi overrides and narration without words fail hygiene checks.

Visible composition uses short headings/labels and actual graphics, not full narration paragraphs or raw visual directions. With no TTS, preserved narration is **not spoken**.

## 8. Duration, fresh script budgets and frames

Timing is estimated narration timing at **130 words/minute**, using Unicode word counting and millisecond-rounded scene estimates. It is not measured speech or audio synchronization.

Fresh generation additionally gets:

- 3 scenes for targets <=60 seconds; 4 for <=90; 5 for <=120.
- Total target words = floor(target seconds × 130 / 60).
- Purpose-weighted per-scene budgets; for 45 seconds: 24 / 48 / 25 words.
- Small counting tolerance: +10% overall and +15% per scene, each with a minimum 3-word allowance.
- Repeated sentences of at least six words and repeated 16-word passages rejected.

Invalid fresh scripts stop clearly, without automatic truncation or endless regeneration. Literal repetition detection does not catch all semantic paraphrases. Older saved scripts are not rewritten or subjected to fresh-generation budgets on resume; duration approval remains applicable.

Duration policy defaults:

```text
wordsPerMinute = 130
applied tolerance = max(5 seconds, target × 20%)
revision threshold = max(10 seconds, target × 35%)
overrun = max(0, estimated narration duration − target)
```

- Overrun <= tolerance: `within_target`.
- Above tolerance but <= revision threshold: `soft_overrun`.
- Above revision threshold: `requires_revision`.

`requires_revision` stops planning/rendering where guarded unless the user explicitly supplies `--approve-overrun` for that invocation. Approval is not silently retained for future resumes. Do not change WPM, discard narration, shrink the target or auto-approve to make a test easier.

Each scene gets `ceil(scene seconds × fps)` frames, with a contiguous cumulative start. The requested target does not force equal scene durations. Positional scene IDs are `scene-001`, `scene-002`, etc.; changing source order changes identity.

Render defaults: **720×1280 portrait, 15 fps, one encoding worker, H.264, no audio**. Landscape remains available with width/height flags, e.g. 960×540. Scene fades use local frame timing. The storyboard's historical canvas metadata (1280×720/30 fps) is not the final render size; use resolved `settings` and MP4 probe results.

## 9. Visual validation and safety

Separate these failure layers:

1. Provider envelope: invalid/incomplete HTTP response format.
2. JSON syntax: model content cannot be parsed as JSON.
3. Structure: valid JSON violates the exact strict structural schema sent to Ollama.
4. Semantics: topology, ID/order, domain, local source evidence, animation logic or uncertainty constraints fail.
5. Rendering: text/layout/browser/encoding/publication fails.

The JSON Schema grammar and local structural parser are derived from the same Zod object, with input-mode export. Custom Zod refinements are checked later; they are not magically encoded by JSON Schema export.

Default graph planning accepts typed nodes, edges, actions and optional short examples. Important checks include:

- Exactly matching scene IDs and order.
- A physical bridge renderer requires physical bridge context; XML/JSON must never select bridge.
- Evidence must match local narration/title, with labels and edge endpoints supported.
- Transfers target existing edges, follow endpoint reveals, and obey sequence order when relevant.
- Percentages must come from explicit source values; no invented statistics.
- XML/JSON comparisons use one shared record; different comparison scenes cannot quietly change that record.
- `confidence: overview` requires graph renderer, overview layout, no edges/values and a visible overview note.
- An uncertain overview must never be silently promoted to supported.

The conservative repair can change only overview confidence/note, only for an edge/value/example-free overview, and only after full revalidation succeeds. Otherwise there is at most one corrective scene-level regeneration. A bad specific plan is not silently replaced by an unrelated domain diagram.

Evidence/schema checking is **not factual verification**. Metadata records `factChecked: false`. Scientific accuracy, causal meaning and editorial adequacy need human review.

## 10. Block 08 visual-action schema and boundaries

Opt in with `--visual-actions`.

Format comparison:

```json
{"sceneId":"scene-001","action":"format_comparison","exampleId":"record-001","focus":"structure"}
```

Only focus `structure` or `fields` is allowed. The model does not generate example contents, renderer mechanics or timing.

Uncertain concept overview:

```json
{"sceneId":"scene-001","action":"concept_overview","labels":[{"text":"XML","evidence":"XML and JSON"}]}
```

This requires one or two concise, locally supported labels and exact source quotes. It asserts no factual relationships.

The catalogue currently extracts the first short string field from a simple XML record already in narration. For the current saved script: `book.title = Harry Potter`, from scene-002. It deliberately shows a short excerpt rather than every original field. Unsupported extraction falls back to `person.name = Ana` with an explicit illustrative-not-source-data note.

The canonical record generates both JSON and escaped XML. Compiled `comparisonFocus` enables line emphasis on both representations; reveals introduce the formats, and paired highlights occur at 40–75% of scene time. The legacy comparison presentation is unchanged when that optional property is absent.

The new illustrative evidence context is narrow: it accepts only the exact deterministic catalogue record, the expected disclosure note and no asserted relationships/numeric data. It is not arbitrary model evidence. Overview labels retain local-source checks. Narration is not modified to justify an example.

Limits:

- Only XML/JSON format comparison and concept overview actions exist.
- No universal process/timeline/system/number action migration yet.
- XML extraction is a bounded scanner, not a general XML parser; no nested XML/general JSON-only extraction.
- One short example field, existing string/name limits.
- `--visuals` overrides are rejected in action mode to prevent divergence from inspected actions.
- The model can still select repetitive focus or unhelpful overviews; manual review must catch that.
- Output cap defaults to 384 tokens per scene, but a configured `OLLAMA_VISUAL_MAX_TOKENS` overrides it.

## 11. Inference configuration and diagnosis

Use server-only settings in ignored `next-app/.env.local`; shell values take precedence for the explain CLI. Do not share actual credentials.

Safe minimal configuration:

```dotenv
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:3b
VIDEO_GEN_USE_FIXTURE=false
REMOTION_BROWSER_EXECUTABLE=/usr/bin/google-chrome
```

Use a base URL, not the `/api/chat` endpoint itself. Do not use `NEXT_PUBLIC_` for provider configuration.

| Variable | Default | Accepted range |
| --- | --- | --- |
| `OLLAMA_SCRIPT_TIMEOUT_MS` | 180000 | 1000–600000 |
| `OLLAMA_VISUAL_TIMEOUT_MS` | 180000 per scene | 1000–600000 |
| `OLLAMA_NUM_CTX` | 4096 | 2048–8192 |
| `OLLAMA_SCRIPT_MAX_TOKENS` | 384 + 5 × target words, capped at 2048 | 256–4096 |
| `OLLAMA_VISUAL_MAX_TOKENS` | 1536 graph / 384 actions | 256–4096 |

Transport uses `stream:false`, `truncate:false`, temperature 0, repeat penalty 1.1, repeat window 128, `keep_alive:"1m"`. A prompt/context budget estimate can fail early; input-byte/4 token estimation is approximate, and actual provider token counts are preferred. Do not blindly increase all limits under memory pressure.

Transient transport retry: at most one delayed retry for connection failures or HTTP 429/503. No transport retry for malformed output, output-limit failure or timeout. Scene planners may perform one separate corrective attempt for validation failures. Thus a scene can have two planning attempts, each with at most two transient transport attempts. These are distinct counters.

The process-wide lane is sequential. A new explicit resume starts a new bounded scene attempt sequence and retains ordered diagnostic history.

Diagnostics include model/stage/scene IDs, planning/transport attempt, input/schema/output sizes, approximate input tokens, actual token counts when provided, elapsed/load/prompt/evaluation time, status and reason. Ollama durations are converted from nanoseconds to milliseconds.

Read-only resource checks:

```sh
free -h
vmstat 1 5
curl --max-time 5 -sS http://localhost:11434/api/version
curl --max-time 5 -sS http://localhost:11434/api/ps
ollama list
```

No inference is required for those checks. A 37–44-second successful response followed by validation rejection is not a timeout. Do not diagnose all local latency as a prompt problem: loading, CPU, context/output limits, RAM/swap and generated output length matter.

## 12. Receipts, inspection, resume and output safety

Internal files normally live under:

```text
artifacts/
  requests/request-<generated-id>/
    request.json
    resolved-plan.json       # after successful --inspect
    diagnostics/
      <unique directory>/response.json
      <unique directory>/validation.json
  videos/<chosen-directory>/
    final.mp4
    final.mp4.json
  tests/<block>/             # automated logs, review frames and other test artifacts
```

`request.json` holds the original request/script, model/timestamps, intended output/settings, diagnostic history and checkpoint/complete plans. Graph mode uses completedScenes/visualPlan. Action mode uses planner `actions-v1`, completedActions/actionPlan and the compiled visualPlan.

`--resume` reuses narration and validated progress. `--replan` explicitly forks a new receipt and clears the old visual checkpoint, preserving the source receipt. Switching a graph receipt to actions requires both `--visual-actions` and `--replan`. A completed actions receipt automatically retains its planner on resume and recompiles/checks its renderer plan.

`--inspect` may still make model calls if visuals are missing; it means **no encoding/publication**, not “always offline.” Once a complete valid saved plan exists, inspection/render reuse it without inference.

Raw redacted model responses, exact structural schemas and parser/Zod issues are persisted before semantic validation can lose them. Semantic artifacts contain candidates, failures and resolved results. Successful responses are also kept because transport success can later become semantic failure. Redaction targets credential assignments, bearer tokens and matching secret environment values; full prompts are not printed as routine logs.

Output rules:

- One final MP4 plus `<video>.json`, not separate demo videos per normal request.
- Output collisions are checked before expensive inference and again during publication.
- Exclusive locks protect concurrent writers to the same path.
- Encoding happens in isolated temporary work directories.
- Complete files are staged on the destination filesystem and exclusively linked into place.
- The pair is published with rollback if sidecar publication fails, but the two files are not a single filesystem transaction.
- Normal failures clean temporary work/locks and do not intentionally leave a partial final deliverable.
- Abrupt process termination can leave a stale lock; investigate before removing it.

Do not overwrite failed artifacts to hide a bug. Use a fresh output path.

## 13. History: how the project reached this design

| Block | Work / lesson |
| --- | --- |
| 01 | Local Ollama script-generation API with strict JSON output; optional deterministic development fixture |
| 02–03 | Text normalization, estimated timing, duration policy and deterministic storyboard |
| 04 | Working silent local Remotion MP4 pipeline |
| 04B | Replaced paragraph slides/raw directions with procedural portrait motion graphics; specialized bridge visuals |
| 05 | Reusable graph primitives and broader biological/computing examples; one final output pair per request |
| 06 | Direct prompt-to-MP4 CLI with model visual planning, source receipts and resume/inspection |
| XML/JSON diagnosis | Found unrelated bridge visuals/static content in a live XML/JSON run; added domain/plan-consumption/progression regressions |
| 07 | Reduced local workload with narration budgets, per-scene sequential graph planning, checkpoints and inference telemetry |
| 07.1 | Conservative overview metadata repair, one corrective scene retry and candidate/checkpoint reporting |
| 07.2 | Separated JSON syntax, structure and custom semantics; preserved raw responses/full issues; focused retry feedback |
| 08 | Opt-in compact semantic action selection and deterministic XML/JSON compiler; awaiting manual evaluation |

### Earlier bridge-versus-XML/JSON failure

The failed video is `artifacts/videos/xml-json-live/final.mp4`, with sidecar and receipt `artifacts/requests/request-0uaKbm/request.json`. Diagnosis established a wrong bridge visual plan for an unrelated topic and inadequate visual progression. Domain guards, schema narrowing, actual scene-plan consumption and scene-relative progression tests were added. Do not explain a new failure as cached artifacts without tracing the actual receipt and sidecar.

The stated video was reported by the user as 153 seconds, but inspection of those specific files found **293.133333 seconds**, 4397 frames at 15 fps. Narration contained **635 words** (212+211+212) against a 45-second target:

```text
635 × 60 / 130 ≈ 293.077 seconds of estimated narration
```

Per-scene frame rounding explains the small remaining difference. The long output followed preserved narration plus explicit overrun approval; it was not corrected by silently shortening speech. See `xml-json-diagnosis.md` for detailed evidence. Do not reuse this long failed script as the latest short test.

### Current short saved script and overview/schema failures

The key reusable short request is:

`artifacts/requests/request-ObyOtP/request.json`

Its script, “XML vs JSON: A Beginner's Guide,” introduces XML/JSON and gives XML and JSON versions of a book record across separate scenes. Some record literals are too long for the renderer's small example limits; some local scenes omit a root/name stated elsewhere. The script also does not fully satisfy every editorial aspect of the original request (such as useful-use-case explanations). Schema/budget success does not prove content completeness. Do not silently rewrite it during visual recovery.

Recorded script inference: ~25.3 seconds. Earlier successful visual inference: ~38.9 seconds, followed by semantic rejection of an overview layout paired with supported confidence. Its raw output was not retained at that time.

In the next test, attempt 1 took ~36.7 seconds and returned confidence overview, graph comparison layout and a conversion edge with unsupported local evidence. Exact uncertainty failures were graph.layout and graph.edges; metadata-only repair was unsafe.

Attempt 2 took ~43.5 seconds and produced valid JSON rejected by local Zod, with four parent paths `visual.graph`. The old handler discarded the issue messages/raw content. The exact four failed checks cannot be reconstructed; do not invent them or call this malformed JSON. Block 07.2 added diagnostics to prevent recurrence. Historical parsed evidence was retained separately without pretending it was original raw bytes.

Earlier bridge/within-target MP4s were played/reviewed. Block 05 documentation also records bridge/photosynthesis/CPU MP4 and frame review. Those results do **not** establish that the latest action path is visually approved.

## 14. Setup on a teammate's machine

1. Obtain the actual working source including untracked files, not only the remote branch.
2. Enter `next-app/` and check Node/npm, package manifest and lockfile.
3. On a fresh machine install the locked dependencies with `npm ci` when appropriate; this can require network access and is not an instruction to replace the lockfile.
4. Create your own ignored `.env.local` with local settings. Do not copy credentials into this document or source control.
5. Confirm the installed model/service and browser/tools. Avoid unnecessary model downloads; ask about a missing local dependency rather than silently changing the architecture.
6. Run automated checks before live inference.
7. Follow the inspection-first Block 08 manual test below.

For browser/API development only:

```sh
cd next-app
npm run dev
```

The homepage does not yet drive the full pipeline. Native local CLI workflow does not need that server.

Development fixtures require both development NODE_ENV and `VIDEO_GEN_USE_FIXTURE=true`. They return a fixed JSON/XML script regardless of topic. `npm run explain` takes the live script path and does not treat fixture success as live inference success.

## 15. Commands for the existing separate stages

Run all commands from `next-app/` unless specified otherwise.

Generate from a request JSON file to a new script path:

```sh
npm run script:generate -- request.json script.json
```

Build a storyboard from a saved script:

```sh
npm run --silent storyboard -- script.json > storyboard.json
```

Inspect normalization plus storyboard:

```sh
npm run --silent storyboard -- script.json --inspect
```

Render a saved storyboard to a fresh path:

```sh
npm run render:storyboard -- storyboard.json artifacts/videos/my-review/final.mp4
```

The separate-stage render CLI does not call the live model planner; explicit specs or the legacy adapter supply its visuals. Do not confuse it with an end-to-end live Qwen test.

Complete default graph path from a raw prompt, when a new generation is intentionally desired:

```sh
npm run explain -- 'Explain a topic for beginners' --duration 45 --inspect --output artifacts/videos/new-topic-review/final.mp4
```

This can generate a new script and visuals. It is **not** the preferred command for continuing the existing short saved request.

## 16. Immediate next manual test: Block 08

**The next step is manual review of the opt-in action path, not TTS or a new feature block.** No live inference or video should be run merely because this document is being read by another agent.

When the user chooses to test, reuse the existing short saved script and explicitly fork the visual plan:

```sh
npm run explain -- --resume artifacts/requests/request-ObyOtP/request.json --visual-actions --replan --inspect --output artifacts/videos/xml-json-block08/final.mp4
```

Use a new output directory if that path already has a final video/sidecar/lock. This makes visual-action model calls only, not new script generation. The original receipt is preserved. Capture the **new** receipt path printed in success output or the failure message:

```sh
action_receipt='artifacts/requests/request-NEW-ID/request.json'
```

Never copy the placeholder literally as if it were a real receipt ID. If the teammate does not have the saved request artifact, arrange its transfer first; do not silently replace it with a fresh generation.

Inspect the exact saved actions, their compiled plan and diagnostics:

```sh
node - "$action_receipt" <<'NODE'
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const filename = process.argv[2];
const saved = JSON.parse(fs.readFileSync(filename, 'utf8'));
const original = JSON.parse(fs.readFileSync('artifacts/requests/request-ObyOtP/request.json', 'utf8'));
assert.equal(saved.planner, 'actions-v1');
assert.deepEqual(saved.script, original.script);
console.log('ACTIONS', JSON.stringify(saved.actionPlan || saved.completedActions, null, 2));
console.table(saved.inferenceDiagnostics.map(d => ({stage:d.stage, scene:d.sceneId, planningAttempt:d.planningAttempt, transportAttempt:d.attempt, status:d.status, reason:d.reason, elapsedMs:d.elapsedMs, outputTokens:d.outputTokens, schemaBytes:d.schemaBytes})));
const diagnostics = path.join(path.dirname(filename), 'diagnostics');
if (fs.existsSync(diagnostics)) {
  for (const file of fs.readdirSync(diagnostics, {recursive:true}).map(String).filter(f => /(?:response|validation)\.json$/.test(f))) {
    console.log(file, fs.readFileSync(path.join(diagnostics, file), 'utf8'));
  }
}
if (saved.planningFailure) {
  console.error(saved.planningFailure); process.exitCode = 1;
} else {
  const plan = JSON.parse(fs.readFileSync(path.join(path.dirname(filename), 'resolved-plan.json'), 'utf8'));
  assert.equal(plan.published, false);
  assert.deepEqual(saved.actionPlan.map(a => a.sceneId), plan.storyboard.scenes.map(s => s.id));
  assert.ok(plan.visuals.every(v => v.renderer === 'graph'));
  console.log('RESOLVED PLAN', JSON.stringify(plan, null, 2));
}
NODE
```

Review source excerpt/fallback disclosure, same example on both sides, appropriate focus progression, local evidence and no misleading overviews. Historic diagnostics may have been inherited from the source receipt; identify new calls by action response shape and their output caps.

If a scene fails, resume the fork, without replan:

```sh
npm run explain -- --resume "$action_receipt" --inspect --output artifacts/videos/xml-json-block08/final.mp4
```

Only after the inspected plan is suitable, render it without new model calls:

```sh
npm run explain -- --resume "$action_receipt" --output artifacts/videos/xml-json-block08/final.mp4
```

Probe and extract all scenes plus progression samples:

```sh
node app/api/video_gen/inspect-render.mjs artifacts/videos/xml-json-block08/final.mp4 artifacts/tests/block08/xml-json-frames --progress
ffplay -autoexit artifacts/videos/xml-json-block08/final.mp4
```

Use a fresh frame directory when repeating extraction. Open every PNG and watch the entire MP4. Confirm matching literal values, simultaneous corresponding-field/structure emphasis, scene progression, readable text, no raw narration/directions printed, 9:16 dimensions, correct duration/order, no bridge and no audio. Inspect the sidecar's originalScript, visualActions, exampleCatalog, modelVisualPlan and factChecked flag.

Repeat the same saved-request render command after success to check overwrite refusal; it must stop before inference and leave both deliverables unchanged.

Report the receipt/output/diagnostic paths, action choices, actual timings/token counts/retries, frame findings and playback result. Do not claim lower latency or better visuals based only on unit tests or the smaller schema.

## 17. Automated verification

Latest recorded Block 08 results:

- Storyboard: **9/9**.
- Existing render: **18/18**.
- Planner/CLI: **15/15**.
- Inference: **12/12**.
- New action suite: **6/6**.
- Combined render/planner/inference/action command: **51/51**.
- Lint, scoped TypeScript and `git diff --check`: passed.

These are the last recorded implementation checks, not a new verification of every dependency/environment on a teammate's machine. This handoff creation does not run live inference or video encoding.

```sh
npm run test:storyboard
npm run test:render
npm run lint
node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module commonjs --moduleResolution node --jsx react-jsx --strict --skipLibCheck --esModuleInterop --types node app/api/video_gen/explain-cli.ts app/api/video_gen/explain.test.ts app/api/video_gen/inference.test.ts app/api/video_gen/visual-actions.test.ts app/api/video_gen/generate-script-cli.ts app/api/video_gen/render-cli.ts app/api/video_gen/render.test.ts app/api/video_gen/remotion/index.tsx app/api/video_gen/route.ts
git diff --check
```

The scoped compiler invocation is deliberate. A full Next production build is not claimed by these results. Empty upload/cropping route placeholders and unrelated starter code remain outside the feature's implementation scope.

Tests use Node's built-in runner, mocked HTTP and fake encoders that do not generate actual videos. A subprocess environment-loader check can fail with EPERM under restrictive tool sandboxes; rerun with the appropriate execution permission rather than deleting the test or misdiagnosing a model failure.

Latest local Block 08 logs: `artifacts/tests/block08/checks-eefq825l/`. The folder is ignored and will not accompany a normal Git clone.

## 18. Troubleshooting checklist

| Symptom | Investigate first |
| --- | --- |
| Wrong bridge on an unrelated topic | Actual receipt/compiled visual plan/sidecar; scene IDs and domain validation; never hide with topic-specific animation |
| MP4 much longer than target | Actual narration word count, estimated timing, duration classification and explicit approval |
| Successful inference followed by failure | Parser/structure/semantic phase and full issue messages; not automatically a timeout |
| Four repeated parent paths | Full `issues` in artifacts; do not infer exact checks from paths alone |
| Model timeout | Loading/evaluation metrics, output length, context, RAM/swap and competing processes |
| Resume repeats work | Correct receipt ID, planner selection, completed prefix validity and whether --replan was accidentally used |
| Cannot switch graph request to actions | Use --visual-actions with --replan and a fresh output path; keep the old receipt |
| Complete action plan differs from cached visuals | Fail and explicitly replan; do not silently use inconsistent metadata |
| Bad comparison examples | Canonical record, source provenance, exact shared keys/values and field/name limits |
| Unhelpful all-overview output | Treat as a manual quality failure even if technically safe |
| Render fails | Text-fit error, installed browser path, actual encoder message and output protection |
| Existing output/lock | Use a fresh path; investigate a stale lock rather than overwriting artifacts |
| Teammate cannot find code/artifacts | Untracked implementation and ignored artifacts may not have been transferred |

## 19. Project rules to preserve

1. Continue the existing architecture; no wholesale rewrite to solve a narrow visual bug.
2. Keep graph planning the default until the opt-in path passes manual review.
3. Preserve scripts/narration; no silent truncation or regeneration on resume.
4. Preserve strict structural, source/domain, uncertainty, duration and publication checks.
5. Do not convert unsupported concepts into misleading specific mechanisms or charts.
6. Do not execute model code/markup or fetch model-selected assets.
7. Keep local inference sequential and retries bounded; do not replace Qwen or download new models without a separate decision.
8. Inspect resolved plans before rendering, then inspect actual frames and playback.
9. Keep failed evidence, use fresh output paths and separate tests from deliverables.
10. No TTS, music, captions, cloud API, frontend expansion or next feature block until separately requested/approved.
11. No commit/push or external messages/uploads without explicit authorization.
12. State limitations honestly: safe/schema-valid does not imply scientifically correct, complete, visually effective or faster.

## 20. Where to read next

All relative to `next-app/app/api/video_gen/`:

- `manual-block08-checks.md` — current experiment, exact commands, files changed and review criteria.
- `manual-block072-checks.md` — schema/refinement diagnosis and raw-response evidence gaps.
- `manual-block071-checks.md` — overview repair and checkpoint recovery.
- `manual-block07-checks.md` — local inference/resource settings and narration budgets.
- `xml-json-diagnosis.md` — wrong bridge/static-video incident and actual long duration.
- `manual-block06-checks.md` — direct CLI workflow history.
- `manual-block05-checks.md` and `fixtures/block05/README.md` — broader topic examples and review evidence.
- `manual-render-checks.md` and `manual-duration-checks.md` — rendering/duration baseline checks.
- `README.md` — accumulated block history; earlier sections contain historical defaults and superseded descriptions. Prefer current code and later block manuals when they conflict.

For a coding assistant taking over, the first task is to inspect current code/status and the latest actual manual results, not assume Block 08 is approved. The intended immediate continuation is live evaluation and diagnosis of the opt-in action path using the saved script, while preserving all existing guardrails.
