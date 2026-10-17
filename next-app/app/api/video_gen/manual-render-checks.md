# Block 04B: manual procedural explainer checks

Run from `next-app/`. No Ollama call is made. Keep outputs under `/tmp` or another
chosen artifact directory. Existing MP4/sidecar paths are refused; choose fresh names.
The renderer defaults to Chrome at `/usr/bin/google-chrome`. Set
`REMOTION_BROWSER_EXECUTABLE` or pass `--browser /absolute/path` if needed.

## Bridge: generate once, verify guard, explicitly approve

```sh
npm run --silent storyboard -- /tmp/bridge-script.json > /tmp/bridge-render-board.json
npm run render:storyboard -- /tmp/bridge-render-board.json /tmp/bridge-denied.mp4
```

The second command MUST exit nonzero with `DURATION_APPROVAL_REQUIRED` and create
no MP4. Then explicitly approve the estimated overrun:

```sh
npm run render:storyboard -- /tmp/bridge-render-board.json /tmp/bridge-manual.mp4 --approve-overrun
```

This approves only this invocation. It does not rewrite duration policy or shorten narration.

## Within-target example, no approval

```sh
node <<'JS'
const fs=require('node:fs');
fs.writeFileSync('/tmp/render-within-script.json', JSON.stringify({
  title:'How a bridge carries weight', targetAudience:'Beginners', estimatedDurationSeconds:15,
  scenes:[
    {narration:'A bridge carries people and vehicles across an obstacle.',visualDirection:'Show a bridge connecting two banks.'},
    {narration:'Its deck transfers weight through supporting structures to the foundations.',visualDirection:'Show a simple path from deck to supports to ground.'},
    {narration:'Engineers choose a structure for the span, site, and expected loads.',visualDirection:'Show the completed bridge with its supports highlighted.'}
  ]
}));
JS
npm run --silent storyboard -- /tmp/render-within-script.json > /tmp/render-within-board.json
node -e 'const b=require("/tmp/render-within-board.json"); console.log(b.durationPolicy); if(b.durationPolicy.classification!=="within_target")process.exit(1)'
npm run render:storyboard -- /tmp/render-within-board.json /tmp/within-manual.mp4
```

## Inspect streams, duration, and frames

```sh
ffprobe -v error -show_entries stream=codec_name,codec_type,width,height,r_frame_rate,nb_frames:format=duration,size -of json /tmp/bridge-manual.mp4
ffmpeg -n -ss 2 -i /tmp/bridge-manual.mp4 -frames:v 1 /tmp/bridge-first.png
```

Expect H.264, 720x1280 (9:16), 15/1 fps, and NO audio stream. Frame count and duration must
match the sidecar; the duration is the sum of ceil(scene estimate * fps) / fps,
not the requested soft target. Each scene gains less than one frame from rounding.

Extract one midpoint frame per scene and print the order for visual inspection:

```sh
node <<'JS'
const fs=require('node:fs'), assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const m=JSON.parse(fs.readFileSync('/tmp/bridge-manual.mp4.json','utf8'));
assert.deepEqual(m.storyboard.scenes.map(s=>s.narration),m.originalStoryboard.scenes.map(s=>s.narration));
let cursor=0;
for(const [i,f] of m.frames.entries()) {
  assert.equal(f.from,cursor); cursor+=f.durationInFrames;
  assert.equal(f.id,m.storyboard.scenes[i].id);
  const seconds=(f.from+Math.floor(f.durationInFrames/2))/m.settings.fps;
  const file=`/tmp/bridge-manual-${f.id}.png`;
  execFileSync('ffmpeg',['-v','error','-n','-ss',String(seconds),'-i','/tmp/bridge-manual.mp4','-frames:v','1',file]);
  console.log(f.id,m.storyboard.scenes[i].visualType,f.from,f.durationInFrames,file);
}
assert.equal(cursor,m.durationInFrames);
JS
```

Open every PNG in your image viewer. Check concise headings, labels, bridge
shapes, wind strokes, vehicles, vibration indicators, highlighted supports, scene
counter, and readable text without clipping. Full narration and raw directions must
NOT appear on screen; compare the sidecar storyboard to the saved source to verify
all narration is preserved. Text fitting still measures actual browser dimensions
after fonts and two animation frames and fails with `TEXT_OVERFLOW` at its minimum.
Watch both MP4s in a video player to check motion and fades; midpoint checks alone
do not establish smooth animation. Motion is scene-relative and deterministic.

## Checks and options

```sh
npm run test:storyboard
npm run test:render
npm run lint
node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module commonjs --moduleResolution node --jsx react-jsx --strict --skipLibCheck --esModuleInterop --types node app/api/video_gen/render-plan.ts app/api/video_gen/render-cli.ts app/api/video_gen/render.test.ts app/api/video_gen/remotion/index.tsx
```

Render options: `--width 720 --height 1280 --fps 15` (defaults); landscape: `--width 960 --height 540`,
`--approve-overrun`, `--browser /absolute/path`.
Width is even 640–1920; height even 360–1920; fps integer 1–30. Single-worker local
rendering limits RAM usage. No browser, image, font, model, or audio download is
performed by the renderer. System Arial/sans-serif fonts are used, so exact pixels
can vary across hosts. Determinism covers scene order, layout, content, and frames;
MP4 byte identity across machines/encoder versions is not promised.

## Block 04B verification (2026-10-17)

- `npm run test:storyboard`, `npm run test:render`, `npm run lint`, and the scoped
  TypeScript command above passed. Render coverage includes the registry/fallback,
  real SVG components, source preservation, markup escaping, portrait/landscape
  settings, duration guard, frame order, and deterministic motion.
- Fresh bridge: `/tmp/block04b-bridge-final.mp4` (approved overrun), 1,194 frames,
  79.6 seconds. Fresh within-target: `/tmp/block04b-within.mp4` (no approval),
  210 frames, 14 seconds. Each has a `.mp4.json` sidecar containing the original
  storyboard, resolved storyboard, visual props, settings, and scene allocations.
- ffprobe verified H.264, 720x1280, 15 fps, one video stream and no audio.
- Unapproved bridge rejected with `DURATION_APPROVAL_REQUIRED`; neither
  `/tmp/block04b-denied.mp4` nor its JSON sidecar was created.
- Sidecar assertions verified unchanged storyboards/narration, scene order,
  contiguous allocation, total frames, and portrait dimensions for both renders.
- All five `/tmp/block04b-bridge-final-scene-00N.png` and three
  `/tmp/block04b-within-scene-00N.png` midpoint images were extracted and inspected.
  They show actual bridge, wind, vehicle, vibration, and support/load-path graphics,
  with readable concise labels and no printed visual instructions or paragraphs.
- Both MP4s were opened in ffplay for playback; player-window captures are
  `/tmp/block04b-player-bridge-final.png` and `/tmp/block04b-player-within.png`.

Remaining limits: bridge graphics are authored schematics; unsupported topics use
abstract components and generic labels. English keyword mapping cannot faithfully
fulfill arbitrary storyboard directions or validate their science. Long silent
scenes retain the original narration-based estimate and loop explanatory motion.
Extreme canvas/text combinations may fail the existing readable-size guard.
No audio or captions. User visual review is required before starting TTS.
