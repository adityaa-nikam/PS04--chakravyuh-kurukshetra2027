import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

export interface AudioDescriptionOptions {
  voice?: string; // e.g. "en-US-AriaNeural" (female) or "en-US-GuyNeural" (male)
  rate?: string;  // e.g. "+0%"
}

/**
 * Generates an audio track for the video narration using fast, lightweight Edge-TTS
 * with zero-dependency Windows SAPI fallback.
 */
export async function generateNarrationAudio(
  text: string,
  outputPath: string,
  options: AudioDescriptionOptions = {}
): Promise<string> {
  const voice = options.voice || "en-US-AriaNeural";
  const cleanText = text.trim();
  if (!cleanText) {
    throw new Error("Narration text is empty.");
  }

  // Method 1: ElevenLabs Natural Female TTS (Primary when configured)
  try {
    const { isElevenLabsConfigured, generateSpeechWithElevenLabs } = await import("./elevenlabs-service");
    if (isElevenLabsConfigured()) {
      await generateSpeechWithElevenLabs(cleanText, outputPath, options.voice ? { voiceId: options.voice } : undefined);
      return outputPath;
    }
  } catch (elevenErr) {
    console.warn("[audio-service] ElevenLabs synthesis failed, falling back:", elevenErr);
  }

  // Method 2: Edge-TTS (High quality neural voice, fast, free)
  try {
    const pythonBin = process.env.PYTHON_PATH || "python";
    const result = spawnSync(pythonBin, [
      "-m",
      "edge_tts",
      "--voice",
      voice,
      "--text",
      cleanText,
      "--write-media",
      outputPath,
    ], { stdio: "ignore" });
    if (result.status === 0 && existsSync(outputPath)) {
      return outputPath;
    }
  } catch (edgeErr) {
    console.warn("[audio-service] edge-tts error, attempting SAPI fallback:", edgeErr);
  }

  // Method 3: Windows Native SAPI Speech (100% offline fallback)
  try {
    const escapedText = cleanText.replace(/["'`$]/g, " ");
    const sanitizedPath = outputPath.replace(/\\/g, "/");
    const script = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SetOutputToWaveFile('${sanitizedPath}'); $s.Speak('${escapedText}'); $s.Dispose();`;
    const result = spawnSync("powershell", ["-NoProfile", "-Command", script], { stdio: "ignore" });
    if (result.status === 0 && existsSync(outputPath)) {
      return outputPath;
    }
  } catch (sapiErr) {
    console.error("[audio-service] SAPI fallback failed:", sapiErr);
    throw new Error(`Failed to generate audio description: ${sapiErr}`);
  }

  throw new Error("Failed to generate audio narration with available engines.");
}

/**
 * Muxes a video file with an audio file into an output video using FFmpeg stream copy.
 * Video is stream-copied (-c:v copy) for near-instant rendering.
 */
export async function muxAudioWithVideo(
  videoPath: string,
  audioPath: string,
  outputPath: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-y",
      "-i",
      videoPath,
      "-i",
      audioPath,
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-shortest",
      "-movflags",
      "+faststart",
      outputPath,
    ]);

    proc.on("close", (code) => {
      if (code === 0 && existsSync(outputPath)) {
        resolve(outputPath);
      } else {
        reject(new Error(`FFmpeg audio muxing exited with code ${code}`));
      }
    });
    proc.on("error", reject);
  });
}
