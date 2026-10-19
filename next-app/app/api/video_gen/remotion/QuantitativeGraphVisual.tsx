import React from "react";
import type { QuantitativeGraphData } from "../enhanced-schema";

interface QuantitativeGraphVisualProps {
  data: QuantitativeGraphData;
  frame: number;
  fps: number;
  scale: number;
  durationInFrames?: number;
}

export function QuantitativeGraphVisual({
  data,
  frame,
  fps,
  scale,
  durationInFrames = 180,
}: QuantitativeGraphVisualProps) {
  const t = frame / fps;
  const progress = Math.min(1, Math.max(0, frame / durationInFrames));

  const cyan = "#38BDF8";
  const purple = "#A855F7";
  const emerald = "#10B981";
  const gold = "#FACC15";

  // Generate SVG curve path based on curveType
  let curvePath = "M 40 260 Q 120 80, 440 60"; // Default logarithmic
  if (data.curveType === "exponential") {
    curvePath = "M 40 260 Q 300 240, 440 40";
  } else if (data.curveType === "bell_curve") {
    curvePath = "M 40 260 C 140 260, 180 50, 240 50 C 300 50, 340 260, 440 260";
  } else if (data.curveType === "linear") {
    curvePath = "M 40 260 L 440 60";
  }

  return (
    <div
      data-visual="quantitative-graph"
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
            📈
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
              {data.graphTitle}
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
              {data.curveType.replace("_", " ")} Curve
            </div>
          </div>
        </div>

        <div
          style={{
            padding: `${3 * scale}px ${10 * scale}px`,
            borderRadius: 999,
            background: `${gold}20`,
            border: `1px solid ${gold}`,
            fontSize: `${11 * scale}px`,
            fontWeight: 800,
            fontFamily: "monospace",
            color: gold,
          }}
        >
          {data.takeawayFormula}
        </div>
      </div>

      {/* Graph Coordinate Canvas */}
      <div
        style={{
          flex: 1,
          background: "rgba(10, 15, 30, 0.85)",
          border: "1.5px dashed rgba(56, 189, 248, 0.35)",
          borderRadius: `${14 * scale}px`,
          position: "relative",
          padding: `${10 * scale}px`,
        }}
      >
        <svg viewBox="0 0 480 300" style={{ width: "100%", height: "100%" }}>
          <defs>
            <linearGradient id="curve-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={cyan} />
              <stop offset="100%" stopColor={emerald} />
            </linearGradient>
            <filter id="curve-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Grid lines */}
          {[60, 110, 160, 210, 260].map((y, i) => (
            <line key={`h-${i}`} x1="40" y1={y} x2="440" y2={y} stroke="rgba(255, 255, 255, 0.08)" strokeDasharray="4 4" />
          ))}
          {[120, 200, 280, 360].map((x, i) => (
            <line key={`v-${i}`} x1={x} y1="40" x2={x} y2="260" stroke="rgba(255, 255, 255, 0.08)" strokeDasharray="4 4" />
          ))}

          {/* Coordinate Axes */}
          <line x1="40" y1="260" x2="440" y2="260" stroke="#64748B" strokeWidth="2" />
          <line x1="40" y1="260" x2="40" y2="40" stroke="#64748B" strokeWidth="2" />

          {/* Animated Curve */}
          <path
            d={curvePath}
            fill="none"
            stroke="url(#curve-gradient)"
            strokeWidth="4"
            filter="url(#curve-glow)"
            strokeDasharray="600"
            strokeDashoffset={Math.max(0, 600 * (1 - progress * 1.5))}
          />

          {/* Points along curve */}
          {data.points.map((pt, i) => {
            const px = 40 + (pt.xPercent / 100) * 400;
            const py = 260 - (pt.yPercent / 100) * 220;
            const isVisible = progress > (i / data.points.length) * 0.7;

            return (
              <g key={i} opacity={isVisible ? 1 : 0} style={{ transition: "opacity 0.3s ease" }}>
                <circle cx={px} cy={py} r="8" fill={pt.highlight ? gold : cyan} opacity="0.4" />
                <circle cx={px} cy={py} r="4.5" fill={pt.highlight ? gold : cyan} />
                <text
                  x={px}
                  y={py - 12}
                  fill={pt.highlight ? gold : "#F8FAFC"}
                  fontSize="12"
                  fontWeight="700"
                  textAnchor="middle"
                  fontFamily="'Segoe UI', Roboto, sans-serif"
                >
                  {pt.label}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Axis Labels */}
        <div style={{ position: "absolute", bottom: `${12 * scale}px`, right: `${16 * scale}px`, fontSize: `${11 * scale}px`, color: "#94A3B8", fontWeight: 700 }}>
          {data.xAxisLabel} →
        </div>
        <div style={{ position: "absolute", top: `${16 * scale}px`, left: `${16 * scale}px`, fontSize: `${11 * scale}px`, color: "#94A3B8", fontWeight: 700 }}>
          ↑ {data.yAxisLabel}
        </div>
      </div>
    </div>
  );
}
