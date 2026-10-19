import React from "react";
import type { TimelineLifecycleData } from "../enhanced-schema";

interface TimelineLifecycleVisualProps {
  data: TimelineLifecycleData;
  frame: number;
  fps: number;
  scale: number;
  durationInFrames?: number;
}

export function TimelineLifecycleVisual({
  data,
  frame,
  fps,
  scale,
  durationInFrames = 180,
}: TimelineLifecycleVisualProps) {
  const t = frame / fps;
  const progress = Math.min(1, Math.max(0, frame / durationInFrames));

  const cyan = "#38BDF8";
  const purple = "#A855F7";
  const emerald = "#10B981";
  const gold = "#FACC15";

  // Cycle through active phases dynamically
  const phaseCount = data.phases.length;
  const activeIndex = Math.min(phaseCount - 1, Math.floor(progress * phaseCount));

  return (
    <div
      data-visual="timeline-lifecycle"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: `${10 * scale}px`,
        padding: `${10 * scale}px`,
        fontFamily: "'Segoe UI', Roboto, sans-serif",
      }}
    >
      {/* Top Header Card */}
      <div
        style={{
          background: "linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))",
          border: `1.5px solid ${cyan}`,
          borderRadius: `${14 * scale}px`,
          padding: `${10 * scale}px ${14 * scale}px`,
          boxShadow: `0 0 20px ${cyan}33`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: `${10 * scale}px` }}>
          <div
            style={{
              width: `${36 * scale}px`,
              height: `${36 * scale}px`,
              borderRadius: `${8 * scale}px`,
              background: `${cyan}25`,
              border: `1px solid ${cyan}88`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: `${18 * scale}px`,
            }}
          >
            ⏱️
          </div>
          <div>
            <div
              style={{
                fontSize: `${18 * scale}px`,
                fontWeight: 800,
                color: "#F8FAFC",
                letterSpacing: `${0.5 * scale}px`,
              }}
            >
              {data.lifecycleTitle}
            </div>
            <div
              style={{
                fontSize: `${10 * scale}px`,
                color: cyan,
                fontWeight: 700,
                letterSpacing: `${1.2 * scale}px`,
                textTransform: "uppercase",
              }}
            >
              Sequential Protocol Lifecycle
            </div>
          </div>
        </div>

        <div
          style={{
            padding: `${3 * scale}px ${10 * scale}px`,
            borderRadius: 999,
            background: `${cyan}20`,
            border: `1px solid ${cyan}`,
            fontSize: `${10 * scale}px`,
            fontWeight: 700,
            color: "#E2E8F0",
          }}
        >
          STEP {activeIndex + 1} OF {phaseCount}
        </div>
      </div>

      {/* Sequential Phase List */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-around",
          gap: `${8 * scale}px`,
          padding: `${12 * scale}px`,
          background: "rgba(10, 15, 30, 0.8)",
          border: "1.5px dashed rgba(56, 189, 248, 0.35)",
          borderRadius: `${14 * scale}px`,
          position: "relative",
        }}
      >
        {data.phases.map((phase, idx) => {
          const isPassed = idx < activeIndex;
          const isCurrent = idx === activeIndex;
          const isPending = idx > activeIndex;

          const color = isPassed ? emerald : isCurrent ? gold : "#64748B";

          return (
            <div
              key={idx}
              style={{
                display: "flex",
                alignItems: "center",
                gap: `${12 * scale}px`,
                padding: `${10 * scale}px ${14 * scale}px`,
                borderRadius: `${10 * scale}px`,
                background: isCurrent
                  ? "linear-gradient(135deg, rgba(250, 204, 21, 0.15), rgba(15, 23, 42, 0.95))"
                  : isPassed
                  ? "linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(15, 23, 42, 0.85))"
                  : "rgba(15, 23, 42, 0.6)",
                border: `1.5px solid ${color}`,
                boxShadow: isCurrent ? `0 0 20px ${gold}35` : "none",
                transform: isCurrent ? "scale(1.02)" : "scale(1)",
                transition: "all 0.3s ease",
              }}
            >
              {/* Step Number Circle */}
              <div
                style={{
                  width: `${32 * scale}px`,
                  height: `${32 * scale}px`,
                  borderRadius: "50%",
                  background: isPassed ? emerald : isCurrent ? gold : "rgba(255, 255, 255, 0.1)",
                  color: isPending ? "#94A3B8" : "#0F172A",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: `${14 * scale}px`,
                  fontWeight: 900,
                  boxShadow: isCurrent ? `0 0 12px ${gold}` : "none",
                }}
              >
                {isPassed ? "✓" : phase.phaseNumber}
              </div>

              {/* Phase Info */}
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: `${15 * scale}px`,
                    fontWeight: 800,
                    color: isCurrent ? gold : "#F8FAFC",
                    display: "flex",
                    alignItems: "center",
                    gap: `${8 * scale}px`,
                  }}
                >
                  {phase.name}
                  {isCurrent && (
                    <span
                      style={{
                        fontSize: `${9 * scale}px`,
                        fontWeight: 700,
                        background: `${gold}20`,
                        color: gold,
                        padding: `${2 * scale}px ${6 * scale}px`,
                        borderRadius: `${4 * scale}px`,
                      }}
                    >
                      IN PROGRESS
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: `${11 * scale}px`,
                    color: isCurrent ? "#E2E8F0" : "#94A3B8",
                    marginTop: `${2 * scale}px`,
                  }}
                >
                  {phase.detail}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Progress Track Bar */}
      <div
        style={{
          background: "rgba(15, 23, 42, 0.9)",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: `${10 * scale}px`,
          padding: `${8 * scale}px ${14 * scale}px`,
          display: "flex",
          flexDirection: "column",
          gap: `${6 * scale}px`,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: `${10 * scale}px`, color: "#94A3B8" }}>
          <span>PROTOCOL EXECUTION</span>
          <span style={{ color: emerald, fontWeight: 700 }}>{Math.round(progress * 100)}% COMPLETE</span>
        </div>
        <div
          style={{
            width: "100%",
            height: `${6 * scale}px`,
            borderRadius: 999,
            background: "rgba(255, 255, 255, 0.1)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${progress * 100}%`,
              height: "100%",
              background: `linear-gradient(90deg, ${cyan}, ${emerald})`,
              borderRadius: 999,
              boxShadow: `0 0 10px ${cyan}`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
