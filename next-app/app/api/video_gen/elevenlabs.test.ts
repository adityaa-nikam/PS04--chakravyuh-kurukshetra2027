import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  getElevenLabsConfig,
  isElevenLabsConfigured,
  chunkTextBySentences,
  generateSpeechWithElevenLabs,
  ELEVENLABS_VOICES,
  DEFAULT_FEMALE_VOICE_ID,
  DEFAULT_MODEL_ID,
} from "./elevenlabs-service";
import { prepareTextForSpeech } from "./pronunciation";
import { buildStoryboard } from "./storyboard";
import { getExplainerScriptFixture } from "./fixture";
import { prepareRender } from "./render-plan";
import { applyNarrationTiming } from "./local-narration";

test("ElevenLabs configuration loads defaults and maps named voices", () => {
  const origKey = process.env.ELEVENLABS_API_KEY;
  const origVoice = process.env.ELEVENLABS_VOICE_ID;
  const origModel = process.env.ELEVENLABS_MODEL_ID;

  try {
    process.env.ELEVENLABS_API_KEY = "test_key_12345";
    delete process.env.ELEVENLABS_VOICE_ID;
    delete process.env.ELEVENLABS_MODEL_ID;

    assert.equal(isElevenLabsConfigured(), true);
    const config = getElevenLabsConfig();
    assert.equal(config.apiKey, "test_key_12345");
    assert.equal(config.voiceId, DEFAULT_FEMALE_VOICE_ID);
    assert.equal(config.modelId, DEFAULT_MODEL_ID);
    assert.equal(config.stability, 0.45);
    assert.equal(config.similarityBoost, 0.80);
    assert.equal(config.style, 0);
    assert.equal(config.useSpeakerBoost, true);

    // Named voice alias mapping
    process.env.ELEVENLABS_VOICE_ID = "sarah";
    const sarahConfig = getElevenLabsConfig();
    assert.equal(sarahConfig.voiceId, ELEVENLABS_VOICES.sarah);

    // Custom UUID
    process.env.ELEVENLABS_VOICE_ID = "custom_voice_uuid_999";
    const customConfig = getElevenLabsConfig();
    assert.equal(customConfig.voiceId, "custom_voice_uuid_999");
  } finally {
    if (origKey !== undefined) process.env.ELEVENLABS_API_KEY = origKey; else delete process.env.ELEVENLABS_API_KEY;
    if (origVoice !== undefined) process.env.ELEVENLABS_VOICE_ID = origVoice; else delete process.env.ELEVENLABS_VOICE_ID;
    if (origModel !== undefined) process.env.ELEVENLABS_MODEL_ID = origModel; else delete process.env.ELEVENLABS_MODEL_ID;
  }
});

test("ElevenLabs throws clear setup requirement when credentials are absent", () => {
  const origKey = process.env.ELEVENLABS_API_KEY;
  try {
    delete process.env.ELEVENLABS_API_KEY;
    assert.equal(isElevenLabsConfigured(), false);
    assert.throws(
      () => getElevenLabsConfig(),
      /MISSING_CREDENTIALS: Set ELEVENLABS_API_KEY in your .env or server environment/
    );
  } finally {
    if (origKey !== undefined) process.env.ELEVENLABS_API_KEY = origKey; else delete process.env.ELEVENLABS_API_KEY;
  }
});

test("technical pronunciation normalizer speaks technical concepts and math fluently", () => {
  // Acronyms
  assert.equal(prepareTextForSpeech("We use SQL with our API and parse JSON or XML."), "We use Sequel with our A-P-I and parse J-S-O-N or X-M-L.");
  assert.equal(prepareTextForSpeech("PyTorch and kubectl help deploy the model."), "Pie-Torch and kube-control help deploy the model.");

  // Complexity & Math notation
  assert.equal(prepareTextForSpeech("Binary search has Big O of O(log n) time, compared to O(n)."), "Binary search has Big-O of O of log n time, compared to O of n.");
  assert.equal(prepareTextForSpeech("Calculate mid = ⌊ low + high ⌋ / 2."), "Calculate mid = low + high rounded down / 2.");
  assert.equal(prepareTextForSpeech("Inspect arr[mid] to check if value === target."), "Inspect array at mid to check if value equals target.");
  assert.equal(prepareTextForSpeech("Range [0..7] -> next range."), "Range 0 through 7, which gives, next range.");

  // Code tags and XML tags
  assert.equal(prepareTextForSpeech("Open <user> and then </user>."), "Open the user tag and then closing user tag.");
});

test("sentence chunker divides long passages cleanly at sentence boundaries", () => {
  const shortText = "First sentence. Second sentence.";
  assert.deepEqual(chunkTextBySentences(shortText, 100), ["First sentence. Second sentence."]);

  const longSentences = [
    "This is the first comprehensive technical explanation covering binary search algorithms.",
    "Next, we inspect the middle element of the sorted array to divide the search space.",
    "Finally, the logarithmic time complexity ensures near-instant lookups even with billions of elements.",
  ];
  const combined = longSentences.join(" ");
  const chunks = chunkTextBySentences(combined, 110);
  assert.ok(chunks.length >= 2);
  for (const chunk of chunks) {
    assert.ok(chunk.endsWith("."));
    assert.ok(chunk.length <= 110);
  }
});

test("ElevenLabs service handles API errors, status codes, and rate limits gracefully", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "eleven-test-"));
  const outputFile = path.join(directory, "test.mp3");

  const origKey = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = "dummy_test_key";

  try {
    // 1. Test 401 Unauthorized
    const unauthFetch = mock.method(globalThis, "fetch", async () => {
      return new Response(JSON.stringify({ detail: { message: "Invalid API key" } }), { status: 401, headers: { "Content-Type": "application/json" } });
    });
    await assert.rejects(
      generateSpeechWithElevenLabs("Hello world.", outputFile),
      /ELEVENLABS_UNAUTHORIZED/
    );
    unauthFetch.mock.restore();

    // 2. Test 404 Voice Not Found
    const notFoundFetch = mock.method(globalThis, "fetch", async () => {
      return new Response(JSON.stringify({ detail: { message: "Voice not found" } }), { status: 404, headers: { "Content-Type": "application/json" } });
    });
    await assert.rejects(
      generateSpeechWithElevenLabs("Hello world.", outputFile),
      /ELEVENLABS_VOICE_NOT_FOUND/
    );
    notFoundFetch.mock.restore();

    // 3. Test 429 Rate Limit
    const rateLimitFetch = mock.method(globalThis, "fetch", async () => {
      return new Response(JSON.stringify({ detail: { message: "Quota exceeded" } }), { status: 429, headers: { "Content-Type": "application/json" } });
    });
    await assert.rejects(
      generateSpeechWithElevenLabs("Hello world.", outputFile),
      /ELEVENLABS_RATE_LIMIT/
    );
    rateLimitFetch.mock.restore();
  } finally {
    if (origKey !== undefined) process.env.ELEVENLABS_API_KEY = origKey; else delete process.env.ELEVENLABS_API_KEY;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("timing synchronization reconciles measured durations with storyboard frame counts", () => {
  const plan = prepareRender(buildStoryboard(getExplainerScriptFixture()), { approveOverrun: true });
  const measuredDurations = plan.frames.map((_, i) => 3.0 + i * 0.5);

  applyNarrationTiming(plan, measuredDurations, ELEVENLABS_VOICES.rachel, "elevenlabs");

  assert.equal(plan.narration?.engine, "elevenlabs");
  assert.equal(plan.narration?.voice, ELEVENLABS_VOICES.rachel);
  assert.deepEqual(plan.narration?.seconds, measuredDurations);

  let cursor = 0;
  for (let i = 0; i < plan.frames.length; i++) {
    const frame = plan.frames[i];
    assert.equal(frame.from, cursor);
    // Verified: each frame must fit speech duration + breathing pause (0.35s)
    const minRequiredFrames = Math.ceil((measuredDurations[i] + 0.35) * plan.settings.fps);
    assert.ok(frame.durationInFrames >= minRequiredFrames);
    cursor += frame.durationInFrames;
  }
  assert.equal(plan.durationInFrames, cursor);
});
