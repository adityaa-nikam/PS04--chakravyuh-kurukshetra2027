// Code-owned primitives: time is always local to the allocated scene, never a clock.
export function frameProgress(frame: number, durationInFrames: number) {
  return Math.max(0, Math.min(1, frame / Math.max(1, durationInFrames - 1)));
}

export function motionWindow(progress: number, start: number, end: number) {
  if (!(end > start)) throw new Error("Animation window must have positive duration.");
  const t = Math.max(0, Math.min(1, (progress - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

export function staggeredReveal(progress: number, start: number, end: number, count: number) {
  if (!Number.isInteger(count) || count < 1) throw new Error("Reveal needs at least one item.");
  const slot = (end - start) / count;
  return Array.from({ length: count }, (_, i) => motionWindow(progress, start + i * slot, start + (i + 1) * slot));
}

export function recordComparisonMotion(frame: number, durationInFrames: number, fields: number, focus: "structure" | "fields") {
  if (!Number.isInteger(fields) || fields < 1 || fields > 3) throw new Error("Record comparison needs 1–3 fields.");
  const progress = frameProgress(frame, durationInFrames);
  const fieldEnd = focus === "fields" ? 0.76 : 0.66;
  const fieldProgress = (progress - 0.5) / (fieldEnd - 0.5);
  const activeField = progress >= 0.5 && progress < fieldEnd ? Math.min(fields - 1, Math.floor(fieldProgress * fields)) : -1;
  return {
    progress,
    record: motionWindow(progress, 0, 0.08),
    xml: staggeredReveal(progress, 0.12, 0.3, fields + 2),
    json: staggeredReveal(progress, 0.32, 0.48, fields + 2),
    activeField,
    correspondence: activeField < 0 ? 0 : motionWindow(fieldProgress * fields - activeField, 0, 0.25),
    structure: progress >= fieldEnd && progress < 0.86,
    settle: motionWindow(progress, 0.86, 0.92),
  };
}
