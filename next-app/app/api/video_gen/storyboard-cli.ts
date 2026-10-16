import { readFileSync } from "node:fs";
import { createStoryboard } from "./storyboard";
import { explainerScriptSchema, type ExplainerScript } from "./schema";
import { normalizeScript, ScriptNormalizationError } from "./normalize";
import { resolveDurationPolicy } from "./duration-policy";

try {
  const [file, ...args] = process.argv.slice(2);
  if (!file) throw new Error("Usage: npm run storyboard -- script.json [--inspect] [--policy policy.json]");
  let inspect = false;
  let config = resolveDurationPolicy();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--inspect") inspect = true;
    else if (args[i] === "--policy" && args[i + 1]) config = resolveDurationPolicy(JSON.parse(readFileSync(args[++i], "utf8")));
    else throw new Error("Unknown or incomplete CLI option.");
  }
  const input: unknown = JSON.parse(readFileSync(file, "utf8"));
  explainerScriptSchema.parse(input);
  // Keep original whitespace so normalization can report changes.
  const normalized = normalizeScript(input as ExplainerScript, config);
  const storyboard = createStoryboard(normalized);
  console.log(JSON.stringify(inspect ? { normalized, storyboard } : storyboard, null, 2));
} catch (error) {
  console.error(error instanceof ScriptNormalizationError ? error.issues : error instanceof Error ? error.message : "Storyboard generation failed");
  process.exitCode = 1;
}
