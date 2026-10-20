import type { ExplainerScript } from "./schema";
import { WORDS_PER_MINUTE } from "./normalize";
import { ScriptGenerationError } from "./ollama";
export const narrationWords = (text: string) => text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
export function scriptBudget(seconds: number) {
  const count = seconds <= 50 ? 3 : seconds <= 75 ? 4 : 5;
  const total = Math.floor(seconds * WORDS_PER_MINUTE / 60);
  const weights = count === 3 ? [0.25, 0.5, 0.25] : count === 4 ? [0.2, 0.3, 0.3, 0.2] : [0.15, 0.25, 0.25, 0.2, 0.15];
  const scenes = weights.map((w, i) => ({ purpose: i === 0 ? "hook" : i === count - 1 ? "takeaway" : i === count - 2 ? "concrete example" : "explanation", maxWords: Math.floor(total * w) }));
  scenes[count - 1].maxWords += total - scenes.reduce((sum, s) => sum + s.maxWords, 0);
  return { totalWords: total, scenes };
}
export function validateScriptQuality(script: ExplainerScript, seconds: number) {
  const budget = scriptBudget(seconds), counts = script.scenes.map(s => narrationWords(s.narration).length);
  const fail = (reason: string): never => { throw new ScriptGenerationError(502, "SCRIPT_QUALITY", `SCRIPT_QUALITY: ${reason} No narration was shortened. Revise the prompt or explicitly generate a new script.`); };
  if (script.scenes.length !== budget.scenes.length) fail(`Expected ${budget.scenes.length} distinct scenes for ${seconds}s.`);
  // Word-count tolerance accommodates LLM variance and natural speaking cadence
  if (counts.reduce((a, b) => a + b, 0) > budget.totalWords + Math.max(12, Math.floor(budget.totalWords * 0.35))) {
    fail(`Narration exceeds ${budget.totalWords} target words (+35% counting tolerance).`);
  }
  counts.forEach((n, i) => {
    const tolerance = Math.max(10, Math.floor(budget.scenes[i].maxWords * 0.45));
    if (n > budget.scenes[i].maxWords + tolerance) {
      fail(`Scene ${i + 1} exceeds its ${budget.scenes[i].maxWords}-word budget.`);
    }
    if (n < 4) {
      fail(`Scene ${i + 1} narration is hollow (${n} words); must provide an informative educational explanation.`);
    }
  });
  // Detect repeated substantive passages across or within scenes, ignoring punctuation/case.
  // Shared short labels and literal example values remain legal.
  const seen = new Set<string>(), sentences = new Set<string>();
  for (const scene of script.scenes) {
    for (const sentence of scene.narration.split(/[.!?。！？]+/u)) {
      const tokens = narrationWords(sentence.toLowerCase());
      if (tokens.length < 6) continue;
      const key = tokens.join(" ");
      if (sentences.has(key)) fail("Repeated narration sentence/conclusion detected.");
      sentences.add(key);
    }
    const words = narrationWords(scene.narration.toLowerCase());
    const local = new Set<string>();
    for (let i = 0; i + 16 <= words.length; i++) {
      const passage = words.slice(i, i + 16).join(" ");
      if (seen.has(passage) || local.has(passage)) fail("Repeated narration passage detected.");
      local.add(passage);
    }
    for (const passage of local) seen.add(passage);
  }
  return { budget, wordCounts: counts, totalWords: counts.reduce((a, b) => a + b, 0), factChecked: false };
}
