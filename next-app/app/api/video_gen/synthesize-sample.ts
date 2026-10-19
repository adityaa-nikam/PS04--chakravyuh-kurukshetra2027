import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generateSpeechWithElevenLabs, getElevenLabsConfig, isElevenLabsConfigured, ELEVENLABS_VOICES } from "./elevenlabs-service";
import { prepareTextForSpeech } from "./pronunciation";
import { runLocalTool } from "./local-narration";

const REPRESENTATIVE_TECHNICAL_SCRIPT =
  "Binary search finds elements in O(log n) time, halving the search space at each step. " +
  "Compared to linear O(n) scans, it queries sorted data like SQL indexes or parsed JSON arrays in milliseconds. " +
  "We compute mid equals low plus high rounded down, and inspect array at mid. " +
  "If target matches, we return the index; otherwise, range [0..7] -> narrowed half!";

async function main() {
  console.log("=== Astra Studio ElevenLabs Speech Synthesizer ===");

  const spokenText = prepareTextForSpeech(REPRESENTATIVE_TECHNICAL_SCRIPT);
  console.log("\n[1] Original Script:\n", REPRESENTATIVE_TECHNICAL_SCRIPT);
  console.log("\n[2] Pronunciation-Normalized Spoken Text:\n", spokenText);

  if (!isElevenLabsConfigured()) {
    console.warn("\n⚠️  ELEVENLABS_API_KEY is not set in next-app/.env or process environment.");
    try {
      getElevenLabsConfig();
    } catch (err) {
      console.error("\n" + (err instanceof Error ? err.message : String(err)));
    }
    console.log("\nTo generate live audio samples:");
    console.log("  1. Add ELEVENLABS_API_KEY=sk_... to next-app/.env");
    console.log("  2. Re-run: npx tsx app/api/video_gen/synthesize-sample.ts\n");
    return;
  }

  const config = getElevenLabsConfig();
  console.log("\n[3] ElevenLabs Configuration:");
  console.log("  Voice ID:", config.voiceId, config.voiceId === ELEVENLABS_VOICES.rachel ? "(Rachel - Default Female Narrator)" : "");
  console.log("  Model ID:", config.modelId);
  console.log("  Stability:", config.stability);
  console.log("  Similarity Boost:", config.similarityBoost);
  console.log("  Style Expressiveness:", config.style);

  const outputDir = path.resolve(process.cwd(), "artifacts/audio");
  mkdirSync(outputDir, { recursive: true });
  const outputFile = path.join(outputDir, "elevenlabs_rachel_sample.mp3");

  console.log("\n[4] Generating voiceover via official ElevenLabs REST API...");
  const result = await generateSpeechWithElevenLabs(REPRESENTATIVE_TECHNICAL_SCRIPT, outputFile, config);

  console.log("\n✓ Speech synthesized successfully!");
  console.log("  Audio Path:", result.audioPath);
  console.log("  Measured Duration:", result.durationSeconds.toFixed(2), "seconds");

  // Inspect audio stream via ffprobe
  const probe = await runLocalTool("ffprobe", [
    "-v", "error",
    "-show_entries", "stream=codec_name,sample_rate,channels,bit_rate:format=duration",
    "-of", "json",
    outputFile,
  ]);
  console.log("\n[5] FFprobe Audio Stream Metadata:\n", probe);
}

main().catch(err => {
  console.error("Execution failed:", err);
  process.exit(1);
});
