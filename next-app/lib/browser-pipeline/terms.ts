/**
 * Browser Technical Terminology Normalization Engine
 * Ported directly from TermNormalizerService (services/ai-worker/app/services/term_normalizer.py)
 * Normalizes spoken expressions into canonical developer code terms with context awareness.
 */

import { RawWord, DisplayWord, CorrectionMetadata } from "./schemas";
import { TECHNICAL_TERMS_VOCABULARY, TechnicalTermItem } from "./vocabulary";

export class TermNormalizerService {
  private terms: TechnicalTermItem[] = [];
  private variantIndex: Map<string, TechnicalTermItem> = new Map();
  private maxNgramLen: number = 1;

  constructor(customTerms?: TechnicalTermItem[]) {
    this.terms = customTerms || TECHNICAL_TERMS_VOCABULARY.terms;
    this.buildIndex();
  }

  private buildIndex(): void {
    this.variantIndex.clear();
    this.maxNgramLen = 1;

    for (const item of this.terms) {
      for (const v of item.spoken_variants) {
        const cleaned = this.cleanToken(v).toLowerCase();
        if (cleaned) {
          this.variantIndex.set(cleaned, item);
          const words = cleaned.split(" ").filter(Boolean);
          if (words.length > this.maxNgramLen) {
            this.maxNgramLen = words.length;
          }
        }
      }
    }
  }

  public cleanToken(text: string): string {
    // Strip leading/trailing non-alphanumeric except '@'
    const cleaned = text.replace(/^[^\w@]+|[^\w]+$/g, "");
    return cleaned.replace(/\s+/g, " ").trim();
  }

  public normalize(rawWords: RawWord[], contextWindowSize: number = 30): DisplayWord[] {
    if (!rawWords || rawWords.length === 0 || this.variantIndex.size === 0) {
      return (rawWords || []).map((w) => ({
        id: w.id,
        text: w.text,
        start_sec: w.start_sec,
        end_sec: w.end_sec,
        source_word_ids: [w.id],
        confidence: w.confidence ?? null,
        correction: null,
      }));
    }

    const allCleanedTokens = rawWords.map((w) => this.cleanToken(w.text).toLowerCase());
    const globalTokenSet = new Set(allCleanedTokens);

    const displayWords: DisplayWord[] = [];
    let i = 0;
    const n = rawWords.length;
    let nextDisplayId = 0;

    while (i < n) {
      let matched = false;

      // Try longest n-gram first (greedy)
      for (let windowSize = Math.min(this.maxNgramLen, n - i); windowSize > 0; windowSize--) {
        const subSlice = rawWords.slice(i, i + windowSize);
        const joinedClean = allCleanedTokens.slice(i, i + windowSize).join(" ");

        if (this.variantIndex.has(joinedClean)) {
          const termDef = this.variantIndex.get(joinedClean)!;
          const canonical = termDef.canonical;
          const termId = termDef.id;
          const contextReq = termDef.context_required || [];
          const requiresReview = termDef.requires_review_if_ambiguous ?? false;

          let hasValidContext = true;
          if (contextReq.length > 0) {
            const ctxStart = Math.max(0, i - contextWindowSize);
            const ctxEnd = Math.min(n, i + windowSize + contextWindowSize);
            const localTokens = new Set(allCleanedTokens.slice(ctxStart, ctxEnd));
            const contextReqSet = new Set(contextReq.map((k) => k.toLowerCase()));

            const localMatch = Array.from(contextReqSet).some((k) => localTokens.has(k));
            const globalMatch = Array.from(contextReqSet).some((k) => globalTokenSet.has(k));
            hasValidContext = localMatch || globalMatch;
          }

          if (!hasValidContext) {
            // Keep original words without applying code term substitution
            matched = false;
            break;
          }

          // Preserve trailing punctuation from the last word in the matched phrase
          const lastWordText = subSlice[subSlice.length - 1].text;
          const trailingPunctMatch = lastWordText.match(/([.,!?;:]+)$/);
          const trailingPunct = trailingPunctMatch ? trailingPunctMatch[1] : "";
          const canonicalWithPunct = canonical + trailingPunct;

          // Aggregate timestamps and source word IDs
          const startSec = subSlice[0].start_sec;
          const endSec = subSlice[subSlice.length - 1].end_sec;
          const sourceIds = subSlice.map((w) => w.id);

          const confidences = subSlice
            .map((w) => w.confidence)
            .filter((c): c is number => typeof c === "number");
          const minConf = confidences.length > 0 ? Math.min(...confidences) : null;

          const correction: CorrectionMetadata = {
            term_id: termId,
            matched_alias: joinedClean,
            applied: true,
            requires_review: requiresReview && !hasValidContext,
            reason: null,
          };

          displayWords.push({
            id: nextDisplayId++,
            text: canonicalWithPunct,
            start_sec: startSec,
            end_sec: endSec,
            source_word_ids: sourceIds,
            confidence: minConf,
            correction: correction,
          });

          i += windowSize;
          matched = true;
          break;
        }
      }

      if (!matched) {
        const w = rawWords[i];
        displayWords.push({
          id: nextDisplayId++,
          text: w.text,
          start_sec: w.start_sec,
          end_sec: w.end_sec,
          source_word_ids: [w.id],
          confidence: w.confidence ?? null,
          correction: null,
        });
        i++;
      }
    }

    return displayWords;
  }
}
