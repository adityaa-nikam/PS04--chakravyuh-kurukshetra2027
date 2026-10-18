/**
 * Canvas Caption & Karaoke Word-Level Renderer
 * Renders high-legibility subtitle overlays and word-level karaoke animations directly onto 2D Canvas.
 */

import { CaptionGroup, CaptionOptions } from "../schemas";

export class CanvasCaptionRenderer {
  public static drawCaptions(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    groups: CaptionGroup[],
    currentRelSec: number,
    canvasWidth: number,
    canvasHeight: number,
    options?: CaptionOptions
  ): void {
    if (!groups || groups.length === 0) return;

    // Find active group for the current timestamp
    const activeGroup = groups.find(
      (g) => currentRelSec >= g.start_sec && currentRelSec <= g.end_sec
    );
    if (!activeGroup) return;

    const fontSize = options?.font_size ?? Math.round(canvasHeight * 0.038); // ~48px on 1280h
    const fontFamily = options?.font_family ?? "Inter, system-ui, -apple-system, sans-serif";
    const primaryColor = options?.primary_color ?? "#FFFFFF";
    const highlightColor = options?.highlight_color ?? "#FACC15"; // energetic yellow
    const outlineColor = options?.outline_color ?? "#000000";
    const outlineWidth = options?.outline_width ?? Math.max(3, Math.round(fontSize * 0.12));
    const marginV = options?.margin_v ?? Math.round(canvasHeight * 0.18); // ~230px from bottom

    ctx.save();
    ctx.font = `800 ${fontSize}px ${fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const lines = activeGroup.lines;
    const lineHeight = fontSize * 1.35;
    const totalBlockHeight = lines.length * lineHeight;
    const startY = canvasHeight - marginV - totalBlockHeight / 2;

    // If karaoke is enabled, we draw word-by-word
    let wordCursor = 0;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const lineText = lines[lineIdx];
      const lineWordsInGroup = activeGroup.words.slice(
        wordCursor,
        wordCursor + lineText.split(" ").filter(Boolean).length
      );
      wordCursor += lineWordsInGroup.length;

      const y = startY + lineIdx * lineHeight;

      // Measure total line width to position individual words accurately
      const spaceWidth = ctx.measureText(" ").width;
      const wordMetrics = lineWordsInGroup.map((w) => ({
        word: w,
        width: ctx.measureText(w.text).width,
      }));
      const totalLineWidth =
        wordMetrics.reduce((sum, m) => sum + m.width, 0) +
        Math.max(0, wordMetrics.length - 1) * spaceWidth;

      let currentX = canvasWidth / 2 - totalLineWidth / 2;

      for (const m of wordMetrics) {
        const wordCenter = currentX + m.width / 2;
        const isCurrentWordActive =
          currentRelSec >= m.word.start_sec && currentRelSec <= m.word.end_sec;

        // Shadow
        ctx.shadowColor = "rgba(0, 0, 0, 0.75)";
        ctx.shadowBlur = 8;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 3;

        // Outline / Stroke
        ctx.lineWidth = outlineWidth;
        ctx.strokeStyle = outlineColor;
        ctx.lineJoin = "round";
        ctx.strokeText(m.word.text, wordCenter, y);

        // Fill with highlight or primary color
        ctx.shadowColor = "transparent";
        ctx.fillStyle = isCurrentWordActive ? highlightColor : primaryColor;
        ctx.fillText(m.word.text, wordCenter, y);

        // Extra glow on active word
        if (isCurrentWordActive) {
          ctx.save();
          ctx.shadowColor = highlightColor;
          ctx.shadowBlur = 12;
          ctx.fillStyle = highlightColor;
          ctx.fillText(m.word.text, wordCenter, y);
          ctx.restore();
        }

        currentX += m.width + spaceWidth;
      }
    }

    ctx.restore();
  }
}
