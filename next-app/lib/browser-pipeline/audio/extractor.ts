/**
 * Browser Audio Extraction & 16kHz Resampling Engine
 * Extracts audio tracks from video or audio files and resamples to 16,000 Hz mono Float32Array
 * natively using Web Audio API (OfflineAudioContext), ready for client-side Whisper ASR.
 */

export class BrowserAudioExtractor {
  public static async extract16kHzMono(
    fileOrBlob: Blob,
    onProgress?: (progress: number, stage: string) => void
  ): Promise<{ audioData: Float32Array; durationSec: number; sampleRate: number }> {
    onProgress?.(0.1, "Reading media buffer...");
    const arrayBuffer = await fileOrBlob.arrayBuffer();

    onProgress?.(0.3, "Decoding compressed audio tracks...");
    // Use an AudioContext to decode any standard audio/video container (MP4, WebM, MP3, WAV, AAC)
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) {
      throw new Error("Web Audio API is not supported in this browser.");
    }

    const audioCtx = new AudioCtx();
    let decodedBuffer: AudioBuffer;
    try {
      decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    } finally {
      await audioCtx.close();
    }

    const originalSampleRate = decodedBuffer.sampleRate;
    const originalDuration = decodedBuffer.duration;
    const targetSampleRate = 16000;
    const targetLength = Math.ceil(originalDuration * targetSampleRate);

    onProgress?.(0.6, `Resampling from ${originalSampleRate}Hz to 16000Hz mono...`);

    // Use OfflineAudioContext for deterministic, hardware-accelerated offline resampling
    const offlineCtx = new OfflineAudioContext(1, targetLength, targetSampleRate);
    const bufferSource = offlineCtx.createBufferSource();
    bufferSource.buffer = decodedBuffer;

    // If source has multiple channels, downmix to mono by connecting to destination
    bufferSource.connect(offlineCtx.destination);
    bufferSource.start(0);

    const resampledBuffer = await offlineCtx.startRendering();
    const monoChannelData = resampledBuffer.getChannelData(0);

    onProgress?.(1.0, "Audio extraction complete.");

    return {
      audioData: monoChannelData,
      durationSec: originalDuration,
      sampleRate: targetSampleRate,
    };
  }
}
