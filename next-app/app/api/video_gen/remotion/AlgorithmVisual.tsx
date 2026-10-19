import React from "react";
import type { VisualScene } from "../visual-plan";
import { FitText } from "./FitText";

// Deterministic algorithm array visualization (Binary Search demonstration)
export function AlgorithmVisual({
  visual,
  frame,
  scale,
  durationInFrames = 180,
}: {
  visual: VisualScene;
  frame: number;
  fps: number;
  scale: number;
  durationInFrames?: number;
}) {
  const progress = Math.max(0, Math.min(1, frame / Math.max(1, durationInFrames - 1)));

  // Array dataset for binary search demonstration
  const array = [2, 5, 8, 12, 16, 23, 38, 56, 72, 91];
  const target = 23;
  const targetIndex = 5;

  // Phase calculation
  // Phase 1 (0.00 - 0.26): Start search, L=0, R=9, M=4 (value 16). 16 < 23
  // Phase 2 (0.26 - 0.52): Left half eliminated, L=5, R=9, M=7 (value 56). 56 > 23
  // Phase 3 (0.52 - 0.78): Right half eliminated, L=5, R=6, M=5 (value 23). Match!
  // Phase 4 (0.78 - 1.00): Match confirmed, emerald victory pulse!
  let low = 0;
  let high = 9;
  let mid = 4;
  let phase = 1;
  let eliminated: number[] = [];
  let comparisonText = "Initialize: Low = 0, High = 9";
  let formulaText = "mid = ⌊(0 + 9) / 2⌋ = 4  →  arr[4] = 16";
  let actionText = "Compare 16 with Target 23";
  let found = false;

  if (progress >= 0.78) {
    phase = 4;
    low = 5;
    high = 6;
    mid = 5;
    eliminated = [0, 1, 2, 3, 4, 6, 7, 8, 9];
    found = true;
    comparisonText = "arr[5] == 23  →  MATCH FOUND!";
    formulaText = "Found target 23 at Index 5 in just 3 steps!";
    actionText = "✓ O(log n) efficiency: 1,000 items in ~10 steps";
  } else if (progress >= 0.52) {
    phase = 3;
    low = 5;
    high = 6;
    mid = 5;
    eliminated = [0, 1, 2, 3, 4, 7, 8, 9];
    comparisonText = "arr[5] = 23  vs  Target 23";
    formulaText = "mid = ⌊(5 + 6) / 2⌋ = 5  →  arr[5] = 23";
    actionText = "23 === 23  →  Match at index 5!";
  } else if (progress >= 0.26) {
    phase = 2;
    low = 5;
    high = 9;
    mid = 7;
    eliminated = [0, 1, 2, 3, 4];
    comparisonText = "arr[7] = 56  vs  Target 23";
    formulaText = "mid = ⌊(5 + 9) / 2⌋ = 7  →  arr[7] = 56";
    actionText = "56 > 23  →  Discard right half [7..9]";
  } else {
    phase = 1;
    low = 0;
    high = 9;
    mid = 4;
    eliminated = [];
    comparisonText = "arr[4] = 16  vs  Target 23";
    formulaText = "mid = ⌊(0 + 9) / 2⌋ = 4  →  arr[4] = 16";
    actionText = "16 < 23  →  Discard left half [0..4]";
  }

  // Smooth pointer positions for Low, Mid, High
  const cellWidth = 54;
  const gap = 8;
  const totalArrayWidth = array.length * cellWidth + (array.length - 1) * gap;
  const startX = (640 - totalArrayWidth) / 2;

  const lowX = startX + low * (cellWidth + gap) + cellWidth / 2;
  const highX = startX + high * (cellWidth + gap) + cellWidth / 2;
  const midX = startX + mid * (cellWidth + gap) + cellWidth / 2;

  const cyan = "#38BDF8";
  const amber = "#F59E0B";
  const emerald = "#10B981";
  const rose = "#F43F5E";

  return (
    <div
      data-visual="algorithm-binary-search"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        padding: `${12 * scale}px 0`,
        fontFamily: "'Segoe UI', Roboto, sans-serif",
      }}
    >
      {/* Top Banner: Algorithm Tag & Target Value */}
      <div
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: `0 ${16 * scale}px`,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8 * scale,
            background: "rgba(56, 189, 248, 0.12)",
            border: `1px solid rgba(56, 189, 248, 0.35)`,
            borderRadius: 8 * scale,
            padding: `${6 * scale}px ${14 * scale}px`,
          }}
        >
          <span style={{ color: cyan, fontSize: 13 * scale, fontWeight: 700, letterSpacing: 1 }}>
            BINARY SEARCH
          </span>
          <span
            style={{
              background: "rgba(56, 189, 248, 0.2)",
              color: "#E0F2FE",
              borderRadius: 4 * scale,
              padding: `2px ${6 * scale}px`,
              fontSize: 11 * scale,
              fontWeight: 800,
            }}
          >
            O(log n)
          </span>
        </div>

        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8 * scale,
            background: "rgba(245, 158, 11, 0.15)",
            border: `1px solid rgba(245, 158, 11, 0.4)`,
            borderRadius: 8 * scale,
            padding: `${6 * scale}px ${14 * scale}px`,
            boxShadow: `0 0 16px rgba(245, 158, 11, 0.2)`,
          }}
        >
          <span style={{ color: "#FDE68A", fontSize: 13 * scale, fontWeight: 600 }}>TARGET:</span>
          <span style={{ color: amber, fontSize: 17 * scale, fontWeight: 800 }}>{target}</span>
        </div>
      </div>

      {/* Main Interactive Array Display */}
      <div
        style={{
          position: "relative",
          width: 640 * scale,
          height: 250 * scale,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <svg
          viewBox="0 0 640 250"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}
        >
          {/* Active Search Window Range Highlight */}
          <rect
            x={startX + low * (cellWidth + gap) - 4}
            y={82}
            width={(high - low + 1) * cellWidth + (high - low) * gap + 8}
            height={68}
            rx={10}
            fill="none"
            stroke={found ? emerald : cyan}
            strokeWidth={2}
            strokeDasharray={found ? "none" : "6 4"}
            opacity={0.7}
          />

          {/* Array Elements with Index Numbers */}
          {array.map((val, idx) => {
            const x = startX + idx * (cellWidth + gap);
            const isMid = idx === mid;
            const isEliminated = eliminated.includes(idx);
            const isTarget = val === target && found;

            return (
              <g key={idx} transform={`translate(${x}, 86)`} opacity={isEliminated ? 0.22 : 1}>
                {/* Index Number on top */}
                <text
                  x={cellWidth / 2}
                  y={-10}
                  fill="#64748B"
                  fontSize={12}
                  fontWeight={600}
                  textAnchor="middle"
                >
                  [{idx}]
                </text>

                {/* Array Memory Cell Box */}
                <rect
                  x={0}
                  y={0}
                  width={cellWidth}
                  height={60}
                  rx={8}
                  fill={
                    isTarget
                      ? "rgba(16, 185, 129, 0.35)"
                      : isMid
                      ? "rgba(56, 189, 248, 0.25)"
                      : "rgba(15, 23, 42, 0.85)"
                  }
                  stroke={
                    isTarget
                      ? emerald
                      : isMid
                      ? cyan
                      : isEliminated
                      ? "#334155"
                      : "rgba(255, 255, 255, 0.15)"
                  }
                  strokeWidth={isTarget || isMid ? 3 : 1}
                />

                {/* Strikethrough for eliminated cells */}
                {isEliminated && (
                  <line
                    x1={4}
                    y1={56}
                    x2={cellWidth - 4}
                    y2={4}
                    stroke="#EF4444"
                    strokeWidth={2}
                    opacity={0.6}
                  />
                )}

                {/* Element Value */}
                <text
                  x={cellWidth / 2}
                  y={38}
                  fill={isTarget ? "#A7F3D0" : isMid ? "#E0F2FE" : isEliminated ? "#64748B" : "#F8FAFC"}
                  fontSize={19}
                  fontWeight={isTarget || isMid ? 800 : 700}
                  textAnchor="middle"
                >
                  {val}
                </text>
              </g>
            );
          })}

          {/* Pointer: MID (from top) */}
          <g transform={`translate(${midX}, 48)`}>
            <rect
              x={-24}
              y={-28}
              width={48}
              height={22}
              rx={6}
              fill={found ? emerald : cyan}
              filter="drop-shadow(0 2px 6px rgba(0,0,0,0.5))"
            />
            <text x={0} y={-13} fill="#020617" fontSize={11} fontWeight={900} textAnchor="middle">
              MID
            </text>
            <path d="M-6 -6 L0 4 L6 -6 Z" fill={found ? emerald : cyan} />
          </g>

          {/* Pointer: LOW (from bottom) */}
          {!found && (
            <g transform={`translate(${lowX}, 180)`}>
              <path d="M-6 6 L0 -4 L6 6 Z" fill={amber} />
              <rect x={-20} y={6} width={40} height={20} rx={5} fill={amber} />
              <text x={0} y={20} fill="#020617" fontSize={11} fontWeight={900} textAnchor="middle">
                LOW
              </text>
            </g>
          )}

          {/* Pointer: HIGH (from bottom) */}
          {!found && (
            <g transform={`translate(${highX}, 180)`}>
              <path d="M-6 6 L0 -4 L6 6 Z" fill={rose} />
              <rect x={-20} y={6} width={40} height={20} rx={5} fill={rose} />
              <text x={0} y={20} fill="#020617" fontSize={11} fontWeight={900} textAnchor="middle">
                HIGH
              </text>
            </g>
          )}
        </svg>
      </div>

      {/* Step Formula & Action Status Card */}
      <div
        style={{
          width: "92%",
          background: "rgba(15, 23, 42, 0.75)",
          border: `1px solid ${found ? "rgba(16, 185, 129, 0.4)" : "rgba(255, 255, 255, 0.1)"}`,
          borderRadius: 12 * scale,
          padding: `${12 * scale}px ${16 * scale}px`,
          boxShadow: found
            ? "0 0 24px rgba(16, 185, 129, 0.25)"
            : "0 8px 24px rgba(0, 0, 0, 0.4)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 6 * scale,
          }}
        >
          <span style={{ color: "#94A3B8", fontSize: 13 * scale, fontWeight: 600 }}>
            STEP {phase} OF 3
          </span>
          <span
            style={{
              color: found ? emerald : amber,
              fontSize: 13 * scale,
              fontWeight: 700,
              fontFamily: "monospace",
            }}
          >
            {comparisonText}
          </span>
        </div>

        {/* Formula calculation */}
        <div
          style={{
            fontFamily: "monospace",
            fontSize: 14 * scale,
            color: "#E2E8F0",
            marginBottom: 6 * scale,
          }}
        >
          {formulaText}
        </div>

        {/* Action result explanation */}
        <div
          style={{
            fontSize: 14 * scale,
            fontWeight: 700,
            color: found ? "#6EE7B7" : cyan,
          }}
        >
          {actionText}
        </div>
      </div>
    </div>
  );
}
