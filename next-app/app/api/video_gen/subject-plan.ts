import type { Storyboard } from "./storyboard";
import { adaptVisualScene } from "./visual-plan";
import { modelVisualSceneSchema } from "./model-visual-plan";
import { sceneTechSubjects, isTechSubject, techVisual, type TechSubject } from "./tech-catalog";

export type IllustratedSubject = "bridge" | "photosynthesis" | "cpu" | TechSubject;

function sourceVisual(board: Storyboard, scene: Storyboard["scenes"][number]) {
  // Illustration directions are not factual evidence. Keep the old authored
  // adapters, but select components/mechanisms from narration and title only.
  return adaptVisualScene({ ...scene, visualDirection: "", elements: scene.elements.map(e => e.role === "visual_direction" ? { ...e, text: "" } : e) }, board.title);
}

export function illustratedSubjects(board: Storyboard, scene: Storyboard["scenes"][number]): IllustratedSubject[] {
  const tech = sceneTechSubjects(board.title, scene.narration);
  if (tech.length) return tech;
  const visual = sourceVisual(board, scene);
  if (visual.renderer === "bridge") {
    // Do not animate a negated/uncertain physical mechanism as an assertion.
    return /\b(?:bridges?|wind|traffic|vehicles?|vibrations?)\s+(?:(?:does?|is|are)\s+)?(?:not|never|may|might|could)\b|\b(?:without|no)\s+(?:wind|traffic|vibration)/i.test(scene.narration) ? [] : ["bridge"];
  }
  return visual.renderer === "graph" && (visual.graph.topic === "photosynthesis" || visual.graph.topic === "cpu") ? [visual.graph.topic] : [];
}

export function illustrateSubject(board: Storyboard, scene: Storyboard["scenes"][number], subject: IllustratedSubject, index: number) {
  if (!illustratedSubjects(board, scene).includes(subject)) throw new Error(`VISUAL_ACTION ${scene.id}: ${subject} illustration lacks source context.`);
  const visual = isTechSubject(subject) ? techVisual(scene, board.title, subject) : sourceVisual(board, scene);
  if (visual.renderer === "graph") {
    const graph = visual.graph;
    const source = `${board.title} ${scene.narration}`.replace(/\s+/g, " ");
    // Enlarge an adapter's assertion quote only enough to include both named
    // endpoints. It stays a verbatim source span; no relationships are added.
    graph.edges = graph.edges.map(edge => {
      const labels = [edge.from, edge.to].map(id => graph.nodes.find(n => n.id === id)!.label.replace(/…$/, ""));
      const quotes = [edge.evidence, ...labels.filter(label => !edge.evidence.toLowerCase().includes(label.toLowerCase()))];
      const spans = quotes.map(quote => {
        const text = quote.replace(/\s+/g, " ");
        const start = source.toLowerCase().indexOf(text.toLowerCase());
        if (start < 0) throw new Error(`VISUAL_ACTION ${scene.id}: relationship evidence is absent.`);
        return { start, end: start + text.length };
      });
      return { ...edge, evidence: source.slice(Math.min(...spans.map(s => s.start)), Math.max(...spans.map(s => s.end))) };
    });
    graph.actions = graph.nodes.map((node, i) => ({ kind: "reveal" as const, target: node.id, start: i * 0.18 / graph.nodes.length, end: (i + 1) * 0.18 / graph.nodes.length }));
    graph.edges.forEach((edge, i) => graph.actions.push({ kind: "transfer", target: `${edge.from}->${edge.to}`, start: 0.28 + i * 0.56 / graph.edges.length, end: 0.28 + (i + 1) * 0.56 / graph.edges.length }));
    const primary = graph.nodes.find(n => n.role === "core") ?? graph.nodes[0];
    if (isTechSubject(subject) && graph.edges.length) {
      const transfers = graph.actions.filter(a => a.kind === "transfer");
      graph.edges.forEach((edge, i) => {
        if (graph.actions.length < 16) graph.actions.push({ kind: "highlight", target: edge.to, start: transfers[i].start, end: transfers[i].end });
      });
    } else graph.actions.push({ kind: "highlight", target: primary.id, start: 0.22, end: 0.88 });
  }
  return modelVisualSceneSchema.parse({
    sceneId: scene.id, purpose: index === 0 ? "hook" : index === board.scenes.length - 1 ? "summary" : "explanation",
    explanation: `Illustrate ${subject} with authored subject graphics and source-supported motion.`,
    confidence: visual.renderer === "graph" && visual.graph.layout === "overview" ? "overview" : "supported", visual,
  });
}
