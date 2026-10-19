import React from "react";
import type { DataTransformationData } from "../enhanced-schema";

interface DataTransformationVisualProps {
  data: DataTransformationData;
  frame: number;
  fps: number;
  scale: number;
  durationInFrames?: number;
}

export function DataTransformationVisual({
  data,
  frame,
  fps,
  scale,
  durationInFrames = 180,
}: DataTransformationVisualProps) {
  const t = frame / fps;
  const progress = Math.min(1, Math.max(0, frame / durationInFrames));

  const cyan = "#38BDF8";
  const purple = "#A855F7";
  const emerald = "#10B981";
  const gold = "#FACC15";

  // Data flow packet
  const packetPos = (frame * 4) % 240;

  return (
    <div
      data-visual="data-transformation"
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
      {/* 1. Input Data Card */}
      <div
        style={{
          background: "linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))",
          border: `1.5px solid ${cyan}`,
          borderRadius: `${14 * scale}px`,
          padding: `${10 * scale}px ${14 * scale}px`,
          boxShadow: `0 0 20px ${cyan}33`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: `${6 * scale}px` }}>
          <div style={{ display: "flex", alignItems: "center", gap: `${8 * scale}px` }}>
            <span style={{ fontSize: `${14 * scale}px` }}>📥</span>
            <span style={{ fontSize: `${14 * scale}px`, fontWeight: 800, color: "#F8FAFC" }}>
              {data.input.label}
            </span>
          </div>
          <span style={{ fontSize: `${10 * scale}px`, color: cyan, fontWeight: 700, fontFamily: "monospace" }}>
            INPUT RAW
          </span>
        </div>

        <div
          style={{
            fontFamily: "monospace",
            fontSize: `${12 * scale}px`,
            color: "#CBD5E1",
            background: "rgba(0, 0, 0, 0.3)",
            padding: `${8 * scale}px ${10 * scale}px`,
            borderRadius: `${8 * scale}px`,
            border: "1px solid rgba(255, 255, 255, 0.08)",
            whiteSpace: "pre-wrap",
          }}
        >
          {data.input.snippet}
        </div>
      </div>

      {/* 2. Processing Pipe / Operator */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: `${4 * scale}px`,
          padding: `${6 * scale}px 0`,
        }}
      >
        {/* Animated Processing Beam */}
        <div
          style={{
            width: `${180 * scale}px`,
            background: "linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(15, 23, 42, 0.95))",
            border: `1.5px solid ${purple}`,
            borderRadius: 999,
            padding: `${6 * scale}px ${14 * scale}px`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: `${8 * scale}px`,
            boxShadow: `0 0 20px ${purple}40`,
          }}
        >
          <span style={{ fontSize: `${14 * scale}px` }}>⚡</span>
          <span style={{ fontFamily: "monospace", fontSize: `${11 * scale}px`, fontWeight: 800, color: "#F8FAFC" }}>
            {data.pipeOperator}
          </span>
          <span style={{ color: purple, fontSize: `${14 * scale}px` }}>↓</span>
        </div>
      </div>

      {/* 3. Transformed Output Card */}
      <div
        style={{
          background: "linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(20, 36, 32, 0.9))",
          border: `1.5px solid ${emerald}`,
          borderRadius: `${14 * scale}px`,
          padding: `${10 * scale}px ${14 * scale}px`,
          boxShadow: `0 0 20px ${emerald}33`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: `${6 * scale}px` }}>
          <div style={{ display: "flex", alignItems: "center", gap: `${8 * scale}px` }}>
            <span style={{ fontSize: `${14 * scale}px` }}>📤</span>
            <span style={{ fontSize: `${14 * scale}px`, fontWeight: 800, color: "#F8FAFC" }}>
              {data.output.label}
            </span>
          </div>
          <span style={{ fontSize: `${10 * scale}px`, color: emerald, fontWeight: 700, fontFamily: "monospace" }}>
            ● TRANSFORMED
          </span>
        </div>

        <div
          style={{
            fontFamily: "monospace",
            fontSize: `${12 * scale}px`,
            color: "#A7F3D0",
            background: "rgba(0, 0, 0, 0.3)",
            padding: `${8 * scale}px ${10 * scale}px`,
            borderRadius: `${8 * scale}px`,
            border: "1px solid rgba(16, 185, 129, 0.3)",
            whiteSpace: "pre-wrap",
          }}
        >
          {data.output.snippet}
        </div>
      </div>
    </div>
  );
}
