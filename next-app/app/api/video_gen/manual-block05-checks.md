# Block 05 manual handoff

Run all commands from `next-app/`. Existing `artifacts/tests/block05/videos/`
contains the three reviewed test deliverables below, each with **one** `final.mp4`
and **one** `final.mp4.json` metadata file. These are three independent topic tests,
not three outputs for one request. Internal attempts/frames/scripts are separate.

## Open the completed videos

```sh
ffplay -autoexit artifacts/tests/block05/videos/bridge/final.mp4
ffplay -autoexit artifacts/tests/block05/videos/photosynthesis/final.mp4
ffplay -autoexit artifacts/tests/block05/videos/cpu/final.mp4
```

| Topic | Expected output | Inspect for meaning, not merely successful encoding |
| --- | --- | --- |
| Bridge | 763 frames, 50.866667 s | Vibration hook; moving wind and vehicles; vibration indicators; damper in takeaway. Motion is exaggerated, not a structural simulation. |
| Photosynthesis | 1,111 frames, 74.066667 s | Separate sunlight, water and carbon-dioxide inputs; chlorophyll highlighted by the leaf symbol; combined input/product flow in scene 5; glucose and oxygen products; source-based recap. The symbols are conceptual, not molecular diagrams. |
| CPU | 1,244 frames, 82.933333 s | Instruction/operation circuit; memory read into CPU; decoded fields; data fetching from memory; operation; write-back to memory; repeat loop. Data fetch follows decode in this particular source; this is not a hardware pipeline or latency simulation. |

All should be H.264, 720x1280 portrait, 15 fps, silent. Inspect large headings,
readable local labels, scene counters/order, progressive reveals, and moving
information/flow indicators. No raw visual directions or narration paragraphs
should be printed. Source narration is fully preserved in each JSON sidecar.
The visual plans intentionally avoid illustrating the scripts' musical/drum analogies
as literal subject matter. They explain the technical components instead.

Photosynthesis and CPU exceeded their original **45-second** targets and were
rendered only after explicit user approval in this session. Their policy remains
`requires_revision`; bridge is `within_target`. Estimated narration durations are
73.847, 82.613, and 50.770 seconds respectively. Frame rounding accounts for the
small differences in actual durations. Narration and policy were not shortened.

## Reproduce offline using the saved live outputs

The repository fixtures under `fixtures/block05/` are snapshots of live
qwen2.5:3b outputs, not synthetic renderer demos. See their provenance README.
Choose a fresh review directory; these example commands intentionally refuse to
replace existing MP4s/sidecars or midpoint PNGs. Approval flags below apply only to
the two test overruns approved in this session, not to future generated scripts.

```sh
mkdir -p artifacts/tests/block05-review/storyboards
npm run --silent storyboard -- app/api/video_gen/fixtures/block05/bridge.script.json > artifacts/tests/block05-review/storyboards/bridge.json
npm run --silent storyboard -- app/api/video_gen/fixtures/block05/photosynthesis.script.json > artifacts/tests/block05-review/storyboards/photosynthesis.json
npm run --silent storyboard -- app/api/video_gen/fixtures/block05/cpu.script.json > artifacts/tests/block05-review/storyboards/cpu.json

npm run render:storyboard -- artifacts/tests/block05-review/storyboards/bridge.json artifacts/tests/block05-review/videos/bridge/final.mp4
npm run render:storyboard -- artifacts/tests/block05-review/storyboards/photosynthesis.json artifacts/tests/block05-review/videos/photosynthesis/final.mp4 --approve-overrun
npm run render:storyboard -- artifacts/tests/block05-review/storyboards/cpu.json artifacts/tests/block05-review/videos/cpu/final.mp4 --approve-overrun

node app/api/video_gen/inspect-render.mjs artifacts/tests/block05-review/videos/bridge/final.mp4 artifacts/tests/block05-review/frames/bridge
node app/api/video_gen/inspect-render.mjs artifacts/tests/block05-review/videos/photosynthesis/final.mp4 artifacts/tests/block05-review/frames/photosynthesis
node app/api/video_gen/inspect-render.mjs artifacts/tests/block05-review/videos/cpu/final.mp4 artifacts/tests/block05-review/frames/cpu

ffplay -autoexit artifacts/tests/block05-review/videos/bridge/final.mp4
ffplay -autoexit artifacts/tests/block05-review/videos/photosynthesis/final.mp4
ffplay -autoexit artifacts/tests/block05-review/videos/cpu/final.mp4
```

The inspect helper runs ffprobe, verifies streams/dimensions/duration/frame count,
compares narration to the original storyboard, checks contiguous frames/order,
and extracts a midpoint PNG for **every** scene. Read its printed nodes/edges and
their evidence strings, then open each PNG and watch each MP4. Automated metadata
checks do not establish scientific correctness or replace visual review.

## Normal request: one final MP4

The CLI stays a development/local-render tool. No new web UI or orchestration
service was added. One storyboard invocation renders only its own ordered scenes.
For a fresh live script, start the existing Ollama server with the already installed
model; use the same generator as the API (no model downloads):

```sh
mkdir -p artifacts/requests/my-topic
# Write request.json with topic, optional targetAudience and durationSeconds.
npm run script:generate -- artifacts/requests/my-topic/request.json artifacts/requests/my-topic/script.json
npm run --silent storyboard -- artifacts/requests/my-topic/script.json > artifacts/requests/my-topic/storyboard.json
npm run render:storyboard -- artifacts/requests/my-topic/storyboard.json
```

The default final path is `artifacts/videos/<safe-title-slug>/final.mp4`, with metadata
at `final.mp4.json`. An explicit output argument chooses another location. A slug
collision or existing video/sidecar is refused; supply a fresh explicit filename for
a new request with the same title. A lock refuses concurrent writers to the same
path. Rendering happens in an isolated temporary directory; failed renders publish
no final MP4. Temporary files and locks are cleaned on normal completion/failure.
An abruptly killed process can leave a `.lock`; inspect before removing a stale lock.
No command automatically renders an unrelated within-target sample.

`script:generate` uses server environment/default `OLLAMA_BASE_URL` and `OLLAMA_MODEL`
like the existing API; it does not load `.env.local` automatically and explicitly
avoids the dev-only JSON/XML fixture switch. Export custom settings if needed.
It validates through the existing generator and refuses to overwrite script output.
If Ollama is unavailable, clearly state that the saved fixtures above are being used.

For an unknown new script, omit `--approve-overrun` initially. If the command returns
`DURATION_APPROVAL_REQUIRED`, obtain explicit approval or revise the source script.
Never change the policy or silently edit narration to fit the target.

## Guard and overwrite checks

```sh
# Must fail before creating either denied.mp4 or its sidecar:
npm run render:storyboard -- artifacts/tests/block05/live/cpu-storyboard.json artifacts/tests/block05/denied/cpu.mp4
# Must fail with Output already exists and preserve the existing bridge files:
npm run render:storyboard -- artifacts/tests/block05/live/bridge-storyboard.json artifacts/tests/block05/videos/bridge/final.mp4
```

## Automated checks

```sh
npm run test:storyboard
npm run test:render
npm run lint
node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module commonjs --moduleResolution node --jsx react-jsx --strict --skipLibCheck --esModuleInterop --types node app/api/video_gen/generate-script-cli.ts app/api/video_gen/render-plan.ts app/api/video_gen/render-cli.ts app/api/video_gen/render.test.ts app/api/video_gen/remotion/index.tsx
```

## Extending the visual system

`visual-graph.ts` validates nodes, authored icons, evidence, directed relationships,
layout, and bounded percentage data. `concept-adapter.ts` provides deterministic
adapters; add topic vocabulary/evidence rules to `conceptAdapters` and reuse the
same graph renderer. New symbols must be authored React/SVG, not source markup.
`visual-plan.ts` retains bridge rendering and selects heading/summary presentation.
The existing storyboard schema and generation pipeline are unchanged.

| Template | Purpose / required evidence |
| --- | --- |
| Bridge | Physical structure, forces, vibration, loads, damping; bridge context. Existing bridge mode coverage retained. |
| Flow | One central component/process, up to three source-mentioned inputs and outputs; arrows require positive local assertions. Photosynthesis requires biological vocabulary as well as topic context. |
| Sequence / cycle | Source-mentioned stages; order/repetition only when explicitly stated. CPU requires CPU/processor context plus instructions. Memory reads/writes use directed source assertions. |
| Cause | Explicit positive `X causes / leads to / results in Y`; no inferred causality from co-occurrence. |
| Comparison | Explicit `A versus/vs/whereas B`, two source excerpts, no fabricated scores. |
| Percentage bars | At least two explicit `Label: value%` entries, each 0–100. No numbers invented; counts, units and isolated statistics remain conceptual pending a typed adapter. |
| Overview | Source excerpts without inferred edges. Used for unknown topics/uncertain mappings; does not pretend to explain an unsupported mechanism. |
| Hook / summary | Concise heading over the supported topic graph, preserving scene order and duration. |

An explicit specification file can override any scene using
`--visuals path/to/specifications.json`. It is an object keyed by `scene-001`, etc.;
each value must satisfy `visualSceneSchema`, including matching sceneId. For graph
specs, use graphSchema's nodes/edges/values and source evidence. Evidence must exist
in that scene's narration/directions/elements or storyboard title; node labels and
percentage values must be backed by it. Invalid specs, absent evidence, dangling
edges, unrecognized icons, and unknown renderers fail rather than silently changing
the user's explicit design. Keyword mappings run only for scenes without a spec.
For the exact fields see `visual-plan.ts` and `visual-graph.ts`; existing `.mp4.json`
visuals provide valid examples to copy and edit. Overrides are data, never code.

Known limits: English rules are deliberately conservative and cannot understand every
paraphrase, negation, analogy or scope. Input scripts still need factual review.
Plant/gas/sugar symbols do not depict molecular structures or reaction stoichiometry;
CPU graphics do not depict transistor-level execution. Unknown topics can still need
an authored adapter or explicit spec; a source overview is not full topic support.
Only labeled percentages currently become charts. Host fonts can affect layout;
overflow still fails explicitly at the readable minimum. Videos remain silent.
Do not start TTS/Block 06 until the user reviews and explicitly accepts these visuals.

## Verification completed in this workspace

- Live script generation succeeded for all three topics; the final saved scripts
  match their provenance snapshots. No synthetic fallback was used.
- Storyboard tests: 9/9 passed. Render tests: 18/18 passed. Lint, scoped TypeScript
  check, and `git diff --check` passed. Detailed output: `artifacts/tests/block05/checks.log`.
- All three final MP4s passed ffprobe and frame/duration checks. All 18 midpoint
  images (4 bridge + 7 photosynthesis + 7 CPU) were extracted and visually inspected.
- Each final folder contains exactly `final.mp4` and `final.mp4.json`; full
  original/resolved storyboards compare equal for these examples.
- The actual CLI refused an unapproved CPU render before output creation and
  refused overwriting the bridge output. Bridge MP4 and metadata SHA-256 hashes
  were unchanged after the overwrite attempt.
- Videos were played in ffplay; window captures are `bridge-player.png`,
  `photosynthesis-player.png`, and `cpu-player.png` under `artifacts/tests/block05/`.
- Initial CPU label overflow and cramped flow-node spacing were fixed before the
  final renders. Superseded internal attempts remain under `attempts/` and are not
  user deliverables. No source narration was changed to resolve layout errors.

Visual assessment: bridge forces/vibration/damping, photosynthesis input/product
flow, and CPU memory/operation/repetition are meaningful schematic explanations.
This does not establish support for arbitrary biological mechanisms, CPU hardware
microarchitecture, or unreviewed generated scripts. Unsupported topics deliberately
remain source overviews. User visual acceptance is still pending before TTS.
