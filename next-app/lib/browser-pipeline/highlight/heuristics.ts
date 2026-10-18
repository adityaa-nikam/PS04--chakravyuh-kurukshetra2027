/**
 * Browser Highlight Selection Engine (Heuristics)
 * Ported from HighlightSelectorService (services/ai-worker/app/services/highlight_selector.py)
 * Analyzes word-level transcripts to identify the single most valuable, coherent, and
 * self-contained 30-60s educational highlight.
 */

import {
  DisplayWord,
  ScoreBreakdown,
  HighlightResult,
  SourceMetadata,
  ValidatedTranscript,
} from "../schemas";

export interface Sentence {
  sentence_id: number;
  words: DisplayWord[];
  start_sec: number;
  end_sec: number;
  duration_sec: number;
  text: string;
}

export interface CandidateSegment {
  candidate_id: number;
  start_sentence_idx: number;
  end_sentence_idx: number;
  words: DisplayWord[];
  start_sec: number;
  end_sec: number;
  duration_sec: number;
  text: string;
  score_breakdown?: ScoreBreakdown;
  total_score?: number;
  reason?: string;
  is_fallback?: boolean;
}

export class HighlightSelectorService {
  public static readonly CONCEPT_DEFINITION_MARKERS = [
    "is called", "concept called", "means that", "we define",
    "this is our", "the concept of", "what is", "one big concept",
    "refers to", "known as", "defined as", "in computer science"
  ];

  public static readonly EXPLANATION_MARKERS = [
    "because", "the reason", "which allows us to", "which allows",
    "this is why", "how it operates", "how they operate", "so that we can",
    "the way this works", "why do we", "how it works", "speed and efficiency"
  ];

  public static readonly EXAMPLE_ANALOGY_MARKERS = [
    "for example", "for instance", "such as", "just like",
    "let's say", "imagine", "picture this", "in this scenario",
    "to illustrate", "think of it as", "different scenarios"
  ];

  public static readonly TAKEAWAY_MARKERS = [
    "optimized for", "time complexity", "trade-off", "in summary",
    "the takeaway", "keep in mind", "super important to know",
    "best practice", "remember that", "as a result"
  ];

  public static readonly DANGLING_OPENING_MARKERS = [
    "as i mentioned earlier", "like i said before", "as we saw",
    "as i said", "like i mentioned", "on the other hand",
    "in the previous video", "so as we discussed"
  ];

  public static readonly CONTINUATION_CONJUNCTIONS = [
    "and so", "and if", "and then", "and also", "but then",
    "or else", "so then", "and"
  ];

  public static readonly DANGLING_ENDING_MARKERS = [
    "more on that later", "and then we will see", "in the next video",
    "we will see in a bit", "we will talk about later", "and so on",
    "more about that in"
  ];

  public static readonly SPEAKER_META_INTRO_MARKERS = [
    "hi my name is", "my name is", "welcome back to", "if you're new here",
    "subscribe to my channel", "leave a comment", "smash that like button",
    "i have a bachelor", "i have a master", "every single day i help"
  ];

  public static readonly FILLER_WORDS = new Set(["um", "uh", "you know", "basically", "sort of", "kind of", "like"]);

  public minDurationSec: number;
  public maxDurationSec: number;
  public targetDurationSec: number;

  constructor(
    minDurationSec: number = 30.0,
    maxDurationSec: number = 60.0,
    targetDurationSec: number = 45.0
  ) {
    this.minDurationSec = minDurationSec;
    this.maxDurationSec = maxDurationSec;
    this.targetDurationSec = targetDurationSec;
  }

  public static segmentIntoSentences(words: DisplayWord[]): Sentence[] {
    if (!words || words.length === 0) return [];

    const sentences: Sentence[] = [];
    let currentWords: DisplayWord[] = [];
    let sentenceId = 0;

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      currentWords.push(word);
      const textStrip = word.text.trim();

      const isTerminalPunct = /[.!?]+$/.test(textStrip);
      const isClausePunct = /[:;]+$/.test(textStrip);

      let isPauseGap = false;
      if (i < words.length - 1) {
        const nextWord = words[i + 1];
        const gap = nextWord.start_sec - word.end_sec;
        if (gap >= 0.65) {
          isPauseGap = true;
        }
      }

      if ((isTerminalPunct || isClausePunct || isPauseGap) && currentWords.length >= 3) {
        const posWords = currentWords.filter((w) => w.end_sec > w.start_sec);
        const sStart = posWords.length > 0 ? posWords[0].start_sec : currentWords[0].start_sec;
        const rawEnd = posWords.length > 0 ? posWords[posWords.length - 1].end_sec : currentWords[currentWords.length - 1].end_sec;

        let trailingPad = 0.0;
        if (i < words.length - 1) {
          const nextWord = words[i + 1];
          const gap = nextWord.start_sec - rawEnd;
          if (gap > 0) {
            trailingPad = Math.min(0.35, gap);
          }
        }

        const sEnd = Math.round((rawEnd + trailingPad) * 1000) / 1000;
        const sText = currentWords.map((w) => w.text).join(" ");

        sentences.push({
          sentence_id: sentenceId++,
          words: [...currentWords],
          start_sec: Math.round(sStart * 1000) / 1000,
          end_sec: sEnd,
          duration_sec: Math.round((sEnd - sStart) * 1000) / 1000,
          text: sText,
        });
        currentWords = [];
      }
    }

    if (currentWords.length > 0) {
      const posWords = currentWords.filter((w) => w.end_sec > w.start_sec);
      const sStart = posWords.length > 0 ? posWords[0].start_sec : currentWords[0].start_sec;
      const sEnd = posWords.length > 0 ? posWords[posWords.length - 1].end_sec : currentWords[currentWords.length - 1].end_sec;
      const sText = currentWords.map((w) => w.text).join(" ");

      sentences.push({
        sentence_id: sentenceId++,
        words: [...currentWords],
        start_sec: Math.round(sStart * 1000) / 1000,
        end_sec: Math.round(sEnd * 1000) / 1000,
        duration_sec: Math.round((sEnd - sStart) * 1000) / 1000,
        text: sText,
      });
    }

    return sentences;
  }

  public generateCandidates(sentences: Sentence[], words: DisplayWord[]): CandidateSegment[] {
    const candidates: CandidateSegment[] = [];
    let candidateId = 0;
    const numSentences = sentences.length;

    for (let i = 0; i < numSentences; i++) {
      const startSec = sentences[i].start_sec;

      for (let j = i; j < numSentences; j++) {
        const endSec = sentences[j].end_sec;
        const duration = endSec - startSec;

        if (duration > this.maxDurationSec) {
          break;
        }

        if (duration >= this.minDurationSec) {
          const candWords: DisplayWord[] = [];
          for (let sIdx = i; sIdx <= j; sIdx++) {
            candWords.push(...sentences[sIdx].words);
          }

          const candText = sentences.slice(i, j + 1).map((s) => s.text).join(" ");
          candidates.push({
            candidate_id: candidateId++,
            start_sentence_idx: i,
            end_sentence_idx: j,
            words: candWords,
            start_sec: Math.round(startSec * 1000) / 1000,
            end_sec: Math.round(endSec * 1000) / 1000,
            duration_sec: Math.round(duration * 1000) / 1000,
            text: candText,
          });
        }
      }
    }

    // Sliding window across words fallback if sentences produced zero valid candidates
    if (candidates.length === 0 && words.length > 0) {
      const posWords = words.filter((w) => w.end_sec > w.start_sec);
      const nPos = posWords.length;
      const step = Math.max(1, Math.floor(nPos / 20));

      for (let startIdx = 0; startIdx < nPos; startIdx += step) {
        const wStart = posWords[startIdx].start_sec;
        for (let endIdx = startIdx + 10; endIdx < nPos; endIdx++) {
          const wEnd = posWords[endIdx].end_sec;
          const dur = wEnd - wStart;
          if (dur > this.maxDurationSec) break;
          if (dur >= this.minDurationSec) {
            const sliceWords = words.filter(
              (w) => wStart - 0.001 <= w.start_sec && w.end_sec <= wEnd + 0.001
            );
            candidates.push({
              candidate_id: candidateId++,
              start_sentence_idx: 0,
              end_sentence_idx: 0,
              words: sliceWords,
              start_sec: Math.round(wStart * 1000) / 1000,
              end_sec: Math.round(wEnd * 1000) / 1000,
              duration_sec: Math.round(dur * 1000) / 1000,
              text: sliceWords.map((w) => w.text).join(" "),
            });
          }
        }
      }
    }

    return candidates;
  }

  public scoreCandidate(candidate: CandidateSegment): {
    totalScore: number;
    breakdown: ScoreBreakdown;
    reason: string;
  } {
    const textLower = candidate.text.toLowerCase();
    const words = candidate.words;
    const numWords = words.length;
    const duration = candidate.duration_sec;
    const reasons: string[] = [];

    // A. Information Value (0 to 100)
    let sInfo = 30.0;
    const conceptCount = HighlightSelectorService.CONCEPT_DEFINITION_MARKERS.filter((m) =>
      textLower.includes(m)
    ).length;
    if (conceptCount > 0) {
      sInfo += Math.min(30.0, conceptCount * 15.0);
      reasons.push("defines core concept");
    }

    const explCount = HighlightSelectorService.EXPLANATION_MARKERS.filter((m) =>
      textLower.includes(m)
    ).length;
    if (explCount > 0) {
      sInfo += Math.min(25.0, explCount * 12.0);
      reasons.push("explains mechanism");
    }

    const exCount = HighlightSelectorService.EXAMPLE_ANALOGY_MARKERS.filter((m) =>
      textLower.includes(m)
    ).length;
    if (exCount > 0) {
      sInfo += Math.min(30.0, exCount * 15.0);
      reasons.push("includes illustrative example/analogy");
    }

    const techTerms = words.filter((w) => w.correction && w.correction.applied);
    if (techTerms.length > 0) {
      sInfo += Math.min(25.0, techTerms.length * 12.0);
      reasons.push(`contains ${techTerms.length} technical term(s)`);
    }

    const takeawayCount = HighlightSelectorService.TAKEAWAY_MARKERS.filter((m) =>
      textLower.includes(m)
    ).length;
    if (takeawayCount > 0) {
      sInfo += Math.min(20.0, takeawayCount * 10.0);
    }
    sInfo = Math.min(100.0, Math.max(0.0, sInfo));

    // B. Self-Contained Meaning (0 to 100)
    let sSelf = 70.0;
    const firstSentenceWords = words.slice(0, Math.min(12, numWords));
    const firstSentenceText = firstSentenceWords.map((w) => w.text).join(" ").toLowerCase();

    const lastSentenceWords = words.slice(Math.max(0, numWords - 12));
    const lastSentenceText = lastSentenceWords.map((w) => w.text).join(" ").toLowerCase();

    for (const conj of HighlightSelectorService.CONTINUATION_CONJUNCTIONS) {
      if (firstSentenceText.startsWith(conj + " ")) {
        sSelf -= 25.0;
        break;
      }
    }

    for (const dangling of HighlightSelectorService.DANGLING_OPENING_MARKERS) {
      if (firstSentenceText.includes(dangling)) {
        sSelf -= 30.0;
        break;
      }
    }

    for (const dangling of HighlightSelectorService.DANGLING_ENDING_MARKERS) {
      if (lastSentenceText.includes(dangling)) {
        sSelf -= 30.0;
        break;
      }
    }
    sSelf = Math.min(100.0, Math.max(0.0, sSelf));

    // C. Opening Hook Quality (0 to 100)
    let sHook = 50.0;
    const strongHookStarters = [
      "before we get into", "have you ever", "why do we",
      "how do we", "what is", "one big concept", "the most important",
      "data structures are super important", "imagine if", "notice how"
    ];
    if (strongHookStarters.some((m) => firstSentenceText.includes(m))) {
      sHook += 35.0;
      reasons.push("strong hook");
    }

    if (firstSentenceText.includes("?") || /^(why|how|what)\b/.test(firstSentenceText)) {
      sHook += 20.0;
    }

    for (const meta of HighlightSelectorService.SPEAKER_META_INTRO_MARKERS) {
      if (textLower.includes(meta)) {
        sHook -= 40.0;
        break;
      }
    }
    sHook = Math.min(100.0, Math.max(0.0, sHook));

    // D. Ending Quality (0 to 100)
    let sEnding = 50.0;
    const lastWordText = words[words.length - 1].text.trim();
    if (/[.!?]+$/.test(lastWordText)) {
      sEnding += 35.0;
    } else {
      sEnding -= 35.0;
    }

    if (["just like", "optimized for", "in summary", "that is how"].some((m) => lastSentenceText.includes(m))) {
      sEnding += 20.0;
      reasons.push("complete conclusion");
    }

    const trailingClean = lastWordText.replace(/[^\w]/g, "").toLowerCase();
    if (new Set(["and", "but", "or", "to", "with", "of", "for", "the", "a", "an", "them"]).has(trailingClean)) {
      sEnding -= 35.0;
    }
    sEnding = Math.min(100.0, Math.max(0.0, sEnding));

    // E. Speech Density & Cadence (0 to 100)
    let sDensity = 75.0;
    if (duration > 0) {
      const wps = numWords / duration;
      if (wps >= 2.2 && wps <= 3.6) {
        sDensity = 100.0;
      } else if ((wps >= 1.6 && wps < 2.2) || (wps > 3.6 && wps <= 4.2)) {
        sDensity = 75.0;
      } else {
        sDensity = 45.0;
      }

      const fillerCount = words.filter((w) =>
        HighlightSelectorService.FILLER_WORDS.has(w.text.toLowerCase().replace(/[,.!?]/g, ""))
      ).length;
      const fillerRatio = numWords > 0 ? fillerCount / numWords : 0;
      if (fillerRatio > 0.05) {
        sDensity -= Math.min(30.0, fillerRatio * 200.0);
      }
    }
    sDensity = Math.min(100.0, Math.max(0.0, sDensity));

    // F. Confidence Score (0 to 100)
    const confScores = words
      .map((w) => w.confidence)
      .filter((c): c is number => typeof c === "number");
    const sConf = confScores.length > 0 ? (confScores.reduce((a, b) => a + b, 0) / confScores.length) * 100.0 : 95.0;

    // G. Duration Sweet-Spot Adjustment (~40s - 50s)
    let durationPenalty = 0.0;
    if (duration > 0) {
      const diff = Math.abs(duration - this.targetDurationSec);
      durationPenalty = Math.min(8.0, Math.round((diff / 15.0) * 4.0 * 100) / 100);
    }

    const rawWeighted =
      0.30 * sInfo +
      0.25 * sSelf +
      0.20 * sHook +
      0.15 * sEnding +
      0.10 * sDensity -
      durationPenalty;

    const confMultiplier = 0.90 + 0.10 * (sConf / 100.0);
    const finalScore = Math.round(Math.max(0.0, Math.min(100.0, rawWeighted * confMultiplier)) * 100) / 100;

    const breakdown: ScoreBreakdown = {
      information_value: Math.round(sInfo * 100) / 100,
      self_contained: Math.round(sSelf * 100) / 100,
      opening_hook: Math.round(sHook * 100) / 100,
      ending_quality: Math.round(sEnding * 100) / 100,
      speech_density: Math.round(sDensity * 100) / 100,
      confidence: Math.round(sConf * 100) / 100,
      duration_penalty: Math.round(durationPenalty * 100) / 100,
    };

    const reasonStr = Array.from(new Set(reasons)).join("; ") || "Coherent standalone explanation";
    return { totalScore: finalScore, breakdown, reason: reasonStr };
  }

  public selectBestHighlight(transcript: ValidatedTranscript): HighlightResult {
    const words = transcript.display_words;
    if (!words || words.length === 0) {
      throw new Error("Transcript contains zero words. Cannot select a highlight.");
    }

    const sentences = HighlightSelectorService.segmentIntoSentences(words);
    const candidates = this.generateCandidates(sentences, words);

    if (candidates.length === 0) {
      const posWords = words.filter((w) => w.end_sec > w.start_sec);
      const wFirst = posWords.length > 0 ? posWords[0] : words[0];
      const wLast = posWords.length > 0 ? posWords[posWords.length - 1] : words[words.length - 1];
      const totalDur = wLast.end_sec - wFirst.start_sec;

      return {
        schema_version: "1.0",
        source: transcript.source,
        start_sec: Math.round(wFirst.start_sec * 1000) / 1000,
        end_sec: Math.round(wLast.end_sec * 1000) / 1000,
        duration_sec: Math.round(totalDur * 1000) / 1000,
        score: 50.0,
        reason: "Single segment fallback: Transcript cannot be subdivided into valid candidate windows.",
        transcript_excerpt: words.map((w) => w.text).join(" "),
        score_breakdown: {
          information_value: 50.0,
          self_contained: 50.0,
          opening_hook: 50.0,
          ending_quality: 50.0,
          speech_density: 50.0,
          confidence: 95.0,
          duration_penalty: 0.0,
        },
        word_start_id: words[0].id,
        word_end_id: words[words.length - 1].id,
        selection_method: "fallback_full_window",
      };
    }

    // Score all candidates
    let bestCandidate: CandidateSegment = candidates[0];
    let highestScore = -1;
    let bestBreakdown: ScoreBreakdown = {
      information_value: 0,
      self_contained: 0,
      opening_hook: 0,
      ending_quality: 0,
      speech_density: 0,
      confidence: 0,
      duration_penalty: 0,
    };
    let bestReason = "";

    for (const cand of candidates) {
      const { totalScore, breakdown, reason } = this.scoreCandidate(cand);
      cand.total_score = totalScore;
      cand.score_breakdown = breakdown;
      cand.reason = reason;

      if (totalScore > highestScore) {
        highestScore = totalScore;
        bestCandidate = cand;
        bestBreakdown = breakdown;
        bestReason = reason;
      }
    }

    const firstWord = bestCandidate.words[0];
    const lastWord = bestCandidate.words[bestCandidate.words.length - 1];

    return {
      schema_version: "1.0",
      source: transcript.source,
      start_sec: bestCandidate.start_sec,
      end_sec: bestCandidate.end_sec,
      duration_sec: bestCandidate.duration_sec,
      score: highestScore,
      reason: bestReason,
      transcript_excerpt: bestCandidate.text,
      score_breakdown: bestBreakdown,
      word_start_id: firstWord.id,
      word_end_id: lastWord.id,
      selection_method: "transcript_heuristic_v1",
    };
  }
}
