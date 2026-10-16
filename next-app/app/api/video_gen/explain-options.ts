import { z } from "zod";
import { scriptRequestSchema } from "./schema";
import { renderOptionsSchema } from "./render-plan";

export const explainOptionsSchema = z.strictObject({
  prompt: scriptRequestSchema.shape.topic.optional(),
  audience: scriptRequestSchema.shape.targetAudience.unwrap().optional(),
  duration: scriptRequestSchema.shape.durationSeconds.unwrap().optional(),
  output: z.string().min(1).optional(),
  resume: z.string().min(1).optional(),
  visuals: z.string().min(1).optional(),
  browser: z.string().min(1).optional(),
  approveOverrun: z.boolean().default(false),
  visualActions: z.boolean().optional(),
  inspect: z.boolean().default(false), replan: z.boolean().default(false),
  width: renderOptionsSchema.shape.width.unwrap().optional(), height: renderOptionsSchema.shape.height.unwrap().optional(), fps: renderOptionsSchema.shape.fps.unwrap().optional(),
}).superRefine((o, ctx) => {
  if (Boolean(o.prompt) === Boolean(o.resume)) ctx.addIssue({ code: "custom", message: "Supply a prompt OR --resume request.json." });
  if (o.replan && !o.resume) ctx.addIssue({ code: "custom", message: "--replan requires --resume; it only regenerates visuals for the saved script." });
  if (o.resume && (o.audience !== undefined || o.duration !== undefined)) ctx.addIssue({ code: "custom", message: "Resume preserves the saved audience/duration. Use a new prompt to revise them." });
});
export type ExplainOptions = z.input<typeof explainOptionsSchema>;
export function parseExplainArgs(args: string[]) {
  const options: Record<string, unknown> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (["--approve-overrun", "--inspect", "--replan", "--visual-actions"].includes(arg)) {
      options[arg === "--approve-overrun" ? "approveOverrun" : arg === "--visual-actions" ? "visualActions" : arg.slice(2)] = true; continue;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (!["audience", "duration", "output", "resume", "visuals", "browser", "width", "height", "fps"].includes(key) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Unknown or incomplete option: ${arg}`);
      if (key in options) throw new Error(`Duplicate option: ${arg}`);
      const value = args[++i]; options[key] = ["duration", "width", "height", "fps"].includes(key) ? Number(value) : value;
    } else {
      if (options.prompt) throw new Error("Quote the complete natural-language prompt as one argument.");
      options.prompt = arg;
    }
  }
  return explainOptionsSchema.parse(options);
}
