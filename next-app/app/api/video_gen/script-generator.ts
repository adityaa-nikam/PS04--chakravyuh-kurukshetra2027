import { generateJson } from "./inference";
import { z } from "zod";
import { getExplainerScriptFixture } from "./fixture";
import { explainerScriptSchema, scriptRequestSchema, type ExplainerScript } from "./schema";
import { ScriptGenerationError, type InferenceContext } from "./ollama";
import { scriptBudget, validateScriptQuality, narrationWords } from "./script-quality";
export { ScriptGenerationError } from "./ollama";

export async function generateExplainerScript(input: unknown, options: { live?: boolean; visualPlanning?: boolean; onDiagnostic?: InferenceContext["onDiagnostic"] } = {}): Promise<ExplainerScript> {
  const request = scriptRequestSchema.safeParse(input);
  if (!request.success) throw new ScriptGenerationError(400, "INVALID_INPUT", "Provide a topic (1–500 characters), optional targetAudience (1–120 characters), and optional durationSeconds (integer, 15–120). No other fields are accepted.");
  if (!options.live && process.env.NODE_ENV === "development" && process.env.VIDEO_GEN_USE_FIXTURE === "true") {
    console.info("[video_gen] fixture mode: returning deterministic JSON vs XML sample; no provider call.");
    return getExplainerScriptFixture();
  }
  const started = Date.now();
  const budget = scriptBudget(request.data.durationSeconds);
  const outputSchema = explainerScriptSchema.extend({ estimatedDurationSeconds: z.literal(request.data.durationSeconds), scenes: explainerScriptSchema.shape.scenes.length(budget.scenes.length) });
  let script: ExplainerScript;
  let quality: unknown;
  const systemPrompt = "Write an accurate, human-sounding educational explainer script in JSON. " +
    "Deliver narration conversationally and warmly, exactly like an experienced female educator explaining a concept naturally one-on-one. " +
    "Requirements for human-like speech: " +
    "1. Varied sentence lengths — mix short, punchy insights with natural flowing explanations. " +
    "2. Natural pacing — use natural punctuation (commas, em-dashes, and pauses) so speech has rhythm and breathing room. " +
    "3. No repetitive robotic intros or textbook jargon — explain ideas with intuitive analogies, relatable context, and clear contrast. " +
    "4. Smooth transitions — connect ideas seamlessly between scenes ('Now here's where it gets interesting...', 'Think of it this way...'). " +
    "5. For Scene 1 (the hook), write an engaging question or hook of 12-20 words introducing the core problem. " +
    `CRITICAL DURATION TARGET: The requested duration is strictly ${request.data.durationSeconds} seconds. Aim for approximately ${budget.totalWords} total spoken words across the ${budget.scenes.length} scenes (at 130 words per minute). ` +
    `Scene word targets: ${budget.scenes.map((s, idx) => `Scene ${idx + 1} (${s.purpose}): target ~${s.maxWords} words`).join(", ")}. ` +
    "Do NOT write rushed 2-word sentences or hollow summaries. Fully explain the architecture, mechanisms, and concrete examples to satisfy the requested duration. " +
    "Each scene has a distinct purpose: hook, explanation, concrete example, takeaway. Never repeat paragraphs, conclusions, or explanations across scenes. Develop the explanation progressively. Use a concrete example when requested; clearly identify invented illustrative values as examples, never user-provided or measured facts. Aim for the requested duration at 130 spoken words per minute. Use concise plain-language visual directions, not executable code or HTML. Return only the script matching the supplied JSON schema. " +
    (options.visualPlanning ? "The estimatedDurationSeconds field must equal the requested durationSeconds. Your narration is the factual source for a later visual planner: explicitly name all components and directional relationships. For comparisons, explain a small concrete example. If comparing representations of data, state the same literal record (root name, short field names and values) in the narration, and name both formats; reuse it throughout. Distinguish illustrative example values from measured statistics. Do not invent measurements or claim factual verification." : "");

  try {
    const inputPayload = {
      ...request.data,
      narrationBudget: {
        totalTargetWords: budget.totalWords,
        scenes: budget.scenes.map((s, idx) => ({
          sceneNumber: idx + 1,
          purpose: s.purpose,
          targetWordCount: s.maxWords,
          minimumWordCount: Math.max(10, Math.floor(s.maxWords * 0.7)),
          guideline: idx === 0 
            ? "MUST write an engaging question or puzzle of at least 12-20 words setting up the topic. Never output a 2-4 word greeting or title."
            : idx === budget.scenes.length - 1
            ? "MUST write a clear, actionable educational takeaway of 15-25 words."
            : "MUST provide a thorough, informative explanation of 30-45 words detailing mechanisms and components.",
        })),
      },
    };

    script = await generateJson(outputSchema, inputPayload, systemPrompt, Math.min(2048, 384 + budget.totalWords * 5), { stage: "script", onDiagnostic: options.onDiagnostic });

    // Cleanly fit slightly wordy scenes at natural sentence boundaries without chopping mid-thought
    for (let i = 0; i < script.scenes.length; i++) {
      const targetMax = budget.scenes[i]?.maxWords ?? 25;
      const words = narrationWords(script.scenes[i].narration);
      const maxThreshold = targetMax + Math.max(10, Math.floor(targetMax * 0.45));
      if (words.length > maxThreshold && words.length <= targetMax * 2) {
        const sentences = script.scenes[i].narration.match(/[^.!?]+[.!?]+/g);
        if (sentences && sentences.length > 1) {
          let fitted = "";
          for (const s of sentences) {
            const next = (fitted + " " + s).trim();
            if (narrationWords(next).length <= maxThreshold) fitted = next;
            else break;
          }
          if (fitted.length > 0) {
            console.info(`[video_gen] Fitted scene ${i + 1} at sentence boundary (${narrationWords(fitted).length} words).`);
            script.scenes[i].narration = fitted;
          }
        }
      }
    }

    quality = validateScriptQuality(script, request.data.durationSeconds);
  } catch (error) {
    console.error("[video_gen] script_validation_failed", { stage: "script", reason: "SCRIPT_QUALITY", detail: error instanceof Error ? error.message : String(error), elapsedMs: Date.now() - started });
    throw error;
  }

  console.info("[video_gen] script_quality", quality);
  console.info("[video_gen] script_generation_success", { elapsedMs: Date.now() - started, scenes: script!.scenes.length });
  return script!;
}
