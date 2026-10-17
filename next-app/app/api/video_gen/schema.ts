import { z } from "zod";

export const scriptRequestSchema = z.strictObject({
  topic: z.string().trim().min(1).max(500),
  targetAudience: z.string().trim().min(1).max(120).default("Beginners"),
  durationSeconds: z.number().int().min(15).max(120).default(45),
});

export const explainerScriptSchema = z.strictObject({
  title: z.string().trim().min(1).max(160),
  targetAudience: z.string().trim().min(1).max(120),
  estimatedDurationSeconds: z.number().int().min(15).max(120),
  // Array order is presentation order; timing belongs to a later block.
  scenes: z.array(z.strictObject({
    narration: z.string().trim().min(1).max(1200),
    visualDirection: z.string().trim().min(1).max(400),
  })).min(3).max(8),
});

export type ScriptRequest = z.infer<typeof scriptRequestSchema>;
export type ExplainerScript = z.infer<typeof explainerScriptSchema>;
