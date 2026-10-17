import React from "react";
import { getLength, getPointAtLength } from "@remotion/paths";
import type { VisualScene } from "../visual-plan";
import { plannedMotion } from "../visual-graph";
import { FitText } from "./FitText";
import { TracePath } from "./AnimationPrimitives";

const green = "#8aefad", gold = "#ffcc66", cyan = "#63e4ec";
// Fixed, authored routes distinguish light arriving at a leaf, water at the
// roots, and products leaving the plant. Only validated edges enable motion.
export const plantRoutes: Record<string, string> = {
  "sunlight->plant": "M128 96 Q230 80 288 191",
  "water->plant": "M124 400 Q206 443 310 426 Q329 342 316 263",
  "carbon-dioxide->plant": "M123 242 Q198 232 263 220",
  "plant->sugar": "M361 255 Q427 307 501 359",
  "plant->oxygen": "M366 207 Q445 172 505 172",
};
const positions: Record<string, { x: number; y: number }> = {
  plant: { x: 320, y: 239 }, sunlight: { x: 92, y: 68 }, water: { x: 92, y: 370 },
  "carbon-dioxide": { x: 92, y: 214 }, sugar: { x: 548, y: 358 }, oxygen: { x: 548, y: 164 },
};

export function PlantVisual({ visual, frame, durationInFrames, scale }: { visual: VisualScene; frame: number; durationInFrames: number; scale: number }) {
  if (visual.renderer !== "graph") return null;
  const graph = visual.graph;
  const coreMotion = plannedMotion(graph, "plant", frame, durationInFrames);
  return <div data-visual="plant-illustration" style={{ position: "relative", width: "100%", height: "100%" }}>
    <svg viewBox="0 0 640 520" width="100%" height="100%" aria-label={visual.heading}>
      <defs><radialGradient id={`canopy-${visual.sceneId}`}><stop stopColor="#245440" stopOpacity="0.7" /><stop offset="1" stopColor="#091822" stopOpacity="0" /></radialGradient></defs>
      <ellipse cx="320" cy="268" rx="166" ry="218" fill={`url(#canopy-${visual.sceneId})`} />
      <g data-component="plant-anatomy" opacity={coreMotion.opacity}>
        <path d="M195 438 Q320 425 444 438" stroke="#78694e" strokeWidth="3" fill="none" />
        <path d="M320 429 Q324 352 317 280 Q311 227 324 145" stroke="#63be80" strokeWidth="10" fill="none" strokeLinecap="round" />
        <g data-component="leaf" fill="#246442" stroke={coreMotion.highlight ? gold : green} strokeWidth="3">
          <path d="M317 276 Q227 288 220 207 Q295 190 317 276Z" />
          <path d="M320 225 Q397 231 411 153 Q336 139 320 225Z" />
          <path d="M321 180 Q271 169 280 104 Q336 112 321 180Z" />
          <path d="M321 348 Q386 355 402 286 Q339 273 321 348Z" />
        </g>
        <path d="M317 276 L236 222 M320 225 L393 168 M321 180 L290 119 M321 348 L386 300" stroke={green} strokeWidth="2" fill="none" />
        <path d="M320 429 L287 470 M320 429 L350 480 M306 447 L269 451 M336 456 L378 462 M320 436 V491" stroke="#c4a16e" strokeWidth="4" fill="none" strokeLinecap="round" />
      </g>
      {graph.edges.map(edge => {
        const target = `${edge.from}->${edge.to}`, route = plantRoutes[target];
        if (!route) return null;
        const motion = plannedMotion(graph, target, frame, durationInFrames);
        const transfer = graph.actions.find(a => a.kind === "transfer" && a.target === target);
        const progress = frame / Math.max(1, durationInFrames - 1);
        const reveal = transfer ? Math.max(0, Math.min(1, (progress - transfer.start) / (transfer.end - transfer.start))) : Math.max(0, Math.min(1, (progress - 0.08) / 0.6));
        const point = motion.transfer !== undefined && motion.transfer >= 0 ? getPointAtLength(route, getLength(route) * motion.transfer) : null;
        const end = getPointAtLength(route, getLength(route));
        const previous = getPointAtLength(route, getLength(route) - 1);
        if (!end || !previous) return null;
        const angle = Math.atan2(end.y - previous.y, end.x - previous.x) * 180 / Math.PI;
        const color = edge.from === "water" ? cyan : edge.from === "sunlight" || edge.to === "sugar" ? gold : green;
        return <g key={target} data-plant-transfer={target}>
          <TracePath path={route} progress={reveal} color={color} opacity={0.65} showHead={false} />
          {reveal >= 1 && <path d="M-10 -6 L0 0 L-10 6" transform={`translate(${end.x} ${end.y}) rotate(${angle})`} stroke={color} strokeWidth="3" fill="none" />}
          {point && <g data-component="resource-in-transit" transform={`translate(${point.x} ${point.y})`}><circle r="12" fill={color} opacity=".2" /><circle r="5" fill={color} /></g>}
        </g>;
      })}
      {graph.nodes.filter(n => n.id !== "plant").map(n => {
        const p = positions[n.id]; if (!p) return null;
        const m = plannedMotion(graph, n.id, frame, durationInFrames);
        return <g key={n.id} transform={`translate(${p.x} ${p.y})`} opacity={m.opacity} data-plant-resource={n.id}>
          {n.id === "sunlight" ? <g data-component="sun" stroke={gold} strokeWidth="3"><circle r="22" fill={gold} />{Array.from({ length: 8 }, (_, i) => <path key={i} d="M0 -29 V-39" transform={`rotate(${i * 45})`} />)}</g>
            : n.id === "water" ? <path d="M0 -32 Q-36 11 -19 27 Q0 42 19 27 Q36 11 0 -32Z" fill="#327fb0" stroke={cyan} strokeWidth="3" />
            : n.id === "sugar" ? <g stroke={gold} strokeWidth="3" fill="#765932"><path d="M-26 -15 L0 -29 L26 -15 V15 L0 29 L-26 15Z M-26 -15 L0 0 L26 -15 M0 0 V29" /></g>
            : <g stroke={green} strokeWidth="3" fill="#143d35"><circle cx="-21" cy="5" r="13" /><circle cy="-9" r="16" /><circle cx="21" cy="5" r="13" /></g>}
        </g>;
      })}
    </svg>
    {graph.nodes.map(n => {
      const p = positions[n.id]; if (!p) return null;
      const core = n.id === "plant", y = core ? 30 : p.y + 44, width = core ? 230 : 172;
      return <div key={n.id} data-plant-label={n.id} style={{ position: "absolute", left: `${(p.x - width / 2) / 640 * 100}%`, top: `${y / 520 * 100}%`, width: `${width / 640 * 100}%`, height: `${72 / 520 * 100}%`, textAlign: "center", opacity: plannedMotion(graph, n.id, frame, durationInFrames).opacity }}>
        <FitText text={n.label} sceneId={visual.sceneId} role="label" scale={scale} preferredSize={23 * scale} minimumSize={Math.max(16, 20 * scale)} />
      </div>;
    })}
  </div>;
}
