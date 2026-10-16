import { z } from "zod";

export const durationPolicyConfigSchema = z.strictObject({
  wordsPerMinute: z.number().finite().min(60).max(240).default(130),
  toleranceSeconds: z.number().finite().nonnegative().max(120).default(5),
  tolerancePercent: z.number().finite().nonnegative().max(100).default(20),
  revisionSeconds: z.number().finite().nonnegative().max(120).default(10),
  revisionPercent: z.number().finite().nonnegative().max(100).default(35),
}).refine(c => c.revisionSeconds >= c.toleranceSeconds && c.revisionPercent >= c.tolerancePercent, {
  message: "Revision thresholds must be at least the corresponding tolerance thresholds.",
});
export type DurationPolicyConfig = z.infer<typeof durationPolicyConfigSchema>;
export type DurationPolicyOptions = z.input<typeof durationPolicyConfigSchema>;
export const DEFAULT_DURATION_POLICY: Readonly<DurationPolicyConfig> = Object.freeze(durationPolicyConfigSchema.parse({}));

export function resolveDurationPolicy(options: DurationPolicyOptions = {}): DurationPolicyConfig {
  // Missing fields use safe defaults; invalid values fail rather than being ignored.
  return durationPolicyConfigSchema.parse(options);
}

const round = (value: number) => Math.round(value * 1000) / 1000;
function calculate(target: number, estimate: number, config: DurationPolicyConfig) {
  const overrun = Math.max(0, estimate - target);
  const tolerance = Math.max(config.toleranceSeconds, target * config.tolerancePercent / 100);
  const revision = Math.max(config.revisionSeconds, target * config.revisionPercent / 100);
  const classification = overrun <= tolerance ? "within_target" as const
    : overrun <= revision ? "soft_overrun" as const : "requires_revision" as const;
  const reason = classification === "within_target" ? null
    : classification === "soft_overrun"
      ? `Estimated narration exceeds the target by ${round(overrun)} seconds (${round(overrun / target * 100)}%). This exceeds the ${round(tolerance)}-second tolerance but not the ${round(revision)}-second revision threshold.`
      : `Estimated narration exceeds the target by ${round(overrun)} seconds (${round(overrun / target * 100)}%), above the ${round(revision)}-second revision threshold. Revise the script or explicitly approve the overrun before rendering.`;
  return { declaredTargetDurationSeconds: target, estimatedNarrationDurationSeconds: estimate,
    overrunSeconds: round(overrun), overrunPercent: round(overrun / target * 100),
    appliedToleranceSeconds: round(tolerance), revisionThresholdSeconds: round(revision),
    classification, reason, config };
}

export const durationPolicyResultSchema = z.strictObject({
  declaredTargetDurationSeconds: z.number().int().min(15).max(120),
  estimatedNarrationDurationSeconds: z.number().finite().positive(),
  overrunSeconds: z.number().finite().nonnegative(), overrunPercent: z.number().finite().nonnegative(),
  appliedToleranceSeconds: z.number().finite().nonnegative(), revisionThresholdSeconds: z.number().finite().nonnegative(),
  classification: z.enum(["within_target", "soft_overrun", "requires_revision"]),
  reason: z.string().nullable(), config: durationPolicyConfigSchema,
}).superRefine((result, ctx) => {
  const expected = calculate(result.declaredTargetDurationSeconds, result.estimatedNarrationDurationSeconds, result.config);
  for (const key of ["overrunSeconds", "overrunPercent", "appliedToleranceSeconds", "revisionThresholdSeconds", "classification", "reason"] as const) {
    if (result[key] !== expected[key]) ctx.addIssue({ code: "custom", path: [key], message: "Inconsistent duration policy result." });
  }
});
export type DurationPolicyResult = z.infer<typeof durationPolicyResultSchema>;

export function evaluateDurationPolicy(target: number, estimate: number, options: DurationPolicyOptions = {}): DurationPolicyResult {
  const config = resolveDurationPolicy(options);
  z.number().int().min(15).max(120).parse(target);
  z.number().finite().positive().parse(estimate);
  return durationPolicyResultSchema.parse(calculate(target, estimate, config));
}
