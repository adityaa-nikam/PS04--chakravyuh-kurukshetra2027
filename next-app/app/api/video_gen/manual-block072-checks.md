# Block 07.2 diagnosis and manual recovery

No live inference or video encoding was run. Resume only after reviewing these changes.

## What the saved evidence establishes

The 07.1 scene-001 attempt-1 parsed candidate is preserved in `visualAttempts`:
confidence `overview`, renderer `graph`, layout `comparison`, one XML→JSON
“converts into” edge, and note `Conceptual overview`. The exact uncertainty
violations are **visual.graph.layout** (must be overview) and
**visual.graph.edges** (must be empty). Renderer, values and note pass that check.
Node/edge evidence additionally quotes facts absent from the local narration/title.
Changing confidence to supported would neither justify that evidence nor repair
this scene. The implementation correctly refuses that repair.

Attempt 2's original raw content and full Zod issues were discarded before the
planner could capture them. Only `request.json` existed for this run. The old
`Invalid fields` suffix is constructed exclusively from `ZodError.issues`, after
`JSON.parse(message.content)`, and paths `visual.graph` cannot originate in the
provider envelope schema. Therefore this was **valid JSON rejected by local Zod
validation**, not JSON syntax failure. It is NOT possible to recover which four
checks failed from the four identical parent paths. They must not be described
as four unknown fields or four malformed-JSON errors. No raw response was fabricated.

Recovered parsed attempt-1 evidence and an explicit attempt-2 availability record
are under `artifacts/requests/request-ObyOtP/diagnostics/historical-071.json`.
This is derived evidence, not the original raw bytes. The saved script/receipt
was not changed during implementation. The parsed candidate is also an offline
regression fixture at `fixtures/regressions/xml-json-overview071.json`.

## Code-level cause and repair

Previously `generateOllamaJson` exported `z.toJSONSchema(schema)` and locally called
`schema.parse(JSON.parse(content))` using the SAME schema instance. There was no
evidence of a stale or different schema. However, the graph schema contains custom
`superRefine` checks (topology, action targets, roles, layout cardinality), plus
animation-time/example-key refinements. JSON Schema export cannot encode those
custom checks. Their Zod messages were reduced to parent paths, then combined with
syntax failures into INVALID_OUTPUT. The planner's corrective prompt appended
blanket overview instructions even when the actual failure was elsewhere.

Now:

- `visual-graph.ts` exports structural primitives and a structural graph schema;
  existing refined schemas and all guards remain enforced.
- `model-visual-plan.ts:sceneOutputSchema` composes the structural scene schema.
  It is passed unchanged to transport. Local source/domain/topology checks run
  afterwards through the existing full `validateVisualPrefix`/graph schemas.
- `ollama.ts:callOllama` sends that schema with `io:input` and parses with the same
  Zod object. Diagnostics distinguish provider envelope, JSON syntax, structure,
  and the planner's later semantic phase. Input mode reflects defaults accepted
  by the local parser. No check has been removed from the completed-plan path.
- Full Zod issues retain **code, path, message and constraint details**; syntax
  errors retain the parser message. Errors preserve structured details across the
  transport wrapper. The uncertainty error lists only fields that actually fail.
- A corrective retry now uses actual issues/reason and requests correction of only
  those conditions with the same schema, not a universal conversion to overview.
  There are still at most two planning attempts per scene; transport retries,
  serialization, context/output limits and timeouts are unchanged.
- The existing deterministic repair is still restricted to an evidence-valid,
  edge/value/example-free overview, changing uncertainty metadata only and then
  running full validation. Unsupported evidence cannot be promoted or discarded.
- `explain-pipeline.ts` saves response and validation artifacts immediately in
  fresh private subdirectories beneath the receipt's `diagnostics/`. Response
  files contain the model content string, schema sent, phase, scene/attempt IDs,
  and exact parser/Zod issues. Validation files contain parsed candidates,
  resolved candidates if accepted, and semantic issues/reasons. Both successful
  and failed raw responses are retained because semantic failure occurs after
  transport success. Credential fields/assignments, bearer tokens and matching
  secret environment values are redacted; full prompts are not logged. Files use
  mode 0600 in unique temporary subdirectories. Redacted artifacts are diagnostic
  evidence, never an executable or trusted input for rendering.

Historical attempt-2 details remain unavailable; new diagnostics close that gap.
A safe result is still not guaranteed from a small model: hallucinated evidence
must fail rather than be converted into a plausible diagram. Schema/evidence
validation is not factual verification.

## Changed files

- `app/api/video_gen/ollama.ts`
- `app/api/video_gen/model-visual-plan.ts`
- `app/api/video_gen/explain-pipeline.ts`
- `app/api/video_gen/visual-graph.ts`
- `app/api/video_gen/inference.test.ts`
- `app/api/video_gen/fixtures/regressions/xml-json-overview071.json`
- `app/api/video_gen/manual-block072-checks.md`

Renderer, narration, duration policy, approval and publication behavior are unchanged.

## Next manual test

From `next-app/`, after implementation review, run visual planning on the saved
script only. Use a fresh output path; **no --replan is needed**, since the receipt
has no completed plan and zero completed scenes:

```sh
npm run explain -- --resume artifacts/requests/request-ObyOtP/request.json --inspect --output artifacts/videos/xml-json-block072/final.mp4
```

Expected: resuming_saved_script; scene-001 planning; at most one corrective attempt
for a validation failure; no script generation, encoding or publication. Existing
history remains intact. Do not grant overrun approval automatically.

Inspect all raw and validation artifacts, including failures:

```sh
rg --files artifacts/requests/request-ObyOtP/diagnostics
node - <<'NODE'
const fs = require('node:fs'), path = require('node:path');
const root = 'artifacts/requests/request-ObyOtP';
for (const file of fs.readdirSync(path.join(root, 'diagnostics'), {recursive:true}).map(String).filter(f => /(?:response|validation)\.json$/.test(f))) {
  const data = JSON.parse(fs.readFileSync(path.join(root, 'diagnostics', file), 'utf8'));
  console.log(file, JSON.stringify(data, null, 2));
}
const request = JSON.parse(fs.readFileSync(path.join(root, 'request.json'), 'utf8'));
console.table(request.inferenceDiagnostics.map(d => ({scene:d.sceneId, planningAttempt:d.planningAttempt, transportAttempt:d.attempt, status:d.status, reason:d.reason, elapsedMs:d.elapsedMs})));
console.log('Completed scenes:', request.completedScenes?.map(s => s.sceneId));
console.log('Last failure:', request.planningFailure);
NODE
```

`response.json.phase=structure` means valid JSON rejected structurally; `issues`
identify exact field paths/unknown keys/constraint details. `phase=json_syntax`
means invalid model JSON with its parser message. `phase=parsed` followed by a
failed `validation.json` means semantic rejection; inspect its `issues`/`reason`.
Keep new failures and report them, not merely the INVALID_OUTPUT summary. Repeating
the same resume/inspect command continues from the first incomplete scene without
regenerating narration. A resume authorizes a new bounded attempt sequence.

If inspection succeeds, review
`artifacts/requests/request-ObyOtP/resolved-plan.json`: all scenes must match IDs
and local narration, no bridge, proper uncertainty labels, source-backed examples,
no invented relationships, and purposeful motion. Do not accept all-overview output
as satisfying the requested example comparison. The saved script separates XML
and JSON examples and lacks some shared local evidence; remaining evidence failures
must be reported rather than silently rewriting it.

Only after deciding the resolved plan is suitable, render from that same receipt:

```sh
npm run explain -- --resume artifacts/requests/request-ObyOtP/request.json --output artifacts/videos/xml-json-block072/final.mp4
node app/api/video_gen/inspect-render.mjs artifacts/videos/xml-json-block072/final.mp4 artifacts/tests/block072/xml-json-frames --progress
ffplay -autoexit artifacts/videos/xml-json-block072/final.mp4
```

Rendering must reuse the saved plan without model calls. Inspect every scene's
extracted frames and full playback. Report diagnostics paths, exact issues, attempt
counts/timings, video/sidecar paths and visible progression. No TTS, commit/push or
new full script generation. Stop for manual review.

Completed automated checks: storyboard **9/9**; render/planner/inference **45/45**;
lint, scoped TypeScript and `git diff --check` passed. Logs: `/home/maithili-wagh/Desktop/PS04--chakravyuh-kurukshetra2027/next-app/artifacts/tests/block072/checks-l2ksw7d2`.
