import { loadCliEnvironment } from "./cli-environment";
import { generateThreeVoicePreviews } from "./generate-previews";

async function main() {
  loadCliEnvironment();
  console.log("=== Generating 3 Real ElevenLabs Female Voice Previews ===");
  const result = await generateThreeVoicePreviews();
  console.log("\n✓ All 3 Previews Generated Successfully!");
  for (const [i, p] of result.previews.entries()) {
    console.log(`\nCandidate #${i + 1}: ${p.voiceName}`);
    console.log(`  Voice ID: ${p.voiceId}`);
    console.log(`  Model: ${p.modelId}`);
    console.log(`  Path: ${p.audioPath}`);
    console.log(`  Public URL: http://localhost:3000${p.publicUrl}`);
    console.log(`  Duration: ${p.durationSeconds.toFixed(2)}s (${Math.round(p.fileSizeBytes / 1024)} KB)`);
  }
  console.log(`\nInteractive Audition Player: http://localhost:3000/voice-previews.html`);
  console.log(`HTML File: ${result.htmlPath}`);
}

main().catch(err => {
  console.error("\n❌ Preview Generation Blocked:");
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
