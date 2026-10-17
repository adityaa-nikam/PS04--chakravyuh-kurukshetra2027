export type TextRole = "heading" | "narration" | "visual_direction" | "label" | "note";
export type TextBox = { width: number; height: number; scrollWidth: number; scrollHeight: number };

export function textFits(box: TextBox) {
  return box.width > 0 && box.height > 0
    && box.scrollWidth <= box.width + 1 && box.scrollHeight <= box.height + 1;
}

// Measure each candidate in the browser. Never shrink below the readable floor.
export function fitText(
  sceneId: string, role: TextRole, preferred: number, minimum: number,
  measure: (fontSize: number) => TextBox,
) {
  let font = Math.max(preferred, minimum);
  for (;;) {
    const box = measure(font);
    if (textFits(box)) return font;
    if (font <= minimum) {
      throw new Error(`TEXT_OVERFLOW: scene=${sceneId} role=${role}; box=${box.width}x${box.height}; scroll=${box.scrollWidth}x${box.scrollHeight}; minimumFont=${minimum}px. Revise layout or increase resolution.`);
    }
    font = Math.max(minimum, font - 1);
  }
}

export function textSizes(role: TextRole, scale: number, statistic = false) {
  const preferred = (role === "heading" ? 44 : role === "narration" ? (statistic ? 36 : 30) : 24) * scale;
  const minimum = Math.max(role === "heading" ? 20 : 16, (role === "heading" ? 28 : 24) * scale);
  return { preferred: Math.max(preferred, minimum), minimum };
}

// Account for the different font sizes, reserving useful space for both panels.
export function narrationShare(narration: string, direction: string) {
  const weight = narration.length * 30 * 30;
  return Math.min(0.75, Math.max(0.55, weight / (weight + direction.length * 24 * 24)));
}
