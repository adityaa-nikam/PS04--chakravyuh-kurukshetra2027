import { z } from "zod";
import { explainerScriptSchema, type ExplainerScript } from "./schema";

import { DEFAULT_DURATION_POLICY, durationPolicyResultSchema, evaluateDurationPolicy, resolveDurationPolicy, type DurationPolicyOptions } from "./duration-policy";

export const WORDS_PER_MINUTE = DEFAULT_DURATION_POLICY.wordsPerMinute;
export const warningSchema = z.strictObject({
  code: z.enum(["WHITESPACE_NORMALIZED", "MARKUP_AS_TEXT", "DURATION_MISMATCH", "DURATION_OUT_OF_RANGE"]),
  path: z.string(),
  message: z.string(),
});
export type NormalizationWarning = z.infer<typeof warningSchema>;
export const normalizedScriptSchema = z.strictObject({
  title: explainerScriptSchema.shape.title,
  targetAudience: explainerScriptSchema.shape.targetAudience,
  declaredDurationSeconds: explainerScriptSchema.shape.estimatedDurationSeconds,
  timing: z.literal("estimated_narration"),
  wordsPerMinute: z.number().min(60).max(240),
  durationPolicy: durationPolicyResultSchema,
  estimatedDurationSeconds: z.number().positive(),
  scenes: z.array(z.strictObject({
    narration: explainerScriptSchema.shape.scenes.element.shape.narration,
    visualDirection: explainerScriptSchema.shape.scenes.element.shape.visualDirection,
    wordCount: z.number().int().positive(),
    estimatedDurationSeconds: z.number().positive(),
  })).min(3).max(8),
  warnings: z.array(warningSchema),
}).superRefine((script, ctx) => {
  if (script.durationPolicy.declaredTargetDurationSeconds !== script.declaredDurationSeconds
    || script.durationPolicy.estimatedNarrationDurationSeconds !== script.estimatedDurationSeconds
    || script.durationPolicy.config.wordsPerMinute !== script.wordsPerMinute) {
    ctx.addIssue({ code: "custom", path: ["durationPolicy"], message: "Policy must match normalized timing." });
  }
});
export type NormalizedScript = z.infer<typeof normalizedScriptSchema>;
export type ValidationIssue = { path: string; message: string };
export class ScriptNormalizationError extends Error {
  readonly issues: ValidationIssue[];
  constructor(issues: ValidationIssue[]) {
    super("Script normalization failed");
    this.name = "ScriptNormalizationError";
    this.issues = issues;
  }
}

export function normalizeScript(input: ExplainerScript, options: DurationPolicyOptions = {}): NormalizedScript {
  const policyConfig = resolveDurationPolicy(options);
  const parsed = explainerScriptSchema.safeParse(input);
  if (!parsed.success) throw new ScriptNormalizationError(parsed.error.issues.map(issue => ({
    path: issue.path.join("."), message: issue.message,
  })));
  const warnings: NormalizationWarning[] = [];
  const issues: ValidationIssue[] = [];
  function text(value: string, path: string): string {
    // Reject hidden controls/bidi overrides instead of silently deleting them.
    if (Array.from(value).some(c => {
      const n = c.codePointAt(0)!;
      return (n < 32 && ![9, 10, 13].includes(n)) || (n >= 127 && n <= 159)
        || (n >= 0x202a && n <= 0x202e) || (n >= 0x2066 && n <= 0x2069);
    })) issues.push({ path, message: "Unsupported control or bidirectional formatting character." });
    const result = value.replace(/\s+/gu, " ").trim();
    if (result !== value) warnings.push({ code: "WHITESPACE_NORMALIZED", path, message: "Whitespace collapsed; text content preserved." });
    if (/<[^>]+>|javascript:/iu.test(result)) warnings.push({ code: "MARKUP_AS_TEXT", path, message: "Markup-like content retained as plain text; never execute or inject as HTML." });
    return result;
  }
  // Use original values so trimming is reported, rather than hidden by Zod transforms.
  const title = text(input.title, "title");
  const targetAudience = text(input.targetAudience, "targetAudience");
  const scenes = input.scenes.map((scene, index) => {
    const narration = text(scene.narration, `scenes.${index}.narration`);
    const visualDirection = text(scene.visualDirection, `scenes.${index}.visualDirection`);
    const wordCount = narration.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0;
    if (!wordCount) issues.push({ path: `scenes.${index}.narration`, message: "Narration must contain words or numbers." });
    return { narration, visualDirection, wordCount, estimatedDurationSeconds: Math.round(wordCount * 60 / policyConfig.wordsPerMinute * 1000) / 1000 };
  });
  if (issues.length) throw new ScriptNormalizationError(issues);
  const estimatedDurationSeconds = Math.round(scenes.reduce((sum, s) => sum + s.estimatedDurationSeconds, 0) * 1000) / 1000;
  if (estimatedDurationSeconds < 15 || estimatedDurationSeconds > 120) warnings.push({ code: "DURATION_OUT_OF_RANGE", path: "estimatedDurationSeconds", message: "Estimated narration is outside 15–120 seconds; edit the script rather than silently stretching or truncating it." });
  const durationPolicy = evaluateDurationPolicy(input.estimatedDurationSeconds, estimatedDurationSeconds, policyConfig);
  if (durationPolicy.reason) warnings.push({ code: "DURATION_MISMATCH", path: "durationPolicy", message: durationPolicy.reason });
  return normalizedScriptSchema.parse({ title, targetAudience, declaredDurationSeconds: input.estimatedDurationSeconds, timing: "estimated_narration", wordsPerMinute: policyConfig.wordsPerMinute, estimatedDurationSeconds, durationPolicy, scenes, warnings });
}
