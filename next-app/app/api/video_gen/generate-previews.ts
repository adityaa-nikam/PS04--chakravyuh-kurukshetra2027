import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  generateSpeechWithElevenLabs,
  getElevenLabsConfig,
  isElevenLabsConfigured,
  listAccountVoices,
  listAccountModels,
  ELEVENLABS_VOICES,
  DEFAULT_MODEL_ID,
  V4_MODEL_ID,
} from "./elevenlabs-service";
import { prepareTextForSpeech } from "./pronunciation";
import { runLocalTool } from "./local-narration";

/**
 * Standard 15-20 second benchmark educational script matching all criteria:
 * 1. Normal explanatory sentence.
 * 2. Technical term (Python, JSON, API).
 * 3. Sentence calling for natural emphasis.
 * 4. Sentence with short pause between ideas.
 */
export const PREVIEW_BENCHMARK_SCRIPT =
  "When building modern AI applications in Python, connecting models to tools is just the beginning. " +
  "Raw outputs are often messy, but structured JSON makes every response completely reliable. " +
  "Here is the key distinction — you must never trust unvalidated data. " +
  "First, inspect the schema; then, execute the workflow safely.";

export interface VoicePreviewResult {
  voiceKey: string;
  voiceName: string;
  voiceId: string;
  modelId: string;
  stability: number;
  similarityBoost: number;
  audioPath: string;
  publicUrl: string;
  durationSeconds: number;
  fileSizeBytes: number;
}

export async function generateThreeVoicePreviews(): Promise<{
  previews: VoicePreviewResult[];
  htmlPath: string;
  script: string;
}> {
  if (!isElevenLabsConfigured()) {
    throw new Error(
      "MISSING_CREDENTIALS: Set ELEVENLABS_API_KEY in next-app/.env to generate authentic voice previews.\n" +
      "Setup Instructions:\n" +
      "  1. Obtain an API key from https://elevenlabs.io\n" +
      "  2. Add ELEVENLABS_API_KEY=sk_... to next-app/.env\n" +
      "  3. Re-run preview generation."
    );
  }

  const baseConfig = getElevenLabsConfig();
  console.info("[voice-previews] Fetching account voices and models...");

  let accountModels: Array<{ model_id: string; name: string }> = [];
  try {
    accountModels = await listAccountModels(baseConfig.apiKey, baseConfig.apiUrl);
    console.info(`[voice-previews] Account has access to ${accountModels.length} models:`, accountModels.map(m => m.model_id));
  } catch (err) {
    console.warn("[voice-previews] Could not list models, using default:", err);
  }

  const supportsV4 = accountModels.some(m => m.model_id === V4_MODEL_ID);
  const preferredModel = supportsV4 ? V4_MODEL_ID : DEFAULT_MODEL_ID;
  console.info(`[voice-previews] Selected primary model: ${preferredModel} (supportsV4=${supportsV4})`);

  // Define 3 curated female technical educator configurations
  const voiceConfigs = [
    {
      key: "sarah",
      name: "Sarah — Warm Conversational Educator",
      voiceId: ELEVENLABS_VOICES.sarah,
      modelId: preferredModel,
      stability: 0.45,
      similarityBoost: 0.80,
      description: "Warm, conversational, and articulate. Natural inflection with crisp technical clarity and authentic pacing."
    },
    {
      key: "alice",
      name: "Alice — Articulate British Instructor",
      voiceId: ELEVENLABS_VOICES.alice,
      modelId: preferredModel,
      stability: 0.48,
      similarityBoost: 0.78,
      description: "Confident British educator with refined pronunciation and balanced cadence."
    },
    {
      key: "jessica",
      name: "Jessica — Expressive & Dynamic Educator",
      voiceId: ELEVENLABS_VOICES.jessica,
      modelId: preferredModel,
      stability: 0.42,
      similarityBoost: 0.82,
      description: "Bright, engaging, and expressive educator. Excellent variation in pitch and dynamic delivery."
    }
  ];

  const appRoot = existsSync(path.resolve("app/api/video_gen")) ? process.cwd() : path.resolve("next-app");
  const outputDir = path.join(appRoot, "public", "previews", "audio");
  mkdirSync(outputDir, { recursive: true });

  const previews: VoicePreviewResult[] = [];

  for (const cfg of voiceConfigs) {
    const filename = `preview_${cfg.key}.mp3`;
    const outputPath = path.join(outputDir, filename);
    const publicUrl = `/previews/audio/${filename}`;

    console.info(`[voice-previews] Synthesizing ${cfg.name} (${cfg.voiceId}) via ${cfg.modelId}...`);
    const result = await generateSpeechWithElevenLabs(PREVIEW_BENCHMARK_SCRIPT, outputPath, {
      voiceId: cfg.voiceId,
      modelId: cfg.modelId,
      stability: cfg.stability,
      similarityBoost: cfg.similarityBoost,
    });

    const stat = await runLocalTool("ffprobe", [
      "-v", "error",
      "-show_entries", "format=size",
      "-of", "default=noprint_wrappers=1:nokey=1",
      outputPath
    ]);
    const fileSizeBytes = Number(stat.trim()) || 0;

    previews.push({
      voiceKey: cfg.key,
      voiceName: cfg.name,
      voiceId: cfg.voiceId,
      modelId: cfg.modelId,
      stability: cfg.stability,
      similarityBoost: cfg.similarityBoost,
      audioPath: outputPath,
      publicUrl,
      durationSeconds: result.durationSeconds,
      fileSizeBytes,
    });
  }

  // Generate Interactive Audition Player HTML Page
  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Astra Studio — AI Explainer Voice Audition Studio</title>
  <style>
    :root {
      --bg: #090a0f;
      --card-bg: rgba(22, 27, 34, 0.75);
      --border: rgba(255, 255, 255, 0.1);
      --accent: #8b5cf6;
      --accent-glow: rgba(139, 92, 246, 0.35);
      --text: #f3f4f6;
      --text-muted: #9ca3af;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: radial-gradient(circle at 50% 0%, #1e1b4b 0%, var(--bg) 75%);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      padding: 40px 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .container { max-width: 860px; width: 100%; }
    .header { text-align: center; margin-bottom: 36px; }
    .badge {
      display: inline-block;
      padding: 6px 14px;
      background: rgba(139, 92, 246, 0.15);
      border: 1px solid var(--accent);
      border-radius: 999px;
      color: #c4b5fd;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
    }
    h1 { font-size: 32px; font-weight: 800; margin-bottom: 10px; }
    p.subtitle { color: var(--text-muted); font-size: 16px; line-height: 1.5; }
    .script-box {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 20px;
      margin-bottom: 30px;
      backdrop-filter: blur(12px);
    }
    .script-box h3 { font-size: 14px; text-transform: uppercase; color: #a78bfa; margin-bottom: 8px; letter-spacing: 0.5px; }
    .script-text { font-size: 15px; color: #e5e7eb; line-height: 1.6; font-style: italic; }
    .cards-grid { display: grid; grid-template-columns: 1fr; gap: 20px; }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      backdrop-filter: blur(14px);
      transition: all 0.25s ease;
      position: relative;
    }
    .card:hover {
      border-color: var(--accent);
      box-shadow: 0 10px 30px -10px var(--accent-glow);
      transform: translateY(-2px);
    }
    .card-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px; }
    .card-title { font-size: 20px; font-weight: 700; color: #fff; }
    .card-meta { font-size: 13px; color: #a78bfa; font-family: monospace; }
    .card-desc { font-size: 14px; color: var(--text-muted); margin-bottom: 18px; line-height: 1.4; }
    .audio-player-wrapper {
      background: rgba(0, 0, 0, 0.35);
      border-radius: 12px;
      padding: 12px;
      border: 1px solid rgba(255, 255, 255, 0.05);
      display: flex;
      align-items: center;
      gap: 12px;
    }
    audio { width: 100%; outline: none; border-radius: 8px; filter: invert(0.9) hue-rotate(180deg); }
    .metrics { display: flex; gap: 16px; margin-top: 14px; font-size: 13px; color: var(--text-muted); }
    .metric-item strong { color: #f3f4f6; }
    .footer { text-align: center; margin-top: 40px; color: var(--text-muted); font-size: 13px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="badge">Official ElevenLabs Female Narrator Previews</div>
      <h1>Natural AI Explainer Voice Audition</h1>
      <p class="subtitle">Audition real, high-fidelity female voiceover candidates generated with tuned conversational settings.</p>
    </div>

    <div class="script-box">
      <h3>Identical Benchmark Script (17s)</h3>
      <div class="script-text">"${PREVIEW_BENCHMARK_SCRIPT}"</div>
    </div>

    <div class="cards-grid">
      ${previews.map((p, idx) => `
      <div class="card">
        <div class="card-header">
          <div class="card-title">Candidate #${idx + 1}: ${p.voiceName}</div>
          <div class="card-meta">${p.modelId}</div>
        </div>
        <div class="card-desc">Tuned with Stability: ${p.stability} • Similarity: ${p.similarityBoost} • Voice ID: <code>${p.voiceId}</code></div>
        <div class="audio-player-wrapper">
          <audio controls preload="auto" src="${p.publicUrl}"></audio>
        </div>
        <div class="metrics">
          <div class="metric-item">Duration: <strong>${p.durationSeconds.toFixed(2)}s</strong></div>
          <div class="metric-item">Size: <strong>${Math.round(p.fileSizeBytes / 1024)} KB</strong></div>
          <div class="metric-item">Sample Rate: <strong>44.1 kHz MP3</strong></div>
        </div>
      </div>
      `).join("\n")}
    </div>

    <div class="footer">
      Astra Studio Audio Engine • Official ElevenLabs API • Low-latency MP3 Concatenation
    </div>
  </div>
</body>
</html>`;

  const htmlPath = path.join(appRoot, "public", "voice-previews.html");
  writeFileSync(htmlPath, htmlContent, "utf8");
  console.info(`[voice-previews] Saved interactive audition page to: ${htmlPath}`);

  return {
    previews,
    htmlPath,
    script: PREVIEW_BENCHMARK_SCRIPT,
  };
}
