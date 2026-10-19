import React from "react";
import type { VisualScene } from "../visual-plan";

export function TakeawayVisual({
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
  const isXmlJson = /xml|json/i.test(title);
  const isAlgo = /algorithm|binary search|sort/i.test(title);
  const isMcpOrArch = /mcp|model context protocol|protocol|architecture/i.test(
    title + " " + visual.heading + " " + visual.labels.join(" ")
  );

  const cyan = "#38BDF8";
  const amber = "#F59E0B";
  const emerald = "#10B981";

  // Topic specific takeaways
  let takeaways = [
    { title: "Core Mechanism", desc: visual.labels[0] || "Foundational architecture and principles." },
    { title: "Key Advantage", desc: visual.labels[1] || "High efficiency and deterministic operation." },
    { title: "Primary Application", desc: visual.labels[2] || "Widely adopted industry standard." },
  ];

  if (isXmlJson) {
    takeaways = [
      {
        title: "JSON: Web APIs & Apps",
        desc: "Lightweight, native JavaScript objects, 40% less payload overhead.",
      },
      {
        title: "XML: Document & Schema",
        desc: "Strict XSD validation, attributes, namespaces, and enterprise formats.",
      },
      {
        title: "The Golden Rule",
        desc: "Use JSON for microservices & APIs; use XML when document markup is required.",
      },
    ];
  } else if (isAlgo) {
    takeaways = [
      {
        title: "Prerequisite: Sorted Array",
        desc: "Binary search strictly requires data to be sorted before searching.",
      },
      {
        title: "Logarithmic Speed: O(log n)",
        desc: "Halves the search space every step — 1 million items in just 20 checks.",
      },
      {
        title: "Space Efficiency",
        desc: "Operates in O(1) auxiliary memory using two boundary pointers.",
      },
    ];
  } else if (isMcpOrArch) {
    takeaways = [
      {
        title: "Standardized Interface",
        desc: "Open JSON-RPC 2.0 protocol connecting AI models directly to external tools.",
      },
      {
        title: "Universal Pluggability",
        desc: "One host client connects to any tool server (Databases, Git, Filesystem, APIs).",
      },
      {
        title: "Secure Isolation",
        desc: "Tools run in sandboxed processes with strict permission and context controls.",
      },
    ];
  }

  return (
    <div
      data-visual="takeaway-summary"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: `${12 * scale}px`,
        gap: 14 * scale,
        fontFamily: "'Segoe UI', Roboto, sans-serif",
      }}
    >
      {/* Top Punchline Badge */}
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8 * scale,
          background: "rgba(16, 185, 129, 0.15)",
          border: `1px solid ${emerald}`,
          borderRadius: 999,
          padding: `${5 * scale}px ${16 * scale}px`,
          boxShadow: `0 0 16px rgba(16, 185, 129, 0.3)`,
        }}
      >
        <span style={{ fontSize: 13 * scale, fontWeight: 800, color: emerald, letterSpacing: 1.5 }}>
          KEY TAKEAWAY & SUMMARY
        </span>
      </div>

      {/* Structured Takeaways List */}
      <div
        style={{
          width: "100%",
          maxWidth: 580 * scale,
          display: "flex",
          flexDirection: "column",
          gap: 10 * scale,
        }}
      >
        {takeaways.map((item, idx) => {
          const delay = idx * 0.25;
          const revealProgress = Math.max(0, Math.min(1, (t - delay) / 0.4));
          const opacity = revealProgress;
          const translateY = (1 - revealProgress) * 16 * scale;

          const badgeColor = idx === 0 ? cyan : idx === 1 ? amber : emerald;

          return (
            <div
              key={idx}
              style={{
                opacity,
                transform: `translateY(${translateY}px)`,
                background: "rgba(15, 23, 42, 0.75)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                borderLeft: `4px solid ${badgeColor}`,
                borderRadius: 10 * scale,
                padding: `${12 * scale}px ${16 * scale}px`,
                display: "flex",
                alignItems: "flex-start",
                gap: 12 * scale,
                boxShadow: "0 4px 16px rgba(0, 0, 0, 0.25)",
              }}
            >
              <div
                style={{
                  width: 24 * scale,
                  height: 24 * scale,
                  borderRadius: "50%",
                  background: `${badgeColor}25`,
                  color: badgeColor,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 14 * scale,
                  fontWeight: 900,
                  flexShrink: 0,
                  marginTop: 2 * scale,
                }}
              >
                ✓
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 3 * scale }}>
                <span style={{ fontSize: 16 * scale, fontWeight: 700, color: "#F8FAFC" }}>
                  {item.title}
                </span>
                <span style={{ fontSize: 14 * scale, color: "#94A3B8", lineHeight: 1.4 }}>
                  {item.desc}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom Insight Pill */}
      <div
        style={{
          maxWidth: 580 * scale,
          width: "100%",
          background: "rgba(255, 255, 255, 0.03)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: 10 * scale,
          padding: `${8 * scale}px ${14 * scale}px`,
          textAlign: "center",
          color: "#E2E8F0",
          fontSize: 13 * scale,
          fontWeight: 600,
        }}
      >
        💡 {visual.note || "Mastering the fundamentals enables high-performance software design."}
      </div>
    </div>
  );
}
