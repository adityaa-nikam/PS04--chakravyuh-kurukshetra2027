import React from "react";
import type { CodeWalkthroughData } from "../enhanced-schema";

interface CodeWalkthroughVisualProps {
  data: CodeWalkthroughData;
  frame: number;
  fps: number;
  scale: number;
  durationInFrames?: number;
}

export function CodeWalkthroughVisual({
  data,
  frame,
  fps,
  scale,
  durationInFrames = 180,
}: CodeWalkthroughVisualProps) {
  const t = frame / fps;
  const progress = Math.min(1, Math.max(0, frame / durationInFrames));

  const lines = data.code.split("\n").filter(l => l.trim().length > 0);
  const cyan = "#38BDF8";
  const purple = "#A855F7";
  const emerald = "#10B981";
  const gold = "#FACC15";

  // Cycle highlighted lines based on progress if multiple
  const highlightSet = new Set(data.highlightLines || [1]);

  return (
    <div
      data-visual="code-walkthrough"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: `${10 * scale}px`,
        padding: `${8 * scale}px`,
        fontFamily: "'Segoe UI', Roboto, sans-serif",
      }}
    >
      {/* Editor Window Frame */}
      <div
        style={{
          flex: 1,
          background: "linear-gradient(135deg, rgba(15, 23, 42, 0.98), rgba(20, 28, 48, 0.95))",
          border: `1.5px solid ${cyan}`,
          borderRadius: `${14 * scale}px`,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: `0 0 24px ${cyan}33`,
        }}
      >
        {/* Editor Titlebar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: `${8 * scale}px ${14 * scale}px`,
            background: "rgba(10, 15, 30, 0.95)",
            borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
          }}
        >
          {/* Mac window dots */}
          <div style={{ display: "flex", alignItems: "center", gap: `${6 * scale}px` }}>
            <span style={{ width: `${10 * scale}px`, height: `${10 * scale}px`, borderRadius: "50%", background: "#EF4444" }} />
            <span style={{ width: `${10 * scale}px`, height: `${10 * scale}px`, borderRadius: "50%", background: "#F59E0B" }} />
            <span style={{ width: `${10 * scale}px`, height: `${10 * scale}px`, borderRadius: "50%", background: "#10B981" }} />
          </div>

          {/* Active File Tab */}
          <div
            style={{
              fontFamily: "monospace",
              fontSize: `${12 * scale}px`,
              fontWeight: 700,
              color: "#F8FAFC",
              display: "flex",
              alignItems: "center",
              gap: `${6 * scale}px`,
            }}
          >
            <span>📄</span>
            <span>{data.title}</span>
          </div>

          {/* Language Badge */}
          <span
            style={{
              fontFamily: "monospace",
              fontSize: `${10 * scale}px`,
              fontWeight: 800,
              color: cyan,
              background: `${cyan}18`,
              border: `1px solid ${cyan}66`,
              padding: `${2 * scale}px ${8 * scale}px`,
              borderRadius: `${4 * scale}px`,
              textTransform: "uppercase",
            }}
          >
            {data.language}
          </span>
        </div>

        {/* Code Lines Body */}
        <div
          style={{
            flex: 1,
            padding: `${12 * scale}px`,
            fontFamily: "'Fira Code', 'Courier New', monospace",
            fontSize: `${13 * scale}px`,
            lineHeight: 1.6,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: `${4 * scale}px`,
            overflow: "hidden",
          }}
        >
          {lines.slice(0, 8).map((lineText, idx) => {
            const lineNum = idx + 1;
            const isHighlighted = highlightSet.has(lineNum);

            return (
              <div
                key={idx}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: `${12 * scale}px`,
                  padding: `${3 * scale}px ${8 * scale}px`,
                  borderRadius: `${6 * scale}px`,
                  background: isHighlighted ? "rgba(56, 189, 248, 0.18)" : "transparent",
                  borderLeft: isHighlighted ? `3px solid ${gold}` : "3px solid transparent",
                  boxShadow: isHighlighted ? `0 0 16px rgba(56, 189, 248, 0.25)` : "none",
                  transition: "all 0.2s ease",
                }}
              >
                {/* Line Number */}
                <span
                  style={{
                    color: isHighlighted ? gold : "#475569",
                    width: `${20 * scale}px`,
                    textAlign: "right",
                    fontSize: `${11 * scale}px`,
                    userSelect: "none",
                  }}
                >
                  {lineNum}
                </span>

                {/* Code Content */}
                <span
                  style={{
                    color: isHighlighted ? "#FFFFFF" : "#CBD5E1",
                    fontWeight: isHighlighted ? 700 : 500,
                    whiteSpace: "pre",
                  }}
                >
                  {lineText}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Terminal Output Box (Optional) */}
      {data.executionOutput && (
        <div
          style={{
            background: "rgba(10, 15, 30, 0.95)",
            border: `1.5px solid ${emerald}`,
            borderRadius: `${10 * scale}px`,
            padding: `${8 * scale}px ${12 * scale}px`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            boxShadow: `0 0 16px ${emerald}30`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: `${8 * scale}px` }}>
            <span style={{ fontSize: `${12 * scale}px`, color: emerald }}>$</span>
            <span
              style={{
                fontFamily: "monospace",
                fontSize: `${11 * scale}px`,
                color: "#E2E8F0",
                fontWeight: 600,
              }}
            >
              {data.executionOutput}
            </span>
          </div>

          <span
            style={{
              fontSize: `${9 * scale}px`,
              fontWeight: 800,
              color: emerald,
              letterSpacing: `${1 * scale}px`,
            }}
          >
            ● OUTPUT
          </span>
        </div>
      )}
    </div>
  );
}
