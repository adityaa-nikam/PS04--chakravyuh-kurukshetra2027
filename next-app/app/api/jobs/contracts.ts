import { z } from "zod";
import { scriptRequestSchema } from "../video_gen/schema";
export const jobInputSchema = scriptRequestSchema.extend({ visualActions: z.boolean().default(false), orientation: z.enum(["portrait", "landscape"]).default("portrait") });
export type JobInput = z.infer<typeof jobInputSchema>;
export const jobIdSchema = z.string().uuid();
export const resumeInputSchema = z.strictObject({ approveOverrun: z.boolean().default(false) });
export type JobStatus = "queued" | "script_generation" | "visual_planning" | "rendering" | "completed" | "failed";
export type PublicJob = { id: string; status: JobStatus; createdAt: string; updatedAt: string; message: string; code?: string; recoverable: boolean; script?: { title: string; scenes: { narration: string; visualDirection: string }[] }; durationSeconds?: number; downloadUrl?: string };
