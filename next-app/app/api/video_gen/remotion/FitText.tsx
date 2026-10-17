import React, { useLayoutEffect, useRef, useState } from "react";
import { cancelRender, continueRender, delayRender } from "remotion";
import { fitText, textSizes, type TextRole } from "./text-layout";

// Hold the render until fonts and the parent composition layout are ready.
export function FitText({ text, sceneId, role, scale, statistic = false, preferredSize, minimumSize, color = "#f8fafc" }: {
  text: string; sceneId: string; role: TextRole; scale: number; statistic?: boolean; preferredSize?: number; minimumSize?: number; color?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [handle] = useState(() => delayRender(`Fit ${sceneId} ${role}`));
  const sizes = textSizes(role, scale, statistic);
  const preferred = preferredSize ?? sizes.preferred;
  const minimum = minimumSize ?? sizes.minimum;
  useLayoutEffect(() => {
    let disposed = false;
    let firstFrame = 0;
    let secondFrame = 0;
    const ready = async () => {
      await document.fonts.ready;
      if (disposed) return;
      firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => {
          if (disposed || !ref.current) return;
          const node = ref.current;
          try {
            fitText(sceneId, role, preferred, minimum, font => {
              node.style.fontSize = `${font}px`;
              return { width: node.clientWidth, height: node.clientHeight,
                scrollWidth: node.scrollWidth, scrollHeight: node.scrollHeight };
            });
            continueRender(handle);
          } catch (error) {
            cancelRender(error instanceof Error ? error : new Error(String(error)));
          }
        });
      });
    };
    void ready().catch(error => {
      if (!disposed) cancelRender(new Error(`TEXT_LAYOUT: scene=${sceneId} role=${role}; ${String(error)}`));
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      continueRender(handle);
    };
  }, [text, sceneId, role, preferred, minimum, handle]);
  return <div ref={ref} data-scene-id={sceneId} data-text-role={role} style={{
    position: "absolute", inset: 0, fontSize: preferred, color,
    lineHeight: 1.3, overflowWrap: "anywhere", whiteSpace: "pre-wrap",
  }}>{text}</div>;
}
