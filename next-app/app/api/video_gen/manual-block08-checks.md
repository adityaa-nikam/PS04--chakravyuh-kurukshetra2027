# Block 08: opt-in compact visual actions

No live Ollama call or real MP4 render was performed during implementation. The
existing graph planner remains the default; this path requires `--visual-actions`.

## Schema and scope

Qwen returns one of two strict, discriminated objects for each scene:

```json
{"sceneId":"scene-001","action":"format_comparison","exampleId":"record-001","focus":"structure"}
```

`format_comparison` accepts only sceneId, action, the known exampleId, and focus
`structure` or `fields`. It is currently an XML/JSON comparison, not an arbitrary
format converter. Both formats must appear in the scene narration or title.
Qwen never supplies record contents, graph nodes/edges, renderer names, icons,
positions, styles, animation targets or times. Unknown fields/types/references fail.

```json
{"sceneId":"scene-001","action":"concept_overview","labels":[{"text":"XML","evidence":"XML and JSON"}]}
```

`concept_overview` takes one or two short labels and exact local narration/title
quotes. It always compiles to confidence overview, note Conceptual overview,
with no relationships, numerical data or examples. Unsupported evidence fails;
an invalid specific action is not silently replaced by an overview. This second
action keeps uncertainty explicit for concepts outside the first supported action.
Processes, timelines, numerical comparisons and architecture actions are deferred;
the default graph planner and all existing visual components remain available.

`visual-actions.ts` compiles actions into the same validated ModelVisualPlan used
by the existing renderer. Code owns scene purposes, graph topology, IDs, headings,
icons, two representations, reveals, paired highlights and layout. Existing render
allocation still follows narration estimates/order; it is not chosen by Qwen.
Default visual-action output cap is **384 tokens per scene**, versus 1536 for the
graph planner; the existing explicit OLLAMA_VISUAL_MAX_TOKENS setting can override
that default. Calls remain sequential, with at most two planning attempts, plus
the existing bounded transient transport retry. Context/timeout defaults remain
4096 tokens / 180 seconds. Fewer output fields/tokens is a design change, not a
measured live performance or quality improvement.

## Canonical example and evidence policy

`action-catalog.ts` deterministically rebuilds record-001 from the unchanged
storyboard. V1 extracts the first short string field from a simple XML record in
narration; names must satisfy existing XML-name limits, values <=20 characters.
For the supplied saved script this is **book.title = Harry Potter**, from scene-002.
Only this short field is shown; the note says “Illustrative record • source excerpt.”
Nested XML, arbitrary XML syntax, JSON-only source extraction and multiple fields
are deliberately not implemented. This scanner does not execute or parse markup
into the DOM. If no supported record exists, a fixed **person.name = Ana** example
is labelled “Illustrative example • not source data.” Neither case claims measured
or user-provided facts beyond its declared provenance.

One canonical record is serialized into JSON and escaped XML. The existing graph
comparison renders both representations with matching field content. Compiled
`comparisonFocus` enables line emphasis: structural delimiters or corresponding
field/value lines highlight on both sides at the same scene-relative time.
Reveals introduce XML then JSON; paired highlights occur at 40–75% of scene time.
The legacy whole-record comparison renderer is unchanged when this field is absent.

The action compiler's local semantic checks run before graph compilation. A scoped
`visual-actions-v1` evidence context lets the existing validators recognize ONLY
the exact code-owned illustrative record, exact disclosure note and no edges/data.
It is not model-provided evidence and cannot accept arbitrary records/relationships.
The default graph path gets no extra evidence or exceptions. Overview labels
must still quote local narration/title, not catalogue text. This avoids mutating
or appending to narration to justify an illustration. Original script and
normalized storyboard are preserved in the receipt/sidecar. Source evidence
validation and illustrative provenance are distinct, and neither is fact-checking.

## Checkpoints, compatibility and protection

Changing an existing graph request to actions requires **both** `--visual-actions`
and `--replan`. This forks a new receipt, preserves the old receipt/script and
clears the old renderer checkpoint. Fresh actions-v1 receipts store planner,
completedActions and then actionPlan. Each validated prefix is checkpointed;
resume recompiles/revalidates it before inference and starts at the next scene.
It never regenerates narration. A complete saved action plan is recompiled and
compared with its cached renderer plan before render. Stale/mismatched plans fail
with explicit replan instructions; they are not silently trusted or migrated.
A resumed actions receipt automatically selects the saved planner without the flag.
Return to the preserved original receipt to use its default graph path.

Raw redacted responses, exact sent schemas, parser issues and semantic validation
artifacts still live in the receipt's diagnostics directory. Semantic failures
are marked validation_failed rather than transport success in saved diagnostics.
Source script/duration approval, locked/exclusive publication, overwrite refusal,
no-publication-on-failure, portrait defaults and text fitting remain in force.
Action-v1 rejects `--visuals` overrides rather than letting arbitrary renderer data
diverge from the inspected actions. No model, dependencies, audio, frontend or
service was installed or added.

## Manual live test: reuse the saved script and inspect first

From `next-app/`, choose a fresh output directory if this one already contains
final deliverables. Run only after reviewing the implementation:

```sh
npm run explain -- --resume artifacts/requests/request-ObyOtP/request.json --visual-actions --replan --inspect --output artifacts/videos/xml-json-block08/final.mp4
```

This performs live **visual action selection only**. It forks the original receipt,
keeps its exact script, and never renders during inspection. Capture the NEW
requestReceipt/inspectionFile printed on success, or the saved-request path in a
failure. Set the variable to that actual fork, not the old source receipt:

```sh
action_receipt='artifacts/requests/request-NEW-ID/request.json'
```

Inspect the saved actions, compiled graphs, example provenance and diagnostics:

```sh
node - "$action_receipt" <<'NODE'
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const receiptPath = process.argv[2], r = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
const original = JSON.parse(fs.readFileSync('artifacts/requests/request-ObyOtP/request.json', 'utf8'));
assert.equal(r.planner, 'actions-v1'); assert.deepEqual(r.script, original.script);
console.log('ACTIONS', JSON.stringify(r.actionPlan || r.completedActions, null, 2));
console.table(r.inferenceDiagnostics.map(d => ({stage:d.stage, scene:d.sceneId, planningAttempt:d.planningAttempt, transportAttempt:d.attempt, status:d.status, reason:d.reason, elapsedMs:d.elapsedMs, outputBytes:d.outputBytes, outputTokens:d.outputTokens, schemaBytes:d.schemaBytes})));
const diagnostics = path.join(path.dirname(receiptPath), 'diagnostics');
if (fs.existsSync(diagnostics)) for (const file of fs.readdirSync(diagnostics, {recursive:true}).map(String).filter(f => /(?:response|validation)\.json$/.test(f))) console.log(file, fs.readFileSync(path.join(diagnostics, file), 'utf8'));
if (r.planningFailure) { console.error(r.planningFailure); process.exitCode = 1; }
else {
  const report = JSON.parse(fs.readFileSync(path.join(path.dirname(receiptPath), 'resolved-plan.json'), 'utf8'));
  assert.equal(report.published, false); assert.ok(!fs.existsSync(report.output));
  assert.deepEqual(r.actionPlan.map(a => a.sceneId), report.storyboard.scenes.map(s => s.id));
  assert.ok(report.visuals.every(v => v.renderer === 'graph'));
  assert.ok(r.actionPlan.some(a => a.action === 'format_comparison'));
  const examples = report.visuals.filter(v => v.graph.example).map(v => v.graph.example);
  assert.ok(examples.length); examples.forEach(e => assert.deepEqual(e, report.exampleCatalog.example));
  console.log('CATALOGUE', JSON.stringify(report.exampleCatalog, null, 2));
  console.log('RESOLVED PLAN', JSON.stringify(report, null, 2));
}
NODE
```

The receipt inherits historic diagnostics; identify new action responses by their
raw action object and 384-token default output limit, not old failed graph attempts.
Check reduced schema/output sizes and actual stage/scene elapsed time. Do not claim
speedup without comparing live timings, loading state and failures. Verify correct
source excerpt, exact equivalent values, disclosure note, useful focus progression,
no unrelated graph, no invented relationships, no raw directions/full narration
printed, and no unresolved failures. If Qwen chooses all overviews or repeatedly
the same focus, report it as a quality failure rather than approving the experiment.
Tests cannot establish its live choice quality or text legibility on an MP4.

If a scene fails, rerun only the fork without `--replan`:

```sh
npm run explain -- --resume "$action_receipt" --inspect --output artifacts/videos/xml-json-block08/final.mp4
```

It resumes the first incomplete action. Do not rerun the original fork command as
ordinary recovery: that explicitly starts a fresh visual plan. Never approve an
overrun automatically; the existing duration guard can still stop saved scripts.

## Render the inspected saved request, inspect frames and play

After reviewing a complete, suitable resolved plan:

```sh
npm run explain -- --resume "$action_receipt" --output artifacts/videos/xml-json-block08/final.mp4
node app/api/video_gen/inspect-render.mjs artifacts/videos/xml-json-block08/final.mp4 artifacts/tests/block08/xml-json-frames --progress
ffplay -autoexit artifacts/videos/xml-json-block08/final.mp4
```

Render must reuse the saved plan with no model calls. Open **every** scene midpoint
and early/highlight/late/boundary PNG and play the entire video. Verify XML and JSON
carry the same record, corresponding fields/structural lines highlight together,
scenes progress according to focus, text remains readable, no markup executes,
narration stays intact in metadata, 9:16 aspect ratio, correct scene order/duration,
no bridge and no audio. The final directory contains exactly final.mp4 and its
final.mp4.json sidecar. Inspect sidecar provenance.visualActions, exampleCatalog,
modelVisualPlan, originalScript and factChecked:false.

Repeat the same resume/render command after success: it must refuse overwrite
before inference and leave both files unchanged. Publication cleanup and duration
refusal are also covered by mocked tests; do not kill a real encode to test them.
Report actual paths, action choices/focus, provenance, tokens/sizes/times/retries,
all frame/playback findings, and limitations. Stop for manual approval; no TTS or
next block.

## Changed files and automated checks

New: action-catalog.ts, visual-actions.ts, visual-actions.test.ts,
manual-block08-checks.md (all under app/api/video_gen/).
Updated: explain-options.ts, explain-cli.ts, explain-pipeline.ts,
model-visual-plan.ts, render-plan.ts, render-service.ts, visual-graph.ts,
remotion/GraphVisual.tsx, run-storyboard.mjs and README.md.

```sh
npm run test:storyboard
npm run test:render
npm run lint
node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module commonjs --moduleResolution node --jsx react-jsx --strict --skipLibCheck --esModuleInterop --types node app/api/video_gen/explain-cli.ts app/api/video_gen/explain.test.ts app/api/video_gen/inference.test.ts app/api/video_gen/visual-actions.test.ts app/api/video_gen/generate-script-cli.ts app/api/video_gen/render-cli.ts app/api/video_gen/render.test.ts app/api/video_gen/remotion/index.tsx app/api/video_gen/route.ts
git diff --check
```

Completed checks: storyboard **9/9**; render/planner/inference/action **51/51**;
lint, scoped TypeScript and `git diff --check` passed. Logs: `/home/maithili-wagh/Desktop/PS04--chakravyuh-kurukshetra2027/next-app/artifacts/tests/block08/checks-eefq825l`.
No live inference or real video encoding was run. Manual performance/visual review
remains pending. No commits or pushes were made.
