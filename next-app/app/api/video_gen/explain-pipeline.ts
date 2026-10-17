import { generateVisualActions, compileActions, visualActionsSchema, type VisualAction } from "./visual-actions";
import { ACTION_EVIDENCE, actionCatalog } from "./action-catalog";
import { existsSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { scriptRequestSchema, explainerScriptSchema, type ExplainerScript, type ScriptRequest } from "./schema";
import { buildStoryboard, type Storyboard } from "./storyboard";
import { generateExplainerScript } from "./script-generator";
import { generateModelVisualPlan, modelSpecifications, validateModelVisualPlan, modelVisualPlanSchema, type ModelVisualPlan, type PlanningOptions, modelVisualSceneSchema } from "./model-visual-plan";
import { renderStoryboard } from "./render-service";
import { outputPaths } from "./output-path";
import { explainOptionsSchema, type ExplainOptions } from "./explain-options";
import { renderOptionsSchema, prepareRender } from "./render-plan";
import { inferenceModel, inferenceProvider } from "./inference";
import { redactDiagnostics, type InferenceContext, type InferenceDiagnostic } from "./ollama";

const receiptSchema = z.strictObject({
  version: z.literal(1), request: scriptRequestSchema, script: explainerScriptSchema,
  provider: z.enum(["ollama", "openrouter"]).optional(), plannerProvider: z.enum(["ollama", "openrouter"]).optional(),
  model: z.string().min(1), generatedAt: z.string().datetime(), output: z.string().min(1),
  renderOptions: renderOptionsSchema.optional(), visuals: z.string().optional(), browser: z.string().optional(),
  planner: z.enum(["graph", "actions-v1"]).optional(), actionPlan: visualActionsSchema.optional(), completedActions: visualActionsSchema.optional(),
  visualPlan: modelVisualPlanSchema.optional(), completedScenes: z.array(modelVisualSceneSchema).max(8).optional(),
  inferenceDiagnostics: z.array(z.unknown()).optional(), visualAttempts: z.array(z.unknown()).optional(), planningFailure: z.string().optional(), plannerModel: z.string().optional(), plannedAt: z.string().datetime().optional(),
});
type Dependencies = {
  generateScript: (request: ScriptRequest, context?: InferenceContext) => Promise<ExplainerScript>;
  planVisuals: (storyboard: Storyboard, options?: PlanningOptions) => Promise<ModelVisualPlan>;
  render: typeof renderStoryboard;
  requestsDirectory: string;
};
export class PendingExplanation extends Error {
  constructor(public readonly receipt: string, reason: string) {
    super(`DURATION_APPROVAL_REQUIRED: ${reason}\nSaved the unchanged generated script at ${receipt}\nTo approve this exact script: npm run explain -- --resume ${"'" + receipt.replace(/'/g, "'\"'\"'") + "'"} --approve-overrun\nTo revise, submit a new prompt/target duration. No video was rendered.`);
  }
}

export async function explain(input: ExplainOptions, overrides: Partial<Dependencies> = {}) {
  const options = explainOptionsSchema.parse(input);
  const deps: Dependencies = {
    generateScript: (request, context) => generateExplainerScript(request, { live: true, visualPlanning: true, onDiagnostic: context?.onDiagnostic }),
    planVisuals: generateModelVisualPlan, render: renderStoryboard, requestsDirectory: path.resolve("artifacts/requests"), ...overrides,
  };
  let receiptPath = options.resume ? path.resolve(options.resume) : undefined;
  let saved = receiptPath ? receiptSchema.parse(JSON.parse(readFileSync(receiptPath, "utf8"))) : undefined;
  const actionMode = options.visualActions ?? (saved?.planner === "actions-v1");
  if (saved && actionMode !== (saved.planner === "actions-v1") && !options.replan) throw new Error("Changing planner requires --resume with --replan; old visual checkpoints will not be reused.");
  if (actionMode && (options.visuals || saved?.visuals)) throw new Error("Visual-action v1 does not accept --visuals overrides; use the graph path for explicit renderer specifications.");
  const request = saved?.request ?? scriptRequestSchema.parse({ topic: options.prompt, targetAudience: options.audience, durationSeconds: options.duration });
  const paths = outputPaths(request.topic, options.output ?? saved?.output);
  // Collision check before either model call, followed by authoritative locked check at publication.
  if (existsSync(paths.video) || existsSync(paths.metadata) || existsSync(paths.lock)) throw new Error(`Output already exists or is locked: ${paths.video}. Use --output with a fresh path.`);
  console.info(saved ? "[explain] resuming_saved_script" : "[explain] generating_live_script", { model: saved?.model ?? inferenceModel() });
  const renderOptions = renderOptionsSchema.parse({ width: options.width ?? saved?.renderOptions?.width, height: options.height ?? saved?.renderOptions?.height, fps: options.fps ?? saved?.renderOptions?.fps, approveOverrun: options.approveOverrun });
  const explicitPath = options.visuals ? path.resolve(options.visuals) : saved?.visuals;
  const browser = options.browser ?? saved?.browser;
  const inferenceDiagnostics: unknown[] = [...(saved?.inferenceDiagnostics ?? [])];
  const onDiagnostic = (event: InferenceDiagnostic) => {
    inferenceDiagnostics.push(event);
    if (saved && receiptPath) {
      saved = { ...saved, inferenceDiagnostics };
      writeFileSync(receiptPath, JSON.stringify(saved, null, 2));
    }
  };
  const script = explainerScriptSchema.parse(saved?.script ?? await deps.generateScript(request, { onDiagnostic }));
  if (script.estimatedDurationSeconds !== request.durationSeconds) throw new Error("INVALID_OUTPUT: model's declared duration must equal the requested target. Retry generation; the duration policy was not changed.");
  const storyboard = buildStoryboard(script);
  if (!saved) {
    mkdirSync(deps.requestsDirectory, { recursive: true });
    receiptPath = path.join(mkdtempSync(path.join(deps.requestsDirectory, "request-")), "request.json");
    saved = { version: 1, planner: actionMode ? "actions-v1" : "graph", request, script, provider: inferenceProvider(), inferenceDiagnostics, model: inferenceModel(), generatedAt: new Date().toISOString(), output: paths.video, renderOptions: { ...renderOptions, approveOverrun: false }, visuals: explicitPath, browser };
    writeFileSync(receiptPath, JSON.stringify(saved, null, 2), { flag: "wx" });
  }
  if (storyboard.durationPolicy.classification === "requires_revision" && !options.approveOverrun) throw new PendingExplanation(receiptPath!, storyboard.durationPolicy.reason ?? "Generated narration exceeds the target.");
  if (options.replan) {
    // Preserve the failed request/plan as diagnostic evidence. A replan makes
    // sequential model calls for visuals only, with the original narration untouched.
    mkdirSync(deps.requestsDirectory, { recursive: true });
    receiptPath = path.join(mkdtempSync(path.join(deps.requestsDirectory, "request-")), "request.json");
    saved = { ...saved, planner: actionMode ? "actions-v1" : "graph", actionPlan: undefined, completedActions: undefined, output: paths.video, visualPlan: undefined, completedScenes: undefined, visualAttempts: undefined, planningFailure: undefined, plannerModel: undefined, plannerProvider: undefined, plannedAt: undefined };
    writeFileSync(receiptPath, JSON.stringify(saved, null, 2), { flag: "wx" });
  }
  const reusedPlan = Boolean(saved.visualPlan);
  let visualPlan: ModelVisualPlan;
  try {
    console.info(reusedPlan ? "[explain] reusing_saved_visual_plan" : "[explain] generating_live_visual_plan", { model: saved.plannerModel ?? inferenceModel() });
    const planningOptions: PlanningOptions = {
      completed: saved.completedScenes, onDiagnostic,
      onResponse: report => {
        const directory = path.join(path.dirname(receiptPath!), "diagnostics");
        mkdirSync(directory, { recursive: true });
        const filename = path.join(mkdtempSync(path.join(directory, `${report.sceneId ?? "scene"}-`)), "response.json");
        writeFileSync(filename, JSON.stringify(redactDiagnostics(report), null, 2), { flag: "wx", mode: 0o600 });
      },
      onAttempt: attempt => {
        const directory = path.join(path.dirname(receiptPath!), "diagnostics");
        mkdirSync(directory, { recursive: true });
        const filename = path.join(mkdtempSync(path.join(directory, `${attempt.sceneId}-validation-`)), "validation.json");
        writeFileSync(filename, JSON.stringify(redactDiagnostics(attempt), null, 2), { flag: "wx", mode: 0o600 });
        saved = { ...saved!, output: paths.video, completedScenes: saved?.completedScenes ?? [], visualAttempts: [...(saved?.visualAttempts ?? []), redactDiagnostics(attempt)] };
        writeFileSync(receiptPath!, JSON.stringify(saved, null, 2));
      },
      onScene: completedScenes => {
        saved = { ...saved!, completedScenes, inferenceDiagnostics, planningFailure: undefined };
        writeFileSync(receiptPath!, JSON.stringify(saved, null, 2));
      },
    };
    if (actionMode) {
      let actions: VisualAction[];
      if (saved.actionPlan) actions = saved.actionPlan;
      else {
        if (saved.visualPlan) throw new Error("Missing action plan for cached action visuals; use --replan --inspect.");
        const result = await generateVisualActions(storyboard, { ...planningOptions, completedActions: saved.completedActions,
          onAction: completedActions => {
            saved = { ...saved!, completedActions, output: paths.video, inferenceDiagnostics };
            writeFileSync(receiptPath!, JSON.stringify(saved, null, 2));
          } });
        actions = result.actions;
      }
      visualPlan = compileActions(actions, storyboard);
      if (saved.visualPlan && JSON.stringify(saved.visualPlan) !== JSON.stringify(visualPlan)) throw new Error("Saved action/render plans differ; use --replan --inspect.");
      saved = { ...saved, actionPlan: actions, completedActions: undefined };
    } else visualPlan = validateModelVisualPlan(saved.visualPlan ?? await deps.planVisuals(storyboard, planningOptions), storyboard);
    saved = { ...saved, output: paths.video, renderOptions: { ...renderOptions, approveOverrun: false }, visuals: explicitPath, browser, visualPlan, completedScenes: undefined, planningFailure: undefined, inferenceDiagnostics, plannerProvider: saved.plannerProvider ?? (reusedPlan ? "ollama" : inferenceProvider()), plannerModel: saved.plannerModel ?? (reusedPlan ? saved.model : inferenceModel()), plannedAt: saved.plannedAt ?? new Date().toISOString() };
    // Only this internal receipt is updated; final deliverables remain exclusive.
    writeFileSync(receiptPath!, JSON.stringify(saved, null, 2));
    const explicit = explicitPath ? z.record(z.string(), z.unknown()).parse(JSON.parse(readFileSync(explicitPath, "utf8"))) : {};
    const specifications = { ...modelSpecifications(visualPlan), ...explicit };
    const resolved = prepareRender(storyboard, renderOptions, specifications, actionMode ? ACTION_EVIDENCE : undefined);
    if (options.inspect) {
      const inspectionFile = path.join(path.dirname(receiptPath!), "resolved-plan.json");
      const report = { mode: "inspection-only", published: false, output: paths.video, metadata: paths.metadata, requestReceipt: receiptPath, inspectionFile,
        inferenceDiagnostics, visualActions: saved.actionPlan, exampleCatalog: actionMode ? actionCatalog(storyboard) : undefined, factChecked: false, durationSeconds: resolved.durationInFrames / resolved.settings.fps, modelVisualPlan: visualPlan, ...resolved };
      writeFileSync(inspectionFile, JSON.stringify(report, null, 2));
      return report;
    }
    console.info("[explain] rendering", { output: paths.video });
    const result = await deps.render(storyboard, renderOptions, specifications, paths.video,
      { provider: saved.provider ?? "ollama", plannerProvider: saved.plannerProvider, planner: saved.planner ?? "graph", visualActions: saved.actionPlan, exampleCatalog: actionMode ? actionCatalog(storyboard) : undefined, inferenceDiagnostics, model: saved.model, plannerModel: saved.plannerModel, generatedAt: saved.generatedAt, plannedAt: saved.plannedAt, request, originalScript: script, modelVisualPlan: visualPlan, explicitOverrides: Object.keys(explicit), requestReceipt: receiptPath, factChecked: false }, undefined, browser, actionMode ? ACTION_EVIDENCE : undefined);
    return { ...result, requestReceipt: receiptPath, planning: reusedPlan ? `saved-${saved.plannerProvider}-plan` : `live-${saved.plannerProvider}`, factChecked: false };
  } catch (error) {
    saved = { ...saved, inferenceDiagnostics, planningFailure: error instanceof Error ? error.message : "Planning/render failed" };
    if (!reusedPlan) writeFileSync(receiptPath!, JSON.stringify(saved, null, 2));
    console.error("[explain] planning_or_render_failure", { receipt: receiptPath, reason: saved.planningFailure });
    throw new Error(`${error instanceof Error ? error.message : "Planning/render failed"}\nSaved request: ${receiptPath}. For an invalid cached plan use --resume with --replan --inspect and a fresh --output; only visual planning will call Ollama. Otherwise retry --resume with the same approval flag if needed. No generated narration was shortened.`, { cause: error });
  }
}
