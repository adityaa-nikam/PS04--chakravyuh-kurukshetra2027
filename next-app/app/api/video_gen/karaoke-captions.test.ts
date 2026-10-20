import test from "node:test";
import assert from "node:assert/strict";
import { buildKaraokePhrases } from "./remotion/KaraokeCaptions";

test("buildKaraokePhrases merges punctuation-only tokens and never creates solo hyphen pills", () => {
  const narration = "connected layers - for example, in deep networks - pass information forward.";
  const phrases = buildKaraokePhrases(narration, 300, 30, 150);

  // Extract all words across all phrases
  const allWords = phrases.flatMap((p) => p.words);

  // Verify that NO word is just '-' or purely non-alphanumeric
  for (const w of allWords) {
    assert.ok(
      /[a-zA-Z0-9]/.test(w.text),
      `Word "${w.text}" should not be a standalone punctuation token`
    );
  }

  // Verify that 'layers -' or similar absorbed the hyphen
  const layersWord = allWords.find((w) => w.text.includes("layers"));
  assert.ok(layersWord, "Expected to find word containing 'layers'");
  assert.ok(layersWord.text.includes("-"), "Hyphen should be merged into 'layers -'");
});

test("buildKaraokePhrases synchronizes word timings to speechDurationInFrames, not total padded frames", () => {
  const narration = "Neural networks learn representations through continuous optimization.";
  const totalSceneFrames = 300; // 10s scene with padding
  const speechFrames = 150;      // 5s actual speech duration

  const phrases = buildKaraokePhrases(narration, totalSceneFrames, 30, speechFrames);
  const allWords = phrases.flatMap((p) => p.words);

  assert.ok(allWords.length > 0, "Should have words");

  // First word starts almost immediately (within 2 frames)
  assert.equal(allWords[0].startFrame <= 2, true);

  // The very last word must finish at or before speechFrames (150), NOT totalSceneFrames (300)
  const lastWord = allWords[allWords.length - 1];
  assert.equal(
    lastWord.endFrame,
    speechFrames,
    `Last word endFrame (${lastWord.endFrame}) should equal speechFrames (${speechFrames})`
  );

  // The last phrase endFrame should stay visible until totalSceneFrames for reading comfort
  const lastPhrase = phrases[phrases.length - 1];
  assert.equal(
    lastPhrase.endFrame,
    totalSceneFrames,
    `Last phrase should persist until totalSceneFrames (${totalSceneFrames})`
  );
});

test("buildKaraokePhrases handles short and empty narration safely", () => {
  assert.deepEqual(buildKaraokePhrases("", 100, 30), []);
  assert.deepEqual(buildKaraokePhrases("   ", 100, 30), []);

  const single = buildKaraokePhrases("Hello!", 60, 30, 30);
  assert.equal(single.length, 1);
  assert.equal(single[0].words.length, 1);
  assert.equal(single[0].words[0].text, "Hello!");
});
