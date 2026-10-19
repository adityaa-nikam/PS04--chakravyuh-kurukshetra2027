import { writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { prepareTextForSpeech } from "./pronunciation";
import { runLocalTool } from "./local-narration";

// Verified pre-made female voices available on ElevenLabs accounts
export const ELEVENLABS_VOICES = {
  sarah: "EXAVITQu4vr4xnSDxMaL",  // Soft, conversational, articulate, news/explainer (Default)
  alice: "Xb7hH8MSUJpSbSDYk0k2",  // Confident, engaging British female educator
  jessica: "cgSgspJ2msm6clMCkdW9",// Playful, bright, warm conversational educator
  laura: "FGY2WhTYpPnrIDTdsKH5",  // Enthusiastic, crisp, upbeat tech creator
  bella: "hpp4J3VqNfWAUOO0d1Us",  // Professional, bright, informative educator
  lily: "pFZP5JQG7iQjIQuC4Bku",   // Warm, velvety British narrator
  rachel: "21m00Tcm4TlvDq8ikWAM", // Library voice (requires subscription)
} as const;

export const DEFAULT_FEMALE_VOICE_ID = ELEVENLABS_VOICES.sarah;
export const DEFAULT_MODEL_ID = "eleven_v4";
export const V4_MODEL_ID = "eleven_v4";
export const MULTILINGUAL_MODEL_ID = "eleven_multilingual_v2";
export const FAST_MODEL_ID = "eleven_turbo_v2_5";

export interface ElevenLabsConfig {
  apiKey: string;
  voiceId: string;
  modelId: string;
  apiUrl: string;
  stability: number;
  similarityBoost: number;
  style: number;
  useSpeakerBoost: boolean;
}

export interface ElevenLabsSynthesizeResult {
  audioPath: string;
  durationSeconds: number;
  voiceId: string;
  modelId: string;
  spokenText: string;
}

/**
 * Checks if ElevenLabs API key is present in environment without throwing.
 */
export function isElevenLabsConfigured(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_API_KEY.trim().length > 0);
}

/**
 * Lists available models on the account.
 */
export async function listAccountModels(apiKey?: string, apiUrl = "https://api.elevenlabs.io/v1") {
  const key = apiKey || process.env.ELEVENLABS_API_KEY?.trim();
  if (!key) throw new Error("ELEVENLABS_API_KEY required to list models.");
  const res = await fetch(`${apiUrl.replace(/\/+$/, "")}/models`, {
    headers: { "xi-api-key": key }
  });
  if (!res.ok) throw new Error(`ELEVENLABS_LIST_MODELS_FAILED [HTTP ${res.status}]: ${await res.text()}`);
  const data = await res.json();
  return data as Array<{ model_id: string; name: string; description?: string; can_do_text_to_speech?: boolean }>;
}

/**
 * Lists available voices on the account.
 */
export async function listAccountVoices(apiKey?: string, apiUrl = "https://api.elevenlabs.io/v1") {
  const key = apiKey || process.env.ELEVENLABS_API_KEY?.trim();
  if (!key) throw new Error("ELEVENLABS_API_KEY required to list voices.");
  const res = await fetch(`${apiUrl.replace(/\/+$/, "")}/voices`, {
    headers: { "xi-api-key": key }
  });
  if (!res.ok) throw new Error(`ELEVENLABS_LIST_VOICES_FAILED [HTTP ${res.status}]: ${await res.text()}`);
  const data = await res.json();
  return (data.voices || []) as Array<{ voice_id: string; name: string; labels?: Record<string, string>; preview_url?: string; category?: string }>;
}

/**
 * Validates and retrieves server-side ElevenLabs configuration.
 * Throws a clear setup error if credentials are missing.
 */
export function getElevenLabsConfig(): ElevenLabsConfig {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "MISSING_CREDENTIALS: Set ELEVENLABS_API_KEY in your .env or server environment to enable natural female AI narration.\n" +
      "Setup Instructions:\n" +
      "  1. Obtain an API key from https://elevenlabs.io\n" +
      "  2. Add ELEVENLABS_API_KEY=sk_... to next-app/.env\n" +
      "  3. (Optional) Set ELEVENLABS_VOICE_ID (defaults to Rachel: 21m00Tcm4TlvDq8ikWAM)\n" +
      "  4. (Optional) Set ELEVENLABS_MODEL_ID (defaults to eleven_multilingual_v2)"
    );
  }

  // Voice ID can be named preset ('rachel', 'sarah', 'alice', 'lily') or an explicit ElevenLabs voice UUID
  const rawVoice = process.env.ELEVENLABS_VOICE_ID?.trim() || DEFAULT_FEMALE_VOICE_ID;
  const voiceId = Object.hasOwn(ELEVENLABS_VOICES, rawVoice.toLowerCase())
    ? ELEVENLABS_VOICES[rawVoice.toLowerCase() as keyof typeof ELEVENLABS_VOICES]
    : rawVoice;

  const modelId = process.env.ELEVENLABS_MODEL_ID?.trim() || DEFAULT_MODEL_ID;
  const apiUrl = process.env.ELEVENLABS_API_URL?.trim() || "https://api.elevenlabs.io/v1";

  const isV4 = modelId.includes("v4") || modelId.includes("eleven_v4");
  const defaultStability = isV4 ? 0.45 : 0.50;
  const defaultSimilarity = isV4 ? 0.80 : 0.75;

  const stability = Math.max(0, Math.min(1, Number(process.env.ELEVENLABS_STABILITY ?? defaultStability)));
  const similarityBoost = Math.max(0, Math.min(1, Number(process.env.ELEVENLABS_SIMILARITY_BOOST ?? defaultSimilarity)));
  const style = Math.max(0, Math.min(1, Number(process.env.ELEVENLABS_STYLE ?? (isV4 ? 0 : 0.15))));
  const useSpeakerBoost = process.env.ELEVENLABS_SPEAKER_BOOST !== "false";

  return {
    apiKey,
    voiceId,
    modelId,
    apiUrl,
    stability,
    similarityBoost,
    style,
    useSpeakerBoost,
  };
}

/**
 * Breaks long narration into sentence-aligned segments if exceeding chunk limit.
 */
export function chunkTextBySentences(text: string, maxChunkLength = 1200): string[] {
  if (text.length <= maxChunkLength) return [text];

  const sentences = text.match(/[^.!?]+[.!?]?(?:\s+|$)/g) || [text];
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if ((current + sentence).length > maxChunkLength && current.trim().length > 0) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }

  if (current.trim().length > 0) {
    chunks.push(current.trim());
  }

  return chunks;
}

/**
 * Synthesizes a single chunk using ElevenLabs REST API.
 */
async function fetchSpeechAudio(
  text: string,
  config: ElevenLabsConfig,
  timeoutMs = 45_000
): Promise<Buffer> {
  const endpoint = `${config.apiUrl.replace(/\/+$/, "")}/text-to-speech/${encodeURIComponent(config.voiceId)}?output_format=mp3_44100_128`;

  const isV4 = config.modelId.includes("v4") || config.modelId.includes("eleven_v4");
  const voice_settings: Record<string, unknown> = {
    stability: config.stability,
    similarity_boost: config.similarityBoost,
  };
  if (!isV4) {
    if (config.style > 0) voice_settings.style = config.style;
    voice_settings.use_speaker_boost = config.useSpeakerBoost;
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "xi-api-key": config.apiKey,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: config.modelId,
        voice_settings,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error(`ELEVENLABS_TIMEOUT: Request timed out after ${timeoutMs}ms.`);
    }
    throw new Error(`ELEVENLABS_NETWORK_ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!response.ok) {
    let errorDetail = "";
    try {
      const errJson = await response.json();
      errorDetail = errJson?.detail?.message || JSON.stringify(errJson);
    } catch {
      errorDetail = await response.text();
    }

    if (response.status === 401) {
      throw new Error(`ELEVENLABS_UNAUTHORIZED: Authentication failed. Please check ELEVENLABS_API_KEY. Details: ${errorDetail}`);
    }
    if (response.status === 404) {
      throw new Error(`ELEVENLABS_VOICE_NOT_FOUND: Voice ID '${config.voiceId}' was not found. Please verify ELEVENLABS_VOICE_ID. Details: ${errorDetail}`);
    }
    if (response.status === 429) {
      throw new Error(`ELEVENLABS_RATE_LIMIT: Rate limit or character quota exceeded on your account. Details: ${errorDetail}`);
    }

    throw new Error(`ELEVENLABS_API_ERROR [HTTP ${response.status}]: ${errorDetail}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Synthesizes validated narration text into high-quality, expressive female speech.
 * Automatically prepares technical terms, handles chunking, measures duration,
 * and saves audio to outputPath.
 */
export async function generateSpeechWithElevenLabs(
  rawNarration: string,
  outputPath: string,
  customConfig?: Partial<ElevenLabsConfig>
): Promise<ElevenLabsSynthesizeResult> {
  const baseConfig = getElevenLabsConfig();
  const config: ElevenLabsConfig = { ...baseConfig, ...customConfig };

  const spokenText = prepareTextForSpeech(rawNarration);
  if (!spokenText.trim()) {
    throw new Error("ELEVENLABS_EMPTY_TEXT: Spoken narration text is empty after normalization.");
  }

  mkdirSync(path.dirname(outputPath), { recursive: true });

  const chunks = chunkTextBySentences(spokenText, 1200);

  if (chunks.length === 1) {
    // Single chunk synthesis (standard for explainer scenes)
    const audioBuffer = await fetchSpeechAudio(chunks[0], config);
    writeFileSync(outputPath, audioBuffer);
  } else {
    // Multi-chunk synthesis: synthesize sub-chunks and concatenate cleanly
    const tempFiles: string[] = [];
    try {
      for (let i = 0; i < chunks.length; i++) {
        const tempPath = outputPath.replace(/\.[^.]+$/, `_chunk_${i}.mp3`);
        const chunkBuffer = await fetchSpeechAudio(chunks[i], config);
        writeFileSync(tempPath, chunkBuffer);
        tempFiles.push(tempPath);
      }

      // Concatenate chunks with ffmpeg stream copy
      const concatList = tempFiles.map(f => `file '${f.replace(/\\/g, "/")}'`).join("\n");
      const listPath = outputPath.replace(/\.[^.]+$/, "_chunks.txt");
      writeFileSync(listPath, concatList);

      await runLocalTool("ffmpeg", [
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", listPath,
        "-c", "copy",
        outputPath
      ]);

      if (existsSync(listPath)) unlinkSync(listPath);
    } finally {
      for (const f of tempFiles) {
        if (existsSync(f)) unlinkSync(f);
      }
    }
  }

  if (!existsSync(outputPath)) {
    throw new Error(`ELEVENLABS_OUTPUT_MISSING: Generated audio file was not written to ${outputPath}`);
  }

  // Measure exact duration using ffprobe
  const probeOutput = await runLocalTool("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    outputPath,
  ]);

  const durationSeconds = Number(probeOutput.trim());
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(`ELEVENLABS_PROBE_ERROR: Invalid audio duration (${probeOutput.trim()}) for ${outputPath}`);
  }

  return {
    audioPath: outputPath,
    durationSeconds,
    voiceId: config.voiceId,
    modelId: config.modelId,
    spokenText,
  };
}
