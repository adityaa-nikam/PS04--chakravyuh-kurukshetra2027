import React from "react";
import type { VisualGraph } from "../visual-graph";
import { plannedMotion, recordRepresentations } from "../visual-graph";
import { recordComparisonMotion } from "../record-animation";
import { FitText } from "./FitText";
import { HighlightBand, TracePath, WipeReveal } from "./AnimationPrimitives";

const fieldColors = ["#ffcc66", "#8aefad", "#b9acff"];

// A reusable presentation of the existing validated example/focus contract.
// Full-width stacked code panels keep the same fields aligned at portrait size.
export function RecordComparison({ graph, sceneId, frame, durationInFrames, scale }: {
  graph: VisualGraph; sceneId: string; frame: number; durationInFrames: number; scale: number;
}) {
  if (!graph.example || !graph.comparisonFocus) return null;
  const example = graph.example;
  const state = recordComparisonMotion(frame, durationInFrames, example.fields.length, graph.comparisonFocus);
  const representations = recordRepresentations(example);
  const rowHeight = 110 / (example.fields.length + 2);
  const boxText = (text: string, role: "label" | "note" = "label", color = "#edf5f8") =>
    <FitText text={text} sceneId={sceneId} role={role} scale={scale} preferredSize={20 * scale} minimumSize={16 * scale} color={color} />;
  const activeColor = fieldColors[Math.max(0, state.activeField)];
  const connectionOpacity = Math.min(...graph.nodes.map(node => plannedMotion(graph, node.id, frame, durationInFrames).opacity));
  const fromY = 142 + (state.activeField + 1.5) * rowHeight;
  const toY = 310 + (state.activeField + 1.5) * rowHeight;
  return <div data-visual="record-comparison" data-sequence="record-correspondence" data-active-field={state.activeField}
    style={{ position: "relative", width: "100%", height: "100%" }}>
    <div style={{ position: "absolute", left: "2%", top: "0%", width: "96%", height: "17%", opacity: state.record, transform: `translateY(${(1 - state.record) * 12 * scale}px)` }}>
      <div style={{ position: "absolute", inset: "0 0 60%", color: "#91aebc" }}>{boxText(`One illustrative record: ${example.name}`, "note")}</div>
      {example.fields.map((field, i) => <div key={field.key} data-record-field={field.key} style={{ position: "absolute", top: "46%", left: `${i * 100 / example.fields.length}%`, width: `${98 / example.fields.length}%`, height: "48%", borderBottom: `2px solid ${fieldColors[i]}` }}>
        {boxText(`${field.key}: ${field.value}`)}
      </div>)}
    </div>
    {(["xml", "json"] as const).map(format => {
      const node = graph.nodes.find(n => n.label.toLowerCase() === format)!;
      const planned = plannedMotion(graph, node.id, frame, durationInFrames);
      const rows = representations[format].split("\n");
      const reveals = state[format];
      const top = format === "xml" ? 108 : 276;
      return <div key={format} data-format={format} style={{ position: "absolute", left: "2%", top: `${top / 520 * 100}%`, width: "94%", height: `${154 / 520 * 100}%`, background: "#123040", borderLeft: "3px solid #63e4ec", opacity: planned.opacity * (reveals[0] > 0 ? 1 : 0), transform: `translateX(${(1 - reveals[0]) * 18 * scale}px)` }}>
        <div style={{ position: "absolute", left: "3%", top: "3%", width: "94%", height: "17%" }}>{boxText(format.toUpperCase())}</div>
        <div data-component="inert-code-example" style={{ position: "absolute", left: "3%", top: "22%", width: "94%", height: `${110 / 154 * 100}%`, fontFamily: "monospace" }}>
          {rows.map((line, row) => {
            const fieldIndex = row > 0 && row < rows.length - 1 ? row - 1 : -1;
            const matching = fieldIndex >= 0 && fieldIndex === state.activeField;
            // Highlight syntax tokens separately: tags vs quoted keys, colon, braces.
            const tokens = format === "xml" ? line.split(/(<[^>]+>)/g) : line.split(/("(?:\\.|[^"\\])*"\s*:|[{},])/g);
            return <WipeReveal key={row} progress={reveals[row]} distance={10 * scale} data-field-key={fieldIndex >= 0 ? example.fields[fieldIndex].key : undefined}
              data-comparison-line={fieldIndex >= 0 ? "field" : "structure"} data-emphasis={matching ? "active" : state.structure ? "structure" : "none"}
              style={{ position: "absolute", top: `${row * 100 / rows.length}%`, width: "100%", height: `${100 / rows.length}%` }}>
              <HighlightBand active={matching} color={fieldColors[Math.max(0, fieldIndex)]}>
              <CodeLine tokens={tokens} syntax={state.structure} matching={matching} color={matching ? fieldColors[fieldIndex] : "#edf5f8"} sceneId={sceneId} scale={scale} />
              </HighlightBand>
            </WipeReveal>;
          })}
        </div>
      </div>;
    })}
    <svg viewBox="0 0 640 520" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} aria-label="Matching field in XML and JSON">
      {state.activeField >= 0 && <TracePath name="field-correspondence" path={`M605 ${fromY} H628 V${toY} H605`} progress={state.correspondence} color={activeColor} opacity={connectionOpacity} />}
    </svg>
    <div style={{ position: "absolute", left: "2%", top: "86%", width: "96%", height: "13%", transform: `translateY(${(1 - state.settle) * 4 * scale}px)` }}>
      {boxText(state.settle > 0 ? "Same values • different notation" : state.structure ? "XML: tags   •   JSON: keys and braces" : state.activeField >= 0 ? `Match ${example.fields[state.activeField].key} in both formats` : "One record, represented two ways", "note")}
    </div>
  </div>;
}

// Keep browser measurement/minimum-font failure behavior, while coloring inert tokens.
function CodeLine({ tokens, syntax, matching, color, sceneId, scale }: {
  tokens: string[]; syntax: boolean; matching: boolean; color: string; sceneId: string; scale: number;
}) {
  return <div style={{ position: "absolute", inset: 0 }}>
    <FitText text={tokens.join("")} sceneId={sceneId} role="label" scale={scale} preferredSize={20 * scale} minimumSize={16 * scale}
      color={matching ? color : "#edf5f8"}>
      {tokens.map((token, index) => <span key={index} data-syntax-token={index % 2 === 1 ? "true" : undefined}
        style={{ color: matching ? color : syntax && index % 2 === 1 ? "#63e4ec" : "inherit", background: syntax && index % 2 === 1 ? "#234e61" : "transparent" }}>{token}</span>)}
    </FitText>
  </div>;
}
