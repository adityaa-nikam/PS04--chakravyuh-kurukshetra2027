import React from "react";
import { evolvePath, getLength, getPointAtLength } from "@remotion/paths";

const clamp = (progress: number) => Math.max(0, Math.min(1, progress));

// Progress comes from scene-local frames. No CSS transitions or wall-clock loops.
export function WipeReveal({ progress, distance = 0, children, style, ...attributes }: {
  progress: number; distance?: number; children?: React.ReactNode; style?: React.CSSProperties;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "children" | "style">) {
  const reveal = clamp(progress);
  return <div {...attributes} style={{ ...style, clipPath: `inset(0 ${(1 - reveal) * 100}% 0 0)`, transform: `translateX(${(1 - reveal) * distance}px)` }}>{children}</div>;
}

export function HighlightBand({ active, color, children }: { active: boolean; color: string; children?: React.ReactNode }) {
  return <div style={{ position: "absolute", inset: 0, background: active ? "#34483f" : "transparent", boxShadow: active ? `inset 3px 0 ${color}` : "none" }}>{children}</div>;
}

// Authored paths only; models continue selecting validated actions, never SVG code.
export function TracePath({ path, progress, color = "#63e4ec", opacity = 1, name = "trace-path", showHead = true }: {
  path: string; progress: number; color?: string; opacity?: number; name?: string; showHead?: boolean;
}) {
  const reveal = clamp(progress);
  const point = showHead && reveal > 0 && reveal < 1 ? getPointAtLength(path, getLength(path) * reveal) : null;
  return <g opacity={clamp(opacity)}>
    <path data-component={name} d={path} fill="none" stroke={color} strokeWidth={3} {...evolvePath(reveal, path)} />
    {point && <circle data-component="trace-head" cx={point.x} cy={point.y} r={4} fill={color} />}
  </g>;
}
