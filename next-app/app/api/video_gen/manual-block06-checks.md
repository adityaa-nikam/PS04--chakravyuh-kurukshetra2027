# Block 06: direct prompt-to-MP4 manual test

The new command is executable without Codex or a frontend. It runs the existing
Ollama script generator, normalizes/builds the storyboard, asks the configured local
model for a structured visual plan, validates it, and uses the existing Remotion
composition. One request publishes one final MP4 and one JSON metadata sidecar.
No model, browser, asset, or service is downloaded/started automatically. No audio.

## Run the required fresh live request

From the repository's `next-app/` directory, with your existing Ollama server and
installed `qwen2.5:3b` available:

```sh
npm run explain -- 'Explain XML vs JSON to a beginner. Show the same small data structure represented in both formats, compare their structure, and explain when each is useful.' --output artifacts/videos/xml-json-live/final.mp4
```

This is the mandatory raw-prompt test. It does not consume any saved topic fixture.
`--output` gives this review a predictable path. Without it, the default is
`artifacts/videos/<safe-prompt-slug>/final.mp4`; the slug is derived from the prompt
so existing deliverables can be rejected before spending time on inference.

Expected runtime logs include `[explain] generating_live_script`,
`[video_gen] ollama_generation_success`, `[explain] generating_live_visual_plan`,
and `[explain] rendering`. On success the command prints the **actual absolute**
video/metadata paths, actual rounded video duration, width, height, fps, warnings,
and the internal request receipt. Each model stage has a 180-second timeout.

If narration requires approval, the command stops **before visual planning or
rendering**, saves the exact generated script in an internal receipt, and prints
an executable resume command with that receipt's actual path. Inspect the estimate
and, only if you approve that overrun, copy the printed command, which has this form:

```sh
npm run explain -- --resume artifacts/requests/request-ID/request.json --approve-overrun
```

Replace `request-ID` with the actual path printed by your invocation (or simply
copy the full printed command). This preserves the generated narration and target;
it does not regenerate the script, lower the target policy, speed up, or truncate.
Do not rerun the raw prompt as a substitute for approving the saved request.
Without approval, another resume also stops. To revise the explanation, start a new
prompt/request instead. An approval flag applies only to its invocation/request.

A planner or render failure prints its error and saved receipt path. Resuming reuses
the script and, when a validated visual plan was already saved, reuses that plan.
Invalid model output is rejected, not replaced with a demo or an invented graph.
If the script lacks concrete example values, revise the request to explicitly ask
for a short named record and literal field values; the planner cannot fill them in
without narration evidence. The CLI's generation guidance already asks for this.

## Open the published deliverable

For the exact command above, the intended output is:

- `artifacts/videos/xml-json-live/final.mp4`
- `artifacts/videos/xml-json-live/final.mp4.json` (metadata, not another video)

```sh
ffplay -autoexit artifacts/videos/xml-json-live/final.mp4
ffprobe -v error -show_entries stream=codec_name,codec_type,width,height,r_frame_rate,nb_frames:format=duration -of json artifacts/videos/xml-json-live/final.mp4
node app/api/video_gen/inspect-render.mjs artifacts/videos/xml-json-live/final.mp4 artifacts/tests/block06/xml-json-frames
```

The last command verifies codec, dimensions, frame totals, duration, unchanged
narration and scene order, and extracts **every** scene midpoint into a separate
review directory. It refuses to overwrite PNGs; use a fresh frame directory on a
second inspection. Open all PNGs, and watch the entire MP4 for motion/transitions.
Expected video: H.264, 720x1280 (9:16), 15 fps, one video stream, **no audio**.
Duration comes from the saved narration estimate with per-scene ceiling to frames,
so it can differ from the requested soft target. Do not assert a duration in advance
of the live run; read the printed summary and sidecar.

Inspect these specifics:

1. At least one concrete comparison shows a readable JSON object and XML element
   structure carrying the **same literal keys and values**. Both are derived by
   code from a single model-planned, narration-backed `graph.example` record.
   The XML is escaped display text; it is never executed or injected as markup.
2. Nodes/arrows and model-timed reveals/highlights illustrate the explanation.
   On-screen text is concise; narration paragraphs and raw visual directions stay
   in metadata. Headings/labels/code examples must remain legible, without clipping.
3. Scene order follows the script. No fabricated percentages or unrelated example
   assets appear. Schema/evidence validation is **not** factual verification.
4. In `final.mp4.json`, inspect `provenance.request`, `originalScript`, `model`,
   `plannerModel`, timestamps, `modelVisualPlan`, `explicitOverrides`, and
   `factChecked: false`. Each model-planned scene records purpose, concept explanation,
   confidence, typed visual data, source evidence and declarative actions. The
   resolved `visuals` are what Remotion renders. `storyboard` and `originalStoryboard`
   preserve ordered narration; `frames` specify contiguous scene allocation.
5. Exactly `final.mp4` and `final.mp4.json` remain in the delivery directory.
   Internal request receipts are under `artifacts/requests/`. Encoding uses an
   isolated temporary directory. Short-lived publication staging/locks are cleaned
   after normal success/failure. An abrupt process kill can leave a stale lock;
   inspect it before removing it.

To test overwrite refusal, run the **same initial command again after success**.
It must fail before inference with `Output already exists or is locked`, preserving
the deliverables. Do not delete them to bypass this check; choose a new `--output`
path if you deliberately want another request. The guard/resume behavior above
and focused unit tests cover duration approval; the live result may legitimately
be within target and not need an approval step.

## Configuration and optional arguments

`npm run explain` loads the existing Next environment configuration via its installed
`@next/env` loader: `.env.local` and other Next env files are read; exported shell
variables take precedence. Defaults remain `OLLAMA_BASE_URL=http://localhost:11434`,
`OLLAMA_MODEL=qwen2.5:3b`. The dev-only fixture switch is explicitly ignored by this
live workflow. There are no cloud keys. CLI prompts use the existing 500-character
input limit, audience 120 characters, requested duration 15–120 seconds.

```sh
npm run explain -- 'Explain how an HTTP browser request receives a response from a server.' --audience Beginners --duration 45 --output artifacts/videos/my-http/final.mp4
npm run explain -- --help
```

The HTTP command is an optional later user test, not a second demo generated as a
side effect of the XML/JSON request. The generic graph vocabulary now includes
browser/server/document/database symbols; Qwen chooses nodes and transfer order.
The runtime is not restricted to these examples or the Block 05 topics.

Other flags: `--width`, `--height`, `--fps`, `--browser`, `--visuals specifications.json`.
Explicit validated specifications win over Qwen specs for their scene IDs. The raw
validated Qwen plan remains in provenance so overrides can be audited. Invalid
explicit specifications fail rather than silently falling back. Legacy storyboard
and `render:storyboard` commands remain available and use the same render service.

## Checks and current handoff status

```sh
npm run test:storyboard
npm run test:render
npm run lint
node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module commonjs --moduleResolution node --jsx react-jsx --strict --skipLibCheck --esModuleInterop --types node app/api/video_gen/explain-cli.ts app/api/video_gen/explain.test.ts app/api/video_gen/generate-script-cli.ts app/api/video_gen/render-cli.ts app/api/video_gen/render.test.ts app/api/video_gen/remotion/index.tsx
git diff --check
```

Automated tests mock all Ollama calls and expensive encoding. They test planning
schema/data/evidence/actions, shared JSON/XML values, HTTP transfer timing, unknown
subject overview, deterministic rendering, narration/order, duration rejection and
resume, publication/collision/cleanup, .env.local precedence, and untrusted text.
Block 05 bridge/photosynthesis/CPU regressions remain in `test:render`.

The developer did **not** generate another demonstration MP4 or run the live prompt
for this block: the requested handoff explicitly stops at commands and waits for
your manual results. The live XML/JSON test, actual duration, ffprobe results,
readability and visual acceptance are therefore **pending**, not reported as passed.

Known limits: the 3B model can still produce schema-invalid plans or weak explanations;
those failures are actionable but not repaired with fabricated data. Evidence quotes
check provenance, not truth or logical entailment. There is no fact-checking claim.
The renderer executes only the finite authored vocabulary, at most six graph nodes,
eight edges, sixteen bounded actions, and small flat record examples. Percentages
are currently the only chart value type. Very dense text fails the existing readable
font-size guard. There is no TTS/audio, and no automatic next feature block.

Implementation checks completed in this workspace: storyboard 9/9; existing render
regressions 18/18; planner/CLI tests 12/12; lint, scoped TypeScript, and
`git diff --check` passed. Logs are under `artifacts/tests/block06/`. The environment
subprocess tests required execution outside this workspace's process sandbox; their
model/encoder calls remained mocked and no demonstration MP4 was created.

## XML/JSON bridge-selection failure follow-up

The first live XML/JSON output exposed a model-plan validation hole. See
[xml-json-diagnosis.md](./xml-json-diagnosis.md) for the evidence trace, corrected
validation, actual duration calculation and exact saved-request retest commands.
Use `--inspect` to validate the resolved plan before encoding. Repairing an invalid
cached plan requires explicit `--replan`, which forks the receipt and regenerates
only the visual plan; it never silently substitutes a topic-specific animation.
