import { durationPolicyResultSchema, type DurationPolicyOptions } from "./duration-policy";
import { z } from "zod";
import { normalizeScript, normalizedScriptSchema, warningSchema, type NormalizedScript } from "./normalize";
import { type ExplainerScript } from "./schema";

export const visualTypeSchema = z.enum(["title", "comparison", "process", "diagram", "statistic", "summary"]);
const elementSchema = z.strictObject({
  id: z.string().regex(/^scene-\d{3}-element-\d{2}$/),
  kind: z.literal("text"),
  role: z.enum(["heading", "narration", "visual_direction"]),
  text: z.string().min(1).max(1200),
  slot: z.enum(["header", "body", "footer"]),
});
export const storyboardSceneSchema = z.strictObject({
  id: z.string().regex(/^scene-\d{3}$/),
  narration: z.string().min(1).max(1200),
  visualDirection: z.string().min(1).max(400),
  estimatedDurationSeconds: z.number().positive(),
  visualType: visualTypeSchema,
  elements: z.array(elementSchema).length(3),
  layout: z.strictObject({ template: visualTypeSchema, padding: z.literal(64), gap: z.literal(24), textAlign: z.literal("left") }),
  animation: z.strictObject({ preset: z.literal("fade"), enterSeconds: z.number().positive(), exitSeconds: z.number().positive() }),
});
export const storyboardSchema = z.strictObject({
  version: z.literal(1), title: z.string().min(1).max(160), targetAudience: z.string().min(1).max(120),
  timing: z.literal("estimated_narration"), wordsPerMinute: z.number().min(60).max(240),
  durationPolicy: durationPolicyResultSchema,
  estimatedDurationSeconds: z.number().positive(),
  canvas: z.strictObject({ width: z.literal(1280), height: z.literal(720), fps: z.literal(30) }),
  scenes: z.array(storyboardSceneSchema).min(3).max(8), warnings: z.array(warningSchema),
}).superRefine((board, ctx) => {
  if (board.durationPolicy.estimatedNarrationDurationSeconds !== board.estimatedDurationSeconds
    || board.durationPolicy.config.wordsPerMinute !== board.wordsPerMinute) ctx.addIssue({ code: "custom", path: ["durationPolicy"], message: "Policy must match storyboard timing." });
  const total = board.scenes.reduce((sum, scene) => sum + scene.estimatedDurationSeconds, 0);
  if (Math.abs(total - board.estimatedDurationSeconds) > 0.001) ctx.addIssue({ code: "custom", path: ["estimatedDurationSeconds"], message: "Must equal scene duration sum." });
  board.scenes.forEach((scene, index) => {
    const id = `scene-${String(index + 1).padStart(3, "0")}`;
    if (scene.id !== id || scene.elements.some((e, i) => e.id !== `${id}-element-${String(i + 1).padStart(2, "0")}`)) ctx.addIssue({ code: "custom", path: ["scenes", index], message: "IDs must match deterministic scene/element order." });
    if (scene.layout.template !== scene.visualType || scene.animation.enterSeconds + scene.animation.exitSeconds > scene.estimatedDurationSeconds) ctx.addIssue({ code: "custom", path: ["scenes", index], message: "Layout or animation timing is inconsistent." });
  });
});
export type Storyboard = z.infer<typeof storyboardSchema>;

function selectVisualType(content: string, index: number, count: number): z.infer<typeof visualTypeSchema> {
  if (index === 0) return "title";
  if (index === count - 1) return "summary";
  if (/\b(vs\.?|versus|compare|comparison|whereas|side.by.side)\b/i.test(content)) return "comparison";
  if (/\d+(?:\.\d+)?\s*(?:%|percent\b)|\b(statistic|statistics)\b/i.test(content)) return "statistic";
  if (/\b(step|steps|first|then|next|process|sequence|cycle)\b/i.test(content)) return "process";
  return "diagram";
}

export function createStoryboard(input: NormalizedScript): Storyboard {
  const normalized = normalizedScriptSchema.parse(input);
  return storyboardSchema.parse({
    version: 1, title: normalized.title, targetAudience: normalized.targetAudience,
    timing: normalized.timing, wordsPerMinute: normalized.wordsPerMinute,
    estimatedDurationSeconds: normalized.estimatedDurationSeconds,
    durationPolicy: normalized.durationPolicy,
    canvas: { width: 1280, height: 720, fps: 30 }, warnings: normalized.warnings,
    scenes: normalized.scenes.map((scene, index) => {
      const id = `scene-${String(index + 1).padStart(3, "0")}`;
      const visualType = selectVisualType(`${scene.narration} ${scene.visualDirection}`, index, normalized.scenes.length);
      const fade = Math.min(0.3, scene.estimatedDurationSeconds / 4);
      return {
        id, narration: scene.narration, visualDirection: scene.visualDirection,
        estimatedDurationSeconds: scene.estimatedDurationSeconds, visualType,
        // Preserve source text; do not invent comparison sides, statistics, or assets.
        elements: [
          { id: `${id}-element-01`, kind: "text", role: "heading", text: index === 0 ? normalized.title : index === normalized.scenes.length - 1 ? "Takeaway" : `Scene ${index + 1}`, slot: "header" },
          { id: `${id}-element-02`, kind: "text", role: "narration", text: scene.narration, slot: "body" },
          { id: `${id}-element-03`, kind: "text", role: "visual_direction", text: scene.visualDirection, slot: "footer" },
        ],
        layout: { template: visualType, padding: 64, gap: 24, textAlign: "left" },
        animation: { preset: "fade", enterSeconds: fade, exitSeconds: fade },
      };
    }),
  });
}

export function buildStoryboard(script: ExplainerScript, options: DurationPolicyOptions = {}): Storyboard {
  return createStoryboard(normalizeScript(script, options));
}
