/**
 * Synchronized Caption & Subtitle Grouping Service
 * Ported from CaptionGeneratorService (services/ai-worker/app/services/caption_generator.py)
 * Converts absolute source timestamps to highlight-relative timeline, groups words into
 * readable 1-2 line captions with clause and technical-term awareness.
 */

import { CaptionWord, CaptionGroup, CaptionOptions, DisplayWord } from "../schemas";

export class CaptionGroupingService {
  public static filterAndConvertWords(
    transcriptWords: DisplayWord[],
    highlightStartSec: number,
    highlightEndSec: number
  ): { words: CaptionWord[]; stats: Record<string, number> } {
    const clipDuration = Math.max(0.0, highlightEndSec - highlightStartSec);
    const relWords: CaptionWord[] = [];
    let zeroDurationCount = 0;
    let clampedCount = 0;
    let droppedInvalidCount = 0;

    const sortedWords = [...transcriptWords].sort((a, b) => a.start_sec - b.start_sec);

    for (const w of sortedWords) {
      const sAbs = w.start_sec;
      const eAbs = w.end_sec;

      if (
        isNaN(sAbs) ||
        isNaN(eAbs) ||
        !isFinite(sAbs) ||
        !isFinite(eAbs) ||
        eAbs < sAbs
      ) {
        droppedInvalidCount++;
        continue;
      }

      // Filter words strictly outside the highlight window
      if (eAbs <= highlightStartSec || sAbs >= highlightEndSec) {
        continue;
      }

      const wasClamped = sAbs < highlightStartSec || eAbs > highlightEndSec;
      if (wasClamped) {
        clampedCount++;
      }

      const sRel = Math.max(0.0, sAbs - highlightStartSec);
      let eRel = Math.min(clipDuration, eAbs - highlightStartSec);

      if (eRel <= sRel) {
        zeroDurationCount++;
        eRel = Math.min(clipDuration, sRel + 0.05);
      }

      relWords.push({
        id: w.id,
        text: (w.text || "").trim(),
        start_sec: Math.round(sRel * 1000) / 1000,
        end_sec: Math.round(eRel * 1000) / 1000,
        source_word_ids: w.source_word_ids ? [...w.source_word_ids] : [w.id],
        confidence: w.confidence ?? null,
        correction: w.correction ?? null,
      });
    }

    const stats = {
      total_input_words: transcriptWords.length,
      filtered_words_count: relWords.length,
      zero_duration_count: zeroDurationCount,
      clamped_count: clampedCount,
      dropped_invalid_count: droppedInvalidCount,
    };

    return { words: relWords, stats };
  }

  public static balanceLines(words: CaptionWord[], maxCharsPerLine: number = 32): string[] {
    const fullText = words.map((w) => w.text).join(" ");
    if (fullText.length <= maxCharsPerLine || words.length <= 3) {
      return [fullText];
    }

    // Split into 2 lines as evenly as possible
    let bestSplitIdx = Math.floor(words.length / 2);
    let minDiff = Infinity;

    for (let i = 1; i < words.length; i++) {
      const line1 = words.slice(0, i).map((w) => w.text).join(" ");
      const line2 = words.slice(i).map((w) => w.text).join(" ");
      const diff = Math.abs(line1.length - line2.length);

      if (line1.length <= maxCharsPerLine && line2.length <= maxCharsPerLine && diff < minDiff) {
        minDiff = diff;
        bestSplitIdx = i;
      }
    }

    const l1 = words.slice(0, bestSplitIdx).map((w) => w.text).join(" ");
    const l2 = words.slice(bestSplitIdx).map((w) => w.text).join(" ");
    return l2 ? [l1, l2] : [l1];
  }

  public static groupWordsIntoCaptions(
    words: CaptionWord[],
    clipDuration: number,
    options?: CaptionOptions
  ): CaptionGroup[] {
    if (!words || words.length === 0) return [];

    const minWords = options?.min_words_per_group ?? 2;
    const maxWords = options?.max_words_per_group ?? 6;
    const maxChars = options?.max_chars_per_line ?? 32;
    const pauseThreshold = options?.speech_pause_threshold_sec ?? 0.65;
    const tailHold = options?.tail_hold_sec ?? 0.4;

    // Step 1: Partition words into natural clauses
    const clauses: CaptionWord[][] = [];
    let currClause: CaptionWord[] = [];

    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      currClause.push(w);
      const hasTerminal = /[.!?]$/.test(w.text);

      const isLast = i === words.length - 1;
      if (isLast) {
        clauses.push(currClause);
        break;
      }

      const nextW = words[i + 1];
      const speechGap = nextW.start_sec - w.end_sec;

      if (hasTerminal || speechGap >= pauseThreshold) {
        clauses.push(currClause);
        currClause = [];
      }
    }

    // Step 2: Subdivide clauses into balanced caption groups
    const rawGroups: CaptionGroup[] = [];
    let groupId = 0;

    for (const clause of clauses) {
      if (clause.length === 0) continue;

      if (clause.length <= maxWords) {
        const lines = this.balanceLines(clause, maxChars);
        rawGroups.push({
          id: groupId++,
          start_sec: clause[0].start_sec,
          end_sec: clause[clause.length - 1].end_sec,
          text: clause.map((w) => w.text).join(" "),
          lines,
          words: clause,
        });
      } else {
        // Chunk long clause into smaller groups of 3-5 words
        let chunkStart = 0;
        while (chunkStart < clause.length) {
          const remaining = clause.length - chunkStart;
          let chunkSize = Math.min(maxWords, remaining);
          if (remaining - chunkSize < minWords && remaining - chunkSize > 0) {
            chunkSize = Math.max(minWords, Math.floor(remaining / 2));
          }

          const subWords = clause.slice(chunkStart, chunkStart + chunkSize);
          const lines = this.balanceLines(subWords, maxChars);

          rawGroups.push({
            id: groupId++,
            start_sec: subWords[0].start_sec,
            end_sec: subWords[subWords.length - 1].end_sec,
            text: subWords.map((w) => w.text).join(" "),
            lines,
            words: subWords,
          });

          chunkStart += chunkSize;
        }
      }
    }

    // Step 3: Extend tail hold duration so captions linger slightly without overlapping next group
    for (let g = 0; g < rawGroups.length; g++) {
      const group = rawGroups[g];
      const maxPossibleEnd =
        g < rawGroups.length - 1
          ? rawGroups[g + 1].start_sec - 0.05
          : clipDuration;

      const desiredEnd = group.end_sec + tailHold;
      group.end_sec = Math.min(maxPossibleEnd, desiredEnd);
    }

    return rawGroups;
  }
}
