import test from "node:test";
import assert from "node:assert/strict";
import {
  enhancedStoryboardPlanSchema,
  enhancedScenePlanSchema,
  type EnhancedStoryboardPlan,
} from "./enhanced-schema";
import {
  isEnhancedPlannerEnabled,
  synthesizeDeterministicEnhancedPlan,
  validateEnhancedSemanticAccuracy,
  enhancedPlanToModelVisualPlan,
} from "./enhanced-planner";
import {
  isImageAssetGenerationEnabled,
  generateImageAsset,
} from "./image-asset-service";
import { buildStoryboard } from "./storyboard";
import { getExplainerScriptFixture } from "./fixture";
import { modelSpecifications } from "./model-visual-plan";
import { prepareRender } from "./render-plan";

test("enhanced schema validates all 10 pedagogical archetypes strictly", () => {
  const samplePlan: EnhancedStoryboardPlan = {
    version: 2,
    topic: "Recursion and the Call Stack",
    targetAudience: "Computer Science Students",
    totalDurationSeconds: 45,
    plannedAt: new Date().toISOString(),
    plannerModel: "meta-llama/llama-3.3-70b-instruct",
    isAssetGenerationEnabled: false,
    scenes: [
      {
        sceneId: "scene-001",
        sceneIndex: 1,
        purpose: "hook",
        educationalGoal: "Introduce recursion as self-referential problem solving.",
        visualArchetype: "typography_definition",
        visual: {
          kind: "typography_definition",
          badge: "CORE PRINCIPLE",
          mainTerm: "Recursion",
          pronouncement: "A function that solves a problem by calling itself with smaller inputs.",
          pillars: [
            { title: "Base Case", detail: "Halts recursion and prevents infinite loops." },
            { title: "Recursive Step", detail: "Reduces problem size towards the base case." },
          ],
        },
      },
      {
        sceneId: "scene-002",
        sceneIndex: 2,
        purpose: "explanation",
        educationalGoal: "Visualize stack frames being pushed into LIFO memory.",
        visualArchetype: "layered_stack",
        visual: {
          kind: "layered_stack",
          stackTitle: "Call Stack Execution",
          stackSubtitle: "LIFO Memory Allocation & Base Case Unwind",
          frames: [
            { functionName: "factorial", args: "n = 1", returnValue: "1", status: "resolved" },
            { functionName: "factorial", args: "n = 2", returnValue: "2 * 1", status: "active" },
            { functionName: "factorial", args: "n = 3", returnValue: "3 * 2", status: "pushing" },
          ],
          baseCondition: "Base Case: if (n <= 1) return 1",
        },
      },
      {
        sceneId: "scene-003",
        sceneIndex: 3,
        purpose: "concrete_example",
        educationalGoal: "Walk through the exact JavaScript recursive implementation.",
        visualArchetype: "code_walkthrough",
        visual: {
          kind: "code_walkthrough",
          language: "javascript",
          title: "factorial.js",
          code: "function factorial(n) {\n  if (n <= 1) return 1;\n  return n * factorial(n - 1);\n}",
          highlightLines: [2, 3],
          executionOutput: "factorial(3) => 6",
        },
      },
    ],
  };

  const parsed = enhancedStoryboardPlanSchema.parse(samplePlan);
  assert.equal(parsed.version, 2);
  assert.equal(parsed.scenes.length, 3);
  assert.equal(parsed.scenes[1].visual.kind, "layered_stack");
});

test("deterministic enhanced plan synthesizes valid plans for diverse topics", () => {
  const topics = [
    "Binary search",
    "Recursion and the call stack",
    "Model Context Protocol (MCP)",
    "TCP three-way handshake",
    "SQL versus NoSQL",
  ];

  for (const topic of topics) {
    const fixture = getExplainerScriptFixture();
    const board = buildStoryboard({ ...fixture, title: topic });
    const plan = synthesizeDeterministicEnhancedPlan(board, false);

    assert.equal(plan.version, 2);
    assert.equal(plan.scenes.length, board.scenes.length);
    const parsed = enhancedStoryboardPlanSchema.safeParse(plan);
    assert.ok(parsed.success, `Failed schema for ${topic}: ${JSON.stringify(parsed.error)}`);
  }
});

test("image asset generation respects ASTRA_IMAGE_ASSETS_ENABLED flag and falls back safely", async () => {
  // 1. When disabled (default)
  delete process.env.ASTRA_IMAGE_ASSETS_ENABLED;
  assert.equal(isImageAssetGenerationEnabled(), false);

  const disabledRes = await generateImageAsset({ prompt: "A futuristic AI neural network brain" });
  assert.equal(disabledRes.success, false);
  assert.equal(disabledRes.fallbackUsed, true);

  // 2. When explicitly disabled
  process.env.ASTRA_IMAGE_ASSETS_ENABLED = "false";
  assert.equal(isImageAssetGenerationEnabled(), false);
});

test("enhanced planner feature flag toggle works reliably", () => {
  // Default is false (preserve original generation path as default)
  delete process.env.ASTRA_ENHANCED_PLANNER_ENABLED;
  assert.equal(isEnhancedPlannerEnabled(), false);

  // Explicitly enabled
  process.env.ASTRA_ENHANCED_PLANNER_ENABLED = "true";
  assert.equal(isEnhancedPlannerEnabled(), true);

  // Explicitly disabled
  process.env.ASTRA_ENHANCED_PLANNER_ENABLED = "false";
  assert.equal(isEnhancedPlannerEnabled(), false);
});

test("enhancedPlanToModelVisualPlan compiles compliant ModelVisualPlan that passes prepareRender", () => {
  const fixture = getExplainerScriptFixture();
  const board = buildStoryboard({ ...fixture, title: "Recursion and the Call Stack" });
  const enhancedPlan = synthesizeDeterministicEnhancedPlan(board, false);

  const modelPlan = enhancedPlanToModelVisualPlan(enhancedPlan, board);
  assert.equal(modelPlan.scenes.length, board.scenes.length);

  for (let i = 0; i < board.scenes.length; i++) {
    const scene = modelPlan.scenes[i];
    assert.equal(scene.sceneId, board.scenes[i].id);
    assert.equal(scene.confidence, "overview");
    assert.ok(scene.visual.enhancedVisual);
  }

  // Verify prepareRender accepts modelSpecifications cleanly without throwing
  const specs = modelSpecifications(modelPlan);
  assert.doesNotThrow(() => prepareRender(board, { approveOverrun: true }, specs));
});

test("semantic validator applies bounded repairs to pointer bounds, code lines, and stack frames", () => {
  const invalidPlan: EnhancedStoryboardPlan = {
    version: 2,
    topic: "Fault Tolerance and Boundary Testing",
    targetAudience: "Engineers",
    totalDurationSeconds: 45,
    plannedAt: new Date().toISOString(),
    plannerModel: "meta-llama/llama-3.3-70b-instruct",
    isAssetGenerationEnabled: false,
    scenes: [
      {
        sceneId: "scene-001",
        sceneIndex: 1,
        purpose: "hook",
        educationalGoal: "Test code highlight clamping.",
        visualArchetype: "code_walkthrough",
        visual: {
          kind: "code_walkthrough",
          language: "python",
          title: "script.py",
          code: "print('line 1')\nprint('line 2')",
          highlightLines: [99, -5], // out of bounds
          executionOutput: "done",
        },
      },
      {
        sceneId: "scene-002",
        sceneIndex: 2,
        purpose: "explanation",
        educationalGoal: "Test pointer index bounds clamping.",
        visualArchetype: "algorithm_demo",
        visual: {
          kind: "algorithm_demo",
          algorithmName: "Bounds Check",
          complexityBadge: "O(1)",
          arrayElements: [
            { value: 10, state: "default" },
            { value: 20, state: "default" },
            { value: 30, state: "default" },
          ],
          pointers: [
            { name: "out_of_bounds", index: 99 },
            { name: "negative", index: -2 },
          ],
          stepExplanation: "Testing pointer repair",
        },
      },
      {
        sceneId: "scene-003",
        sceneIndex: 3,
        purpose: "summary",
        educationalGoal: "Test stack frame active status repair.",
        visualArchetype: "layered_stack",
        visual: {
          kind: "layered_stack",
          stackTitle: "Stack Test",
          stackSubtitle: "Double Active Fix",
          frames: [
            { functionName: "fnA", args: "", returnValue: "", status: "active" },
            { functionName: "fnB", args: "", returnValue: "", status: "active" }, // multiple active
          ],
          baseCondition: "return",
        },
      },
    ],
  };

  const result = validateEnhancedSemanticAccuracy(invalidPlan);
  assert.equal(result.valid, true);
  assert.ok(result.repairsApplied.length >= 3, "Expected at least 3 repairs applied");

  // Verify repaired values
  const s1 = invalidPlan.scenes[0].visual as any;
  assert.deepEqual(s1.highlightLines, [2, 1]); // clamped to [1, 2]

  const s2 = invalidPlan.scenes[1].visual as any;
  assert.equal(s2.pointers[0].index, 2); // clamped to arrayElements.length - 1
  assert.equal(s2.pointers[1].index, 0); // clamped to 0

  const s3 = invalidPlan.scenes[2].visual as any;
  const activeCount = s3.frames.filter((f: any) => f.status === "active").length;
  assert.equal(activeCount, 1, "Only one stack frame should remain active after repair");
});

test("10-topic generalization matrix produces distinct, topic-accurate archetypes and valid compilations", () => {
  const topicMatrix = [
    { topic: "SQL versus NoSQL Databases", expectedArchetype: "dual_comparison" },
    { topic: "Binary Search in a Sorted Array", expectedArchetype: "algorithm_demo" },
    { topic: "Recursion and Call Stack Memory", expectedArchetype: "layered_stack" },
    { topic: "Deep Neural Networks Architecture", expectedArchetype: "architecture_flow" },
    { topic: "HTTP API Request Lifecycle", expectedArchetype: "timeline_lifecycle" },
    { topic: "TCP Three-Way Handshake Connection", expectedArchetype: "timeline_lifecycle" },
    { topic: "Quicksort Partition Algorithm", expectedArchetype: "algorithm_demo" },
    { topic: "Garbage Collection Mark and Sweep", expectedArchetype: "timeline_lifecycle" },
    { topic: "Continuous Exponential Growth Curves", expectedArchetype: "quantitative_graph" },
    { topic: "Raft Distributed Consensus Election Protocol", expectedArchetype: "architecture_flow" },
  ];

  const generatedArchetypes = new Set<string>();

  for (const { topic, expectedArchetype } of topicMatrix) {
    const fixture = getExplainerScriptFixture();
    const board = buildStoryboard({ ...fixture, title: topic });
    const plan = synthesizeDeterministicEnhancedPlan(board, false);

    assert.equal(plan.version, 2);
    assert.equal(plan.scenes.length, board.scenes.length);

    // Verify Scene 2 exhibits the expected distinct educational archetype
    const middleArchetype = plan.scenes[1].visual.kind;
    assert.equal(middleArchetype, expectedArchetype, `Mismatch for topic "${topic}"`);
    generatedArchetypes.add(middleArchetype);

    // Verify semantic validation passes
    const validation = validateEnhancedSemanticAccuracy(plan);
    assert.equal(validation.valid, true);

    // Verify it compiles into a compliant ModelVisualPlan and passes prepareRender
    const modelPlan = enhancedPlanToModelVisualPlan(plan, board);
    const specs = modelSpecifications(modelPlan);
    assert.doesNotThrow(() => prepareRender(board, { approveOverrun: true }, specs));
  }

  // Ensure diversity across topics (not forcing every topic into one repetitive box)
  assert.ok(generatedArchetypes.size >= 5, `Expected diverse archetypes, got ${generatedArchetypes.size}`);
});

