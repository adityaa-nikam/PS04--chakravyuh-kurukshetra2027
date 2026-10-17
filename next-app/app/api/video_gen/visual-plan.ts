import { z } from "zod";
import type { Storyboard } from "./storyboard";
import { graphSchema } from "./visual-graph";
import { adaptConceptGraph, compactText } from "./concept-adapter";
import { sceneTechSubjects, isTechSubject, supportsTechSubject, techVisual } from "./tech-catalog";

export const visualRegistry = {
  title: "hook", process: "process", diagram: "diagram",
  comparison: "comparison", summary: "summary", statistic: "diagram",
} as const;
export function selectVisualConcept(type: string) {
  return Object.hasOwn(visualRegistry, type)
    ? visualRegistry[type as keyof typeof visualRegistry] : "diagram";
}
const visualBaseSchema = z.strictObject({
  sceneId: z.string().regex(/^scene-\d{3}$/),
  concept: z.enum(["hook", "process", "diagram", "comparison", "summary"]),
  mode: z.enum(["overview", "vibration", "wind", "traffic", "combined", "load", "supports", "damping", "comparison"]),
  heading: z.string().min(1).max(64),
  labels: z.array(z.string().min(1).max(28)).min(1).max(3),
  note: z.string().min(1).max(64),
});
export const graphVisualSceneSchema = visualBaseSchema.extend({ renderer: z.literal("graph"), mode: z.literal("overview"), graph: graphSchema });
export const visualSceneSchema = z.discriminatedUnion("renderer", [
  visualBaseSchema.extend({ renderer: z.literal("bridge") }),
  visualBaseSchema.extend({ renderer: z.literal("abstract") }),
  graphVisualSceneSchema,
]);
export type VisualScene = z.infer<typeof visualSceneSchema>;


// A domain eligibility guard, not a visual planner. The specialized physical
// bridge renderer must never become a cheap alternative to a complete graph.
export function hasPhysicalBridgeContext(text: string) {
  return /\bbridges?\b/i.test(text)
    && /\b(?:wind|traffic|vehicles?|cars?|trucks?|deck|supports?|foundations?|loads?|weight|river|span|ground|obstacle|people)\b|vibrat|creak|shak|sway|damp|bridge works/i.test(text)
    && !/\b(?:network bridge|bridge pattern|dental bridge)\b/i.test(text);
}
export function assertVisualDomain(scene: Storyboard["scenes"][number], title: string, visual: VisualScene) {
  if (visual.renderer === "graph" && isTechSubject(visual.graph.topic) && !supportsTechSubject(visual.graph.topic, `${title} ${scene.narration}`)) {
    throw new Error(`VISUAL_DOMAIN_MISMATCH: ${scene.id} selected ${visual.graph.topic} graphics without source context.`);
  }
  if (visual.renderer === "bridge" && !hasPhysicalBridgeContext(title + " " + scene.narration)) {
    throw new Error(`VISUAL_DOMAIN_MISMATCH: ${scene.id} selected physical bridge graphics without bridge source context. Replan this scene; no domain fallback is allowed.`);
  }
  if (visual.renderer === "bridge" && visual.concept === "comparison" && visual.mode !== "comparison") {
    throw new Error(`VISUAL_SPEC: ${scene.id} bridge comparison requires comparison mode.`);
  }
}

function shortTitle(title: string) {
  if (title.length <= 56) return title;
  const cut = title.slice(0, 53);
  return cut.slice(0, cut.lastIndexOf(" ") > 25 ? cut.lastIndexOf(" ") : 53) + "…";
}

// Fixed, authored visuals only. Source strings are inspected as data, never markup.
// Narration is not rewritten: this returns a separate, intentionally concise display plan.
export function adaptVisualScene(scene: Storyboard["scenes"][number], title: string): VisualScene {
  const tech = sceneTechSubjects(title, scene.narration)[0];
  if (tech) return visualSceneSchema.parse(techVisual(scene, title, tech));
  const content = scene.narration + " " + scene.visualDirection;
  const concept = selectVisualConcept(scene.visualType);
  const bridge = hasPhysicalBridgeContext(scene.narration + " " + title);
  if (!bridge) {
    const graph = adaptConceptGraph(scene, title);
    const heading = concept === "hook" ? shortTitle(title)
      : concept === "summary" ? compactText(title, 46) + " • recap"
      : graph.topic === "photosynthesis" ? "Inside photosynthesis"
      : graph.topic === "cpu" ? "Inside the instruction cycle"
      : graph.layout === "bars" ? "The supplied percentages"
      : graph.layout === "cause" ? "Cause and effect"
      : graph.layout === "sequence" ? "Step by step"
      : graph.layout === "comparison" ? "Side by side" : shortTitle(title);
    return visualSceneSchema.parse({
      sceneId: scene.id, concept, renderer: "graph", mode: "overview", graph,
      heading, labels: graph.nodes.slice(0, 3).map(n => n.label),
      note: graph.layout === "bars" ? "Source values • scale 0–100%"
        : graph.layout === "overview" ? "Source overview • no inferred connections"
        : graph.edges.length ? "Arrows follow the supplied explanation" : "Components mentioned in this scene",
    });
  }
  const wind = /\bwind\b|gust/i.test(content);
  const traffic = /\btraffic\b|\bcars?\b|\btrucks?\b|\bvehicles?\b/i.test(content);
  const damping = /\bdamp(?:ing|ers?)\b|shock absorber/i.test(content);
  const vibrates = /vibrat|shak|sway|creak|wave/i.test(content);
  const load = /\bweight\b|\bloads?\b|transfers?|foundations?/i.test(content);
  let mode: VisualScene["mode"] = damping ? "damping" : concept === "comparison" ? "comparison"
    : concept === "summary" ? "supports"
    : concept === "hook" ? "overview"
    : wind && traffic ? "combined" : wind ? "wind" : traffic && !load ? "traffic" : load ? "load" : vibrates ? "vibration" : "supports";
  // A hook can introduce a static structure; the gentle vibration is used only
  // when the source actually discusses vibration.
  if (mode === "overview" && vibrates) {
    mode = wind && traffic ? "combined" : wind ? "wind" : traffic ? "traffic" : "vibration";
  }
  const copy = {
    overview: ["How a bridge works", ["Deck", "Supports", "Ground"]],
    vibration: ["Why do bridges vibrate?", ["Deck", "Motion", "Supports"]],
    wind: ["Wind sets the bridge in motion", ["Wind", "Force", "Vibration"]],
    traffic: ["Traffic creates vibration", ["Moving vehicles", "Deck", "Vibration"]],
    combined: [concept === "hook" ? "Why do bridges vibrate?" : "Two forces. One bridge.", ["Wind", "Traffic", "Vibration"]],
    load: ["Follow the weight", ["Deck", "Supports", "Foundations"]],
    damping: ["Damping reduces motion", ["Deck", "Damper", "Motion"]],
    supports: [concept === "summary" ? "Designed for stability" : "A bridge is a connected system", ["Deck", "Supports", "Foundations"]],
    comparison: ["Wind and traffic", ["Wind force", "Vehicle loads"]],
  } as const;
  return visualSceneSchema.parse({
    sceneId: scene.id, concept, renderer: "bridge", mode,
    heading: copy[mode][0], labels: [...copy[mode][1]],
    note: mode === "supports" ? "Supports carry forces to the ground" : "Schematic • motion exaggerated",
  });
}

// All motion uses the Sequence-relative frame, never wall-clock time or randomness.
export function visualMotion(frame: number, fps: number) {
  const seconds = Math.max(0, frame) / fps;
  return {
    reveal: Math.min(1, seconds / 0.8),
    wind: (seconds / 2) % 1,
    vehicle: (seconds / 6) % 1,
    vibration: Math.sin(seconds * Math.PI * 4),
    load: (seconds / 3) % 1,
  };
}
