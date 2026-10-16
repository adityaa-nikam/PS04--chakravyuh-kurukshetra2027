import React from "react";
import { Composition, getInputProps, registerRoot } from "remotion";
import { Explainer } from "./Explainer";
import type { RenderPlan } from "../render-plan";

function Root() {
  const { plan } = getInputProps() as { plan: RenderPlan };
  return <Composition id="Explainer" component={Explainer} width={plan.settings.width} height={plan.settings.height}
    fps={plan.settings.fps} durationInFrames={plan.durationInFrames} defaultProps={{ plan }} />;
}
registerRoot(Root);
