import React from "react";
import type { VisualScene } from "../visual-plan";
import { graphMotion, graphPositions, plannedMotion, recordRepresentations, type GraphNode } from "../visual-graph";
import { FitText } from "./FitText";

const cyan = "#63e4ec", gold = "#ffcc66";

// Rich relatable emoji and styling resolver based on label and icon
export function getRelatableGlyph(label: string, icon?: string): { emoji: string; color: string; bg: string; secondaryColor: string } {
  const t = (label + " " + (icon || "")).toLowerCase();
  
  if (/rag|retriev|search|query|lookup|find|fetch/i.test(t)) {
    return { emoji: "🔍", color: "#38BDF8", bg: "rgba(56, 189, 248, 0.22)", secondaryColor: "#818CF8" };
  }
  if (/ai|model|llm|gpt|neural|brain|intelligence|deep learning/i.test(t)) {
    return { emoji: "🧠", color: "#C084FC", bg: "rgba(192, 132, 252, 0.22)", secondaryColor: "#F472B6" };
  }
  if (/database|vector|embed|store|storage|sql|redis|index|memory/i.test(t)) {
    return { emoji: "🗄️", color: "#34D399", bg: "rgba(52, 211, 153, 0.22)", secondaryColor: "#22D3EE" };
  }
  if (/generat|synthesis|answer|output|response|result|creativ/i.test(t)) {
    return { emoji: "✨", color: "#FBBF24", bg: "rgba(251, 191, 36, 0.22)", secondaryColor: "#F43F5E" };
  }
  if (/prompt|question|chat|message|user|input|ask/i.test(t)) {
    return { emoji: "💬", color: "#60A5FA", bg: "rgba(96, 165, 250, 0.22)", secondaryColor: "#A78BFA" };
  }
  if (/document|doc|pdf|file|text|context|knowledge|book/i.test(t)) {
    return { emoji: "📚", color: "#F472B6", bg: "rgba(244, 114, 182, 0.22)", secondaryColor: "#FB923C" };
  }
  if (/code|program|dev|script|algorithm|sort|tree|function|syntax/i.test(t)) {
    return { emoji: "💻", color: "#4ADE80", bg: "rgba(74, 222, 128, 0.22)", secondaryColor: "#2DD4BF" };
  }
  if (/speed|fast|lightning|realtime|instant|stream|latency|quick/i.test(t)) {
    return { emoji: "⚡", color: "#FACC15", bg: "rgba(250, 204, 21, 0.22)", secondaryColor: "#FB923C" };
  }
  if (/security|guardrail|safe|privacy|auth|token|trust|protect/i.test(t)) {
    return { emoji: "🛡️", color: "#FB7185", bg: "rgba(251, 113, 133, 0.22)", secondaryColor: "#F43F5E" };
  }
  if (/accuracy|fact|truth|correct|verify|eval|score|target/i.test(t)) {
    return { emoji: "🎯", color: "#F87171", bg: "rgba(248, 113, 113, 0.22)", secondaryColor: "#FBBF24" };
  }
  if (/server|api|cloud|network|web|endpoint|host/i.test(t)) {
    return { emoji: "🌐", color: "#22D3EE", bg: "rgba(34, 211, 238, 0.22)", secondaryColor: "#38BDF8" };
  }
  if (/docker|container|box|package|module/i.test(t)) {
    return { emoji: "📦", color: "#38BDF8", bg: "rgba(56, 189, 248, 0.22)", secondaryColor: "#0284C7" };
  }
  if (/gear|process|engine|system|pipeline|cycle/i.test(t)) {
    return { emoji: "⚙️", color: "#94A3B8", bg: "rgba(148, 163, 184, 0.22)", secondaryColor: "#CBD5E1" };
  }
  if (/rocket|launch|deploy|scale|grow|boost/i.test(t)) {
    return { emoji: "🚀", color: "#FB923C", bg: "rgba(251, 146, 60, 0.22)", secondaryColor: "#E11D48" };
  }
  if (/leaf|plant|nature|biology|photo/i.test(t)) {
    return { emoji: "🌿", color: "#4ADE80", bg: "rgba(74, 222, 128, 0.22)", secondaryColor: "#10B981" };
  }
  if (/sun|solar|light|energy/i.test(t)) {
    return { emoji: "☀️", color: "#FBBF24", bg: "rgba(251, 191, 36, 0.22)", secondaryColor: "#F59E0B" };
  }
  if (/water|fluid|liquid/i.test(t)) {
    return { emoji: "💧", color: "#38BDF8", bg: "rgba(56, 189, 248, 0.22)", secondaryColor: "#0284C7" };
  }
  if (/robot|agent|bot|automation/i.test(t)) {
    return { emoji: "🤖", color: "#818CF8", bg: "rgba(129, 140, 248, 0.22)", secondaryColor: "#C084FC" };
  }

  // Deterministic variety hash so different unknown labels still look distinct and lively
  const hash = Math.abs(label.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0));
  const fallbacks = [
    { emoji: "💡", color: "#FBBF24", bg: "rgba(251, 191, 36, 0.22)", secondaryColor: "#F59E0B" },
    { emoji: "⚡", color: "#38BDF8", bg: "rgba(56, 189, 248, 0.22)", secondaryColor: "#818CF8" },
    { emoji: "🔮", color: "#C084FC", bg: "rgba(192, 132, 252, 0.22)", secondaryColor: "#E879F9" },
    { emoji: "💎", color: "#22D3EE", bg: "rgba(34, 211, 238, 0.22)", secondaryColor: "#38BDF8" },
    { emoji: "🧩", color: "#34D399", bg: "rgba(52, 211, 153, 0.22)", secondaryColor: "#10B981" },
    { emoji: "🏷️", color: "#FB7185", bg: "rgba(251, 113, 133, 0.22)", secondaryColor: "#F43F5E" },
  ];
  return fallbacks[hash % fallbacks.length];
}

// Authored symbols with enhanced vibrant rendering + relatable emoji badge fallback
function Symbol({ icon, phase, label, frame }: { icon: GraphNode["icon"]; phase: number; label: string; frame: number }) {
  switch (icon) {
    case "leaf": return <g data-component="leaf"><path d="M-42 26 Q-55 -46 45 -39 Q55 25 -42 26Z" fill="#1e5237" stroke="#4ade80" strokeWidth="4" /><path d="M-45 36 L29 -24 M-11 8 L-22 -16 M9 -9 L30 5" stroke="#4ade80" strokeWidth="3" /></g>;
    case "sun": return <g data-component="sun"><circle r="23" fill={gold} />{Array.from({ length: 8 }, (_, i) => <path key={i} d="M0 -32 V-43" stroke={gold} strokeWidth="4" transform={`rotate(${i * 45})`} />)}</g>;
    case "water": return <path data-component="water" d="M0 -42 Q-44 7 -28 27 Q0 54 28 27 Q44 7 0 -42Z" fill="#1e40af" stroke={cyan} strokeWidth="3" />;
    case "gas": return <g data-component="gas" fill="#153b4a" stroke={cyan} strokeWidth="3"><circle cx="-25" cy="12" r="15" /><circle cx="20" cy="-20" r="18" /><circle cx="25" cy="24" r="12" /></g>;
    case "sugar": return <g data-component="sugar" fill="#856331" stroke={gold} strokeWidth="3"><path d="M-30 -18 L0 -34 L30 -18 V18 L0 34 L-30 18Z M-30 -18 L0 0 L30 -18 M0 0 V34" /></g>;
    case "chip": case "execute": return <g data-component={icon} stroke={cyan} strokeWidth="4" fill="#0f2638"><rect x="-30" y="-30" width="60" height="60" rx="8" />{[-20, 0, 20].map(x => <path key={x} d={`M${x} -42 V-31 M${x} 31 V42 M-42 ${x} H-31 M31 ${x} H42`} />)}<path d="M-18 -15 H8 V15 H-8 V0 H20" stroke={gold} strokeDasharray="12 6" strokeDashoffset={-phase * 36} fill="none" /></g>;
    case "fetch": case "memory": return <g data-component={icon} stroke={cyan} strokeWidth="3" fill="#0f2638">{[-25, 0, 25].map(y => <g key={y} opacity={Math.floor(phase * 3) === (y + 25) / 25 ? 1 : 0.35}><rect x="-42" y={y - 10} width="84" height="19" rx="4" /><path d={`M-28 ${y} H15`} /></g>)}</g>;
    case "decode": return <g data-component="decode" stroke={cyan} strokeWidth="4" fill="none"><rect x="-42" y="-32" width="84" height="22" rx="5" /><path d="M-12 -32 V-10 M0 -10 V10 M-30 32 V10 H30 V32 M0 10 V32" />{[-30, 0, 30].map(x => <circle key={x} cx={x} cy="36" r="7" opacity={Math.floor(phase * 3) === (x + 30) / 30 ? 1 : 0.3} fill={gold} />)}</g>;
    case "browser": return <g data-component="browser" stroke={cyan} strokeWidth="4" fill="#0f2638"><rect x="-44" y="-34" width="88" height="68" rx="6" /><path d="M-44 -16 H44 M-32 -25 H-15 M-25 0 H25 M-25 14 H12" /></g>;
    case "server": case "database": return <g data-component={icon} stroke={cyan} strokeWidth="4" fill="#0f2638">{[-24, 0, 24].map(y => <g key={y}><rect x="-38" y={y - 9} width="76" height="20" rx="5" /><circle cx="23" cy={y + 1} r="3" fill={gold} /></g>)}</g>;
    case "document": return <g data-component="document" stroke={cyan} strokeWidth="4" fill="#0f2638"><path d="M-28 -40 H12 L30 -22 V40 H-28Z M12 -40 V-22 H30 M-16 -10 H16 M-16 4 H16 M-16 18 H7" /></g>;
    case "force": return <path data-component="force" d="M-40 0 H40 M15 -20 L40 0 L15 20" stroke={gold} strokeWidth="7" fill="none" />;
    default: {
      const glyph = getRelatableGlyph(label, icon);
      const pulse = 1 + Math.sin(frame / 15) * 0.05;
      return (
        <g data-component="source-point" transform={`scale(${pulse})`}>
          {/* Glowing frosted circular badge */}
          <circle r="34" fill={glyph.bg} stroke={glyph.color} strokeWidth="2.5" />
          {/* Subtle spinning orbital ring */}
          <circle
            r="41"
            fill="none"
            stroke={glyph.secondaryColor}
            strokeWidth="1.5"
            strokeDasharray="6 6"
            opacity="0.65"
            transform={`rotate(${((frame * 1.5) % 360)})`}
          />
          {/* Vibrant Relatable Emoji */}
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="30"
            y="2"
            style={{ userSelect: "none" }}
          >
            {glyph.emoji}
          </text>
        </g>
      );
    }
  }
}

export function GraphVisual({ visual, frame, fps, scale, durationInFrames = 180 }: { visual: VisualScene; frame: number; fps: number; scale: number; durationInFrames?: number }) {
  if (visual.renderer !== "graph") return null;
  const graph = visual.graph;
  const positions = graphPositions(graph);
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
        return <div key={n.id} style={{ position: "absolute", left: `${i * 50 + 1}%`, top: "5%", width: "48%", height: "89%", opacity: m.reveal, borderTop: `3px solid ${m.highlight ? gold : cyan}`, background: "rgba(18, 32, 54, 0.9)", borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
          <div style={{ position: "absolute", top: "4%", left: "5%", width: "90%", height: "10%" }}>
            <FitText text={n.label} sceneId={visual.sceneId} role="label" scale={scale} preferredSize={28 * scale} minimumSize={20 * scale} />
          </div>
          <div data-component="inert-code-example" style={{ position: "absolute", left: "5%", top: "19%", width: "90%", height: "76%", fontFamily: "monospace" }}>
            {graph.comparisonFocus ? content.split("\n").map((line, row, lines) => {
              const field = line.includes(graph.example!.fields[0].key);
              const active = m.highlight && (graph.comparisonFocus === "fields" ? field : !field);
              return <div key={row} data-comparison-line={field ? "field" : "structure"} data-emphasis={active ? "active" : "none"}
                style={{ position: "absolute", top: `${row / lines.length * 100}%`, width: "100%", height: `${100 / lines.length}%`, background: active ? "#6b5326" : "transparent", color: active ? gold : "#edf5f8", borderRadius: 4 }}>
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
      <defs>
        <filter id="soft-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="8" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* Connection Edges with Moving Glowing Pulses */}
      {graph.edges.map((edge, i) => {
        const a = positions[graph.nodes.findIndex(n => n.id === edge.from)];
        const b = positions[graph.nodes.findIndex(n => n.id === edge.to)];
        const m = motion(`${edge.from}->${edge.to}`, i + 1);
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const start = { x: a.x + Math.cos(angle) * 73, y: a.y + Math.sin(angle) * 73 };
        const end = { x: b.x - Math.cos(angle) * 73, y: b.y - Math.sin(angle) * 73 };
        const returning = edge.meaning === "cycle";
        const path = returning ? `M${a.x + 75} ${a.y} Q635 ${a.y} 600 260 Q635 ${b.y} ${b.x + 75} ${b.y}` : `M${start.x} ${start.y} L${end.x} ${end.y}`;
        return <g key={`${edge.from}-${edge.to}`} data-component="connection" data-meaning={edge.meaning} opacity={m.reveal}>
          {/* Base path */}
          <path d={path} stroke="#3b5368" strokeWidth="4" fill="none" strokeDasharray="8 6" />
          {/* Arrow head */}
          {!returning && <>
            <path d="M-12 -7 L0 0 L-12 7" fill="none" stroke={gold} strokeWidth="4" transform={`translate(${end.x} ${end.y}) rotate(${angle * 180 / Math.PI})`} />
            {/* Glowing moving light packet */}
            <circle opacity={m.packet < 0 ? 0 : 1} r="6" fill="#38BDF8" cx={start.x + (end.x - start.x) * m.packet} cy={start.y + (end.y - start.y) * m.packet} style={{ filter: "drop-shadow(0 0 8px #38BDF8)" }} />
          </>}
          {returning && <path d={path} stroke={gold} strokeWidth="3" fill="none" strokeDasharray="8 14" strokeDashoffset={-m.packet * 44} />}
        </g>;
      })}

      {/* Interactive Node Cards */}
      {graph.nodes.map((n, i) => {
        const p = positions[i], m = motion(n.id, i);
        if (bar) {
          const v = graph.values.find(value => value.nodeId === n.id)!;
          return <g key={n.id} data-component="data-bar" opacity={m.reveal}>
            <path d={`M80 ${p.y + 45} H580`} stroke="rgba(255,255,255,0.08)" strokeWidth="25" strokeLinecap="round" />
            <path d={`M80 ${p.y + 45} h${v.value / 100 * 500 * m.reveal}`} stroke={i % 2 ? gold : cyan} strokeWidth="25" strokeLinecap="round" />
          </g>;
        }

        const glyph = getRelatableGlyph(n.label, n.icon);
        // Subtle floating animation for lively feel
        const floatY = Math.sin((frame + i * 25) / 16) * 5;

        return <g key={n.id} transform={`translate(${p.x} ${p.y + floatY})`} opacity={m.reveal}>
          {/* Soft ambient aura */}
          <rect
            x="-74"
            y="-52"
            width="148"
            height="104"
            rx={graph.layout === "comparison" ? 12 : 28}
            fill="none"
            stroke={glyph.color}
            strokeWidth="8"
            opacity="0.15"
            style={{ filter: "blur(6px)" }}
          />

          {/* Premium Glass Card */}
          <rect
            x="-70"
            y="-50"
            width="140"
            height="100"
            rx={graph.layout === "comparison" ? 10 : 26}
            fill="rgba(15, 23, 42, 0.92)"
            stroke={m.highlight ? gold : n.role === "core" ? "#34D399" : glyph.color}
            strokeWidth={m.highlight ? 3 : 2}
          />

          {/* Relatable Symbol / Emoji Badge */}
          <Symbol icon={n.icon} phase={m.packet} label={n.label} frame={frame} />
        </g>;
      })}
    </svg>

    {/* Edge Labels */}
    {graph.edges.filter(e => e.label).map((e, i) => {
      const a = positions[graph.nodes.findIndex(n => n.id === e.from)], b = positions[graph.nodes.findIndex(n => n.id === e.to)];
      const m = motion(`${e.from}->${e.to}`, i + 1);
      return <div key={`${e.from}-${e.to}-label`} style={{ position: "absolute", left: `${((a.x + b.x) / 2 + (i % 2 ? 90 : -90) - 70) / 640 * 100}%`, top: `${((a.y + b.y) / 2 - 25) / 520 * 100}%`, width: `${140 / 640 * 100}%`, height: `${50 / 520 * 100}%`, textAlign: "center", opacity: m.reveal }}>
        <FitText text={e.label!} sceneId={visual.sceneId} role="label" scale={scale} preferredSize={21 * scale} minimumSize={Math.max(16, 18 * scale)} />
      </div>;
    })}

    {/* Node Labels (with floating sync) */}
    {graph.nodes.map((n, i) => {
      const p = positions[i], m = motion(n.id, i);
      const value = graph.values.find(v => v.nodeId === n.id);
      const floatY = Math.sin((frame + i * 25) / 16) * 5;
      const glyph = getRelatableGlyph(n.label, n.icon);

      return <div key={n.id} style={{
        position: "absolute",
        left: `${(bar ? 75 : p.x - 86) / 640 * 100}%`,
        top: `${(bar ? p.y - 22 : p.y + 52 + floatY) / 520 * 100}%`,
        width: `${(bar ? 500 : 172) / 640 * 100}%`,
        height: `${(graph.layout === "flow" ? 56 : 60) / 520 * 100}%`,
        textAlign: bar ? "left" : "center",
        opacity: m.reveal,
      }}>
        <FitText text={value ? `${n.label}: ${value.value}%` : n.label} sceneId={visual.sceneId} role="label" scale={scale} preferredSize={23 * scale} minimumSize={Math.max(16, 20 * scale)} color={m.highlight ? gold : glyph.color} />
      </div>;
    })}
  </div>;
}
