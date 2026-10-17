import { actionEvidenceText, type ActionEvidence } from "./action-catalog";
import { z } from "zod";
import { adaptVisualScene, visualSceneSchema, assertVisualDomain } from "./visual-plan";
import { storyboardSchema, visualTypeSchema, type Storyboard } from "./storyboard";

export const renderOptionsSchema = z.strictObject({
  width: z.number().int().min(640).max(1920).multipleOf(2).default(720),
  height: z.number().int().min(360).max(1920).multipleOf(2).default(1280),
  fps: z.number().int().min(1).max(30).default(15),
  approveOverrun: z.boolean().default(false),
});
export type RenderOptions = z.input<typeof renderOptionsSchema>;
export function prepareRender(input: unknown, options: RenderOptions = {}, specifications: unknown = {}, context?: ActionEvidence) {
  const settings = renderOptionsSchema.parse(options);
  // Only unknown nonempty visual-type names are adapted; all other validation remains strict.
  const candidate = z.object({ scenes: z.array(z.object({ visualType: z.string().min(1), layout: z.object({ template: z.string().min(1) }).passthrough() }).passthrough()) }).passthrough().parse(input);
  const fallbackSceneIndexes: number[] = [];
  const scenes = candidate.scenes.map((scene, index) => {
    if (!visualTypeSchema.safeParse(scene.visualType).success) {
      fallbackSceneIndexes.push(index);
      return { ...scene, visualType: "diagram", layout: { ...scene.layout, template: "diagram" } };
    }
    return scene;
  });
  const storyboard = storyboardSchema.parse({ ...candidate, scenes });
  if (storyboard.durationPolicy.classification === "requires_revision" && !settings.approveOverrun) {
    throw new Error("DURATION_APPROVAL_REQUIRED: revise the script or explicitly pass --approve-overrun.");
  }
  let from = 0;
  const frames = storyboard.scenes.map(scene => {
    // Ceiling preserves every scene's estimated duration (at most one frame extra each).
    const durationInFrames = Math.max(1, Math.ceil(scene.estimatedDurationSeconds * settings.fps));
    const result = { id: scene.id, from, durationInFrames };
    from += durationInFrames;
    return result;
  });
  const overrides = z.record(z.string().regex(/^scene-\d{3}$/), visualSceneSchema).parse(specifications);
  for (const [id, visual] of Object.entries(overrides)) {
    const scene = storyboard.scenes.find(s => s.id === id);
    if (!scene || visual.sceneId !== id) throw new Error(`VISUAL_SPEC: unknown or mismatched scene ${id}`);
    assertVisualDomain(scene, storyboard.title, visual);
    if (visual.renderer === "graph") {
      const source = actionEvidenceText(storyboard, context, visual) + " " + storyboard.title + " " + scene.narration + " " + scene.visualDirection + " " + scene.elements.map(e => e.text).join(" ");
      const backed = (evidence: string) => source.replace(/\s+/g, " ").toLowerCase().includes(evidence.replace(/\s+/g, " ").toLowerCase());
      for (const item of [...visual.graph.nodes, ...visual.graph.edges, ...visual.graph.values]) {
        if (!backed(item.evidence)) throw new Error(`VISUAL_SPEC: evidence is absent from ${id}`);
      }
      for (const n of visual.graph.nodes) {
        if (!n.evidence.toLowerCase().includes(n.label.replace(/…$/, "").toLowerCase())) throw new Error(`VISUAL_SPEC: label evidence is missing in ${id}`);
      }
      if (visual.graph.example) {
        const example = visual.graph.example;
        if (!backed(example.evidence) || !example.evidence.toLowerCase().includes(example.name.toLowerCase())) throw new Error(`VISUAL_SPEC: example name evidence is missing in ${id}`);
        for (const f of example.fields) if (!backed(f.evidence) || !f.evidence.toLowerCase().includes(f.key.toLowerCase()) || !f.evidence.includes(f.value)) throw new Error(`VISUAL_SPEC: example field evidence is missing in ${id}`);
      }
      for (const item of visual.graph.values) {
        const percentages = [...item.evidence.matchAll(/(?<![\d.-])(\d+(?:\.\d+)?)\s*%/g)].map(m => Number(m[1]));
        if (!percentages.includes(item.value)) throw new Error(`VISUAL_SPEC: percentage evidence is missing in ${id}`);
      }
    }
  }
  const visuals = storyboard.scenes.map(scene => overrides[scene.id] ?? adaptVisualScene(scene, storyboard.title));
  visuals.forEach((visual, i) => assertVisualDomain(storyboard.scenes[i], storyboard.title, visual));
  return { storyboard, visuals, settings, frames, durationInFrames: from, fallbackSceneIndexes, explicitVisualSceneIds: Object.keys(overrides) };
}
export type RenderPlan = ReturnType<typeof prepareRender>;
export type RenderScene = Storyboard["scenes"][number];
