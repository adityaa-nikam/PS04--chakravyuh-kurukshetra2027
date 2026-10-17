import type { VisualScene } from "./visual-plan";
import type { Storyboard } from "./storyboard";
import { recordExampleSchema } from "./visual-graph";

export const ACTION_EVIDENCE = "visual-actions-v1" as const;
export type ActionEvidence = typeof ACTION_EVIDENCE;
// Code-owned catalogue, rebuilt from unchanged source on every resume. No model
// record contents, markup parser, URLs, or executable instructions are accepted.
export function actionCatalog(board: Storyboard) {
  let record = { name: "person", fields: [{ key: "name", value: "Ana" }] };
  let sourceSceneId: string | undefined;
  for (const scene of board.scenes) {
    const root = scene.narration.match(/<([A-Za-z][A-Za-z0-9_]{0,11})>\s*</);
    if (!root) continue;
    const field = [...scene.narration.matchAll(/<([A-Za-z][A-Za-z0-9_]{0,11})>([^<>\n]{1,20})<\/\1>/g)][0];
    if (!field) continue;
    record = { name: root[1], fields: [{ key: field[1], value: field[2] }] };
    sourceSceneId = scene.id; break;
  }
  const evidence = `${record.name} ${record.fields.map(f => `${f.key} ${f.value}`).join(" ")}`;
  const example = recordExampleSchema.parse({ ...record, evidence, fields: record.fields.map(f => ({ ...f, evidence })) });
  return { id: "record-001" as const, example, sourceSceneId,
    provenance: sourceSceneId ? "source-excerpt" as const : "illustrative" as const,
    note: sourceSceneId ? "Illustrative record • source excerpt" : "Illustrative example • not source data" };
}
export function actionEvidenceText(board: Storyboard, context?: ActionEvidence, visual?: VisualScene) {
  if (context === undefined) return "";
  if (context !== ACTION_EVIDENCE) throw new Error("Invalid visual-action evidence context");
  if (!visual || visual.renderer !== "graph" || !visual.graph.example) return "";
  const catalog = actionCatalog(board);
  if (JSON.stringify(visual.graph.example) !== JSON.stringify(catalog.example) || visual.note !== catalog.note || visual.graph.edges.length || visual.graph.values.length) throw new Error("VISUAL_ACTION: illustration must match the code-owned catalogue and cannot assert relationships/data");
  // The additional evidence is exclusively a code-owned illustrative record,
  // never a model-provided relationship, measurement or source assertion.
  return actionCatalog(board).example.evidence;
}
