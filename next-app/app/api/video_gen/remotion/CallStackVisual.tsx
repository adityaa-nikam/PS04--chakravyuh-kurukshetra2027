import React from "react";
import type { LayeredStackData } from "../enhanced-schema";

interface CallStackVisualProps {
  data: LayeredStackData;
  frame: number;
  fps: number;
  scale: number;
  durationInFrames?: number;
}

export function CallStackVisual({
  data,
  frame,
  fps,
  scale,
  durationInFrames = 180,
}: CallStackVisualProps) {
  const t = frame / fps;
  const progress = Math.min(1, Math.max(0, frame / durationInFrames));

  const cyan = "#38BDF8";
  const purple = "#A855F7";
  const emerald = "#10B981";
  const gold = "#FACC15";

  // Pulse effect
  const pulse = Math.sin(t * 3.5) * 0.15 + 0.85;

  return (
    <div
      data-visual="call-stack"
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
          border: `1.5px solid ${purple}`,
          borderRadius: `${14 * scale}px`,
          padding: `${10 * scale}px ${14 * scale}px`,
          boxShadow: `0 0 20px ${purple}33`,
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
              background: `${purple}25`,
              border: `1px solid ${purple}88`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: `${18 * scale}px`,
            }}
          >
            🥞
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
              {data.stackTitle}
            </div>
            <div
              style={{
                fontSize: `${10 * scale}px`,
                color: purple,
                fontWeight: 700,
                letterSpacing: `${1.2 * scale}px`,
                textTransform: "uppercase",
              }}
            >
              {data.stackSubtitle}
            </div>
          </div>
        </div>

        <div
          style={{
            padding: `${3 * scale}px ${10 * scale}px`,
            borderRadius: 999,
            background: `${purple}20`,
            border: `1px solid ${purple}`,
            fontSize: `${10 * scale}px`,
            fontWeight: 700,
            color: "#E2E8F0",
          }}
        >
          ● LIFO STACK
        </div>
      </div>

      {/* Stack Frames Container */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column-reverse", // Call stack grows upward
          justifyContent: "flex-start",
          gap: `${8 * scale}px`,
          padding: `${12 * scale}px`,
          background: "rgba(10, 15, 30, 0.8)",
          border: "1.5px dashed rgba(56, 189, 248, 0.35)",
          borderRadius: `${14 * scale}px`,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {data.frames.map((frameData, index) => {
          const enterFrame = Math.min(1, Math.max(0, (frame - index * 12) / 14));
          const isActive = frameData.status === "active";
          const isResolved = frameData.status === "resolved";

          const frameColor = isResolved ? emerald : isActive ? gold : cyan;

          return (
            <div
              key={index}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: `${10 * scale}px ${14 * scale}px`,
                borderRadius: `${10 * scale}px`,
                background: isActive
                  ? "linear-gradient(135deg, rgba(250, 204, 21, 0.18), rgba(15, 23, 42, 0.95))"
                  : isResolved
                  ? "linear-gradient(135deg, rgba(16, 185, 129, 0.18), rgba(15, 23, 42, 0.95))"
                  : "rgba(15, 23, 42, 0.85)",
                border: `1.5px solid ${frameColor}`,
                boxShadow: isActive ? `0 0 18px ${gold}40` : "none",
                transform: `translateY(${(1 - enterFrame) * 20}px) scale(${0.96 + enterFrame * 0.04})`,
                opacity: enterFrame,
                transition: "all 0.2s ease",
              }}
            >
              {/* Left: Frame index & Function Call */}
              <div style={{ display: "flex", alignItems: "center", gap: `${10 * scale}px` }}>
                <span
                  style={{
                    fontFamily: "monospace",
                    fontSize: `${11 * scale}px`,
                    fontWeight: 700,
                    color: frameColor,
                    background: `${frameColor}20`,
                    padding: `${2 * scale}px ${6 * scale}px`,
                    borderRadius: `${4 * scale}px`,
                  }}
                >
                  FRAME #{index + 1}
                </span>

                <span
                  style={{
                    fontFamily: "monospace",
                    fontSize: `${15 * scale}px`,
                    fontWeight: 800,
                    color: "#F8FAFC",
                  }}
                >
                  {frameData.functionName}(<span style={{ color: cyan }}>{frameData.args}</span>)
                </span>
              </div>

              {/* Right: Return value or active indicator */}
              <div style={{ display: "flex", alignItems: "center", gap: `${6 * scale}px` }}>
                {frameData.returnValue ? (
                  <span
                    style={{
                      fontFamily: "monospace",
                      fontSize: `${12 * scale}px`,
                      fontWeight: 700,
                      color: emerald,
                      background: "rgba(16, 185, 129, 0.15)",
                      padding: `${3 * scale}px ${8 * scale}px`,
                      borderRadius: `${6 * scale}px`,
                      border: `1px solid ${emerald}50`,
                    }}
                  >
                    return {frameData.returnValue}
                  </span>
                ) : (
                  <span
                    style={{
                      fontFamily: "monospace",
                      fontSize: `${11 * scale}px`,
                      fontWeight: 700,
                      color: gold,
                      letterSpacing: `${1 * scale}px`,
                    }}
                  >
                    ▶ ACTIVE {Math.round(pulse * 100) > 90 ? "●" : "○"}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Base Condition / Unwind Banner */}
      {data.baseCondition && (
        <div
          style={{
            background: "linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(15, 23, 42, 0.95))",
            border: `1.5px solid ${emerald}`,
            borderRadius: `${12 * scale}px`,
            padding: `${8 * scale}px ${14 * scale}px`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            boxShadow: `0 0 16px ${emerald}30`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: `${8 * scale}px` }}>
            <span style={{ fontSize: `${14 * scale}px` }}>🛑</span>
            <span
              style={{
                fontFamily: "monospace",
                fontSize: `${12 * scale}px`,
                fontWeight: 700,
                color: "#A7F3D0",
              }}
            >
              {data.baseCondition}
            </span>
          </div>

          <span
            style={{
              fontSize: `${10 * scale}px`,
              fontWeight: 800,
              color: emerald,
              letterSpacing: `${1 * scale}px`,
            }}
          >
            STOPS RECURSION
          </span>
        </div>
      )}
    </div>
  );
}
