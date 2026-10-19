import React from "react";
import type { VisualScene } from "../visual-plan";
import { TechSymbol, techSymbolIcons } from "./TechSymbols";

interface ConceptComparisonProps {
  visual: VisualScene;
  frame: number;
  fps: number;
  scale: number;
  durationInFrames?: number;
}

export function ConceptComparisonVisual({
  visual,
  frame,
  fps,
  scale,
  durationInFrames = 180,
}: ConceptComparisonProps) {
  if (visual.renderer !== "graph") return null;
  const nodes = visual.graph.nodes;
  if (!nodes || nodes.length < 2) return null;

  const nodeA = nodes[0];
  const nodeB = nodes[1];

  const fullContext = (
    visual.heading +
    " " +
    visual.note +
    " " +
    visual.labels.join(" ") +
    " " +
    nodes.map((n) => n.label + " " + (n.evidence || "")).join(" ")
  ).toLowerCase();

  const isDatabase = /sql|nosql|database|db|store|table|document|mongo|postgres/i.test(fullContext);
  const isApi = /rest|graphql|grpc|api|endpoint|query|rpc/i.test(fullContext);
  const isNetwork = /tcp|udp|http|websocket|socket|ip/i.test(fullContext);
  const isArchitecture = /monolith|microservice|serverless|cloud|container|docker/i.test(fullContext);

  // Time-based animations
  const t = frame / fps;
  const progress = Math.min(1, Math.max(0, frame / durationInFrames));

  // Entrances: Node A at frame 0, Node B at frame 10, VS badge at frame 18
  const enterA = Math.min(1, frame / 18);
  const enterB = Math.min(1, Math.max(0, (frame - 10) / 18));
  const enterVs = Math.min(1, Math.max(0, (frame - 16) / 14));

  // Active side highlight shifts as narration progresses (first 45% -> A, next 55% -> B)
  const isAActive = progress < 0.5;

  // Colors
  const blue = "#38BDF8";
  const green = "#10B981";
  const yellow = "#FACC15";
  const purple = "#A855F7";

  const colorA = isDatabase ? blue : isApi ? purple : isNetwork ? blue : blue;
  const colorB = isDatabase ? green : isApi ? blue : isNetwork ? green : purple;

  // Scan beam animation for tables/code
  const scanA = (frame * 2.5) % 180;
  const scanB = ((frame - 30) * 2.5) % 180;

  return (
    <div
      data-visual="concept-comparison"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: `${14 * scale}px`,
        padding: `${12 * scale}px`,
      }}
    >
      {/* Top Card: Concept A */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          background: isAActive
            ? "linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.85))"
            : "linear-gradient(135deg, rgba(15, 23, 42, 0.75), rgba(20, 27, 45, 0.65))",
          border: `1.5px solid ${isAActive ? colorA : "rgba(255, 255, 255, 0.1)"}`,
          borderRadius: `${16 * scale}px`,
          padding: `${12 * scale}px ${16 * scale}px`,
          boxShadow: isAActive
            ? `0 0 24px ${colorA}33, inset 0 1px 0 rgba(255, 255, 255, 0.15)`
            : "0 4px 16px rgba(0, 0, 0, 0.4)",
          transform: `translateY(${(1 - enterA) * -30}px) scale(${0.96 + enterA * 0.04})`,
          opacity: enterA,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Glow Header Row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: `${10 * scale}px` }}>
            <div
              style={{
                width: `${34 * scale}px`,
                height: `${34 * scale}px`,
                borderRadius: `${8 * scale}px`,
                background: `${colorA}22`,
                border: `1px solid ${colorA}66`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {techSymbolIcons.has(nodeA.icon) ? (
                <svg viewBox="0 0 100 100" width="80%" height="80%">
                  <TechSymbol icon={nodeA.icon} phase={t} />
                </svg>
              ) : (
                <span style={{ fontSize: `${18 * scale}px` }}>
                  {isDatabase ? "🗄️" : isApi ? "⚡" : isNetwork ? "🌐" : "📦"}
                </span>
              )}
            </div>
            <div>
              <div
                style={{
                  fontFamily: "'Segoe UI', Roboto, sans-serif",
                  fontSize: `${22 * scale}px`,
                  fontWeight: 800,
                  color: "#F8FAFC",
                  letterSpacing: `${0.5 * scale}px`,
                }}
              >
                {nodeA.label}
              </div>
              <div
                style={{
                  fontSize: `${11 * scale}px`,
                  color: colorA,
                  fontWeight: 700,
                  letterSpacing: `${1.2 * scale}px`,
                  textTransform: "uppercase",
                }}
              >
                {isDatabase ? "RELATIONAL / STRUCTURED" : isApi ? "REST ARCHITECTURE" : "STANDARD PROTOCOL"}
              </div>
            </div>
          </div>

          {/* Active Status Chip */}
          <div
            style={{
              padding: `${3 * scale}px ${10 * scale}px`,
              borderRadius: 999,
              background: isAActive ? `${colorA}25` : "rgba(255, 255, 255, 0.06)",
              border: `1px solid ${isAActive ? colorA : "rgba(255, 255, 255, 0.1)"}`,
              fontSize: `${11 * scale}px`,
              fontWeight: 700,
              color: isAActive ? colorA : "#94A3B8",
              letterSpacing: `${0.8 * scale}px`,
            }}
          >
            {isAActive ? "● ANALYZING" : "CONCEPT 1"}
          </div>
        </div>

        {/* Domain-Specific Interactive Graphics */}
        {isDatabase ? (
          /* Structured SQL Table Graphic */
          <div
            style={{
              background: "rgba(10, 15, 28, 0.85)",
              border: `1px solid ${colorA}44`,
              borderRadius: `${8 * scale}px`,
              padding: `${8 * scale}px`,
              margin: `${8 * scale}px 0`,
              fontFamily: "'Fira Code', 'Courier New', monospace",
              fontSize: `${11 * scale}px`,
              position: "relative",
              overflow: "hidden",
            }}
          >
            {/* Table Header */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.2fr 2fr 1.8fr",
                padding: `${4 * scale}px 0`,
                borderBottom: `1px solid ${colorA}55`,
                color: colorA,
                fontWeight: 700,
              }}
            >
              <span>id (PK)</span>
              <span>name (VARCHAR)</span>
              <span>role (ENUM)</span>
            </div>
            {/* Table Rows */}
            {[
              { id: "101", name: "'Alice'", role: "'Admin'" },
              { id: "102", name: "'Bob'", role: "'Engineer'" },
            ].map((row, idx) => (
              <div
                key={idx}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.2fr 2fr 1.8fr",
                  padding: `${3 * scale}px 0`,
                  color: "#CBD5E1",
                  borderBottom: idx === 0 ? "1px solid rgba(255,255,255,0.05)" : "none",
                }}
              >
                <span style={{ color: yellow }}>{row.id}</span>
                <span>{row.name}</span>
                <span style={{ color: "#38BDF8" }}>{row.role}</span>
              </div>
            ))}
            {/* Active Scanning Beam */}
            <div
              style={{
                position: "absolute",
                top: `${scanA}px`,
                left: 0,
                right: 0,
                height: "2px",
                background: `linear-gradient(90deg, transparent, ${colorA}, transparent)`,
                boxShadow: `0 0 8px ${colorA}`,
                pointerEvents: "none",
              }}
            />
          </div>
        ) : (
          /* General Features Badge Row */
          <div style={{ display: "flex", gap: `${8 * scale}px`, flexWrap: "wrap", margin: `${6 * scale}px 0` }}>
            {["Strict Schema", "ACID Guarantees", "Structured Indexing"].map((feat, i) => (
              <span
                key={i}
                style={{
                  background: `${colorA}15`,
                  border: `1px solid ${colorA}44`,
                  color: "#E2E8F0",
                  fontSize: `${11 * scale}px`,
                  fontWeight: 600,
                  padding: `${3 * scale}px ${8 * scale}px`,
                  borderRadius: `${6 * scale}px`,
                }}
              >
                ✔ {feat}
              </span>
            ))}
          </div>
        )}

        {/* Bottom Feature Pill */}
        <div style={{ fontSize: `${11 * scale}px`, color: "#94A3B8", display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ color: colorA }}>✦</span>
          <span>{isDatabase ? "Strict Tabular Schema • Predefined Constraints • ACID" : nodeA.evidence || "Core Concept"}</span>
        </div>
      </div>

      {/* Center "VS" Badge with Energetic Electric Pulse */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: `${24 * scale}px`,
          position: "relative",
          zIndex: 2,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: "10%",
            right: "10%",
            height: "1px",
            background: `linear-gradient(90deg, transparent, ${yellow}88, transparent)`,
          }}
        />
        <div
          style={{
            background: "rgba(15, 23, 42, 0.95)",
            border: `1.5px solid ${yellow}`,
            borderRadius: 999,
            padding: `${3 * scale}px ${16 * scale}px`,
            color: yellow,
            fontFamily: "'Montserrat', sans-serif",
            fontSize: `${12 * scale}px`,
            fontWeight: 900,
            letterSpacing: `${1.5 * scale}px`,
            boxShadow: `0 0 16px ${yellow}66`,
            transform: `scale(${enterVs * (1 + Math.sin(t * 5) * 0.06)})`,
            opacity: enterVs,
          }}
        >
          VS
        </div>
      </div>

      {/* Bottom Card: Concept B */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          background: !isAActive
            ? "linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(20, 36, 32, 0.85))"
            : "linear-gradient(135deg, rgba(15, 23, 42, 0.75), rgba(18, 28, 25, 0.65))",
          border: `1.5px solid ${!isAActive ? colorB : "rgba(255, 255, 255, 0.1)"}`,
          borderRadius: `${16 * scale}px`,
          padding: `${12 * scale}px ${16 * scale}px`,
          boxShadow: !isAActive
            ? `0 0 24px ${colorB}33, inset 0 1px 0 rgba(255, 255, 255, 0.15)`
            : "0 4px 16px rgba(0, 0, 0, 0.4)",
          transform: `translateY(${(1 - enterB) * 30}px) scale(${0.96 + enterB * 0.04})`,
          opacity: enterB,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Glow Header Row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: `${10 * scale}px` }}>
            <div
              style={{
                width: `${34 * scale}px`,
                height: `${34 * scale}px`,
                borderRadius: `${8 * scale}px`,
                background: `${colorB}22`,
                border: `1px solid ${colorB}66`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {techSymbolIcons.has(nodeB.icon) ? (
                <svg viewBox="0 0 100 100" width="80%" height="80%">
                  <TechSymbol icon={nodeB.icon} phase={t} />
                </svg>
              ) : (
                <span style={{ fontSize: `${18 * scale}px` }}>
                  {isDatabase ? "📄" : isApi ? "🎯" : isNetwork ? "🚀" : "✨"}
                </span>
              )}
            </div>
            <div>
              <div
                style={{
                  fontFamily: "'Segoe UI', Roboto, sans-serif",
                  fontSize: `${22 * scale}px`,
                  fontWeight: 800,
                  color: "#F8FAFC",
                  letterSpacing: `${0.5 * scale}px`,
                }}
              >
                {nodeB.label}
              </div>
              <div
                style={{
                  fontSize: `${11 * scale}px`,
                  color: colorB,
                  fontWeight: 700,
                  letterSpacing: `${1.2 * scale}px`,
                  textTransform: "uppercase",
                }}
              >
                {isDatabase ? "DOCUMENT / FLEXIBLE" : isApi ? "GRAPHQL / FLEXIBLE" : "DATAGRAM PROTOCOL"}
              </div>
            </div>
          </div>

          {/* Active Status Chip */}
          <div
            style={{
              padding: `${3 * scale}px ${10 * scale}px`,
              borderRadius: 999,
              background: !isAActive ? `${colorB}25` : "rgba(255, 255, 255, 0.06)",
              border: `1px solid ${!isAActive ? colorB : "rgba(255, 255, 255, 0.1)"}`,
              fontSize: `${11 * scale}px`,
              fontWeight: 700,
              color: !isAActive ? colorB : "#94A3B8",
              letterSpacing: `${0.8 * scale}px`,
            }}
          >
            {!isAActive ? "● ANALYZING" : "CONCEPT 2"}
          </div>
        </div>

        {/* Domain-Specific Interactive Graphics */}
        {isDatabase ? (
          /* Flexible JSON Document Graphic */
          <div
            style={{
              background: "rgba(10, 15, 28, 0.85)",
              border: `1px solid ${colorB}44`,
              borderRadius: `${8 * scale}px`,
              padding: `${8 * scale}px`,
              margin: `${8 * scale}px 0`,
              fontFamily: "'Fira Code', 'Courier New', monospace",
              fontSize: `${11 * scale}px`,
              position: "relative",
              overflow: "hidden",
              lineHeight: 1.45,
            }}
          >
            <div style={{ color: "#94A3B8" }}>{"{"}</div>
            <div style={{ paddingLeft: `${14 * scale}px` }}>
              <span style={{ color: colorB }}>"user_id"</span>: <span style={{ color: yellow }}>"usr_99"</span>,
            </div>
            <div style={{ paddingLeft: `${14 * scale}px` }}>
              <span style={{ color: colorB }}>"name"</span>: <span style={{ color: "#E2E8F0" }}>"John"</span>,
            </div>
            <div style={{ paddingLeft: `${14 * scale}px` }}>
              <span style={{ color: colorB }}>"tags"</span>: [<span style={{ color: "#38BDF8" }}>"cloud"</span>, <span style={{ color: "#38BDF8" }}>"nosql"</span>]
            </div>
            <div style={{ color: "#94A3B8" }}>{"}"}</div>

            {/* Active Scanning Beam */}
            <div
              style={{
                position: "absolute",
                top: `${scanB}px`,
                left: 0,
                right: 0,
                height: "2px",
                background: `linear-gradient(90deg, transparent, ${colorB}, transparent)`,
                boxShadow: `0 0 8px ${colorB}`,
                pointerEvents: "none",
              }}
            />
          </div>
        ) : (
          /* General Features Badge Row */
          <div style={{ display: "flex", gap: `${8 * scale}px`, flexWrap: "wrap", margin: `${6 * scale}px 0` }}>
            {["Dynamic Schema", "Horizontal Scaling", "Rapid Prototyping"].map((feat, i) => (
              <span
                key={i}
                style={{
                  background: `${colorB}15`,
                  border: `1px solid ${colorB}44`,
                  color: "#E2E8F0",
                  fontSize: `${11 * scale}px`,
                  fontWeight: 600,
                  padding: `${3 * scale}px ${8 * scale}px`,
                  borderRadius: `${6 * scale}px`,
                }}
              >
                ✔ {feat}
              </span>
            ))}
          </div>
        )}

        {/* Bottom Feature Pill */}
        <div style={{ fontSize: `${11 * scale}px`, color: "#94A3B8", display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ color: colorB }}>✦</span>
          <span>{isDatabase ? "Dynamic Key-Value / Documents • Horizontal Partitioning • High Throughput" : nodeB.evidence || "Contrasting Concept"}</span>
        </div>
      </div>
    </div>
  );
}
