import { z } from "zod";
import { generateJson, inferenceModel, inferenceProvider } from "./inference";
import type { Storyboard } from "./storyboard";
import {
  enhancedStoryboardPlanSchema,
  enhancedScenePlanSchema,
  type EnhancedStoryboardPlan,
  type EnhancedScenePlan,
} from "./enhanced-schema";
import { generateImageAsset, isImageAssetGenerationEnabled } from "./image-asset-service";
import { validateModelVisualPlan, type ModelVisualPlan } from "./model-visual-plan";
import type { VisualScene } from "./visual-plan";

/**
 * Feature flag check for the Enhanced Planner.
 * Enabled by default or via ASTRA_ENHANCED_PLANNER_ENABLED="true".
 */
export function isEnhancedPlannerEnabled(): boolean {
  const envVal = (process.env.ASTRA_ENHANCED_PLANNER_ENABLED || "false").trim().toLowerCase();
  return envVal === "true" || envVal === "1" || envVal === "yes";
}

/**
 * Visual Planner System Prompt instructing the model to analyze educational concepts
 * and select the optimal visual archetype from the 10 general-purpose pedagogical primitives.
 */
const ENHANCED_PLANNER_SYSTEM_PROMPT = `You are a Senior Educational Motion Designer and AI Video Architect.
Your task is to plan rich, highly specific visual animations for each scene of an educational explainer video.

You have access to 10 distinct, general-purpose pedagogical visual archetypes:
1. "code_walkthrough": Syntax-highlighted code block with specific lines highlighted and execution output.
   - Use when explaining code snippets, functions, syntax, or query languages.
2. "algorithm_demo": Interactive data structure array with active pointers ("low", "mid", "high", etc.) and state colors ("matched", "eliminated", "active").
   - Use when demonstrating sorting, searching, array traversal, or binary search.
3. "layered_stack": Vertical stack frames pushed and popped with a stack pointer and base condition.
   - Use when explaining recursion, call stacks, memory management, or OSI layers.
4. "architecture_flow": Multi-tier system diagram with Client/Caller, Protocol Bus (with request/response labels), and connected Tool/Backend services.
   - Use when explaining system architectures, APIs, client-server, microservices, Model Context Protocol (MCP), or distributed systems.
5. "timeline_lifecycle": Horizontal sequence of milestone phases with active phase marker and details.
   - Use when explaining lifecycle sequences, network handshakes (e.g. TCP SYN/SYN-ACK/ACK), event loops, or garbage collection phases.
6. "data_transformation": Input data snippet flowing through a processing pipe operator into transformed output data.
   - Use when explaining data parsing, vector embeddings, compilation, serialization, or filtering.
7. "quantitative_graph": Coordinate curve (logarithmic, linear, exponential, bell_curve) with labeled axes, data points, and complexity badges.
   - Use when explaining time/space complexity (O(log n)), statistical distributions, mathematical functions, or performance curves.
8. "dual_comparison": Side-by-side contrast cards comparing two paradigms with typed feature lists and optional code snippets.
   - Use when comparing two contrasting concepts (e.g. SQL vs NoSQL, XML vs JSON, Sync vs Async).
9. "conceptual_metaphor": Real-world analogy mapping domain elements to technical roles with icons.
   - Use when introducing abstract ideas through relatable visual analogies.
10. "typography_definition": Authoritative core principle card with key pillars.
    - Use for opening hooks or conclusive takeaways.

RULES:
- Choose the archetype that BEST teaches the concept being explained in each scene.
- Fill all archetype fields with accurate, topic-specific data. Never leave placeholder strings.
- Scene 1 is usually a hook (conceptual_metaphor, typography_definition, or architecture_flow).
- Scene 2 is the core mechanical explanation (algorithm_demo, layered_stack, architecture_flow, code_walkthrough, or timeline_lifecycle).
- Scene 3 is the concrete example or takeaway (dual_comparison, code_walkthrough, data_transformation, or typography_definition).
- Return strictly valid JSON adhering to the provided schema.`;

/**
 * Plans educational visuals using the Enhanced LLM Planner.
 */
export async function planEnhancedStoryboard(
  board: Storyboard,
  options: { live?: boolean; forceArchetype?: string } = {}
): Promise<EnhancedStoryboardPlan> {
  const started = Date.now();
  const plannerModel = inferenceModel();
  const imageAssetsEnabled = isImageAssetGenerationEnabled();

  const userPayload = {
    title: board.title,
    targetAudience: board.targetAudience,
    totalDurationSeconds: board.durationPolicy.declaredTargetDurationSeconds,
    scenes: board.scenes.map((s, idx) => ({
      sceneId: s.id,
      sceneIndex: idx + 1,
      purpose: idx === 0 ? "hook" : idx === board.scenes.length - 1 ? "summary" : "explanation",
      narration: s.narration,
      suggestedVisualDirection: s.visualDirection,
      estimatedDurationSeconds: s.estimatedDurationSeconds,
    })),
    imageAssetsEnabled,
  };

  const outputSchema = enhancedStoryboardPlanSchema;

  let plan: EnhancedStoryboardPlan | undefined;
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const prompt = attempt === 1
        ? ENHANCED_PLANNER_SYSTEM_PROMPT
        : `${ENHANCED_PLANNER_SYSTEM_PROMPT}\n\nPREVIOUS ATTEMPT VALIDATION ERROR: ${lastError instanceof Error ? lastError.message : String(lastError)}. Please fix schema mismatches and output complete declarative scene data.`;

      const raw = await generateJson(
        outputSchema,
        userPayload,
        prompt,
        3072,
        { stage: "visual" }
      );

      plan = enhancedStoryboardPlanSchema.parse(raw);
      break;
    } catch (err) {
      lastError = err;
      console.warn(`[enhanced_planner] Attempt ${attempt} failed schema validation (${err instanceof Error ? err.message : String(err)}). Retrying...`);
    }
  }

  // Fallback to deterministic programmatic plan if LLM failed
  if (!plan) {
    console.warn("[enhanced_planner] LLM visual planning exhausted retries. Synthesizing deterministic fallback plan.");
    plan = synthesizeDeterministicEnhancedPlan(board, imageAssetsEnabled);
  }

  // If optional image assets are enabled, attempt asset generation for illustrative scenes
  if (imageAssetsEnabled) {
    for (const scene of plan.scenes) {
      if (scene.visual.kind === "illustrative_asset") {
        const result = await generateImageAsset({ prompt: scene.visual.prompt });
        if (result.success && result.assetPath) {
          scene.visual.assetPath = result.assetPath;
        } else {
          console.info(`[enhanced_planner] Illustrative asset generation skipped for ${scene.sceneId}. Retaining deterministic fallback visual.`);
        }
      }
    }
  }

  console.info("[enhanced_planner] Visual planning completed successfully", {
    topic: board.title,
    archetypes: plan.scenes.map((s) => s.visual.kind),
    elapsedMs: Date.now() - started,
  });

  return plan;
}

/**
 * Deterministic fallback generator for when the LLM planner is unavailable or disabled.
 * Produces valid, topic-specific enhanced plans across all pedagogical archetypes.
 */
export function synthesizeDeterministicEnhancedPlan(
  board: Storyboard,
  imageAssetsEnabled = false
): EnhancedStoryboardPlan {
  const topicLower = board.title.toLowerCase();

  const isComparison = /vs|versus|comparison|difference|sql.*nosql|xml.*json|relational.*document/i.test(topicLower);
  const isBinarySearch = /binary search/i.test(topicLower);
  const isSort = /sort|quicksort|mergesort|bubble sort/i.test(topicLower);
  const isStack = /recursion|call stack|stack frame|fibonacci|factorial/i.test(topicLower);
  const isNeural = /neural|deep learning|backpropagation|transformer|neuron/i.test(topicLower);
  const isTcp = /tcp|three-way handshake|syn.*ack/i.test(topicLower);
  const isApi = /api.*lifecycle|request.*lifecycle|rest api|http lifecycle/i.test(topicLower);
  const isGc = /garbage collect|memory leak|mark.*sweep|generational gc/i.test(topicLower);
  const isMath = /math|exponential|euler|logarithm|curve|calculus|growth|physics/i.test(topicLower);
  const isArch = /architecture|protocol|mcp|model context protocol|client.*server|agent|tool/i.test(topicLower);
  const isBiology = /photo.*synthesis|chloroplast|plant|cell|biology|dna|gene|mitosis|leaf|leaves/i.test(topicLower);
  const isPhysical = /bridge|vibrat|engine|turbine|aerodynamic|rocket|telescope/i.test(topicLower);
  const isHardware = /cpu|chip|silicon|transistor|hardware|motherboard|cache line/i.test(topicLower);
  const isVisualDepiction = /visual|diagram|depict|illustrat|picture/i.test(topicLower);

  const scenes: EnhancedScenePlan[] = board.scenes.map((s, idx) => {
    const isFirst = idx === 0;
    const isLast = idx === board.scenes.length - 1;
    const sceneId = s.id;
    const sceneIndex = idx + 1;

    if (isFirst) {
      return {
        sceneId,
        sceneIndex,
        purpose: "hook",
        educationalGoal: "Introduce the core challenge and establish conceptual context.",
        visualArchetype: "typography_definition",
        visual: {
          kind: "typography_definition",
          badge: "EDUCATIONAL EXPLAINER",
          mainTerm: board.title.slice(0, 40),
          pronouncement: s.narration.slice(0, 110),
          pillars: [
            { title: "Core Mechanism", detail: "Foundational architecture and principles." },
            { title: "Key Advantage", detail: "High operational efficiency and clarity." },
          ],
        },
      };
    }

    if (isLast) {
      return {
        sceneId,
        sceneIndex,
        purpose: "summary",
        educationalGoal: "Consolidate the primary architectural takeaway.",
        visualArchetype: "typography_definition",
        visual: {
          kind: "typography_definition",
          badge: "KEY TAKEAWAY",
          mainTerm: "Summary & Impact",
          pronouncement: s.narration.slice(0, 110),
          pillars: [
            { title: "Production Standard", detail: "Industry-standard reliable design pattern." },
            { title: "Operational Impact", detail: "Optimal trade-off between performance & simplicity." },
          ],
        },
      };
    }

    // High-fidelity AI generated illustrative asset for physical, biological, or visual subjects
    if (imageAssetsEnabled && (isBiology || isPhysical || isHardware || (isVisualDepiction && !isComparison && !isBinarySearch && !isSort && !isStack && !isNeural && !isArch))) {
      return {
        sceneId,
        sceneIndex,
        purpose: "explanation",
        educationalGoal: `Visually depict ${board.title} with high-fidelity realistic illustrative imagery.`,
        visualArchetype: "illustrative_asset",
        visual: {
          kind: "illustrative_asset",
          prompt: `detailed scientific 3D illustration of ${board.title}, high quality educational depiction, 4k digital art, dramatic tech lighting, portrait 9:16 vertical`,
          overlayHeadline: board.title.slice(0, 40),
          overlayDetail: s.narration.slice(0, 100),
          fallbackVisual: {
            kind: "typography_definition",
            badge: "VISUAL OVERVIEW",
            mainTerm: board.title.slice(0, 32),
            pronouncement: s.narration.slice(0, 100),
            pillars: [
              { title: "Physical Mechanism", detail: "Real-world operational dynamics and behavior." },
              { title: "Key Observation", detail: "Empirical structural interactions and flows." },
            ],
          },
        },
      };
    }

    // Scene 2 (Middle): Dedicated mechanical demonstration
    if (isBinarySearch) {
      return {
        sceneId,
        sceneIndex,
        purpose: "explanation",
        educationalGoal: "Demonstrate step-by-step search boundary reduction.",
        visualArchetype: "algorithm_demo",
        visual: {
          kind: "algorithm_demo",
          algorithmName: "Binary Search",
          complexityBadge: "O(log n)",
          arrayElements: [
            { value: 2, state: "eliminated" },
            { value: 8, state: "eliminated" },
            { value: 16, state: "eliminated" },
            { value: 23, state: "matched" },
            { value: 42, state: "active" },
            { value: 56, state: "default" },
            { value: 91, state: "default" },
          ],
          pointers: [
            { name: "low", index: 3 },
            { name: "mid", index: 3 },
            { name: "high", index: 6 },
          ],
          stepExplanation: "Target 23 matches array[mid] exactly in logarithmic time.",
        },
      };
    }

    if (isSort) {
      return {
        sceneId,
        sceneIndex,
        purpose: "explanation",
        educationalGoal: "Demonstrate partition swapping and element ordering.",
        visualArchetype: "algorithm_demo",
        visual: {
          kind: "algorithm_demo",
          algorithmName: "Quicksort Partition",
          complexityBadge: "O(n log n)",
          arrayElements: [
            { value: 3, state: "eliminated" },
            { value: 5, state: "matched" },
            { value: 2, state: "active" },
            { value: 8, state: "default" },
            { value: 7, state: "default" },
          ],
          pointers: [
            { name: "left", index: 0 },
            { name: "pivot", index: 1 },
            { name: "right", index: 4 },
          ],
          stepExplanation: "Partitioning array around pivot 5: values smaller than 5 swap left.",
        },
      };
    }

    if (isStack) {
      return {
        sceneId,
        sceneIndex,
        purpose: "explanation",
        educationalGoal: "Visualize call stack frames push, active execution, and return unwind.",
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
      };
    }

    if (isNeural) {
      return {
        sceneId,
        sceneIndex,
        purpose: "explanation",
        educationalGoal: "Demonstrate forward pass matrix multiplication and activation layers.",
        visualArchetype: "architecture_flow",
        visual: {
          kind: "architecture_flow",
          systemName: "Deep Neural Network",
          caller: {
            name: "Input Vector (X)",
            role: "Normalized Features",
            badge: "TENSOR",
          },
          protocol: {
            name: "Synaptic Weights & Bias",
            transport: "Matrix Multiply (W·X + b)",
            requestLabel: "FORWARD: Activation Pass",
            responseLabel: "BACKPROP: Loss Gradients",
          },
          services: [
            { name: "Dense Layer", desc: "Feature transformation", icon: "🧠" },
            { name: "ReLU Activation", desc: "Non-linear thresholding", icon: "⚡" },
            { name: "Softmax Layer", desc: "Probability distribution", icon: "📊" },
            { name: "Cross Entropy", desc: "Supervised loss function", icon: "🎯" },
          ],
        },
      };
    }

    if (isTcp) {
      return {
        sceneId,
        sceneIndex,
        purpose: "explanation",
        educationalGoal: "Demonstrate TCP three-way handshake connection establishment.",
        visualArchetype: "timeline_lifecycle",
        visual: {
          kind: "timeline_lifecycle",
          lifecycleTitle: "TCP Handshake Lifecycle",
          phases: [
            { phaseNumber: 1, name: "SYN (Init)", detail: "Client dispatches SYN packet with Seq=100", status: "completed" },
            { phaseNumber: 2, name: "SYN-ACK", detail: "Server returns SYN-ACK with Seq=300, Ack=101", status: "active" },
            { phaseNumber: 3, name: "ACK (Established)", detail: "Client acknowledges; duplex stream ready for payload", status: "pending" },
          ],
          currentPhaseIndex: 1,
        },
      };
    }

    if (isApi) {
      return {
        sceneId,
        sceneIndex,
        purpose: "explanation",
        educationalGoal: "Demonstrate client-server request and response pipeline.",
        visualArchetype: "timeline_lifecycle",
        visual: {
          kind: "timeline_lifecycle",
          lifecycleTitle: "API Request Lifecycle",
          phases: [
            { phaseNumber: 1, name: "DNS & TLS", detail: "Domain resolution and cryptographic handshake", status: "completed" },
            { phaseNumber: 2, name: "Gateway Auth", detail: "API key validation and rate limit inspection", status: "completed" },
            { phaseNumber: 3, name: "Controller Exec", detail: "Routing, validation, and business logic execution", status: "active" },
            { phaseNumber: 4, name: "Database Query", detail: "Indexed lookup and relational state retrieval", status: "pending" },
            { phaseNumber: 5, name: "JSON Response", detail: "HTTP 200 OK serialized payload dispatched", status: "pending" },
          ],
          currentPhaseIndex: 2,
        },
      };
    }

    if (isGc) {
      return {
        sceneId,
        sceneIndex,
        purpose: "explanation",
        educationalGoal: "Demonstrate mark-and-sweep memory reclamation.",
        visualArchetype: "timeline_lifecycle",
        visual: {
          kind: "timeline_lifecycle",
          lifecycleTitle: "Garbage Collection Phases",
          phases: [
            { phaseNumber: 1, name: "Root Set Scan", detail: "Identify live global variables and call stack references", status: "completed" },
            { phaseNumber: 2, name: "Mark Reachable", detail: "Traverse object reference tree and mark active nodes", status: "active" },
            { phaseNumber: 3, name: "Sweep Unused", detail: "Deallocate unreferenced heap memory blocks", status: "pending" },
            { phaseNumber: 4, name: "Compaction", detail: "Defragment surviving memory into contiguous space", status: "pending" },
          ],
          currentPhaseIndex: 1,
        },
      };
    }

    if (isMath) {
      return {
        sceneId,
        sceneIndex,
        purpose: "explanation",
        educationalGoal: "Demonstrate continuous rate-of-change and exponential acceleration.",
        visualArchetype: "quantitative_graph",
        visual: {
          kind: "quantitative_graph",
          graphTitle: "Continuous Exponential Growth",
          xAxisLabel: "Time (t)",
          yAxisLabel: "Magnitude N(t)",
          curveType: "exponential",
          points: [
            { label: "Initial N₀", xPercent: 10, yPercent: 10, highlight: false },
            { label: "Doubling Point", xPercent: 50, yPercent: 35, highlight: true },
            { label: "Vertical Accel", xPercent: 85, yPercent: 90, highlight: true },
          ],
          takeawayFormula: "N(t) = N₀ · e^(kt)",
        },
      };
    }

    if (isArch) {
      return {
        sceneId,
        sceneIndex,
        purpose: "explanation",
        educationalGoal: "Demonstrate multi-tier bidirectional protocol flow.",
        visualArchetype: "architecture_flow",
        visual: {
          kind: "architecture_flow",
          systemName: "Model Context Protocol (MCP)",
          caller: {
            name: "AI Host Client",
            role: "Claude Desktop • IDE Agent",
            badge: "CONTEXT AWARE",
          },
          protocol: {
            name: "MCP Standardized Bus",
            transport: "JSON-RPC 2.0 (stdio/SSE)",
            requestLabel: "REQUEST: tools/call & prompts/get",
            responseLabel: "RESPONSE: Tool execution data",
          },
          services: [
            { name: "Filesystem", desc: "Read & edit source files", icon: "📁" },
            { name: "Database/SQL", desc: "Execute schema queries", icon: "🗄️" },
            { name: "GitHub API", desc: "PRs & commit history", icon: "🐙" },
            { name: "Web / Tools", desc: "Search & Fetch docs", icon: "🔍" },
          ],
        },
      };
    }

    if (isComparison) {
      return {
        sceneId,
        sceneIndex,
        purpose: "explanation",
        educationalGoal: "Contrast structural and behavioral tradeoffs side-by-side.",
        visualArchetype: "dual_comparison",
        visual: {
          kind: "dual_comparison",
          topicTitle: board.title.slice(0, 40),
          leftSide: {
            name: "Relational (SQL)",
            badge: "STRUCTURED",
            features: ["Strict Table Schema", "ACID Transactions", "Foreign Key Integrity"],
          },
          rightSide: {
            name: "Document (NoSQL)",
            badge: "FLEXIBLE",
            features: ["Dynamic JSON Documents", "Horizontal Sharding", "Schema-on-Read"],
          },
          contrastCriterion: "Relational Consistency vs Horizontal Scale",
        },
      };
    }

    // General-purpose / Unfamiliar topic: dynamic semantic synthesis
    const narrationText = s.narration;
    const isSequential = /phase|step|then|after|first|next|cycle/i.test(narrationText);
    if (isSequential) {
      return {
        sceneId,
        sceneIndex,
        purpose: "explanation",
        educationalGoal: "Demonstrate ordered state transitions and execution flow.",
        visualArchetype: "timeline_lifecycle",
        visual: {
          kind: "timeline_lifecycle",
          lifecycleTitle: `${board.title.slice(0, 32)} Process`,
          phases: [
            { phaseNumber: 1, name: "Initiation", detail: "Establish baseline state and allocate resources", status: "completed" },
            { phaseNumber: 2, name: "Core Processing", detail: "Execute main logical transformation", status: "active" },
            { phaseNumber: 3, name: "Verification", detail: "Confirm consistency guarantees and finalize", status: "pending" },
          ],
          currentPhaseIndex: 1,
        },
      };
    }

    return {
      sceneId,
      sceneIndex,
      purpose: "explanation",
      educationalGoal: "Illustrate programmatic processing and state transformation.",
      visualArchetype: "data_transformation",
      visual: {
        kind: "data_transformation",
        processName: `${board.title.slice(0, 28)} Engine`,
        input: {
          label: "Input State",
          snippet: "{ status: 'initial', ready: true }",
        },
        pipeOperator: "Core Processing Engine",
        output: {
          label: "Processed Result",
          snippet: "{ status: 'converged', verified: true }",
        },
      },
    };
  });

  return {
    version: 2,
    topic: board.title,
    targetAudience: board.targetAudience,
    totalDurationSeconds: board.durationPolicy.declaredTargetDurationSeconds,
    scenes,
    plannedAt: new Date().toISOString(),
    plannerModel: "deterministic-enhanced-v2",
    isAssetGenerationEnabled: imageAssetsEnabled,
  };
}

/**
 * Validates the semantic accuracy of an enhanced plan and applies bounded repairs
 * for structural consistency before sending to Remotion.
 */
export interface SemanticValidationResult {
  valid: boolean;
  repairsApplied: string[];
  diagnostics: string[];
}

export function validateEnhancedSemanticAccuracy(
  plan: EnhancedStoryboardPlan
): SemanticValidationResult {
  const repairsApplied: string[] = [];
  const diagnostics: string[] = [];

  for (const scene of plan.scenes) {
    const v = scene.visual;
    switch (v.kind) {
      case "code_walkthrough": {
        const lineCount = v.code.split("\n").length;
        if (!v.highlightLines || v.highlightLines.length === 0) {
          v.highlightLines = [1];
          repairsApplied.push(`${scene.sceneId}: set default highlight line [1]`);
        } else {
          const clamped = v.highlightLines
            .map(l => Math.max(1, Math.min(lineCount, l)))
            .filter((val, idx, arr) => arr.indexOf(val) === idx);
          if (JSON.stringify(clamped) !== JSON.stringify(v.highlightLines)) {
            repairsApplied.push(`${scene.sceneId}: clamped highlight lines to [1, ${lineCount}]`);
            v.highlightLines = clamped;
          }
        }
        break;
      }
      case "algorithm_demo": {
        const arrLen = v.arrayElements.length;
        if (arrLen < 3) {
          diagnostics.push(`${scene.sceneId}: algorithm_demo arrayElements has fewer than 3 items`);
        }
        for (const ptr of v.pointers) {
          if (ptr.index < 0 || ptr.index >= arrLen) {
            const oldIdx = ptr.index;
            ptr.index = Math.max(0, Math.min(arrLen - 1, ptr.index));
            repairsApplied.push(`${scene.sceneId}: pointer '${ptr.name}' index ${oldIdx} clamped to ${ptr.index}`);
          }
        }
        break;
      }
      case "layered_stack": {
        if (!v.frames || v.frames.length === 0) {
          v.frames = [{ functionName: "main", args: "", returnValue: "void", status: "active" }];
          repairsApplied.push(`${scene.sceneId}: initialized empty stack frames`);
        }
        const activeCount = v.frames.filter(f => f.status === "active").length;
        if (activeCount > 1) {
          let foundFirst = false;
          for (const f of v.frames) {
            if (f.status === "active") {
              if (foundFirst) f.status = "resolved";
              else foundFirst = true;
            }
          }
          repairsApplied.push(`${scene.sceneId}: normalized multiple active stack frames`);
        }
        break;
      }
      case "timeline_lifecycle": {
        const numPhases = v.phases.length;
        if (v.currentPhaseIndex < 0 || v.currentPhaseIndex >= numPhases) {
          const old = v.currentPhaseIndex;
          v.currentPhaseIndex = Math.max(0, Math.min(numPhases - 1, v.currentPhaseIndex));
          repairsApplied.push(`${scene.sceneId}: currentPhaseIndex ${old} clamped to ${v.currentPhaseIndex}`);
        }
        break;
      }
      case "quantitative_graph": {
        if (!v.points || v.points.length < 2) {
          v.points = [
            { label: "Start", xPercent: 10, yPercent: 10, highlight: false },
            { label: "End", xPercent: 90, yPercent: 90, highlight: true },
          ];
          repairsApplied.push(`${scene.sceneId}: provided default points for quantitative_graph`);
        }
        for (const p of v.points) {
          p.xPercent = Math.max(0, Math.min(100, p.xPercent));
          p.yPercent = Math.max(0, Math.min(100, p.yPercent));
        }
        if (!v.takeawayFormula) {
          v.takeawayFormula = "O(log n)";
          repairsApplied.push(`${scene.sceneId}: set default takeawayFormula`);
        }
        break;
      }
      case "architecture_flow": {
        if (!v.services || v.services.length === 0) {
          v.services = [
            { name: "Primary Service", desc: "Core processing engine", icon: "⚡" },
            { name: "Storage/State", desc: "Persistent database", icon: "🗄️" },
          ];
          repairsApplied.push(`${scene.sceneId}: added baseline services to architecture_flow`);
        }
        break;
      }
      case "dual_comparison": {
        if (!v.leftSide.features.length) v.leftSide.features = ["Core paradigm behavior"];
        if (!v.rightSide.features.length) v.rightSide.features = ["Alternative trade-off structure"];
        if (v.contrastCriterion && v.contrastCriterion.length > 48) {
          v.contrastCriterion = v.contrastCriterion.slice(0, 48);
          repairsApplied.push(`${scene.sceneId}: clamped contrastCriterion to 48 chars`);
        }
        break;
      }
      case "typography_definition": {
        if (!v.pillars || v.pillars.length === 0) {
          v.pillars = [
            { title: "Core Principle", detail: "Primary operational mechanism." },
            { title: "Implementation Impact", detail: "Key architectural benefit." },
          ];
          repairsApplied.push(`${scene.sceneId}: provided default pillars for typography_definition`);
        }
        break;
      }
      default:
        break;
    }
  }

  return {
    valid: diagnostics.length === 0,
    repairsApplied,
    diagnostics,
  };
}

/**
 * Compiles an EnhancedStoryboardPlan into a fully valid ModelVisualPlan
 * compatible with prepareRender, assertions, and receipt checkpoints.
 */
export function enhancedPlanToModelVisualPlan(
  plan: EnhancedStoryboardPlan,
  storyboard: Storyboard
): ModelVisualPlan {
  const scenes = storyboard.scenes.map((scene, idx) => {
    const enhancedScene = plan.scenes[idx];
    const narration = scene.narration.trim();
    const sentenceMatch = narration.match(/[^.!?]+[.!?]?/) || [narration];
    const evidence = sentenceMatch[0].trim().slice(0, 120);

    const words = evidence.replace(/[^a-zA-Z0-9\s]/g, " ").split(/\s+/).filter(w => w.length >= 3);
    const label = (words[0] || storyboard.title.split(" ")[0] || "Concept").slice(0, 24);

    const heading = (enhancedScene?.visualArchetype
      ? enhancedScene.visualArchetype.replace(/_/g, " ").toUpperCase()
      : storyboard.title
    ).slice(0, 60);

    const graph = {
      topic: "general" as const,
      layout: "overview" as const,
      nodes: [
        {
          id: `node-${idx + 1}`,
          label,
          evidence,
          icon: "item" as const,
          role: "item" as const,
        },
      ],
      edges: [],
      values: [],
      actions: [],
    };

    const visual: VisualScene = {
      sceneId: scene.id,
      concept: idx === 0 ? "hook" : idx === storyboard.scenes.length - 1 ? "summary" : "diagram",
      renderer: "graph",
      mode: "overview",
      heading,
      labels: [label],
      note: "Topic overview • structured pedagogical animation",
      enhancedVisual: enhancedScene?.visual,
      graph,
    };

    return {
      sceneId: scene.id,
      purpose: idx === 0 ? "hook" as const : idx === storyboard.scenes.length - 1 ? "summary" as const : "explanation" as const,
      explanation: (enhancedScene?.educationalGoal || scene.visualDirection || narration).slice(0, 150),
      confidence: "overview" as const,
      visual,
    };
  });

  return validateModelVisualPlan({ scenes }, storyboard);
}
