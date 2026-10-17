import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import type { RenderPlan } from "../render-plan";
import { assertVisualDomain } from "../visual-plan";
import { FitText } from "./FitText";
import { visualComponents } from "./Visuals";

function VisualScene({ plan, index }: { plan: RenderPlan; index: number }) {
  return <SceneFrame plan={plan} index={index} frame={useCurrentFrame()} />;
}

// The actual scene presentation takes an explicit local frame. Tests can exercise
// this exact component without an encoder or a second, test-only visual renderer.
export function SceneFrame({ plan, index, frame }: { plan: RenderPlan; index: number; frame: number }) {
  const scene = plan.storyboard.scenes[index];
  const visual = plan.visuals[index];
  if (!scene || !visual || visual.sceneId !== scene.id || plan.frames[index]?.id !== scene.id || !Object.hasOwn(visualComponents, visual.renderer)) throw new Error(`RENDER_PLAN: missing, invalid or mismatched resolved visual for scene index ${index}`);
  assertVisualDomain(scene, plan.storyboard.title, visual);
  const { width, height, fps } = plan.settings;
  const portrait = height > width;
  const scale = Math.min(width / (portrait ? 720 : 960), height / (portrait ? 1280 : 540));
  const pad = 40 * scale;
  const stageWidth = portrait ? width - pad * 2 : Math.min((width - pad * 3) * 0.61, (height - pad * 2 - 78 * scale) * 640 / 520);
  const stageHeight = stageWidth * 520 / 640;
  const stageScale = stageWidth / 640;
  const allocation = plan.frames[index];
  const opacity = Math.max(0, Math.min(1, frame / Math.max(1, scene.animation.enterSeconds * fps),
    (allocation.durationInFrames - frame) / Math.max(1, scene.animation.exitSeconds * fps)));
  const Component = visualComponents[visual.renderer];
  return <AbsoluteFill data-resolved-scene={scene.id} data-local-frame={frame} data-renderer={visual.renderer} style={{ width, height, background: "#091822", color: "#edf5f8", fontFamily: "Arial, sans-serif" }}>
    <div style={{ position: "absolute", inset: pad, opacity, display: "flex", flexDirection: "column" }}>
      <div style={{ color: "#63e4ec", letterSpacing: 3 * scale, fontSize: 16 * scale, height: 30 * scale }}>
        {String(index + 1).padStart(2, "0")} / {String(plan.frames.length).padStart(2, "0")} • {visual.renderer === "bridge" ? "BRIDGE LAB" : visual.renderer === "graph" && visual.graph.topic === "photosynthesis" ? "PLANT LAB" : visual.renderer === "graph" && visual.graph.topic === "cpu" ? "COMPUTING LAB" : "CONCEPT LAB"}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "grid",
        gridTemplateColumns: portrait ? "minmax(0, 1fr)" : "minmax(0, 0.39fr) minmax(0, 0.61fr)",
        gridTemplateRows: portrait ? `${180 * scale}px minmax(0, 1fr) ${64 * scale}px ${48 * scale}px` : "1fr 84px 64px",
        columnGap: pad, rowGap: 16 * scale, alignItems: "center", paddingTop: 24 * scale, paddingBottom: 20 * scale }}>
        <div style={{ position: "relative", height: "100%", fontWeight: 700, letterSpacing: -1.5 * scale }}>
          <FitText text={visual.heading} sceneId={scene.id} role="heading" scale={scale}
            preferredSize={(portrait ? 54 : 40) * scale} minimumSize={Math.max(24, (portrait ? 40 : 30) * scale)} />
        </div>
        <div style={{ width: stageWidth, height: stageHeight, justifySelf: "center", gridColumn: portrait ? 1 : 2, gridRow: portrait ? 2 : "1 / 4" }}>
          <Component visual={visual} frame={frame} fps={fps} scale={stageScale} durationInFrames={allocation.durationInFrames} />
        </div>
        <div style={{ display: "flex", gap: 16 * scale, height: "100%", gridColumn: 1 }}>
          {visual.labels.map((label, i) => <div key={i} style={{ position: "relative", flex: 1, borderTop: "2px solid #355364" }}>
            <div style={{ position: "absolute", inset: `${10 * scale}px 0 0` }}>
              <FitText text={label} sceneId={scene.id} role="label" scale={scale} preferredSize={24 * scale} minimumSize={Math.max(16, 20 * scale)} color={i === 2 ? "#ffcc66" : "#edf5f8"} />
            </div>
          </div>)}
        </div>
        <div style={{ position: "relative", height: "100%", gridColumn: 1 }}>
          <FitText text={visual.note} sceneId={scene.id} role="note" scale={scale} preferredSize={18 * scale} minimumSize={Math.max(14, 16 * scale)} color="#91aebc" />
        </div>
      </div>
      <div style={{ height: 3 * scale, background: "#274150" }}>
        <div style={{ height: "100%", width: `${(index + frame / allocation.durationInFrames) / plan.frames.length * 100}%`, background: "#63e4ec" }} />
      </div>
    </div>
  </AbsoluteFill>;
}

export function Explainer({ plan }: { plan: RenderPlan }) {
  return <AbsoluteFill>{plan.storyboard.scenes.map((scene, index) =>
    <Sequence key={scene.id} from={plan.frames[index].from} durationInFrames={plan.frames[index].durationInFrames}>
      <VisualScene plan={plan} index={index} />
    </Sequence>)}</AbsoluteFill>;
}
