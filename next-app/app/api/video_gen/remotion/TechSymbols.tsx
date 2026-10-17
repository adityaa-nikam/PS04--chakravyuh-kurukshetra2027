import React from "react";
import type { GraphNode } from "../visual-graph";

const cyan = "#63e4ec", gold = "#ffcc66", ink = "#163c51";
type SymbolProps = { phase: number };

export function BookSymbol({ phase }: SymbolProps) {
  const turn = Math.sin(Math.max(0, phase) * Math.PI) * 12;
  return <g data-component="book" stroke={cyan} strokeWidth={3} fill={ink}>
    <path d="M0 -24 Q-22 -41 -51 -31 V34 Q-23 25 0 42 Q23 25 51 34 V-31 Q22 -41 0 -24Z" />
    <path d="M0 -24 V42 M-42 -17 Q-24 -21 -10 -11 M-42 -3 Q-24 -7 -10 3 M10 -11 Q26 -21 42 -17 M10 3 Q26 -7 42 -3" fill="none" />
    <path d={`M0 -24 Q${18 + turn} -34 ${38 - turn} -23 V24 Q18 19 0 42Z`} fill="#285568" opacity={0.7} />
    <path d="M-45 44 Q-23 35 0 49 Q23 35 45 44" fill="none" stroke={gold} />
  </g>;
}

export function SearchSymbol({ phase }: SymbolProps) {
  const shift = Math.max(0, phase) * 10;
  return <g data-component="search" stroke={cyan} strokeWidth={3} fill="none">
    <path d="M-45 -35 H17 L32 -20 V38 H-45Z M-33 -21 H6 M-33 -7 H17 M-33 7 H6 M-33 21 H14" />
    <g transform={`translate(${shift} 0)`}><circle cx={13} cy={0} r={24} fill={ink} /><path d="M29 18 L49 40" strokeWidth={7} stroke={gold} /><path d="M1 -5 H23 M1 6 H18" stroke={gold} /></g>
  </g>;
}

export function ModelSymbol({ phase }: SymbolProps) {
  return <g data-component="language-model" stroke={cyan} strokeWidth={3} fill={ink}>
    <path d="M0 -46 L41 -23 V23 L0 46 L-41 23 V-23Z" />
    <path d="M-16 -25 Q-37 -12 -21 3 Q-27 25 -5 28 M16 -25 Q37 -12 21 3 Q27 25 5 28 M0 -29 V30 M-20 3 H20 M-17 -18 L17 19 M17 -18 L-17 19" fill="none" />
    {[-18, 0, 18].map((x, i) => <circle key={x} cx={x} cy={i % 2 ? 0 : -18} r={5} fill={gold} opacity={0.4 + (Math.floor(Math.max(0, phase) * 3) === i ? 0.6 : 0)} />)}
  </g>;
}

export function VectorStoreSymbol({ phase }: SymbolProps) {
  return <g data-component="vector-store" stroke={cyan} strokeWidth={3} fill={ink}>
    <path d="M-43 -26 V28 C-43 47 43 47 43 28 V-26" /><ellipse cy={-26} rx={43} ry={14} />
    <path d="M-43 -7 C-43 12 43 12 43 -7 M-43 12 C-43 31 43 31 43 12" fill="none" />
    {[[-22, -7], [3, 4], [24, -3], [-13, 24], [17, 29]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={4} fill={Math.floor(Math.max(0, phase) * 5) === i ? gold : cyan} />)}
  </g>;
}

export function GraphQLSymbol({ phase }: SymbolProps) {
  const points = [[0, -40], [35, -20], [35, 20], [0, 40], [-35, 20], [-35, -20]];
  return <g data-component="graphql" stroke="#e879c4" strokeWidth={3} fill="none">
    <path d="M0 -40 L35 -20 V20 L0 40 L-35 20 V-20Z M0 -40 L35 20 H-35Z M-35 -20 L0 40 L35 -20" />
    {points.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={6} fill={Math.floor(Math.max(0, phase) * 6) === i ? gold : "#e879c4"} stroke="none" />)}
  </g>;
}

export function CodeDocumentSymbol({ format, phase }: SymbolProps & { format: "json" | "xml" | "query" }) {
  return <g data-component={format} stroke={cyan} strokeWidth={3} fill="none">
    <path d="M-37 -46 H19 L38 -27 V46 H-37Z M19 -46 V-27 H38" fill={ink} />
    {format === "xml" ? <path d="M-12 -12 L-25 0 L-12 12 M12 -12 L25 0 L12 12 M5 -16 L-5 16" stroke={gold} />
      : <path d="M-12 -19 Q-25 -19 -21 -7 Q-19 0 -29 0 Q-19 0 -21 7 Q-25 19 -12 19 M12 -19 Q25 -19 21 -7 Q19 0 29 0 Q19 0 21 7 Q25 19 12 19" stroke={gold} />}
    {format === "query" && <path d="M-7 -8 H9 M-7 1 H13 M-7 10 H5" stroke={gold} />}
    <path d="M-25 31 H22" stroke={gold} strokeDasharray="12 7" strokeDashoffset={-Math.max(0, phase) * 19} />
  </g>;
}

export function ResolverSymbol({ phase }: SymbolProps) {
  return <g data-component="resolver" stroke={cyan} strokeWidth={3} fill={ink}>
    <path d="M-43 0 H-12 M12 0 H43 M0 -12 V-35 M0 12 V35" fill="none" />
    <path d="M0 -19 L19 0 L0 19 L-19 0Z" fill={gold} />
    {[[-44, 0], [44, 0], [0, -37], [0, 37]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={8} fill={Math.floor(Math.max(0, phase) * 4) === i ? gold : ink} />)}
  </g>;
}

export function PagesSymbol({ phase }: SymbolProps) {
  return <g data-component="pages" stroke={cyan} strokeWidth={3} fill={ink}>
    {[-12, 0, 12].map((x, i) => <g key={x} transform={`translate(${x} ${-x / 2})`}><path d="M-29 -34 H29 V34 H-29Z" stroke={Math.floor(Math.max(0, phase) * 3) === i ? gold : cyan} /><path d="M-18 -18 H18 M-18 -4 H18 M-18 10 H9" fill="none" /></g>)}
  </g>;
}

export const techSymbolIcons = new Set<GraphNode["icon"]>(["book", "search", "model", "vector-store", "graphql", "json", "xml", "query", "resolver", "pages", "index", "question", "answer"]);
export function TechSymbol({ icon, phase }: { icon: GraphNode["icon"]; phase: number }) {
  if (icon === "book") return <BookSymbol phase={phase} />;
  if (icon === "search") return <SearchSymbol phase={phase} />;
  if (icon === "model") return <ModelSymbol phase={phase} />;
  if (icon === "vector-store") return <VectorStoreSymbol phase={phase} />;
  if (icon === "graphql") return <GraphQLSymbol phase={phase} />;
  if (icon === "json" || icon === "xml" || icon === "query") return <CodeDocumentSymbol format={icon} phase={phase} />;
  if (icon === "resolver") return <ResolverSymbol phase={phase} />;
  if (icon === "pages") return <PagesSymbol phase={phase} />;
  if (icon === "index") return <g data-component="index" stroke={cyan} strokeWidth={3} fill="none"><path d="M-33 -36 H33 V36 H-33Z M-19 -22 H-9 M0 -22 H23 M-19 -6 H-9 M0 -6 H23 M-19 10 H-9 M0 10 H23 M-19 26 H-9 M0 26 H23" /></g>;
  return <g data-component={icon} stroke={cyan} strokeWidth={3} fill={ink}><path d="M-43 -31 H43 V25 H-9 L-27 41 V25 H-43Z" />{icon === "question" ? <path d="M-9 -13 Q-9 -25 5 -21 Q20 -15 8 -5 L0 1 V7 M0 15 V18" stroke={gold} strokeWidth={4} fill="none" /> : <path d="M-25 -12 H25 M-25 0 H25 M-25 12 H9" stroke={gold} fill="none" />}</g>;
}
