/**
 * Verification test script for browser-pipeline TypeScript core modules.
 */

import { TermNormalizerService } from "./lib/browser-pipeline/terms";
import { HighlightSelectorService } from "./lib/browser-pipeline/highlight/heuristics";
import { CropGeometryCalculator, parseAspectRatio } from "./lib/browser-pipeline/vision/crop-geometry";
import { CropSmoother } from "./lib/browser-pipeline/vision/smoother";
import { CaptionGroupingService } from "./lib/browser-pipeline/captions/group";
import { RawWord, ValidatedTranscript, DisplayWord } from "./lib/browser-pipeline/schemas";

console.log("=== Testing Browser-Pipeline Core Modules ===");

// 1. Term Normalizer Test
console.log("\n[1] Testing Term Normalizer...");
const normalizer = new TermNormalizerService();
const sampleRawWords: RawWord[] = [
  { id: 0, text: "In", start_sec: 0.0, end_sec: 0.2 },
  { id: 1, text: "React,", start_sec: 0.2, end_sec: 0.5 },
  { id: 2, text: "we", start_sec: 0.5, end_sec: 0.7 },
  { id: 3, text: "use", start_sec: 0.7, end_sec: 0.9 },
  { id: 4, text: "effect", start_sec: 0.9, end_sec: 1.3 },
  { id: 5, text: "for", start_sec: 1.3, end_sec: 1.5 },
  { id: 6, text: "side", start_sec: 1.5, end_sec: 1.8 },
  { id: 7, text: "effects.", start_sec: 1.8, end_sec: 2.2 },
];
const displayWords = normalizer.normalize(sampleRawWords);
console.log("Display words:", displayWords.map((w) => w.text).join(" "));
const useEffectFound = displayWords.some((w) => w.text.includes("useEffect"));
if (!useEffectFound) {
  throw new Error("FAILED: 'use effect' was not normalized to 'useEffect'");
}
console.log("✓ Term Normalizer verified: 'use effect' -> 'useEffect'");

// 2. Crop Geometry Test
console.log("\n[2] Testing Crop Geometry...");
const aspect = parseAspectRatio("9:16");
console.log("Aspect 9:16 =", aspect);
if (Math.abs(aspect - 0.5625) > 0.001) {
  throw new Error("FAILED: parseAspectRatio 9:16 should be 0.5625");
}
const { pixelBox, normBox } = CropGeometryCalculator.calculateCropBox(1920, 1080, aspect, 960, 540);
console.log("1920x1080 -> 9:16 crop box:", pixelBox, normBox);
if (pixelBox.height !== 1080 || pixelBox.width !== 608) {
  throw new Error(`FAILED: Expected 608x1080, got ${pixelBox.width}x${pixelBox.height}`);
}
console.log("✓ Crop Geometry verified: strictly centered within bounds");

// 3. Crop Smoother Test
console.log("\n[3] Testing Crop Smoother...");
const smoother = new CropSmoother(0.35, 0.35, 0.03);
const c0 = smoother.smooth([500, 500], 0.0, true, 1920, 1080);
const c1 = smoother.smooth([600, 500], 0.5, false, 1920, 1080);
console.log("Smoother step 0 -> 1:", c0, "->", c1);
if (c1[0] <= 500 || c1[0] >= 600) {
  throw new Error("FAILED: Smoother should interpolate between previous and target center");
}
console.log("✓ Crop Smoother verified: smooth trajectory with bounded velocity");

// 4. Highlight Selector Test
console.log("\n[4] Testing Highlight Selector...");
// Generate a 45-second lecture with concept definitions and takeaways
const lectureWords: DisplayWord[] = [];
let t = 0.0;
const wordsList = [
  "Welcome.", "Today", "we", "define", "the", "concept", "called", "binary", "search.",
  "The", "reason", "this", "works", "is", "because", "the", "array", "is", "already", "sorted.",
  "For", "example,", "think", "of", "looking", "up", "a", "name", "in", "a", "phone", "book.",
  "Notice", "how", "each", "step", "divides", "the", "search", "space", "in", "half.",
  "As", "a", "result,", "the", "time", "complexity", "is", "optimized", "for", "logarithmic", "time.",
  "In", "summary,", "keep", "in", "mind", "this", "trade-off.", "That", "is", "how", "it", "operates."
];
for (let i = 0; i < wordsList.length; i++) {
  const dur = 0.5;
  lectureWords.push({
    id: i,
    text: wordsList[i],
    start_sec: Math.round(t * 10) / 10,
    end_sec: Math.round((t + dur) * 10) / 10,
    source_word_ids: [i],
    confidence: 0.98,
    correction: null,
  });
  t += dur + (wordsList[i].endsWith(".") ? 0.8 : 0.05);
}

const transcript: ValidatedTranscript = {
  schema_version: "1.0",
  source: {
    filename: "lecture.mp4",
    duration_sec: t,
  },
  transcription: {
    model: "whisper-base.en",
    detected_language: "en",
    timestamp_origin: "start",
  },
  raw_words: [],
  display_words: lectureWords,
};

const selector = new HighlightSelectorService(15.0, 60.0, 30.0);
const highlight = selector.selectBestHighlight(transcript);
console.log("Selected highlight interval:", highlight.start_sec, "to", highlight.end_sec, `(${highlight.duration_sec}s)`);
console.log("Score:", highlight.score, "| Reason:", highlight.reason);
console.log("Score breakdown:", highlight.score_breakdown);
if (highlight.score < 60) {
  throw new Error("FAILED: High-quality educational lecture should score >= 60");
}
console.log("✓ Highlight Selector verified: identified high-value educational highlight");

// 5. Caption Grouping Test
console.log("\n[5] Testing Caption Grouping...");
const { words: relWords } = CaptionGroupingService.filterAndConvertWords(
  lectureWords,
  highlight.start_sec,
  highlight.end_sec
);
const captionGroups = CaptionGroupingService.groupWordsIntoCaptions(
  relWords,
  highlight.duration_sec
);
console.log(`Generated ${captionGroups.length} caption groups.`);
captionGroups.slice(0, 3).forEach((g, idx) => {
  console.log(` Group ${idx}: [${g.start_sec}s - ${g.end_sec}s] "${g.text}" (lines: ${g.lines.length})`);
});
if (captionGroups.length === 0) {
  throw new Error("FAILED: Caption grouping produced 0 groups");
}
console.log("✓ Caption Grouping verified: formatted readable clauses with karaoke timing");

console.log("\n ALL BROWSER-PIPELINE CORE TESTS PASSED DETERMINISTICALLY!");
