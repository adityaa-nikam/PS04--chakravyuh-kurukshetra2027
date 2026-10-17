# Block 07.1: overview repair and saved-request recovery

## Confirmed diagnosis

`artifacts/requests/request-ObyOtP/request.json` records successful script inference
in 25,323 ms and successful scene-001 inference in 38,889 ms (439 output tokens;
~5,176 ms prompt evaluation, ~33,687 ms generation). The subsequent semantic error
was not a timeout. The exact throwing condition establishes these parsed fields:

- `visual.renderer === "graph"`
- `visual.graph.layout === "overview"`
- `confidence === "supported"` (the schema permits only supported/overview)

The raw response was **not retained** by Block 07. Only this request receipt exists
for the run, with no completed scene. Other response fields, including note,
edges and evidence, cannot be reconstructed from the receipt; the regression
reproduces the confirmed field mismatch, not a fabricated copy of that response.

The schema independently allowed either confidence and layout. The prompt explained
uncertainty only under “insufficient evidence,” leaving room for a model to consider
overview labels supported. Meanwhile graph `visual.mode` is always overview even
for non-overview graph layouts. The prompt now explicitly distinguishes these
fields and requires overview confidence for overview layout regardless of label
confidence. Strict semantic validation still rejects the original mismatch.

## Changes and recovery bounds

Only these files changed in 07.1:

- `model-visual-plan.ts`: precise uncertainty-field diagnostics; conservative
  overview metadata repair followed by full prefix validation; at most one
  corrective regeneration for the failed scene; validation reporting/candidate
  callbacks; clearer mode/layout guidance.
- `ollama.ts`: optional `planningAttempt` on inference diagnostics; schema failures
  identify invalid/missing field paths without logging source text. Existing
  transport timeout, context/output caps and serial lane remain intact.
- `explain-pipeline.ts`: save `visualAttempts` (parsed original candidate, resolved
  candidate where accepted/repaired, status, reason and planning-attempt index),
  preserving `completedScenes` and exact script. Explicit replan forks clear this
  history; normal resume retains it.
- `inference.test.ts`: exact-condition repair, unsupported evidence/edge rejection,
  single-scene corrective success, persistent semantic failure and checkpoint
  resume, missing-confidence diagnostics; update previous schema-failure recovery
  expectations for the one corrective attempt.
- `manual-block071-checks.md`: this diagnosis and manual procedure.

Repair is restricted to a schema-valid graph overview with no edges, no values,
and no example. Only confidence/note can change, to overview/Conceptual overview.
The entire candidate plus completed prefix is revalidated against the original
source, IDs, domain, graph structure and all evidence rules before acceptance.
Repair does not promote uncertain content, add facts, change labels/evidence,
remove causal claims/data, or bypass validation. Unsupported evidence therefore
cannot be rescued by changing confidence.

If repair is unavailable, JSON/schema/semantic validation failure gets one concise
corrective request for that scene only. Prior validated scenes are reused. Timeout,
output-limit, context/configuration and provider failures do not trigger this
corrective retry. Existing transport retry remains at most one for connection
failures or HTTP 429/503: at most **two planning attempts**, each with at most **two
transport attempts**, sequentially. `planningAttempt` is 1/2 within this invocation;
`attempt` is the transport attempt. An explicit user resume starts a new bounded
planning attempt sequence; receipt history remains ordered and retained.

`inferenceDiagnostics` now reflects semantic results (`success`, `repaired`,
`validation_failed`, or transport failure/retry). The transport console event can
report success before semantic validation; the subsequent `visual_validation`
console event and persisted diagnostic record show final scene status. Parsed
semantic candidates are kept in the internal receipt, not printed as full prompts.
Malformed/schema-invalid output has field-path diagnostics but no accepted parsed
candidate. Persistence errors fail the workflow rather than triggering regeneration.

No renderer, source narration, script budgets, duration policy, approval,
publication, audio, or dependency changes. No live request or render was run.
The original saved request is unchanged at implementation handoff (SHA-256
`80463a28b11218aad5a663bf38d44fb55146ceec4fa93a94325119b214ecbd76`).

## Next manual test — run only after reviewing this implementation

From `next-app/`, reuse the existing script. Do **not** run a raw-prompt command.
Choose a different fresh output directory if this one already has deliverables.

```sh
npm run explain -- --resume artifacts/requests/request-ObyOtP/request.json --inspect --output artifacts/videos/xml-json-block071/final.mp4
```

No `--replan` is needed: the receipt has no complete visual plan or completed scene.
This calls the planner starting at scene-001, preserves the exact saved script,
and saves validated scenes as they complete. It does not encode. Do not add
`--approve-overrun` automatically. If a future source requires approval, inspect
its duration first; this code does not grant approval.

On failure, inspect `planningFailure`, `visualAttempts`, `completedScenes` and
`inferenceDiagnostics` in the same receipt. Each failure must name scene and field
or evidence condition. Then rerun the **same resume/inspect command** to continue
from the first incomplete scene. Do not use `--replan` for ordinary recovery;
it deliberately forks and replans every scene. The old failed response cannot be
repaired offline because it was never saved; the first resume requires a new
scene-001 visual call, but no script call.

Inspect the result and timing/retry history:

```sh
node - <<'NODE'
const fs = require('node:fs'), assert = require('node:assert/strict');
const receipt = JSON.parse(fs.readFileSync('artifacts/requests/request-ObyOtP/request.json', 'utf8'));
const plan = JSON.parse(fs.readFileSync('artifacts/requests/request-ObyOtP/resolved-plan.json', 'utf8'));
assert.equal(plan.published, false);
assert.deepEqual(plan.storyboard.scenes.map(s => s.narration), receipt.script.scenes.map(s => s.narration));
assert.deepEqual(plan.visuals.map(v => v.sceneId), plan.storyboard.scenes.map(s => s.id));
assert.ok(plan.visuals.every(v => v.renderer === 'graph'));
for (const e of receipt.visualPlan.scenes) if (e.visual.graph.layout === 'overview') {
  assert.equal(e.confidence, 'overview');
  assert.match(e.visual.note, /overview/i);
  assert.equal(e.visual.graph.edges.length, 0); assert.equal(e.visual.graph.values.length, 0);
}
console.table(receipt.inferenceDiagnostics.map(d => ({stage:d.stage, scene:d.sceneId, planningAttempt:d.planningAttempt, transportAttempt:d.attempt, status:d.status, reason:d.reason, elapsedMs:d.elapsedMs, outputTokens:d.outputTokens})));
console.table((receipt.visualAttempts || []).map(a => ({scene:a.sceneId, planningAttempt:a.planningAttempt, status:a.status, reason:a.reason})));
console.log(JSON.stringify({durationSeconds:plan.durationSeconds, policy:plan.storyboard.durationPolicy, visuals:plan.visuals}, null, 2));
NODE
```

The first two historic diagnostics remain in history; they lack planningAttempt
because Block 07 did not record it. New semantic failures must no longer be saved
as successful planning. Confirm that any repaired overview has local evidence
and no factual edges/data; repair need not occur if Qwen now returns a valid plan.
Read all scene content. The saved script puts XML and JSON examples in separate
scenes; it does not state every field/root in every scene, and some literals exceed
the renderer's short-record limits. Local evidence guards remain strict; a safe
overview or a clear remaining evidence failure is possible. Do not approve an
all-overview result as satisfying the desired example comparison. Report such
limitations rather than silently editing the source or weakening validation.

After inspecting the complete resolved plan and deciding to render it:

```sh
npm run explain -- --resume artifacts/requests/request-ObyOtP/request.json --output artifacts/videos/xml-json-block071/final.mp4
node app/api/video_gen/inspect-render.mjs artifacts/videos/xml-json-block071/final.mp4 artifacts/tests/block071/xml-json-frames --progress
ffplay -autoexit artifacts/videos/xml-json-block071/final.mp4
```

Render must reuse the saved plan without inference. Open every extracted PNG and
play the full video. Verify changing scene content, planned motion, readable text,
no bridge, correct uncertainty labels, narration preserved in the sidecar, portrait
dimensions and expected duration. The final directory should contain one MP4 plus
one JSON sidecar. Repeat the render command to verify overwrite refusal before
inference; keep the published files. Report paths, planning/transport attempts,
repairs, elapsed times and any remaining field/evidence failures. No TTS or new
full live generation until separately approved.

Automated checks completed: storyboard **9/9**, render/planner/inference **42/42**,
lint, scoped TypeScript and `git diff --check` passed. Logs: `/home/maithili-wagh/Desktop/PS04--chakravyuh-kurukshetra2027/next-app/artifacts/tests/block071/checks-oo68qzjs`.
No live inference or MP4 encoding occurred during verification.
