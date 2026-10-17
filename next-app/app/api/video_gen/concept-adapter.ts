import type { Storyboard } from "./storyboard";
import { graphSchema, type GraphNode, type VisualGraph } from "./visual-graph";

type Scene = Storyboard["scenes"][number];
export function compactText(text: string, limit = 28) {
  if (text.length <= limit) return text;
  const part = text.slice(0, limit - 1);
  const boundary = part.lastIndexOf(" ");
  return part.slice(0, boundary > limit / 2 ? boundary : part.length) + "…";
}
const node = (id: string, label: string, icon: GraphNode["icon"], evidence: string, role: GraphNode["role"] = "item"): GraphNode => ({ id, label, icon, evidence, role });
function sceneText(scene: Scene) {
  const authored = scene.elements.filter(e => !/^(?:Scene \d+|Takeaway)$/.test(e.text)).map(e => e.text);
  return [...new Set([scene.narration, scene.visualDirection, ...authored])].join(" ");
}
const sentences = (text: string) => text.match(/[^.!?]+[.!?]?/g)?.map(s => s.trim()).filter(Boolean) ?? [text];

// Narrow, auditable adapters. Topic context chooses vocabulary; only local source
// assertions enable nodes and edges. Mentioning two entities alone creates no edge.
function photosynthesis(scene: Scene, title: string): VisualGraph | undefined {
  const context = title + " " + sceneText(scene);
  if (!/\bphotosynthesis\b/i.test(context) || !/\b(?:plants?|leaves|leaf|chlorophyll|glucose)\b/i.test(context)) return;
  const text = sceneText(scene);
  const nodes: GraphNode[] = [];
  const core = text.match(/\bchlorophyll\b/i) ?? text.match(/\b(?:photosynthesis|leaves|leaf|plants?)\b/i) ?? title.match(/\bphotosynthesis\b/i);
  if (!core) return;
  nodes.push(node("plant", core[0], "leaf", core[0], "core"));
  const terms = [
    ["sunlight", /\b(?:sunlight|light energy)\b/i, "sun", "input"],
    ["water", /\bwater\b/i, "water", "input"],
    ["carbon-dioxide", /\b(?:carbon dioxide|CO2)\b/i, "gas", "input"],
    ["sugar", /\b(?:glucose|sugars?)\b/i, "sugar", "output"],
    ["oxygen", /\boxygen\b/i, "gas", "output"],
  ] as const;
  const edges: VisualGraph["edges"] = [];
  for (const [id, regex, icon, role] of terms) {
    const match = text.match(regex);
    if (!match) continue;
    nodes.push(node(id, match[0], icon, match[0], role));
    // Require a positive, local assertion. Negated/uncertain statements remain conceptual.
    const assertion = sentences(scene.narration).find(s => regex.test(s) && !/\b(?:not|never|no|may|might|could|without)\b|n't\b/i.test(s) &&
      (role === "input"
        ? [...s.matchAll(/\b(?:uses?|absorbs?|catches?|captures?|takes? in|needs?|converts?)\s+(.+?)(?=\b(?:into|to|produc\w*|releas\w*|mak\w*)\b|[.;]|$)/gi)].some(m => regex.test(m[1]))
        : [...s.matchAll(/\b(?:produc\w*|releas\w*|makes?|into)\s+(.+?)(?=\b(?:using|from|by|with)\b|[.;]|$)/gi)].some(m => regex.test(m[1]))));
    const arrival = role === "input" ? sentences(scene.narration).find(s => regex.test(s) && /\b(?:enters?|hits?)\b[^.!?]*\b(?:plant|leaf|leaves|chlorophyll)\b/i.test(s) && !/\b(?:not|never|may|might)\b|n't\b/i.test(s)) : undefined;
    const passive = role === "output" ? sentences(scene.narration).find(s => {
      const match = s.match(regex);
      return match && /^(?:\s+is|\s+are)?\s+(?:produced|released)\b/i.test(s.slice(match.index! + match[0].length)) && !/\b(?:not|never|may|might)\b|n't\b/i.test(s);
    }) : undefined;
    if (assertion || arrival || passive) edges.push({ from: role === "input" ? id : "plant", to: role === "input" ? "plant" : id, meaning: role, evidence: assertion ?? arrival ?? passive! });
  }
  return graphSchema.parse({ topic: "photosynthesis", layout: "flow", nodes, edges });
}

function cpu(scene: Scene, title: string): VisualGraph | undefined {
  const context = title + " " + sceneText(scene);
  if (!/\b(?:CPU|central processing unit|processor)\b/i.test(context) || !/\binstructions?\b/i.test(context)) return;
  const text = sceneText(scene);
  const stages = [
    ["fetch", /\bfetch(?:es|ing)?\b/i], ["decode", /\bdecod(?:e|es|ing)\b/i], ["execute", /\b(?:execut(?:e|es|ing)|performs? (?:the |an? )?operation)\b/i],
  ] as const;
  const nodes: GraphNode[] = [];
  for (const [id, regex] of stages) {
    const match = text.match(regex);
    if (match) nodes.push(node(id, match[0], id, match[0]));
  }
  // Source order is authoritative, even if it differs from the usual CPU cycle.
  nodes.sort((a, b) => text.indexOf(a.evidence) - text.indexOf(b.evidence));
  if (!nodes.length) {
    const match = text.match(/\b(?:CPU|processor|instructions?)\b/i);
    if (match) nodes.push(node("cpu", match[0], "chip", match[0]));
  }
  const memory = text.match(/\bmemory\b/i);
  if (memory) nodes.push(node("memory", memory[0], "memory", memory[0]));
  const register = text.match(/\binstruction register\b/i);
  if (register) nodes.push(node("register", register[0], "memory", register[0]));
  if (!nodes.length) return;
  const edges: VisualGraph["edges"] = [];
  const positive = !/\b(?:not|never|may|might|could)\b|n't\b/i.test(scene.narration);
  const operation = nodes.find(n => n.id === "fetch" || n.id === "cpu");
  if (positive && memory && operation && /\b(?:reads?|fetch\w*)\b[^.!?]*\bfrom memory\b/i.test(scene.narration)) {
    edges.push({ from: "memory", to: operation.id, meaning: "input", evidence: scene.narration });
  }
  if (positive && memory && nodes.some(n => n.id === "cpu") && /\b(?:updates?|writes?|stores?)\b[^.!?]*\bmemory\b/i.test(scene.narration)) {
    edges.push({ from: "cpu", to: "memory", meaning: "output", evidence: scene.narration });
  }
  if (/\b(?:first|then|next|finally|followed by|in order)\b/i.test(scene.narration) && !/\b(?:not|never|may|might)\b|n't\b/i.test(scene.narration)) {
    const present = nodes.filter(n => ["fetch", "decode", "execute"].includes(n.id) && scene.narration.includes(n.evidence));
    for (let i = 1; i < present.length; i++) edges.push({ from: present[i - 1].id, to: present[i].id, meaning: "order", evidence: scene.narration });
    if (/\b(?:repeats?|repeat\w* cycle)\b/i.test(scene.narration) && present.length > 1) edges.push({ from: present.at(-1)!.id, to: present[0].id, meaning: "cycle", evidence: scene.narration });
  }
  if (positive && nodes.length === 1 && nodes[0].id === "execute" && /\b(?:repeats?|continuous)\b/i.test(scene.narration)) {
    const instruction = scene.narration.match(/\binstructions?\b/i);
    if (instruction) {
      nodes.unshift(node("instruction", instruction[0], "fetch", instruction[0]));
      edges.push({ from: "instruction", to: "execute", meaning: "order", evidence: scene.narration }, { from: "execute", to: "instruction", meaning: "cycle", evidence: scene.narration });
    }
  }
  return graphSchema.parse({ topic: "cpu", layout: edges.some(e => e.meaning === "cycle") ? "cycle" : "sequence", nodes, edges });
}

function general(scene: Scene): VisualGraph {
  const text = scene.narration;
  // Only explicit labeled percentages are charted; an isolated number is not a dataset.
  const matches = [...text.matchAll(/(?:^|[.;]\s*)([\p{L}][\p{L}\p{N} -]{0,25}):\s*(\d+(?:\.\d+)?)\s*%/gu)];
  if (matches.length >= 2 && matches.length <= 6 && matches.every(m => Number(m[2]) <= 100) && !/\b(?:not|about|approximately|maybe)\b|n't\b/i.test(text)) {
    const nodes = matches.map((m, i) => node(`value-${i}`, m[1], "item", m[0].trim()));
    return graphSchema.parse({ topic: "general", layout: "bars", nodes, edges: [], values: matches.map((m, i) => ({ nodeId: nodes[i].id, value: Number(m[2]), unit: "%", evidence: m[0].trim() })) });
  }
  const cause = text.match(/^(.{1,100}?)\s+(?:causes?|leads? to|results? in)\s+(.{1,100}?)[.!?]?$/i);
  if (cause && !/\b(?:not|never|may|might|could)\b|n't\b/i.test(text)) return graphSchema.parse({ topic: "general", layout: "cause", nodes: [node("cause", compactText(cause[1]), "item", cause[1]), node("effect", compactText(cause[2]), "item", cause[2])], edges: [{ from: "cause", to: "effect", meaning: "cause", evidence: text }] });
  const compare = text.match(/^(.{1,80}?)\s+(?:versus|vs\.?|whereas)\s+(.{1,80}?)[.!?]?$/i);
  if (compare) return graphSchema.parse({ topic: "general", layout: "comparison", nodes: [node("a", compactText(compare[1]), "item", compare[1]), node("b", compactText(compare[2]), "item", compare[2])], edges: [] });
  const steps = text.split(/\b(?:first|then|next|finally)\b[:,]?\s*/i).map(s => s.trim().replace(/[.;,]+$/, "")).filter(Boolean);
  if (/^first\b/i.test(text) && steps.length >= 2 && steps.length <= 6) {
    const nodes = steps.map((s, i) => node(`step-${i}`, compactText(s), "item", s));
    return graphSchema.parse({ topic: "general", layout: "sequence", nodes, edges: nodes.slice(1).map((n, i) => ({ from: nodes[i].id, to: n.id, meaning: "order", evidence: text })) });
  }
  // A source-based overview: no random connected geometry or invented labels.
  const phrases = sentences(text).slice(0, 3);
  return graphSchema.parse({ topic: "general", layout: "overview", nodes: phrases.map((s, i) => node(`point-${i}`, compactText(s), "item", s)), edges: [] });
}

export const conceptAdapters = [
  { id: "photosynthesis", purpose: "Source-supported inputs and products around a plant", adapt: photosynthesis },
  { id: "cpu", purpose: "Instruction stages and explicitly stated order", adapt: cpu },
] as const;
export function adaptConceptGraph(scene: Scene, title: string): VisualGraph {
  for (const adapter of conceptAdapters) {
    const graph = adapter.adapt(scene, title);
    if (graph) return graph;
  }
  return general(scene);
}
