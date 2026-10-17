import React from "react";
import type { VisualScene } from "../visual-plan";
import { graphMotion, graphPositions, graphNodeLayouts, plannedMotion, recordRepresentations, type GraphNode } from "../visual-graph";
import { FitText } from "./FitText";
import { PlantVisual, plantRoutes } from "./PlantVisual";
import { RecordComparison } from "./RecordComparison";
import { TechSymbol, techSymbolIcons } from "./TechSymbols";
const cyan = "#63e4ec", gold = "#ffcc66";

// Authored symbols only. Source strings never become tag names, paths, or styles.
function Symbol({ icon, phase }: { icon: GraphNode["icon"]; phase: number }) {
  if (techSymbolIcons.has(icon)) return <TechSymbol icon={icon} phase={phase} />;
  switch (icon) {
    case "leaf": return <g data-component="leaf"><path d="M-42 26 Q-55 -46 45 -39 Q55 25 -42 26Z" fill="#286c4a" stroke="#8aefad" strokeWidth="4" /><path d="M-45 36 L29 -24 M-11 8 L-22 -16 M9 -9 L30 5" stroke="#8aefad" strokeWidth="3" /></g>;
    case "sun": return <g data-component="sun"><circle r="23" fill={gold} />{Array.from({ length: 8 }, (_, i) => <path key={i} d="M0 -32 V-43" stroke={gold} strokeWidth="4" transform={`rotate(${i * 45})`} />)}</g>;
    case "water": return <path data-component="water" d="M0 -42 Q-44 7 -28 27 Q0 54 28 27 Q44 7 0 -42Z" fill="#3b9fd9" stroke={cyan} strokeWidth="3" />;
    case "gas": return <g data-component="gas" fill="#153b4a" stroke={cyan} strokeWidth="3"><circle cx="-25" cy="12" r="15" /><circle cx="20" cy="-20" r="18" /><circle cx="25" cy="24" r="12" /></g>;
    case "sugar": return <g data-component="sugar" fill="#856331" stroke={gold} strokeWidth="3"><path d="M-30 -18 L0 -34 L30 -18 V18 L0 34 L-30 18Z M-30 -18 L0 0 L30 -18 M0 0 V34" /></g>;
    case "chip": case "execute": return <g data-component={icon} stroke={cyan} strokeWidth="4" fill="#163c51"><rect x="-30" y="-30" width="60" height="60" rx="5" />{[-20, 0, 20].map(x => <path key={x} d={`M${x} -42 V-31 M${x} 31 V42 M-42 ${x} H-31 M31 ${x} H42`} />)}<path d="M-18 -15 H8 V15 H-8 V0 H20" stroke={gold} strokeDasharray="12 6" strokeDashoffset={-phase * 36} fill="none" /></g>;
    case "fetch": case "memory": return <g data-component={icon} stroke={cyan} strokeWidth="3" fill="#163c51">{[-25, 0, 25].map(y => <g key={y} opacity={Math.floor(phase * 3) === (y + 25) / 25 ? 1 : 0.35}><rect x="-42" y={y - 10} width="84" height="19" rx="3" /><path d={`M-28 ${y} H15`} /></g>)}</g>;
    case "decode": return <g data-component="decode" stroke={cyan} strokeWidth="4" fill="none"><rect x="-42" y="-32" width="84" height="22" rx="4" /><path d="M-12 -32 V-10 M0 -10 V10 M-30 32 V10 H30 V32 M0 10 V32" />{[-30, 0, 30].map(x => <circle key={x} cx={x} cy="36" r="7" opacity={Math.floor(phase * 3) === (x + 30) / 30 ? 1 : 0.3} fill={gold} />)}</g>;
    case "browser": return <g data-component="browser" stroke={cyan} strokeWidth="4" fill="none"><rect x="-44" y="-34" width="88" height="68" rx="5" /><path d="M-44 -16 H44 M-32 -25 H-15 M-25 0 H25 M-25 14 H12" /></g>;
    case "server": case "database": return <g data-component={icon} stroke={cyan} strokeWidth="4" fill="#163c51">{[-24, 0, 24].map(y => <g key={y}><rect x="-38" y={y - 9} width="76" height="20" rx="4" /><circle cx="23" cy={y + 1} r="3" fill={gold} /></g>)}</g>;
    case "document": return <g data-component="document" stroke={cyan} strokeWidth="4" fill="none"><path d="M-28 -40 H12 L30 -22 V40 H-28Z M12 -40 V-22 H30 M-16 -10 H16 M-16 4 H16 M-16 18 H7" /></g>;
    case "force": return <path data-component="force" d="M-40 0 H40 M15 -20 L40 0 L15 20" stroke={gold} strokeWidth="7" fill="none" />;
    default: return <g data-component="source-point" fill="none" stroke={cyan} strokeWidth="4"><circle r="30" /><path d="M-15 0 H15 M0 -15 V15" /></g>;
  }
}
export function GraphVisual({ visual, frame, fps, scale, durationInFrames = 180 }: { visual: VisualScene; frame: number; fps: number; scale: number; durationInFrames?: number }) {
  if (visual.renderer !== "graph") return null;
  const graph = visual.graph;
  if (graph.topic === "photosynthesis" && graph.layout === "flow" && graph.nodes.some(n => n.id === "plant") && graph.nodes.every(n => ["plant", "sunlight", "water", "carbon-dioxide", "sugar", "oxygen"].includes(n.id)) && graph.edges.every(e => Object.hasOwn(plantRoutes, `${e.from}->${e.to}`))) return <PlantVisual visual={visual} frame={frame} durationInFrames={durationInFrames} scale={scale} />;
  if (graph.example && graph.comparisonFocus) return <RecordComparison graph={graph} sceneId={visual.sceneId} frame={frame} durationInFrames={durationInFrames} scale={scale} />;
  const positions = graphPositions(graph);
  const nodeLayouts = graphNodeLayouts(graph);
  const bar = graph.layout === "bars";
  const motion = (id: string, i: number) => {
    const fallback = graphMotion(frame, fps, i);
    const planned = plannedMotion(graph, id, frame, durationInFrames);
    return { reveal: fallback.reveal * planned.opacity, packet: planned.transfer ?? fallback.packet, highlight: planned.highlight };
  };
  if (graph.example) {
    const representations = recordRepresentations(graph.example);
    return <div data-visual="record-comparison" style={{ position: "relative", width: "100%", height: "100%" }}>
      {graph.nodes.map((n, i) => {
        const m = motion(n.id, i);
        const content = /^json$/i.test(n.label) ? representations.json : representations.xml;
        return <div key={n.id} style={{ position: "absolute", left: `${i * 50 + 1}%`, top: "5%", width: "48%", height: "89%", opacity: m.reveal, borderTop: `3px solid ${m.highlight ? gold : cyan}`, background: "#123040" }}>
          <div style={{ position: "absolute", top: "4%", left: "5%", width: "90%", height: "10%" }}>
            <FitText text={n.label} sceneId={visual.sceneId} role="label" scale={scale} preferredSize={28 * scale} minimumSize={20 * scale} />
          </div>
          <div data-component="inert-code-example" style={{ position: "absolute", left: "5%", top: "19%", width: "90%", height: "76%", fontFamily: "monospace" }}>
            {graph.comparisonFocus ? content.split("\n").map((line, row, lines) => {
              const field = line.includes(graph.example!.fields[0].key);
              const active = m.highlight && (graph.comparisonFocus === "fields" ? field : !field);
              return <div key={row} data-comparison-line={field ? "field" : "structure"} data-emphasis={active ? "active" : "none"}
                style={{ position: "absolute", top: `${row / lines.length * 100}%`, width: "100%", height: `${100 / lines.length}%`, background: active ? "#6b5326" : "transparent", color: active ? gold : "#edf5f8" }}>
                <FitText text={line || " "} sceneId={visual.sceneId} role="label" scale={scale} preferredSize={22 * scale} minimumSize={Math.max(16, 18 * scale)} />
              </div>;
            }) : <FitText text={content} sceneId={visual.sceneId} role="label" scale={scale} preferredSize={22 * scale} minimumSize={Math.max(16, 18 * scale)} />}
          </div>
        </div>;
      })}
    </div>;
  }
  return <div data-visual="graph" data-topic={graph.topic} data-layout={graph.layout} style={{ position: "relative", width: "100%", height: "100%" }}>
    <svg viewBox="0 0 640 520" width="100%" height="100%" aria-label={visual.heading}>
      {graph.edges.map((edge, i) => {
        const a = positions[graph.nodes.findIndex(n => n.id === edge.from)];
        const b = positions[graph.nodes.findIndex(n => n.id === edge.to)];
        const m = motion(`${edge.from}->${edge.to}`, i + 1);
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const fromScale = nodeLayouts[graph.nodes.findIndex(n => n.id === edge.from)].symbolScale;
        const toScale = nodeLayouts[graph.nodes.findIndex(n => n.id === edge.to)].symbolScale;
        const start = { x: a.x + Math.cos(angle) * 73 * fromScale, y: a.y + Math.sin(angle) * 73 * fromScale };
        const end = { x: b.x - Math.cos(angle) * 73 * toScale, y: b.y - Math.sin(angle) * 73 * toScale };
        const returning = edge.meaning === "cycle";
        const path = returning ? `M${a.x + 75} ${a.y} Q635 ${a.y} 600 260 Q635 ${b.y} ${b.x + 75} ${b.y}` : `M${start.x} ${start.y} L${end.x} ${end.y}`;
        return <g key={`${edge.from}-${edge.to}`} data-component="connection" data-meaning={edge.meaning} opacity={m.reveal}>
          <path d={path} stroke="#426777" strokeWidth="4" fill="none" />
          {!returning && <><path d="M-12 -7 L0 0 L-12 7" fill="none" stroke={gold} strokeWidth="4" transform={`translate(${end.x} ${end.y}) rotate(${angle * 180 / Math.PI})`} /><circle opacity={m.packet < 0 ? 0 : 1} r="5" fill={gold} cx={start.x + (end.x - start.x) * m.packet} cy={start.y + (end.y - start.y) * m.packet} /></>}
          {returning && <path d={path} stroke={gold} strokeWidth="3" fill="none" strokeDasharray="8 14" strokeDashoffset={-m.packet * 44} />}
        </g>;
      })}
      {graph.nodes.map((n, i) => {
        const p = positions[i], m = motion(n.id, i);
        if (bar) {
          const v = graph.values.find(value => value.nodeId === n.id)!;
          return <g key={n.id} data-component="data-bar" opacity={m.reveal}><path d={`M80 ${p.y + 45} H580`} stroke="#284352" strokeWidth="25" /><path d={`M80 ${p.y + 45} h${v.value / 100 * 500 * m.reveal}`} stroke={i % 2 ? gold : cyan} strokeWidth="25" /></g>;
        }
        return <g key={n.id} transform={`translate(${p.x} ${p.y})`} opacity={m.reveal}>
          <g transform={`scale(${nodeLayouts[i].symbolScale})`}>
          {techSymbolIcons.has(n.icon)
            ? <ellipse rx={64} ry={54} fill="#123040" stroke={m.highlight ? gold : "none"} strokeWidth={2} />
            : <rect x="-70" y="-50" width="140" height="100" rx={graph.layout === "comparison" ? 8 : 28} fill="#123040" stroke={m.highlight ? gold : n.role === "core" ? "#8aefad" : "#31576b"} strokeWidth="2" />}
          <Symbol icon={n.icon} phase={m.packet} />
          </g>
        </g>;
      })}
    </svg>
    {graph.edges.filter(e => e.label).map((e, i) => {
      const a = positions[graph.nodes.findIndex(n => n.id === e.from)], b = positions[graph.nodes.findIndex(n => n.id === e.to)];
      const m = motion(`${e.from}->${e.to}`, i + 1);
      return <div key={`${e.from}-${e.to}-label`} style={{ position: "absolute", left: `${((a.x + b.x) / 2 + (i % 2 ? 90 : -90) - 70) / 640 * 100}%`, top: `${((a.y + b.y) / 2 - 25) / 520 * 100}%`, width: `${140 / 640 * 100}%`, height: `${50 / 520 * 100}%`, textAlign: "center", opacity: m.reveal }}>
        <FitText text={e.label!} sceneId={visual.sceneId} role="label" scale={scale} preferredSize={21 * scale} minimumSize={Math.max(16, 18 * scale)} />
      </div>;
    })}
    {graph.nodes.map((n, i) => {
      const box = nodeLayouts[i].label, m = motion(n.id, i);
      const value = graph.values.find(v => v.nodeId === n.id);
      return <div key={n.id} data-node-label={n.id} style={{ position: "absolute", left: `${box.x / 640 * 100}%`, top: `${box.y / 520 * 100}%`, width: `${box.width / 640 * 100}%`, height: `${box.height / 520 * 100}%`, textAlign: bar ? "left" : "center", opacity: m.reveal }}>
        <FitText text={value ? `${n.label}: ${value.value}%` : n.label} sceneId={visual.sceneId} role="label" scale={scale} preferredSize={23 * scale} minimumSize={Math.max(16, 20 * scale)} />
      </div>;
    })}
  </div>;
}
