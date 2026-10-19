import React from "react";
import type { IllustrativeAssetData } from "../enhanced-schema";
import { Img } from "remotion";

interface IllustrativeAssetVisualProps {
  data: IllustrativeAssetData;
  frame: number;
  fps: number;
  scale: number;
  durationInFrames?: number;
}

export function IllustrativeAssetVisual({
  data,
  frame,
  fps,
  scale,
  durationInFrames = 180,
}: IllustrativeAssetVisualProps) {
  const t = frame / fps;
  const progress = Math.min(1, Math.max(0, frame / durationInFrames));

  const cyan = "#38BDF8";
  const purple = "#A855F7";
  const gold = "#FACC15";

  // Subtle Ken Burns slow pan/zoom effect
  const zoom = 1 + progress * 0.08;
  const panY = progress * -12;

  // If no image asset was generated or available, render fallback visual
  if (!data.assetPath) {
    const fb = data.fallbackVisual;
    return (
      <div
        data-visual="illustrative-fallback"
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          padding: `${16 * scale}px`,
          textAlign: "center",
          background: "linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))",
          borderRadius: `${14 * scale}px`,
          border: `1.5px solid ${purple}`,
        }}
      >
        <div style={{ fontSize: `${42 * scale}px`, marginBottom: `${12 * scale}px` }}>💡</div>
        <div style={{ fontSize: `${20 * scale}px`, fontWeight: 800, color: "#F8FAFC", marginBottom: `${6 * scale}px` }}>
          {data.overlayHeadline}
        </div>
        <div style={{ fontSize: `${13 * scale}px`, color: "#CBD5E1", maxWidth: `${380 * scale}px`, lineHeight: 1.5 }}>
          {data.overlayDetail}
        </div>
      </div>
    );
  }

  return (
    <div
      data-visual="illustrative-asset"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        borderRadius: `${14 * scale}px`,
        overflow: "hidden",
        border: `1.5px solid ${purple}`,
        boxShadow: `0 0 24px ${purple}33`,
      }}
    >
      {/* Background AI Generated Image with subtle Ken Burns effect */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `scale(${zoom}) translateY(${panY}px)`,
          transition: "transform 0.1s linear",
        }}
      >
        <Img
          src={data.assetPath}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
        {/* Dark Vignette Overlay for readability */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, rgba(11, 15, 25, 0.4) 0%, rgba(11, 15, 25, 0.85) 100%)",
          }}
        />
      </div>

      {/* Foreground Technical Text Overlay */}
      <div
        style={{
          position: "absolute",
          bottom: `${16 * scale}px`,
          left: `${16 * scale}px`,
          right: `${16 * scale}px`,
          background: "rgba(15, 23, 42, 0.85)",
          backdropFilter: "blur(12px)",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          borderRadius: `${12 * scale}px`,
          padding: `${12 * scale}px ${16 * scale}px`,
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.5)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: `${8 * scale}px`, marginBottom: `${4 * scale}px` }}>
          <span style={{ width: `${8 * scale}px`, height: `${8 * scale}px`, borderRadius: "50%", background: purple, boxShadow: `0 0 8px ${purple}` }} />
          <span style={{ fontSize: `${10 * scale}px`, fontWeight: 800, color: purple, letterSpacing: `${1 * scale}px`, textTransform: "uppercase" }}>
            ILLUSTRATIVE CONTEXT
          </span>
        </div>

        <div style={{ fontSize: `${16 * scale}px`, fontWeight: 800, color: "#F8FAFC", marginBottom: `${4 * scale}px` }}>
          {data.overlayHeadline}
        </div>

        <div style={{ fontSize: `${11 * scale}px`, color: "#CBD5E1", lineHeight: 1.4 }}>
          {data.overlayDetail}
        </div>
      </div>
    </div>
  );
}
