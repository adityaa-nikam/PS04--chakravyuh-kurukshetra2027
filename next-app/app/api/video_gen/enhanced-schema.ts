import { z } from "zod";

// Base scene identifiers
export const sceneIdRegex = /^scene-\d{3}$/;

// ----------------------------------------------------------------------------
// 1. Code Walkthrough Archetype
// ----------------------------------------------------------------------------
export const codeWalkthroughSchema = z.object({
  kind: z.literal("code_walkthrough"),
  language: z.enum(["typescript", "javascript", "python", "json", "sql", "rust", "cpp", "html", "css", "c"]).default("typescript"),
  title: z.string().min(1).max(64),
  code: z.string().min(1).max(600),
  highlightLines: z.array(z.number().int().min(1).max(30)).max(6).default([1, 2]),
  executionOutput: z.string().max(120).optional(),
});
export type CodeWalkthroughData = z.infer<typeof codeWalkthroughSchema>;

// ----------------------------------------------------------------------------
// 2. Algorithm Demonstration Archetype
// ----------------------------------------------------------------------------
export const algorithmDemoSchema = z.object({
  kind: z.literal("algorithm_demo"),
  algorithmName: z.string().min(1).max(48),
  complexityBadge: z.string().max(24).default("O(log n)"),
  arrayElements: z.array(
    z.object({
      value: z.union([z.string(), z.number()]),
      state: z.enum(["default", "active", "matched", "eliminated", "pivot"]).default("default"),
    })
  ).min(4).max(10),
  pointers: z.array(
    z.object({
      name: z.string().min(1).max(8),
      index: z.number().int().min(0).max(9),
    })
  ).max(3).default([]),
  stepExplanation: z.string().min(1).max(120),
});
export type AlgorithmDemoData = z.infer<typeof algorithmDemoSchema>;

// ----------------------------------------------------------------------------
// 3. Layered Stack / Call Stack Archetype (Recursion, Memory, OSI)
// ----------------------------------------------------------------------------
export const layeredStackSchema = z.object({
  kind: z.literal("layered_stack"),
  stackTitle: z.string().min(1).max(48),
  stackSubtitle: z.string().max(64).default("Memory Frame Hierarchy (LIFO)"),
  frames: z.array(
    z.object({
      functionName: z.string().min(1).max(32),
      args: z.string().max(32),
      returnValue: z.string().max(32).optional(),
      status: z.enum(["pushing", "active", "popping", "resolved"]).default("active"),
    })
  ).min(2).max(6),
  baseCondition: z.string().max(64).optional(),
});
export type LayeredStackData = z.infer<typeof layeredStackSchema>;

// ----------------------------------------------------------------------------
// 4. Architecture & System Flow Archetype
// ----------------------------------------------------------------------------
export const architectureFlowSchema = z.object({
  kind: z.literal("architecture_flow"),
  systemName: z.string().min(1).max(48),
  caller: z.object({
    name: z.string().min(1).max(32),
    role: z.string().max(48),
    badge: z.string().max(24).default("CLIENT / HOST"),
  }),
  protocol: z.object({
    name: z.string().min(1).max(36),
    transport: z.string().max(36),
    requestLabel: z.string().max(40),
    responseLabel: z.string().max(40),
  }),
  services: z.array(
    z.object({
      name: z.string().min(1).max(28),
      desc: z.string().max(48),
      icon: z.string().max(8).default("🔌"),
    })
  ).min(2).max(4),
});
export type ArchitectureFlowData = z.infer<typeof architectureFlowSchema>;

// ----------------------------------------------------------------------------
// 5. Timeline & Lifecycle Archetype (TCP handshake, Request-Response, GC)
// ----------------------------------------------------------------------------
export const timelineLifecycleSchema = z.object({
  kind: z.literal("timeline_lifecycle"),
  lifecycleTitle: z.string().min(1).max(48),
  phases: z.array(
    z.object({
      phaseNumber: z.number().int().min(1).max(6),
      name: z.string().min(1).max(32),
      detail: z.string().min(1).max(80),
      status: z.enum(["pending", "active", "completed"]).default("active"),
    })
  ).min(2).max(5),
  currentPhaseIndex: z.number().int().min(0).max(4).default(1),
});
export type TimelineLifecycleData = z.infer<typeof timelineLifecycleSchema>;

// ----------------------------------------------------------------------------
// 6. Data Transformation Archetype (Input -> Pipe -> Output)
// ----------------------------------------------------------------------------
export const dataTransformationSchema = z.object({
  kind: z.literal("data_transformation"),
  processName: z.string().min(1).max(48),
  input: z.object({
    label: z.string().min(1).max(32),
    snippet: z.string().min(1).max(120),
  }),
  pipeOperator: z.string().min(1).max(48),
  output: z.object({
    label: z.string().min(1).max(32),
    snippet: z.string().min(1).max(120),
  }),
});
export type DataTransformationData = z.infer<typeof dataTransformationSchema>;

// ----------------------------------------------------------------------------
// 7. Quantitative & Complexity Graph Archetype (O(log n), Bell Curve, Metrics)
// ----------------------------------------------------------------------------
export const quantitativeGraphSchema = z.object({
  kind: z.literal("quantitative_graph"),
  graphTitle: z.string().min(1).max(48),
  curveType: z.enum(["logarithmic", "linear", "exponential", "bell_curve", "step"]).default("logarithmic"),
  xAxisLabel: z.string().min(1).max(32),
  yAxisLabel: z.string().min(1).max(32),
  points: z.array(
    z.object({
      label: z.string().min(1).max(20),
      xPercent: z.number().min(0).max(100),
      yPercent: z.number().min(0).max(100),
      highlight: z.boolean().default(false),
    })
  ).min(2).max(6),
  takeawayFormula: z.string().max(48).default("O(log n)"),
});
export type QuantitativeGraphData = z.infer<typeof quantitativeGraphSchema>;

// ----------------------------------------------------------------------------
// 8. Dual Concept Comparison Archetype (SQL vs NoSQL, Sync vs Async)
// ----------------------------------------------------------------------------
export const dualComparisonSchema = z.object({
  kind: z.literal("dual_comparison"),
  topicTitle: z.string().min(1).max(48),
  leftSide: z.object({
    name: z.string().min(1).max(28),
    badge: z.string().max(24),
    features: z.array(z.string().max(48)).min(2).max(4),
    snippet: z.string().max(80).optional(),
  }),
  rightSide: z.object({
    name: z.string().min(1).max(28),
    badge: z.string().max(24),
    features: z.array(z.string().max(48)).min(2).max(4),
    snippet: z.string().max(80).optional(),
  }),
  contrastCriterion: z.string().max(48).default("Key Architectural Difference"),
});
export type DualComparisonData = z.infer<typeof dualComparisonSchema>;

// ----------------------------------------------------------------------------
// 9. Conceptual Metaphor Archetype
// ----------------------------------------------------------------------------
export const conceptualMetaphorSchema = z.object({
  kind: z.literal("conceptual_metaphor"),
  conceptTitle: z.string().min(1).max(48),
  analogyDomain: z.string().min(1).max(48),
  elements: z.array(
    z.object({
      icon: z.string().max(8),
      role: z.string().min(1).max(28),
      analogyText: z.string().min(1).max(60),
    })
  ).min(2).max(4),
});
export type ConceptualMetaphorData = z.infer<typeof conceptualMetaphorSchema>;

// ----------------------------------------------------------------------------
// 10. Typography Definition & Takeaway Archetype
// ----------------------------------------------------------------------------
export const typographyDefinitionSchema = z.object({
  kind: z.literal("typography_definition"),
  badge: z.string().max(32).default("CORE PRINCIPLE"),
  mainTerm: z.string().min(1).max(48),
  pronouncement: z.string().min(1).max(120),
  pillars: z.array(
    z.object({
      title: z.string().min(1).max(28),
      detail: z.string().min(1).max(64),
    })
  ).min(2).max(3),
});
export type TypographyDefinitionData = z.infer<typeof typographyDefinitionSchema>;

// ----------------------------------------------------------------------------
// 11. Optional AI Illustrative Asset Archetype
// ----------------------------------------------------------------------------
export const illustrativeAssetSchema = z.object({
  kind: z.literal("illustrative_asset"),
  prompt: z.string().min(10).max(400),
  assetPath: z.string().optional(),
  overlayHeadline: z.string().min(1).max(48),
  overlayDetail: z.string().min(1).max(120),
  // Deterministic fallback if image generation is disabled or fails
  fallbackVisual: z.union([conceptualMetaphorSchema, typographyDefinitionSchema]),
});
export type IllustrativeAssetData = z.infer<typeof illustrativeAssetSchema>;

// ----------------------------------------------------------------------------
// Master Discriminated Union for Enhanced Visual Scene Plans
// ----------------------------------------------------------------------------
export const enhancedSceneVisualSchema = z.discriminatedUnion("kind", [
  codeWalkthroughSchema,
  algorithmDemoSchema,
  layeredStackSchema,
  architectureFlowSchema,
  timelineLifecycleSchema,
  dataTransformationSchema,
  quantitativeGraphSchema,
  dualComparisonSchema,
  conceptualMetaphorSchema,
  typographyDefinitionSchema,
  illustrativeAssetSchema,
]);
export type EnhancedSceneVisual = z.infer<typeof enhancedSceneVisualSchema>;

// ----------------------------------------------------------------------------
// Enhanced Scene Plan
// ----------------------------------------------------------------------------
export const enhancedScenePlanSchema = z.object({
  sceneId: z.string().regex(sceneIdRegex),
  sceneIndex: z.number().int().min(1).max(8),
  purpose: z.enum(["hook", "explanation", "concrete_example", "summary"]),
  educationalGoal: z.string().min(1).max(140),
  visualArchetype: z.enum([
    "code_walkthrough",
    "algorithm_demo",
    "layered_stack",
    "architecture_flow",
    "timeline_lifecycle",
    "data_transformation",
    "quantitative_graph",
    "dual_comparison",
    "conceptual_metaphor",
    "typography_definition",
    "illustrative_asset",
  ]),
  visual: enhancedSceneVisualSchema,
});
export type EnhancedScenePlan = z.infer<typeof enhancedScenePlanSchema>;

// ----------------------------------------------------------------------------
// Enhanced Storyboard Plan
// ----------------------------------------------------------------------------
export const enhancedStoryboardPlanSchema = z.object({
  version: z.literal(2),
  topic: z.string().min(1).max(300),
  targetAudience: z.string().min(1).max(100),
  totalDurationSeconds: z.number().int().min(15).max(120),
  scenes: z.array(enhancedScenePlanSchema).min(3).max(8),
  plannedAt: z.string().datetime(),
  plannerModel: z.string().min(1),
  isAssetGenerationEnabled: z.boolean().default(false),
});
export type EnhancedStoryboardPlan = z.infer<typeof enhancedStoryboardPlanSchema>;
