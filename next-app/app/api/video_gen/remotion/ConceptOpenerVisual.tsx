import React from "react";
import type { VisualScene } from "../visual-plan";
import { FitText } from "./FitText";

export function ConceptOpenerVisual({
  visual,
  frame,
  fps,
  scale,
  title,
}: {
  visual: VisualScene;
  frame: number;
  fps: number;
  scale: number;
  title: string;
}) {
  const t = frame / fps;
  const pulse = Math.sin(t * 3) * 0.15 + 0.85;
  const rotate1 = (frame * 0.8) % 360;
  const rotate2 = -(frame * 0.5) % 360;

  const isXmlJson = /xml|json/i.test(title);
  const isAlgo = /algorithm|binary search|sort/i.test(title);
  const isArch = /mcp|model context protocol|protocol|architecture|pipeline|client.*server|agent/i.test(
    title + " " + visual.heading + " " + (visual.labels || []).join(" ")
  );
  const isAi = /ai|rag|model|llm|langchain/i.test(title);

  const cyan = "#38BDF8";
  const violet = "#A855F7";
  const amber = "#F59E0B";
  const emerald = "#10B981";

  const primaryColor = isXmlJson ? cyan : isAlgo ? emerald : isArch ? cyan : isAi ? violet : cyan;
  const secondaryColor = isXmlJson ? amber : isAlgo ? cyan : isArch ? violet : isAi ? cyan : amber;

  return (
    <div
      data-visual="concept-opener"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: `${20 * scale}px`,
        textAlign: "center",
      }}
    >
      {/* Background Animated Concentric Tech Rings */}
      <svg
        viewBox="0 0 500 500"
        style={{
          position: "absolute",
          width: 460 * scale,
          height: 460 * scale,
          pointerEvents: "none",
          opacity: 0.65,
        }}
      >
        <defs>
          <radialGradient id="opener-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={primaryColor} stopOpacity={0.25} />
            <stop offset="100%" stopColor={primaryColor} stopOpacity={0} />
          </radialGradient>
        </defs>

        <circle cx="250" cy="250" r="220" fill="url(#opener-glow)" />

        {/* Outer Orbital Ring */}
        <circle
          cx="250"
          cy="250"
          r="190"
          fill="none"
          stroke={secondaryColor}
          strokeWidth="1.5"
          strokeDasharray="16 12 4 12"
          transform={`rotate(${rotate1} 250 250)`}
          opacity="0.5"
        />

        {/* Middle Track Ring */}
        <circle
          cx="250"
          cy="250"
          r="150"
          fill="none"
          stroke={primaryColor}
          strokeWidth="2"
          strokeDasharray="24 18"
          transform={`rotate(${rotate2} 250 250)`}
          opacity="0.7"
        />

        {/* Inner Pulsing Ring */}
        <circle
          cx="250"
          cy="250"
          r={110 * pulse}
          fill="none"
          stroke="rgba(255, 255, 255, 0.25)"
          strokeWidth="1.5"
        />
      </svg>

      {/* Hero Visual Centerpiece */}
      <div
        style={{
          position: "relative",
          zIndex: 2,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16 * scale,
        }}
      >
        {/* Topic Badge */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8 * scale,
            background: "rgba(255, 255, 255, 0.08)",
            border: `1px solid ${primaryColor}`,
            boxShadow: `0 0 20px ${primaryColor}40`,
            borderRadius: 999,
            padding: `${6 * scale}px ${18 * scale}px`,
          }}
        >
          <span
            style={{
              width: 8 * scale,
              height: 8 * scale,
              borderRadius: "50%",
              background: primaryColor,
              boxShadow: `0 0 10px ${primaryColor}`,
            }}
          />
          <span
            style={{
              color: "#F8FAFC",
              fontSize: 14 * scale,
              fontWeight: 800,
              letterSpacing: 2 * scale,
              textTransform: "uppercase",
            }}
          >
            {isXmlJson ? "DATA ARCHITECTURE" : isAlgo ? "ALGORITHMS & STRUCTURES" : isArch ? "SYSTEM ARCHITECTURE & PROTOCOL" : "CONCEPT BREAKDOWN"}
          </span>
        </div>

        {/* Hero Concept Graphics */}
        {isXmlJson ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 24 * scale,
              margin: `${12 * scale}px 0`,
            }}
          >
            <div
              style={{
                background: "rgba(56, 189, 248, 0.15)",
                border: "2px solid #38BDF8",
                borderRadius: 16 * scale,
                padding: `${16 * scale}px ${24 * scale}px`,
                boxShadow: "0 0 30px rgba(56, 189, 248, 0.3)",
              }}
            >
              <span style={{ fontFamily: "monospace", fontSize: 26 * scale, fontWeight: 900, color: "#38BDF8" }}>
                &lt;XML /&gt;
              </span>
            </div>

            <span style={{ fontSize: 22 * scale, fontWeight: 800, color: "#94A3B8" }}>VS</span>

            <div
              style={{
                background: "rgba(245, 158, 11, 0.15)",
                border: "2px solid #F59E0B",
                borderRadius: 16 * scale,
                padding: `${16 * scale}px ${24 * scale}px`,
                boxShadow: "0 0 30px rgba(245, 158, 11, 0.3)",
              }}
            >
              <span style={{ fontFamily: "monospace", fontSize: 26 * scale, fontWeight: 900, color: "#F59E0B" }}>
                &#123; JSON &#125;
              </span>
            </div>
          </div>
        ) : isAlgo ? (
          <div
            style={{
              display: "flex",
              gap: 10 * scale,
              margin: `${12 * scale}px 0`,
            }}
          >
            {[2, 8, 16, 23, 56, 91].map((n, i) => (
              <div
                key={i}
                style={{
                  width: 44 * scale,
                  height: 48 * scale,
                  background: n === 23 ? "rgba(16, 185, 129, 0.3)" : "rgba(15, 23, 42, 0.8)",
                  border: `2px solid ${n === 23 ? emerald : "rgba(255, 255, 255, 0.15)"}`,
                  borderRadius: 8 * scale,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 18 * scale,
                  fontWeight: 800,
                  color: n === 23 ? "#6EE7B7" : "#F8FAFC",
                  boxShadow: n === 23 ? "0 0 20px rgba(16, 185, 129, 0.5)" : "none",
                }}
              >
                {n}
              </div>
            ))}
          </div>
        ) : isArch ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14 * scale,
              margin: `${12 * scale}px 0`,
            }}
          >
            {/* Host Node */}
            <div
              style={{
                background: "rgba(168, 85, 247, 0.18)",
                border: "2px solid #A855F7",
                borderRadius: 12 * scale,
                padding: `${12 * scale}px ${16 * scale}px`,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4 * scale,
                boxShadow: "0 0 24px rgba(168, 85, 247, 0.35)",
              }}
            >
              <span style={{ fontSize: 24 * scale }}>🤖</span>
              <span style={{ fontFamily: "'Segoe UI', Roboto, sans-serif", fontSize: 13 * scale, fontWeight: 800, color: "#F8FAFC" }}>
                AI HOST
              </span>
            </div>

            {/* Protocol Rail Indicator */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4 * scale,
              }}
            >
              <span
                style={{
                  fontSize: 10 * scale,
                  fontWeight: 800,
                  color: "#38BDF8",
                  letterSpacing: 1 * scale,
                  fontFamily: "monospace",
                  background: "rgba(56, 189, 248, 0.15)",
                  padding: `${2 * scale}px ${8 * scale}px`,
                  borderRadius: 999,
                  border: "1px solid rgba(56, 189, 248, 0.4)",
                }}
              >
                JSON-RPC
              </span>
              <span style={{ fontSize: 18 * scale, color: "#38BDF8" }}>
                ⇄
              </span>
            </div>

            {/* Tool Servers Node */}
            <div
              style={{
                background: "rgba(16, 185, 129, 0.18)",
                border: "2px solid #10B981",
                borderRadius: 12 * scale,
                padding: `${12 * scale}px ${16 * scale}px`,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4 * scale,
                boxShadow: "0 0 24px rgba(16, 185, 129, 0.35)",
              }}
            >
              <span style={{ fontSize: 24 * scale }}>🔌</span>
              <span style={{ fontFamily: "'Segoe UI', Roboto, sans-serif", fontSize: 13 * scale, fontWeight: 800, color: "#F8FAFC" }}>
                MCP TOOLS
              </span>
            </div>
          </div>
        ) : (
          <div
            style={{
              width: 100 * scale,
              height: 100 * scale,
              borderRadius: "50%",
              background: `linear-gradient(135deg, ${primaryColor}30, ${secondaryColor}30)`,
              border: `2px solid ${primaryColor}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: `0 0 40px ${primaryColor}50`,
              margin: `${8 * scale}px 0`,
            }}
          >
            <span style={{ fontSize: 42 * scale }}>⚡</span>
          </div>
        )}

        {/* Explainer Tagline */}
        <div
          style={{
            maxWidth: 520 * scale,
            fontSize: 17 * scale,
            color: "#94A3B8",
            lineHeight: 1.5,
            fontWeight: 500,
          }}
        >
          {visual.note || "A complete visual breakdown of core concepts, architecture, and tradeoffs."}
        </div>
      </div>
    </div>
  );
}
