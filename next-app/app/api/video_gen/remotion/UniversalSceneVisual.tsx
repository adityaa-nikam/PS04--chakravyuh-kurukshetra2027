import React from "react";
import type { EnhancedSceneVisual } from "../enhanced-schema";
import { CodeWalkthroughVisual } from "./CodeWalkthroughVisual";
import { CallStackVisual } from "./CallStackVisual";
import { TimelineLifecycleVisual } from "./TimelineLifecycleVisual";
import { DataTransformationVisual } from "./DataTransformationVisual";
import { QuantitativeGraphVisual } from "./QuantitativeGraphVisual";
import { IllustrativeAssetVisual } from "./IllustrativeAssetVisual";
import { AlgorithmVisual } from "./AlgorithmVisual";
import { ArchitectureFlowVisual } from "./ArchitectureFlowVisual";
import { ConceptComparisonVisual } from "./ConceptComparisonVisual";
import { ConceptOpenerVisual } from "./ConceptOpenerVisual";
import { TakeawayVisual } from "./TakeawayVisual";
import type { VisualScene } from "../visual-plan";

interface UniversalSceneVisualProps {
  enhancedVisual: EnhancedSceneVisual;
  legacyVisual: VisualScene;
  frame: number;
  fps: number;
  scale: number;
  durationInFrames?: number;
}

export function UniversalSceneVisual({
  enhancedVisual,
  legacyVisual,
  frame,
  fps,
  scale,
  durationInFrames = 180,
}: UniversalSceneVisualProps) {
  switch (enhancedVisual.kind) {
    case "code_walkthrough":
      return (
        <CodeWalkthroughVisual
          data={enhancedVisual}
          frame={frame}
          fps={fps}
          scale={scale}
          durationInFrames={durationInFrames}
        />
      );

    case "layered_stack":
      return (
        <CallStackVisual
          data={enhancedVisual}
          frame={frame}
          fps={fps}
          scale={scale}
          durationInFrames={durationInFrames}
        />
      );

    case "timeline_lifecycle":
      return (
        <TimelineLifecycleVisual
          data={enhancedVisual}
          frame={frame}
          fps={fps}
          scale={scale}
          durationInFrames={durationInFrames}
        />
      );

    case "data_transformation":
      return (
        <DataTransformationVisual
          data={enhancedVisual}
          frame={frame}
          fps={fps}
          scale={scale}
          durationInFrames={durationInFrames}
        />
      );

    case "quantitative_graph":
      return (
        <QuantitativeGraphVisual
          data={enhancedVisual}
          frame={frame}
          fps={fps}
          scale={scale}
          durationInFrames={durationInFrames}
        />
      );

    case "illustrative_asset":
      return (
        <IllustrativeAssetVisual
          data={enhancedVisual}
          frame={frame}
          fps={fps}
          scale={scale}
          durationInFrames={durationInFrames}
        />
      );

    case "algorithm_demo":
      return (
        <AlgorithmVisual
          data={enhancedVisual}
          visual={legacyVisual}
          frame={frame}
          fps={fps}
          scale={scale}
          durationInFrames={durationInFrames}
        />
      );

    case "architecture_flow":
      return (
        <ArchitectureFlowVisual
          data={enhancedVisual}
          visual={legacyVisual}
          frame={frame}
          fps={fps}
          scale={scale}
          durationInFrames={durationInFrames}
        />
      );

    case "dual_comparison":
      return (
        <ConceptComparisonVisual
          data={enhancedVisual}
          visual={legacyVisual}
          frame={frame}
          fps={fps}
          scale={scale}
          durationInFrames={durationInFrames}
        />
      );

    case "conceptual_metaphor":
      return (
        <ConceptOpenerVisual
          data={enhancedVisual}
          visual={legacyVisual}
          frame={frame}
          fps={fps}
          scale={scale}
          title={enhancedVisual.conceptTitle}
        />
      );

    case "typography_definition":
      return (
        <TakeawayVisual
          data={enhancedVisual}
          visual={legacyVisual}
          frame={frame}
          fps={fps}
          scale={scale}
          title={enhancedVisual.mainTerm}
        />
      );

    default:
      return null;
  }
}
