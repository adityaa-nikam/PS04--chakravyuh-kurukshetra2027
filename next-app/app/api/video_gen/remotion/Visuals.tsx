import React from "react";
import type { VisualScene } from "../visual-plan";
import { visualMotion } from "../visual-plan";
import { GraphVisual } from "./GraphVisual";
import { FitText } from "./FitText";
import { UniversalSceneVisual } from "./UniversalSceneVisual";

const cyan = "#63e4ec", yellow = "#ffcc66", white = "#edf5f8";
type Motion = ReturnType<typeof visualMotion>;

function Arrow({ x, y, down = false, color = cyan }: { x: number; y: number; down?: boolean; color?: string }) {
  return <g transform={`translate(${x} ${y}) rotate(${down ? 90 : 0})`} stroke={color} strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <path d="M0 0 H52 M40 -10 L52 0 L40 10" />
  </g>;
}
function Vehicle({ x, truck = false }: { x: number; truck?: boolean }) {
  return <g data-component="vehicle" transform={`translate(${x} 269)`}>
    <path d={truck ? "M0 0 V-30 H50 V0 M50 -20 H68 L78 -6 V0 H0" : "M0 0 V-13 L12 -26 H40 L54 -12 V0 Z"} fill={yellow} />
    <path d="M15 -22 H34 L43 -13 H10 Z" fill="#132f43" />
    <circle cx="10" cy="2" r="7" fill={white} /><circle cx={truck ? 65 : 43} cy="2" r="7" fill={white} />
  </g>;
}
function Bridge({ motion, wind, traffic, vibration, load, supports }: {
  motion: Motion; wind: boolean; traffic: boolean; vibration: boolean; load: boolean; supports: boolean;
}) {
  const dy = vibration ? motion.vibration * 3 : 0;
  return <g data-component="bridge">
    <path d="M24 450 Q80 438 140 452 T290 451 T450 450 T616 450" stroke="#285a6d" strokeWidth="3" fill="none" />
    <path d="M32 415 H165 M475 415 H608" stroke="#5a788a" strokeWidth="18" />
    <g stroke={supports || load ? cyan : "#4f748a"} strokeWidth="20" fill="none">
      <path d="M180 282 V410 M460 282 V410" />
      <path d="M150 418 H210 M430 418 H490" strokeWidth="28" />
    </g>
    <g transform={`translate(0 ${dy})`}>
      <path d="M70 278 H570" stroke={white} strokeWidth="13" />
      <path d="M90 268 L180 186 L320 268 L460 186 L550 268 M180 186 V269 M460 186 V269" stroke="#7ea7bb" strokeWidth="6" fill="none" />
      <path d="M80 289 H560" stroke={cyan} strokeWidth="4" />
      {traffic && <g>
        <Vehicle x={74 + motion.vehicle * 430} />
        <Vehicle x={74 + ((motion.vehicle + 0.5) % 1) * 420} truck />
      </g>}
    </g>
    {wind && <g data-component="wind" opacity={motion.reveal}>
      {[0, 1, 2].map(i => <g key={i} transform={`translate(${45 + ((motion.wind + i * 0.22) % 1) * 400} ${105 + i * 35})`} stroke={cyan} strokeWidth="4" fill="none">
        <path d="M-40 0 H45 Q65 0 65 -12 Q65 -24 52 -24" />
        <path d="M-25 10 H18" opacity=".4" />
      </g>)}
    </g>}
    {vibration && <g data-component="vibration" stroke={yellow} strokeWidth="3" fill="none" opacity={0.45 + Math.abs(motion.vibration) * 0.55}>
      <path d="M270 310 Q320 340 370 310 M255 325 Q320 365 385 325" />
      <path d="M285 245 L285 215 M278 224 L285 215 L292 224" />
    </g>}
    {(load || supports) && <g data-component="load-path" opacity={motion.reveal}>
      {[180, 460].map(x => <g key={x}>
        <path d={`M${x} 300 V395`} stroke={yellow} strokeWidth="3" strokeDasharray="8 7" strokeDashoffset={-motion.load * 45} />
        <Arrow x={x} y={310 + motion.load * 32} down color={yellow} />
      </g>)}
    </g>}
  </g>;
}

function Label({ sceneId, text, x, y, scale }: { sceneId: string; text: string; x: number; y: number; scale: number }) {
  return <div style={{ position: "absolute", left: `${x / 640 * 100}%`, top: `${y / 520 * 100}%`, width: "25%", height: "8%", textAlign: "center" }}>
    <FitText sceneId={sceneId} text={text} role="label" scale={scale} preferredSize={24 * scale} minimumSize={Math.max(16, 21 * scale)} />
  </div>;
}

export function BridgeVisual({ visual, frame, fps, scale }: { visual: VisualScene; frame: number; fps: number; scale: number; durationInFrames?: number }) {
  const m = visualMotion(frame, fps);
  const comparison = visual.mode === "comparison";
  const damping = visual.mode === "damping";
  const anatomy = ["load", "supports", "overview"].includes(visual.mode);
  return <div data-visual="bridge" style={{ position: "relative", width: "100%", height: "100%" }}>
    <svg viewBox="0 0 640 520" width="100%" height="100%" aria-label={visual.heading}>
      {comparison ? <>
        <g transform="translate(0 -25) scale(1 .65)"><Bridge motion={m} wind traffic={false} vibration load={false} supports={false} /></g>
        <g transform="translate(0 230) scale(1 .65)"><Bridge motion={m} wind={false} traffic vibration load={false} supports={false} /></g>
        <path d="M60 260 H580" stroke="#355364" strokeDasharray="5 8" />
      </> : <Bridge motion={m}
        wind={visual.mode === "wind" || visual.mode === "combined"}
        traffic={visual.mode === "traffic" || visual.mode === "combined"}
        vibration={["vibration", "wind", "traffic", "combined"].includes(visual.mode)}
        load={visual.mode === "load"} supports={visual.mode === "supports"} />}
      {damping && <g data-component="damper" stroke={yellow} strokeWidth="5" fill="none">
        <path d="M320 289 V320 M298 320 H342 V370 H298 V320 M320 343 V405 M297 405 H343" />
        <path d={`M270 330 Q320 ${340 + m.vibration * 2} 370 330`} opacity=".6" />
      </g>}
      {anatomy && <g stroke="#6d8c9d" strokeWidth="2" fill="none">
        <path d="M320 120 V180 L355 270 M110 360 H163 M400 472 H460 V435" />
      </g>}
    </svg>
    {comparison ? <>
      <Label sceneId={visual.sceneId} text="Wind" x={240} y={0} scale={scale} />
      <Label sceneId={visual.sceneId} text="Traffic" x={240} y={270} scale={scale} />
    </> : anatomy ? <>
      <Label sceneId={visual.sceneId} text="Deck" x={240} y={70} scale={scale} />
      <Label sceneId={visual.sceneId} text="Supports" x={0} y={320} scale={scale} />
      <Label sceneId={visual.sceneId} text="Foundations" x={230} y={455} scale={scale} />
    </> : <Label sceneId={visual.sceneId} text={visual.mode === "traffic" ? "Traffic" : visual.mode === "vibration" ? "Vibration" : damping ? "Damper" : "Wind"} x={240} y={20} scale={scale} />}
  </div>;
}

export function AbstractVisual({ visual, frame, fps, scale, durationInFrames = 180 }: { visual: VisualScene; frame: number; fps: number; scale: number; durationInFrames?: number }) {
  if (visual.enhancedVisual) {
    return (
      <UniversalSceneVisual
        enhancedVisual={visual.enhancedVisual}
        legacyVisual={visual}
        frame={frame}
        fps={fps}
        scale={scale}
        durationInFrames={durationInFrames}
      />
    );
  }
  const m = visualMotion(frame, fps);
  const compare = visual.concept === "comparison";
  const process = visual.concept === "process";
  return <div data-visual="abstract" style={{ position: "relative", width: "100%", height: "100%" }}>
    <svg viewBox="0 0 640 520" width="100%" height="100%">
      {compare ? <>
        <circle cx="170" cy="260" r="105" fill="#143c51" stroke={cyan} strokeWidth="4" />
        <rect x="370" y="155" width="210" height="210" rx="28" fill="#3a3040" stroke={yellow} strokeWidth="4" />
        <path d="M320 130 V390" stroke="#6d8c9d" strokeDasharray="6 8" />
      </> : <>
        <path d={process ? "M100 260 H540" : "M110 350 L320 140 L530 350 Z"} stroke="#527588" strokeWidth="5" fill="none" strokeDasharray="10 8" strokeDashoffset={-m.load * 54} />
        {[0, 1, 2].map(i => <g key={i} opacity={Math.min(1, Math.max(0, frame / fps * 2 - i * 0.4))}>
          <circle cx={process ? 110 + i * 210 : [110, 320, 530][i]} cy={process ? 260 : [350, 140, 350][i]} r="65" fill="#123648" stroke={i === 2 ? yellow : cyan} strokeWidth="5" />
          {process && i < 2 && <Arrow x={190 + i * 210} y={260} />}
          {visual.concept === "summary" && <path d={`M${90 + i * 210} ${[350, 140, 350][i]} l15 15 l30 -35`} stroke={yellow} strokeWidth="6" fill="none" />}
        </g>)}
      </>}
    </svg>
    {compare ? <>
      <Label sceneId={visual.sceneId} text={visual.labels[0]} x={90} y={390} scale={scale} />
      <Label sceneId={visual.sceneId} text={visual.labels[1]} x={390} y={390} scale={scale} />
    </> : visual.labels.map((label, i) => <Label key={label} sceneId={visual.sceneId} text={label} x={30 + i * 210} y={process ? 360 : [440, 40, 440][i]} scale={scale} />)}
  </div>;
}

export const visualComponents = { bridge: BridgeVisual, abstract: AbstractVisual, graph: GraphVisual } as const;
