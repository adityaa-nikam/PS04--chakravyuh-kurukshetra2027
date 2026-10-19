import React from "react";
import type { VisualScene } from "../visual-plan";
import { TechSymbol, techSymbolIcons } from "./TechSymbols";

interface ArchitectureFlowProps {
  visual: VisualScene;
  frame: number;
  fps: number;
  scale: number;
  durationInFrames?: number;
}

export function ArchitectureFlowVisual({
  visual,
  frame,
  fps,
  scale,
  durationInFrames = 180,
}: ArchitectureFlowProps) {
  if (visual.renderer !== "graph") return null;

  const t = frame / fps;
  const progress = Math.min(1, Math.max(0, frame / durationInFrames));

  // Entrances
  const enterClient = Math.min(1, frame / 16);
  const enterProtocol = Math.min(1, Math.max(0, (frame - 8) / 16));
  const enterServers = Math.min(1, Math.max(0, (frame - 16) / 16));

  // Data packet movement along rails
  const packetForward = (frame * 3.5) % 240;
  const packetReturn = (240 - ((frame * 3.2) % 240));

  const isMcp = /mcp|model context protocol|context protocol/i.test(
    visual.heading + " " + visual.labels.join(" ") + " " + visual.note
  );

  const cyan = "#38BDF8";
  const purple = "#A855F7";
  const emerald = "#10B981";
  const gold = "#FACC15";

  return (
    <div
      data-visual="architecture-flow"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: `${10 * scale}px`,
        padding: `${8 * scale}px`,
      }}
    >
      {/* Top Layer: AI Host / Client (Caller) */}
      <div
        style={{
          background: "linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))",
          border: `1.5px solid ${purple}`,
          borderRadius: `${14 * scale}px`,
          padding: `${10 * scale}px ${14 * scale}px`,
          boxShadow: `0 0 20px ${purple}33`,
          transform: `translateY(${(1 - enterClient) * -24}px)`,
          opacity: enterClient,
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
            🤖
          </div>
          <div>
            <div
              style={{
                fontFamily: "'Segoe UI', Roboto, sans-serif",
                fontSize: `${18 * scale}px`,
                fontWeight: 800,
                color: "#F8FAFC",
                letterSpacing: `${0.5 * scale}px`,
              }}
            >
              {isMcp ? "AI Host / Client" : "Client Application"}
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
              {isMcp ? "Claude Desktop • IDE Agent • LLM App" : "Frontend / Consumer"}
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
          ● CONTEXT AWARE
        </div>
      </div>

      {/* Center Layer: Protocol & Transport Bus (MCP / JSON-RPC) */}
      <div
        style={{
          flex: 1,
          minHeight: `${120 * scale}px`,
          background: "linear-gradient(135deg, rgba(10, 15, 30, 0.95), rgba(15, 23, 42, 0.9))",
          border: `1.5px solid ${cyan}`,
          borderRadius: `${14 * scale}px`,
          padding: `${10 * scale}px ${14 * scale}px`,
          boxShadow: `0 0 24px ${cyan}33`,
          transform: `scale(${0.96 + enterProtocol * 0.04})`,
          opacity: enterProtocol,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Protocol Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: `${8 * scale}px` }}>
            <span
              style={{
                width: `${8 * scale}px`,
                height: `${8 * scale}px`,
                borderRadius: "50%",
                background: cyan,
                boxShadow: `0 0 8px ${cyan}`,
              }}
            />
            <span
              style={{
                fontFamily: "'Segoe UI', Roboto, sans-serif",
                fontSize: `${14 * scale}px`,
                fontWeight: 800,
                color: cyan,
                letterSpacing: `${1 * scale}px`,
                textTransform: "uppercase",
              }}
            >
              {isMcp ? "MCP Standardized Protocol Layer" : "API Protocol & Data Bus"}
            </span>
          </div>
          <span
            style={{
              fontSize: `${10 * scale}px`,
              color: gold,
              background: `${gold}15`,
              border: `1px solid ${gold}66`,
              padding: `${2 * scale}px ${8 * scale}px`,
              borderRadius: `${6 * scale}px`,
              fontWeight: 700,
              fontFamily: "monospace",
            }}
          >
            {isMcp ? "JSON-RPC 2.0 (stdio / SSE)" : "REST / WebSocket"}
          </span>
        </div>

        {/* Animated Bidirectional Request & Response Rails */}
        <div style={{ display: "flex", flexDirection: "column", gap: `${10 * scale}px`, margin: `${6 * scale}px 0` }}>
          {/* Top Rail: Client -> Server Request */}
          <div style={{ position: "relative", height: `${28 * scale}px`, display: "flex", alignItems: "center" }}>
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "rgba(56, 189, 248, 0.08)",
                border: "1px dashed rgba(56, 189, 248, 0.35)",
                borderRadius: `${6 * scale}px`,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: `${8 * scale}px`,
                fontSize: `${10 * scale}px`,
                fontWeight: 700,
                color: cyan,
                fontFamily: "monospace",
              }}
            >
              REQUEST: tools/call & prompts/get
            </div>
            {/* Animated Packet */}
            <div
              style={{
                position: "absolute",
                left: `${(packetForward / 240) * 85}%`,
                width: `${14 * scale}px`,
                height: `${14 * scale}px`,
                borderRadius: "50%",
                background: gold,
                boxShadow: `0 0 12px ${gold}`,
                transform: "translateY(-50%)",
                top: "50%",
              }}
            />
          </div>

          {/* Bottom Rail: Server -> Client Response */}
          <div style={{ position: "relative", height: `${28 * scale}px`, display: "flex", alignItems: "center" }}>
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "rgba(16, 185, 129, 0.08)",
                border: "1px dashed rgba(16, 185, 129, 0.35)",
                borderRadius: `${6 * scale}px`,
              }}
            />
            <div
              style={{
                position: "absolute",
                right: `${8 * scale}px`,
                fontSize: `${10 * scale}px`,
                fontWeight: 700,
                color: emerald,
                fontFamily: "monospace",
              }}
            >
              RESPONSE: Tool Results & Context Data
            </div>
            {/* Animated Return Packet */}
            <div
              style={{
                position: "absolute",
                left: `${(packetReturn / 240) * 85}%`,
                width: `${14 * scale}px`,
                height: `${14 * scale}px`,
                borderRadius: "50%",
                background: emerald,
                boxShadow: `0 0 12px ${emerald}`,
                transform: "translateY(-50%)",
                top: "50%",
              }}
            />
          </div>
        </div>

        {/* Feature summary */}
        <div style={{ fontSize: `${10 * scale}px`, color: "#94A3B8", display: "flex", justifyContent: "space-between" }}>
          <span>✦ Standardized Interface</span>
          <span>✦ Real-Time Tool Discovery</span>
          <span>✦ Sandboxed Security</span>
        </div>
      </div>

      {/* Bottom Layer: Connected MCP Servers / Data Sources */}
      <div
        style={{
          background: "linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(20, 36, 32, 0.9))",
          border: `1.5px solid ${emerald}`,
          borderRadius: `${14 * scale}px`,
          padding: `${10 * scale}px ${14 * scale}px`,
          boxShadow: `0 0 20px ${emerald}33`,
          transform: `translateY(${(1 - enterServers) * 24}px)`,
          opacity: enterServers,
          display: "flex",
          flexDirection: "column",
          gap: `${8 * scale}px`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: `${6 * scale}px` }}>
            <span style={{ fontSize: `${14 * scale}px` }}>🔌</span>
            <span
              style={{
                fontFamily: "'Segoe UI', Roboto, sans-serif",
                fontSize: `${15 * scale}px`,
                fontWeight: 800,
                color: "#F8FAFC",
              }}
            >
              {isMcp ? "Connected MCP Tool Servers" : "Backend Microservices & Stores"}
            </span>
          </div>
          <span
            style={{
              fontSize: `${10 * scale}px`,
              color: emerald,
              fontWeight: 700,
            }}
          >
            ● LIVE & READY
          </span>
        </div>

        {/* Server & Tool Badges Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: `${8 * scale}px` }}>
          {[
            { icon: "📁", label: "Filesystem", desc: "Read & edit code", color: cyan },
            { icon: "🗄️", label: "Database / SQL", desc: "Query data stores", color: purple },
            { icon: "🐙", label: "GitHub API", desc: "PRs & Git workflow", color: gold },
            { icon: "🔍", label: "Web / Tools", desc: "Search & Fetch docs", color: emerald },
          ].map((server, i) => (
            <div
              key={i}
              style={{
                background: "rgba(255, 255, 255, 0.04)",
                border: `1px solid ${server.color}44`,
                borderRadius: `${8 * scale}px`,
                padding: `${6 * scale}px ${10 * scale}px`,
                display: "flex",
                alignItems: "center",
                gap: `${8 * scale}px`,
              }}
            >
              <span style={{ fontSize: `${16 * scale}px` }}>{server.icon}</span>
              <div>
                <div style={{ fontSize: `${11 * scale}px`, fontWeight: 700, color: "#F8FAFC" }}>{server.label}</div>
                <div style={{ fontSize: `${9 * scale}px`, color: "#94A3B8" }}>{server.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
