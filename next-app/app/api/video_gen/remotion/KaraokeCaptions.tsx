import React from "react";

export interface CaptionWordTiming {
  text: string;
  cleanText: string;
  startFrame: number;
  endFrame: number;
}

export interface CaptionPhrase {
  words: CaptionWordTiming[];
  startFrame: number;
  endFrame: number;
}

/**
 * Builds word-level timing and groups narration into punchy 3-5 word karaoke phrases.
 * Paces words proportionally by character length and punctuation pauses, strictly synchronized
 * with the exact measured audio speech duration so narration never outruns captions.
 */
export function buildKaraokePhrases(
  narration: string,
  totalFrames: number,
  fps: number,
  speechDurationInFrames?: number
): CaptionPhrase[] {
  if (!narration || !narration.trim()) return [];

  const rawWords = narration.trim().split(/\s+/).filter(Boolean);
  if (rawWords.length === 0) return [];

  // Merge punctuation-only tokens (e.g. '-', '—', '–', '--', '...', '•') into adjacent words
  // so punctuation marks NEVER get their own standalone yellow highlight pill!
  const sanitizedWords: string[] = [];
  for (const token of rawWords) {
    if (!/[a-zA-Z0-9]/.test(token)) {
      if (sanitizedWords.length > 0) {
        sanitizedWords[sanitizedWords.length - 1] += ` ${token}`;
      }
    } else {
      sanitizedWords.push(token);
    }
  }
  if (sanitizedWords.length === 0) return [];

  // Pacing weights: word length in characters + slight pause for natural speech cadence
  const weights = sanitizedWords.map((w) => {
    const cleanLen = w.replace(/[^a-zA-Z0-9]/g, "").length;
    // Base weight proportional to spoken characters:
    // Short words (1-3 chars): weight 2-3
    // Medium words (4-6 chars): weight 4-6
    // Long words (7-12 chars): weight 7-12
    let weight = Math.max(2, Math.min(12, cleanLen));
    // Minor pause for comma/dash/colon
    if (/[,;:\-]/.test(w)) weight += 1.5;
    // Sentence-ending punctuation pause
    if (/[.!?]/.test(w)) weight += 2.5;
    return weight;
  });

  const totalWeight = weights.reduce((acc, wt) => acc + wt, 0);

  // The audio speech duration takes priority.
  // If speechDurationInFrames is provided, words pace across the actual speech duration.
  // Any extra frames in totalFrames are visual breathing room at the end of the scene.
  const targetSpeechFrames = speechDurationInFrames && speechDurationInFrames > 0
    ? Math.min(totalFrames, speechDurationInFrames)
    : totalFrames;

  // Real TTS speech begins almost immediately (approx 2 frames / ~60ms lead-in)
  const leadInFrames = Math.min(2, Math.max(1, Math.round(fps * 0.06)));
  const availableSpeechFrames = Math.max(1, targetSpeechFrames - leadInFrames);

  let currentFrame = leadInFrames;
  const wordTimings: CaptionWordTiming[] = [];

  for (let i = 0; i < sanitizedWords.length; i++) {
    const word = sanitizedWords[i];
    const duration = Math.max(2, Math.round((weights[i] / totalWeight) * availableSpeechFrames));
    const startFrame = currentFrame;
    const endFrame = Math.min(targetSpeechFrames, currentFrame + duration);
    currentFrame = endFrame;

    wordTimings.push({
      text: word,
      cleanText: word.replace(/^[^\w]+|[^\w]+$/g, "").toUpperCase(),
      startFrame,
      endFrame,
    });
  }

  // Ensure the last word extends cleanly to targetSpeechFrames so speech finishes synchronously
  if (wordTimings.length > 0) {
    wordTimings[wordTimings.length - 1].endFrame = targetSpeechFrames;
  }

  // Group into balanced 3 to 5 word phrases
  const phrases: CaptionPhrase[] = [];
  let currentGroup: CaptionWordTiming[] = [];

  for (let i = 0; i < wordTimings.length; i++) {
    const wt = wordTimings[i];
    currentGroup.push(wt);

    const hasTerminal = /[.!?]$/.test(wt.text);
    const hasComma = /[,;]$/.test(wt.text);
    const isLast = i === wordTimings.length - 1;

    if (
      isLast ||
      hasTerminal ||
      (currentGroup.length >= 4 && hasComma) ||
      currentGroup.length >= 5
    ) {
      phrases.push({
        words: currentGroup,
        startFrame: currentGroup[0].startFrame,
        // The last phrase stays visible for the rest of the scene (including padding)
        // so the viewer can read the completed sentence during the scene's ending breath.
        endFrame: isLast ? totalFrames : currentGroup[currentGroup.length - 1].endFrame,
      });
      currentGroup = [];
    }
  }

  return phrases;
}

export function KaraokeCaptions({
  narration,
  frame,
  fps,
  durationInFrames,
  speechDurationInFrames,
  scale,
  highlightColor = "#FACC15",
}: {
  narration: string;
  frame: number;
  fps: number;
  durationInFrames: number;
  speechDurationInFrames?: number;
  scale: number;
  highlightColor?: string;
}) {
  const phrases = React.useMemo(
    () => buildKaraokePhrases(narration, durationInFrames, fps, speechDurationInFrames),
    [narration, durationInFrames, fps, speechDurationInFrames]
  );

  if (phrases.length === 0) return null;

  // Find active phrase for current frame
  let activePhrase = phrases.find(
    (p) => frame >= p.startFrame && frame <= p.endFrame
  );

  // If between phrases or just before/after, display the nearest phrase
  if (!activePhrase) {
    if (frame < phrases[0].startFrame) {
      activePhrase = phrases[0];
    } else if (frame > phrases[phrases.length - 1].endFrame) {
      activePhrase = phrases[phrases.length - 1];
    } else {
      activePhrase = phrases.reduce((prev, curr) =>
        Math.abs(curr.startFrame - frame) < Math.abs(prev.startFrame - frame) ? curr : prev
      );
    }
  }

  if (!activePhrase) return null;

  const fontSize = Math.round(26 * scale);

  return (
    <div
      data-component="karaoke-captions"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: `${10 * scale}px`,
        flexWrap: "wrap",
        background: "rgba(7, 11, 22, 0.75)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        border: "1px solid rgba(255, 255, 255, 0.12)",
        borderRadius: `${14 * scale}px`,
        padding: `${8 * scale}px ${20 * scale}px`,
        boxShadow: "0 8px 30px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
        maxWidth: "92%",
        margin: "0 auto",
      }}
    >
      {activePhrase.words.map((w, idx) => {
        const isActive = frame >= w.startFrame && frame < w.endFrame;
        const isPast = frame >= w.endFrame;

        return (
          <span
            key={idx}
            style={{
              fontFamily:
                "'Montserrat', 'Inter', system-ui, -apple-system, sans-serif",
              fontSize: `${fontSize}px`,
              fontWeight: 800,
              letterSpacing: `${0.5 * scale}px`,
              textTransform: "uppercase",
              display: "inline-block",
              transition: "transform 0.08s cubic-bezier(0.34, 1.56, 0.64, 1)",
              transform: isActive ? "scale(1.14)" : "scale(1)",
              color: isActive ? highlightColor : isPast ? "#FFFFFF" : "rgba(255, 255, 255, 0.85)",
              textShadow: isActive
                ? `0 0 18px ${highlightColor}, 0 0 35px ${highlightColor}88, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000`
                : "-1.5px -1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px 1.5px 0 #000, 0 3px 6px rgba(0,0,0,0.8)",
              background: isActive ? `${highlightColor}20` : "transparent",
              borderRadius: `${6 * scale}px`,
              padding: `${1 * scale}px ${4 * scale}px`,
            }}
          >
            {w.text}
          </span>
        );
      })}
    </div>
  );
}
