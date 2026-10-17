# Animation and local narration review

This block addresses the small-card photosynthesis rendering and silent exports.
Earlier uncommitted changes in this workspace remain intact.

## Existing components retained

`Visuals.tsx` contains the authored bridge, vehicles, wind, vibration and load
paths. `GraphVisual.tsx` renders CPU/technical graphs and dispatches XML/JSON
records to `RecordComparison.tsx`. `AnimationPrimitives.tsx` already supplies
`TracePath`, `WipeReveal` and `HighlightBand`. `plannedMotion` resolves validated
scene-relative reveal/highlight/transfer actions. `SceneFrame` receives the local
frame through Remotion sequences and passes each scene's allocated frame count.
`FitText` still enforces readable minimum sizes and fails on overflow.

## Files changed in this block

| File | Purpose |
| --- | --- |
| `remotion/PlantVisual.tsx` | Full authored plant, resource symbols, persistent labels, traced transport paths and moving packets. Only supported graph edges animate. |
| `remotion/GraphVisual.tsx` | Dispatch compatible photosynthesis flows to the plant component; preserve general rendering for other graph structures. |
| `plant-animation.test.ts` | Deterministic motion, source-backed transfers, negation and general-renderer fallback tests. |
| `local-narration.ts` | Local Piper invocation, WAV duration measurement, minimum scene timing and FFmpeg audio assembly/mux. |
| `piper-worker.py` | Load one local voice per render and speak the exact scene narration into separate WAV files. |
| `render-service.ts` | Prepare narration before visual encoding, then mux speech before publishing. Injected test encoders remain isolated from speech dependencies. |
| `render-plan.ts` | Optional speech provenance and measured duration metadata. |
| `local-narration.test.ts` | Timing/approval guards and actual FFmpeg stream assembly tests. |
| `inspect-render.mjs` | Validate the final audio stream and measured speech-aware frame allocations; continue supporting silent historical exports. |
| `run-storyboard.mjs`, `package.json` | Add `test:animation` and include new tests in the render suite. |
| `.gitignore` | Exclude the project-local Python speech environment. |
| `README.md`, this file | Setup, behavior and manual review commands. |

The local environment and voice files are ignored runtime assets. No keys were
added or changed. OpenRouter remains the script/visual planning provider.

## Animation sequence

1. Keep one recognizable plant in the same position across scenes.
2. Reveal only resources named in the validated plan; labels stay readable.
3. Follow the existing ordered transfer intervals: water travels toward roots
   and up the stem; carbon dioxide and light reach leaves; product paths leave
   the plant. A moving packet communicates direction and the completed path
   remains visible for comparison.
4. Keep scene reading time and extend allocations if measured speech needs more
   time. Each complete narrated scene is followed by at least a 350ms audio pause.

The renderer does not add missing relationships or teaching steps. The latest
saved script still has three scenes. A different script requires explicit new
generation; replay preserves the original narration and evidence.

## Verification

- Focused animation/audio tests: 6 passing.
- Existing renderer: 21 passing; technical component library: 7 passing.
- Storyboard: 9 passing; explain pipeline: 15 passing; record animation: 8 passing.
- Previously recorded failures persist: inference 1, compact visual actions 2,
  OpenRouter 1. They concern retry/budget expectations; no new suite failures.
- Changed-file ESLint and scoped TypeScript pass; `git diff --check` passes.
- Full repository lint retains 11 errors and 3 warnings in unrelated existing files.
- Installed Piper 1.4.2 and the en_US-lessac-medium voice; synthesized all three
  saved scenes locally and verified unchanged narration and non-silent WAV audio.
  Measured speech durations: 3.460s, 9.764s and 5.283s. The saved scene allocations
  already accommodate these clips. Samples are in `artifacts/tests/local-voice/`.
- Nine static PNGs: three progress points in every scene, no text overflow.
- No live OpenRouter/Qwen call or explainer MP4 render during implementation.

## Manual review commands

Run from `next-app`. Replay the saved validated script and plan without inference:

```sh
npm run explain -- --resume artifacts/requests/request-y7KAtY/request.json --approve-overrun --output artifacts/videos/photosynthesis-local-voice-review/final.mp4
```

Extract the midpoint and early/late progress samples from every scene:

```sh
node app/api/video_gen/inspect-render.mjs artifacts/videos/photosynthesis-local-voice-review/final.mp4 artifacts/tests/photosynthesis-local-voice-review --progress
```

Play the generated MP4 with audio:

```sh
ffplay -autoexit artifacts/videos/photosynthesis-local-voice-review/final.mp4
```

- [ ] Narration is audible from the first scene through the final sentence.
- [ ] No speech is truncated or overlaps the next scene's narration.
- [ ] Leaves, roots and resource symbols are recognizable at normal playback size.
- [ ] Labels remain readable, with no overlaps or clipping.
- [ ] Every animated input/output matches the current scene's narration.
- [ ] Water follows the root/stem route; other transfers have correct directions.
- [ ] The plant remains stable across scene changes; timing allows comprehension.
- [ ] XML/JSON, CPU, bridge and technical subjects retain their own renderer.

Wait for manual review before starting another animation block.
