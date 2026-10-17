import { z } from "zod";

export const iconSchema = z.enum(["leaf", "sun", "water", "gas", "sugar", "chip", "memory", "fetch", "decode", "execute", "force", "item", "browser", "server", "document", "database", "book", "search", "model", "vector-store", "query", "resolver", "graphql", "json", "xml", "question", "answer", "pages", "index"]);
export const graphActionStructureSchema = z.strictObject({
  kind: z.enum(["reveal", "highlight", "hide", "transfer"]),
  target: z.string().min(1).max(66),
  start: z.number().min(0).max(1), end: z.number().min(0).max(1),
});
export const graphActionSchema = graphActionStructureSchema.refine(a => a.end > a.start, "Animation end must follow start.");
export const recordExampleStructureSchema = z.strictObject({
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,11}$/),
  evidence: z.string().min(1).max(1200),
  fields: z.array(z.strictObject({ key: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,11}$/), value: z.string().min(1).max(20), evidence: z.string().min(1).max(1200) })).min(1).max(3),
});
export const recordExampleSchema = recordExampleStructureSchema.refine(e => new Set(e.fields.map(f => f.key)).size === e.fields.length, "Example keys must be unique.");
export const graphStructureSchema = z.strictObject({
  topic: z.enum(["photosynthesis", "cpu", "general", "rag", "graphql", "book", "json", "xml"]),
  layout: z.enum(["flow", "sequence", "cycle", "comparison", "cause", "bars", "overview"]),
  nodes: z.array(z.strictObject({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
    label: z.string().min(1).max(28), icon: iconSchema,
    role: z.enum(["input", "core", "output", "item"]).default("item"),
    evidence: z.string().min(1).max(1200),
  })).min(1).max(6),
  edges: z.array(z.strictObject({
    from: z.string(), to: z.string(),
    label: z.string().min(1).max(28).optional(),
    meaning: z.enum(["input", "output", "order", "cause", "cycle"]),
    evidence: z.string().min(1).max(1200),
  })).max(8),
  actions: z.array(graphActionStructureSchema).max(16).default([]),
  example: recordExampleStructureSchema.optional(),
  comparisonFocus: z.enum(["structure", "fields"]).optional(),
  values: z.array(z.strictObject({ nodeId: z.string(), value: z.number().finite().min(0).max(100), unit: z.literal("%"), evidence: z.string().min(1).max(1200) })).max(6).default([]),
});
export const graphSchema = graphStructureSchema.extend({ actions: z.array(graphActionSchema).max(16).default([]), example: recordExampleSchema.optional() }).superRefine((graph, ctx) => {
  if (graph.layout === "flow" && (graph.nodes.filter(n => n.role === "core").length !== 1 || graph.nodes.some(n => n.role === "item") || graph.nodes.filter(n => n.role === "input").length > 3 || graph.nodes.filter(n => n.role === "output").length > 3)) ctx.addIssue({ code: "custom", message: "Flow needs one core and up to three inputs/outputs." });
  if (graph.example && (graph.layout !== "comparison" || graph.nodes.length !== 2 || !graph.nodes.some(n => /^json$/i.test(n.label)) || !graph.nodes.some(n => /^xml$/i.test(n.label)))) ctx.addIssue({ code: "custom", message: "Record comparison requires JSON and XML sides." });
  const ids = new Set(graph.nodes.map(n => n.id));
  if (ids.size !== graph.nodes.length) ctx.addIssue({ code: "custom", message: "Node IDs must be unique." });
  for (const a of graph.actions) {
    const edge = graph.edges.some(e => `${e.from}->${e.to}` === a.target);
    if (a.kind === "transfer" ? !edge : !ids.has(a.target)) ctx.addIssue({ code: "custom", message: "Animation target must exist and match its primitive." });
  }
  for (const e of graph.edges) if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) ctx.addIssue({ code: "custom", message: "Edges need distinct existing endpoints." });
  if (graph.layout === "comparison" && graph.nodes.length !== 2) ctx.addIssue({ code: "custom", message: "Comparison needs two sides." });
  if (graph.layout === "bars" && (graph.values.length < 2 || graph.values.length !== graph.nodes.length || new Set(graph.values.map(v => v.nodeId)).size !== graph.values.length)) ctx.addIssue({ code: "custom", message: "Bars need at least two distinct, labeled percentages." });
  if (graph.layout !== "bars" && graph.values.length) ctx.addIssue({ code: "custom", message: "Values are only supported in bars." });
  for (const v of graph.values) if (!ids.has(v.nodeId)) ctx.addIssue({ code: "custom", message: "Value needs a node." });
});
export type VisualGraph = z.infer<typeof graphSchema>;
export type GraphNode = VisualGraph["nodes"][number];

// Fixed layouts, never source-provided coordinates or executable SVG.
export function graphPositions(graph: VisualGraph) {
  const counts = { input: 0, core: 0, output: 0, item: 0 };
  return graph.nodes.map((n, i) => {
    if (graph.layout === "flow") {
      const peers = graph.nodes.filter(p => p.role === n.role).length;
      const row = counts[n.role]++;
      return { x: n.role === "input" ? 95 : n.role === "output" ? 545 : 320, y: peers === 3 ? 50 + row * 172 : peers === 2 ? 164 + row * 172 : 250 };
    }
    if (graph.layout === "comparison") return { x: 170 + i * 300, y: 245 };
    if (graph.layout === "bars") return { x: 90, y: 90 + i * (360 / Math.max(1, graph.nodes.length - 1)) };
    if (graph.nodes.length <= 3) return { x: 320, y: graph.nodes.length === 1 ? 260 : 70 + i * (330 / Math.max(1, graph.nodes.length - 1)) };
    return { x: i % 2 === 0 ? 170 : 470, y: 50 + Math.floor(i / 2) * 172 };
  });
}

// Labels get the space available in their actual layout, rather than the same
// narrow box for a single-column diagram and a three-column flow.
export function graphNodeLayouts(graph: VisualGraph) {
  const positions = graphPositions(graph);
  const fixed = ["flow", "comparison", "bars"].includes(graph.layout);
  const dense = !fixed && graph.nodes.length > 3;
  return positions.map((p, index) => {
    const compact = dense || graph.layout === "flow" && graph.nodes.filter(n => n.role === graph.nodes[index].role).length > 1;
    const width = graph.layout === "bars" ? 500 : dense || graph.layout === "comparison" ? 244 : graph.layout === "flow" ? 190 : 480;
    return {
      ...p, symbolScale: compact ? 0.74 : 1,
      label: {
        x: graph.layout === "bars" ? 75 : p.x - width / 2,
        y: graph.layout === "bars" ? p.y - 22 : p.y + (compact ? 44 : 56),
        width, height: dense || graph.layout === "flow" || graph.layout === "comparison" ? 78 : 60,
      },
    };
  });
}

export function graphMotion(frame: number, fps: number, index: number) {
  const seconds = Math.max(0, frame) / fps;
  return { reveal: Math.max(0, Math.min(1, (seconds - index * 0.24) / 0.45)), packet: ((seconds / 2 - index * 0.15) % 1 + 1) % 1 };
}

// XML is a text representation of the same record, never injected into the DOM.
export function recordRepresentations(example: z.infer<typeof recordExampleSchema>) {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  return {
    json: JSON.stringify(Object.fromEntries(example.fields.map(f => [f.key, f.value])), null, 2),
    xml: `<${example.name}>\n${example.fields.map(f => `  <${f.key}>${escape(f.value)}</${f.key}>`).join("\n")}\n</${example.name}>`,
  };
}
export function plannedMotion(graph: VisualGraph, target: string, frame: number, durationInFrames: number) {
  const progress = Math.max(0, frame) / Math.max(1, durationInFrames - 1);
  let opacity = 1, highlight = false, transfer: number | undefined;
  for (const a of graph.actions.filter(a => a.target === target)) {
    const local = Math.max(0, Math.min(1, (progress - a.start) / (a.end - a.start)));
    if (a.kind === "reveal") opacity *= local;
    if (a.kind === "hide") opacity *= 1 - local;
    if (a.kind === "highlight" && progress >= a.start && progress <= a.end) highlight = true;
    if (a.kind === "transfer") transfer = progress < a.start || progress > a.end ? -1 : local;
  }
  return { opacity, highlight, transfer };
}
