# XML/JSON live failure: diagnosis and retest

## Evidence examined (existing files, no new model call or video)

- Failed video/sidecar: `artifacts/videos/xml-json-live/final.mp4[.json]`.
- Exact receipt named by sidecar: `artifacts/requests/request-0uaKbm/request.json`.
- Separate request: `artifacts/requests/xml-vs-json/{request,script,storyboard}.json`.
  This is not the source of the failed video: its four-scene storyboard estimates
  53.539 seconds; the failed sidecar uses a different, three-scene script.
- Extracted existing-video midpoints and boundary PNG:
  `artifacts/tests/xml-json-diagnosis/{scene-001,scene-002,scene-003,boundary}.png`.
- A source-only regression snapshot of the actual failure is kept in
  `fixtures/regressions/xml-json-bridge.json`.

## Exact trace

1. The receipt and sidecar record the correct raw XML/JSON prompt, audience Beginners,
   and a **45-second target**. Narration is XML/JSON content, with no bridge mention.
   Generation is repetitive: scene narration lengths are 1,200, 1,196 and 1,199
   characters, including repeated explanations, markup examples and incomplete
   sentence endings. The saved source itself contains these problems; Remotion did
   not duplicate or truncate narration to produce them.
2. Qwen returned `renderer: "bridge"`, `mode: "overview"`, `concept: "comparison"`
   for **all three scenes**, with the same heading, footer labels and note. It
   supplied no graph nodes, record example or declarative actions.
3. The shared discriminated schema allowed a graph-free bridge branch. It was the
   first branch and required substantially less data than a graph, but the artifacts
   do not establish the model's internal reason for choosing it. There was **no
   renderer default** forcing that choice. The runtime validator then executed
   `if (visual.renderer !== "graph") continue`, skipping source/evidence/action
   checks for bridge scenes. This was the validation defect.
4. The model plan in the receipt equals the sidecar's `provenance.modelVisualPlan`;
   its visual specs equal the resolved `visuals` exactly. `explicitOverrides` and
   `fallbackSceneIndexes` are empty. Scene IDs are correctly ordered 001/002/003.
   No old bridge fixture/spec was substituted by the code. Explicit specs correctly
   took precedence over the legacy adapter, but the invalid model specs should
   have been rejected first. Normalization did not select a renderer.
5. The renderer dispatches `visualComponents[visual.renderer]`. BridgeVisual obeys
   `mode`, so overview draws its static deck/supports/foundations. The comparison
   concept/JSON/XML footer does not transform that bridge into a data comparison.
   There was a semantic mismatch between two individually accepted enum fields.
6. Remotion sequences start at frames **0, 1468, 2929**, lasting **1468, 1461,
   1468** frames. Midpoint images show scene counters **01, 02, 03** and advancing
   progress bars; the boundary image shows scene 02 fading in. The clock and
   transitions work. The main composition looks unchanged because every resolved
   scene asks for the same static overview. No motion mode or graph actions were
   supplied. The frames agree with the sidecar, not a stale bundle/video cache.
   Bundling already uses a fresh temporary directory and webpack cache disabled.

## Why the duration is long (and the 153-second discrepancy)

`ffprobe` of the stated file reports **293.133333 seconds**, 4,397 H.264 frames,
720x1280 at 15 fps, one video stream, no audio. The matching sidecar records
293.077 seconds of estimated narration and **232.599 seconds of render wall time**.
None of those is 153 seconds; that number cannot be substantiated from these files.

The existing word tokenizer counts **212 + 211 + 212 = 635** narration words,
including markup/example tokens. At the preserved 130 words/minute policy,
`635 * 60 / 130 = 293.076923...` seconds. Per-scene ceiling to frames adds only
0.056333 seconds. The three boundaries occur at approximately 0, 97.866667 and
195.266667 seconds. The policy correctly says `requires_revision`, target 45,
overrun 248.077 seconds; the actual rendered settings have `approveOverrun: true`.
The receipt stores false because approvals intentionally apply only to an invocation.
The artifacts do not record the exact terminal command that set that render flag.

A visual-only repair must keep this duration when reusing the same narration.
A shorter final video requires an explicitly revised script, not a changed duration
policy, dropped narration, altered fps allocation, or automatic speed-up. No such
source revision was made in this fix.

## Fixes

- Qwen's response grammar uses only the shared graph schema for sources without
  physical bridge context. This closes the cheap unrelated specialized branch
  without adding an XML/JSON animation or replacing model planning.
- Domain validation rejects an ungrounded bridge renderer in model plans, explicit
  specs, resolved plans, and the scene component. A bridge comparison also requires
  bridge comparison mode. Mixed-topic requests are checked per scene. Legacy
  physical bridge graphics and graph-based CPU/photosynthesis remain available.
- Graph specs require their graph payload and compatible overview mode. Uncertain
  plans must remain explicitly labeled, source-grounded generic overviews. Invalid
  cached specs fail clearly; they are not silently converted into unrelated graphics.
- The actual scene presentation has a pure local-frame entry (`SceneFrame`) used by
  Remotion and regression tests. It checks resolved scene/frame/visual identity and
  missing/unknown renderer data. Tests render its real markup to verify distinct
  headings, record representations, planned visibility/highlight states and fades,
  and verify the enclosing Remotion Sequence allocation/child bindings.
- `--inspect` validates and saves `resolved-plan.json` without encoding/publishing.
  `--replan` explicitly regenerates only the visuals for a saved script and forks a
  new receipt; the failed original is retained as evidence. No automatic replan on
  resume, duration bypass, overwrite or source shortening was introduced.

## Manual retest: saved source, inspect first, render only after inspection

Run from `next-app/`. No replacement video or live model call was made by the
agent for this fix. The following commands are for your manual run.

### 1. Confirm the old plan is rejected, entirely offline

```sh
npm run explain -- --resume artifacts/requests/request-0uaKbm/request.json --inspect --output artifacts/videos/xml-json-retest/final.mp4 --approve-overrun
```

Expected: `VISUAL_DOMAIN_MISMATCH` for scene-001; no video, no model call, and no
change to the original receipt. The approval flag here permits inspection of the
existing long script; `--inspect` cannot encode. This exact command was checked in
the fix. Use a different fresh output directory if the retest path already exists.

### 2. Ask Qwen to repair only the visual plan, still without rendering

The invalid saved plan contains no graph/record/actions to reuse. A faithful
model-driven repair therefore needs **one necessary visual-planning model call**.
It does not regenerate the script or hand-author a topic-specific animation.
If you accept preserving the original ~293-second narration for this visual test:

```sh
npm run explain -- --resume artifacts/requests/request-0uaKbm/request.json --replan --inspect --output artifacts/videos/xml-json-retest/final.mp4 --approve-overrun
```

This prints a **new** `requestReceipt` and `inspectionFile` path under
`artifacts/requests/request-NEW/`. Do not guess the generated ID. Open the printed
`resolved-plan.json` before rendering. It must show:

- No bridge renderer; each `visuals[i].sceneId` and `frames[i].id` matches the source.
- Meaningful model-planned source-grounded graphs and a shared record in concrete
  representation comparisons, not two empty boxes or a generic topic guess.
- Readable concise headings/labels; inspect `graph.actions` for reveals/highlights
  and transfers where appropriate. A genuine uncertain fallback is labeled overview.
- Unchanged source narration and approximately 293.133 seconds / 4,397 frames.

If planning is invalid or unhelpful, **do not render**. Report the error/inspection
file. No final MP4 should exist. Schema/source validation does not fact-check the
original script, whose oversimplifications/repetition still warrant editorial review.

### 3. Render the inspected new receipt to the fresh path

Replace `request-NEW` with the path printed in step 2. Do not include `--replan`:

```sh
npm run explain -- --resume artifacts/requests/request-NEW/request.json --output artifacts/videos/xml-json-retest/final.mp4 --approve-overrun
```

Expected logs: reuse saved script and saved visual plan, **no model calls**, then
render. The CLI revalidates the cached plan and approval. Only one new MP4 and its
metadata sidecar are published; the failed `xml-json-live/` output stays intact.

### 4. Inspect every scene and its progression; play the complete video

```sh
ffprobe -v error -show_entries stream=codec_name,codec_type,width,height,r_frame_rate,nb_frames:format=duration -of json artifacts/videos/xml-json-retest/final.mp4
node app/api/video_gen/inspect-render.mjs artifacts/videos/xml-json-retest/final.mp4 artifacts/tests/xml-json-retest-frames --progress
ffplay -autoexit artifacts/videos/xml-json-retest/final.mp4
```

Open all extracted PNGs. The helper extracts each midpoint plus entry, 10%, 40%,
70%, 90% and exit frames for every scene. Compare those states to the inspected
model actions. Check scene counters/fades, same example keys/values in both
representations, legible text, no bridges or raw direction instructions, and silence.
Repeating step 3 must refuse overwrite before inference or encoding. Only after
this manual visual review and explicit user approval may further feature work begin.

## Verification of the fix

Storyboard tests: 9/9. Existing render regressions: 18/18. Planner/CLI regressions:
15/15, including the actual failed plan and real scene markup/state tests. Lint,
scoped TypeScript and `git diff --check` passed. Logs are in
`artifacts/tests/xml-json-diagnosis/`. The isolated environment subprocess test
required execution outside the process sandbox; all model/encoder tests remained
mocked. Inspection of the actual cached receipt now rejects it offline with
`VISUAL_DOMAIN_MISMATCH`. SHA-256 checks confirmed that the original MP4, sidecar
and receipt are unchanged; no replacement MP4 or new live model output was created.
The corrected live visual plan/video still requires the user's manual retest.
