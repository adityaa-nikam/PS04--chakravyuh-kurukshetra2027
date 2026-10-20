import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import type { RenderPlan } from "../render-plan";
import { assertVisualDomain } from "../visual-plan";
import { FitText } from "./FitText";
import { visualComponents } from "./Visuals";
import { KaraokeCaptions } from "./KaraokeCaptions";

// Theme generator to give each video topic a unique, modern visual identity
export function getVisualTheme(title: string, index: number) {
  const t = title.toLowerCase();

  if (/ai|rag|model|llm|neural|gpt|agent|machine learning/i.test(t)) {
    return {
      name: "cyber-ai",
      tag: "AI ARCHITECTURE",
      bgDark: "#060913",
      glow1: "rgba(168, 85, 247, 0.22)", // Violet
      glow2: "rgba(6, 182, 212, 0.18)",  // Cyan
      accent1: "#A855F7",
      accent2: "#06B6D4",
      highlight: "#FBBF24",
      cardBorder: "rgba(168, 85, 247, 0.35)",
      noteColor: "#94A3B8",
      barGrad: "linear-gradient(90deg, #A855F7, #06B6D4)",
    };
  }
  if (/database|sql|cloud|api|server|network|storage|backend|vector/i.test(t)) {
    return {
      name: "cloud-sapphire",
      tag: "SYSTEMS & CLOUD",
      bgDark: "#050B18",
      glow1: "rgba(59, 130, 246, 0.22)", // Blue
      glow2: "rgba(16, 185, 129, 0.18)", // Mint
      accent1: "#3B82F6",
      accent2: "#10B981",
      highlight: "#38BDF8",
      cardBorder: "rgba(59, 130, 246, 0.35)",
      noteColor: "#94A3B8",
      barGrad: "linear-gradient(90deg, #3B82F6, #10B981)",
    };
  }
  if (/code|algorithm|sort|tree|git|python|javascript|rust|program/i.test(t)) {
    return {
      name: "matrix-emerald",
      tag: "ALGORITHM & CODE",
      bgDark: "#05130D",
      glow1: "rgba(16, 185, 129, 0.22)", // Emerald
      glow2: "rgba(56, 189, 248, 0.18)", // Sky
      accent1: "#10B981",
      accent2: "#38BDF8",
      highlight: "#FBBF24",
      cardBorder: "rgba(16, 185, 129, 0.35)",
      noteColor: "#94A3B8",
      barGrad: "linear-gradient(90deg, #10B981, #38BDF8)",
    };
  }
  if (/physics|bridge|engine|speed|force|mechanical|car|traffic/i.test(t)) {
    return {
      name: "sunset-fusion",
      tag: "PHYSICS & ENGINEERING",
      bgDark: "#13090F",
      glow1: "rgba(244, 63, 94, 0.22)",  // Rose
      glow2: "rgba(245, 158, 11, 0.18)", // Amber
      accent1: "#F43F5E",
      accent2: "#F59E0B",
      highlight: "#FDE047",
      cardBorder: "rgba(244, 63, 94, 0.35)",
      noteColor: "#FDA4AF",
      barGrad: "linear-gradient(90deg, #F43F5E, #F59E0B)",
    };
  }

  // Diverse dynamic themes for other educational topics
  const hash = Math.abs(title.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) + index);
  const palettes = [
    {
      name: "cyber-violet",
      tag: "CONCEPT LAB",
      bgDark: "#070A14",
      glow1: "rgba(139, 92, 246, 0.22)",
      glow2: "rgba(236, 72, 153, 0.18)",
      accent1: "#8B5CF6",
      accent2: "#EC4899",
      highlight: "#FBBF24",
      cardBorder: "rgba(139, 92, 246, 0.35)",
      noteColor: "#94A3B8",
      barGrad: "linear-gradient(90deg, #8B5CF6, #EC4899)",
    },
    {
      name: "neon-cyan",
      tag: "KNOWLEDGE LAB",
      bgDark: "#040E14",
      glow1: "rgba(6, 182, 212, 0.22)",
      glow2: "rgba(99, 102, 241, 0.18)",
      accent1: "#06B6D4",
      accent2: "#6366F1",
      highlight: "#FBBF24",
      cardBorder: "rgba(6, 182, 212, 0.35)",
      noteColor: "#94A3B8",
      barGrad: "linear-gradient(90deg, #06B6D4, #6366F1)",
    },
    {
      name: "aurora-teal",
      tag: "DISCOVERY LAB",
      bgDark: "#051310",
      glow1: "rgba(20, 184, 166, 0.22)",
      glow2: "rgba(59, 130, 246, 0.18)",
      accent1: "#14B8A6",
      accent2: "#3B82F6",
      highlight: "#FACC15",
      cardBorder: "rgba(20, 184, 166, 0.35)",
      noteColor: "#94A3B8",
      barGrad: "linear-gradient(90deg, #14B8A6, #3B82F6)",
    },
  ];
  return palettes[hash % palettes.length];
}

function VisualScene({ plan, index }: { plan: RenderPlan; index: number }) {
  return <SceneFrame plan={plan} index={index} frame={useCurrentFrame()} />;
}

export function SceneFrame({ plan, index, frame }: { plan: RenderPlan; index: number; frame: number }) {
  const scene = plan.storyboard.scenes[index];
  const visual = plan.visuals[index];
  if (!scene || !visual || visual.sceneId !== scene.id || plan.frames[index]?.id !== scene.id || !Object.hasOwn(visualComponents, visual.renderer)) {
    throw new Error(`RENDER_PLAN: missing, invalid or mismatched resolved visual for scene index ${index}`);
  }
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

  const theme = getVisualTheme(plan.storyboard.title, index);

  // Floating ambient glow orbs positions
  const orb1X = 20 + Math.sin(frame / 32) * 8;
  const orb1Y = 22 + Math.cos(frame / 40) * 8;
  const orb2X = 75 + Math.cos(frame / 36) * 8;
  const orb2Y = 68 + Math.sin(frame / 28) * 8;

  const labTag = visual.renderer === "bridge"
    ? "BRIDGE LAB"
    : visual.renderer === "graph" && visual.graph.topic === "photosynthesis"
    ? "PLANT LAB"
    : visual.renderer === "graph" && visual.graph.topic === "cpu"
    ? "COMPUTING LAB"
    : `${theme.tag}`;

  const progressPercent = ((index + frame / allocation.durationInFrames) / plan.frames.length) * 100;

  return (
    <AbsoluteFill
      data-resolved-scene={scene.id}
      data-local-frame={frame}
      data-renderer={visual.renderer}
      style={{
        width,
        height,
        background: theme.bgDark,
        color: "#f8fafc",
        fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        overflow: "hidden",
      }}
    >
      {/* Background Animated Ambient Glow Orbs */}
      <div
        style={{
          position: "absolute",
          left: `${orb1X}%`,
          top: `${orb1Y}%`,
          width: 500 * scale,
          height: 500 * scale,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${theme.glow1} 0%, transparent 70%)`,
          filter: "blur(60px)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: `${orb2X}%`,
          top: `${orb2Y}%`,
          width: 440 * scale,
          height: 440 * scale,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${theme.glow2} 0%, transparent 70%)`,
          filter: "blur(60px)",
          pointerEvents: "none",
        }}
      />

      {/* Main Content Layout */}
      <div style={{ position: "absolute", inset: pad, opacity, display: "flex", flexDirection: "column" }}>
        {/* Modern Top Pill Badge */}
        <div style={{ height: 34 * scale, display: "flex", alignItems: "center" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8 * scale,
              background: "rgba(255, 255, 255, 0.06)",
              border: `1px solid ${theme.cardBorder}`,
              borderRadius: 999,
              padding: `${4 * scale}px ${14 * scale}px`,
            }}
          >
            <span
              style={{
                width: 8 * scale,
                height: 8 * scale,
                borderRadius: "50%",
                background: theme.accent1,
                boxShadow: `0 0 10px ${theme.accent1}`,
              }}
            />
            <span
              style={{
                color: theme.accent2,
                letterSpacing: 2 * scale,
                fontSize: 13 * scale,
                fontWeight: 700,
                textTransform: "uppercase",
              }}
            >
              {String(index + 1).padStart(2, "0")} / {String(plan.frames.length).padStart(2, "0")} • {labTag}
            </span>
          </div>
        </div>

        {/* Dynamic Presentation Grid */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "grid",
            gridTemplateColumns: portrait ? "minmax(0, 1fr)" : "minmax(0, 0.39fr) minmax(0, 0.61fr)",
            gridTemplateRows: portrait
              ? `${120 * scale}px minmax(0, 1fr) ${64 * scale}px ${54 * scale}px ${44 * scale}px`
              : "1fr 64px 84px 64px",
            columnGap: pad,
            rowGap: 14 * scale,
            alignItems: "center",
            paddingTop: 16 * scale,
            paddingBottom: 16 * scale,
          }}
        >
          {/* Scene Headline */}
          <div style={{ position: "relative", height: "100%", fontWeight: 700, letterSpacing: -1 * scale }}>
            <FitText
              text={visual.heading}
              sceneId={scene.id}
              role="heading"
              scale={scale}
              preferredSize={(portrait ? 50 : 38) * scale}
              minimumSize={Math.max(22, (portrait ? 36 : 28) * scale)}
              color="#F8FAFC"
            />
          </div>

          {/* Central Interactive Animation Stage */}
          <div style={{ width: stageWidth, height: stageHeight, justifySelf: "center", gridColumn: portrait ? 1 : 2, gridRow: portrait ? 2 : "1 / 5" }}>
            <Component visual={visual} frame={frame} fps={fps} scale={stageScale} durationInFrames={allocation.durationInFrames} />
          </div>

          {/* Synchronized Word-Level Active Karaoke Captions */}
          <div
            style={{
              width: "100%",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gridColumn: 1,
              gridRow: portrait ? 3 : 2,
              zIndex: 10,
            }}
          >
            <KaraokeCaptions
              narration={scene.narration}
              frame={frame}
              fps={fps}
              durationInFrames={allocation.durationInFrames}
              speechDurationInFrames={
                plan.narration?.seconds?.[index] && Number.isFinite(plan.narration.seconds[index]) && plan.narration.seconds[index] > 0
                  ? Math.min(allocation.durationInFrames, Math.round(plan.narration.seconds[index] * fps))
                  : allocation.durationInFrames
              }
              scale={scale}
              highlightColor={theme.highlight || "#FACC15"}
            />
          </div>

          {/* Topic Labels / Sub-points */}
          <div style={{ display: "flex", gap: 14 * scale, height: "100%", gridColumn: 1, gridRow: portrait ? 4 : 3 }}>
            {visual.labels.map((label, i) => (
              <div
                key={i}
                style={{
                  position: "relative",
                  flex: 1,
                  background: "rgba(255, 255, 255, 0.04)",
                  borderTop: `2px solid ${i === 0 ? theme.accent1 : i === 1 ? theme.accent2 : theme.highlight}`,
                  borderRadius: `0 0 ${8 * scale}px ${8 * scale}px`,
                  padding: `${8 * scale}px ${10 * scale}px`,
                }}
              >
                <div style={{ position: "absolute", inset: `${10 * scale}px 0 0` }}>
                  <FitText
                    text={label}
                    sceneId={scene.id}
                    role="label"
                    scale={scale}
                    preferredSize={24 * scale}
                    minimumSize={Math.max(16, 20 * scale)}
                    color={i === 2 ? theme.highlight : "#F1F5F9"}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Bottom Educational Takeaway Card */}
          <div
            style={{
              position: "relative",
              height: "100%",
              gridColumn: 1,
              gridRow: portrait ? 5 : 4,
              background: "rgba(255, 255, 255, 0.03)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: 10 * scale,
              padding: `${6 * scale}px ${14 * scale}px`,
              display: "flex",
              alignItems: "center",
            }}
          >
            <FitText
              text={`💡 ${visual.note}`}
              sceneId={scene.id}
              role="note"
              scale={scale}
              preferredSize={18 * scale}
              minimumSize={Math.max(14, 16 * scale)}
              color={theme.noteColor}
            />
          </div>
        </div>

        {/* Dual-Color Gradient Progress Bar with Runner Glow */}
        <div style={{ height: 4 * scale, background: "rgba(255, 255, 255, 0.1)", borderRadius: 999, overflow: "hidden", position: "relative" }}>
          <div
            style={{
              height: "100%",
              width: `${progressPercent}%`,
              background: theme.barGrad,
              borderRadius: 999,
              boxShadow: `0 0 12px ${theme.accent1}`,
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
}

export function Explainer({ plan }: { plan: RenderPlan }) {
  return (
    <AbsoluteFill>
      {plan.storyboard.scenes.map((scene, index) => (
        <Sequence key={scene.id} from={plan.frames[index].from} durationInFrames={plan.frames[index].durationInFrames}>
          <VisualScene plan={plan} index={index} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
