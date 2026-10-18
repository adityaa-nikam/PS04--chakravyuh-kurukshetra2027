/**
 * Browser Audio Extraction & 16kHz Resampling Engine
 * Extracts audio tracks from video or audio files and resamples to 16,000 Hz mono Float32Array
 * natively using Web Audio API (OfflineAudioContext), ready for client-side Whisper ASR and MP4 AAC muxing.
 */

export class BrowserAudioExtractor {
  /**
   * Decodes full compressed audio track into an AudioBuffer using native browser Web Audio API.
   */
  public static async decodeFullAudio(
    fileOrBlob: Blob,
    onProgress?: (progress: number, stage: string) => void
  ): Promise<AudioBuffer> {
    onProgress?.(0.1, "Reading media buffer...");
    const arrayBuffer = await fileOrBlob.arrayBuffer();

    onProgress?.(0.3, "Decoding compressed audio tracks...");
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) {
      throw new Error("Web Audio API is not supported in this browser.");
    }

    const audioCtx = new AudioCtx();
    try {
      return await audioCtx.decodeAudioData(arrayBuffer);
    } finally {
      await audioCtx.close();
    }
  }

  /**
   * Resamples full audio buffer to 16kHz mono Float32Array for Whisper ASR.
   */
  public static async extract16kHzMono(
    fileOrBlob: Blob,
    onProgress?: (progress: number, stage: string) => void
  ): Promise<{ audioData: Float32Array; durationSec: number; sampleRate: number; rawBuffer?: AudioBuffer }> {
    const decodedBuffer = await this.decodeFullAudio(fileOrBlob, onProgress);
    const originalSampleRate = decodedBuffer.sampleRate;
    const originalDuration = decodedBuffer.duration;
    const targetSampleRate = 16000;
    const targetLength = Math.ceil(originalDuration * targetSampleRate);

    onProgress?.(0.6, `Resampling from ${originalSampleRate}Hz to 16000Hz mono...`);

    const offlineCtx = new OfflineAudioContext(1, targetLength, targetSampleRate);
    const bufferSource = offlineCtx.createBufferSource();
    bufferSource.buffer = decodedBuffer;
    bufferSource.connect(offlineCtx.destination);
    bufferSource.start(0);

    const resampledBuffer = await offlineCtx.startRendering();
    const monoChannelData = resampledBuffer.getChannelData(0);

    onProgress?.(1.0, "Audio extraction complete.");

    return {
      audioData: monoChannelData,
      durationSec: originalDuration,
      sampleRate: targetSampleRate,
      rawBuffer: decodedBuffer,
    };
  }

  /**
   * Extracts an audio slice corresponding to a highlight clip [startSec, startSec + durationSec]
   * and resamples it cleanly to targetSampleRate (default 48000 Hz) mono Float32Array for AAC MP4 encoding.
   */
  public static async extractResampledSegment(
    sourceAudioBuffer: AudioBuffer,
    startSec: number,
    durationSec: number,
    targetSampleRate: number = 48000
  ): Promise<Float32Array> {
    const targetLength = Math.max(1024, Math.ceil(durationSec * targetSampleRate));
    const offlineCtx = new OfflineAudioContext(1, targetLength, targetSampleRate);

    const bufferSource = offlineCtx.createBufferSource();
    bufferSource.buffer = sourceAudioBuffer;
    bufferSource.connect(offlineCtx.destination);
    // Play sourceBuffer starting at startSec for durationSec
    bufferSource.start(0, Math.max(0, startSec), durationSec);

    const rendered = await offlineCtx.startRendering();
    return rendered.getChannelData(0);
  }
}
