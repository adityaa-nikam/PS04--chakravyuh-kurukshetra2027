import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { generateExplainerScript } from "./script-generator";

import { loadCliEnvironment } from "./cli-environment";

async function main() {
  loadCliEnvironment();
  const [request, output, ...extra] = process.argv.slice(2);
  if (!request || !output || extra.length) throw new Error("Usage: npm run script:generate -- request.json script.json");
  if (existsSync(output)) throw new Error("Script output already exists; choose a fresh path.");
  // This explicit CLI always uses the real provider path, never the dev-only fixture switch.
  const fixtureFlag = process.env.VIDEO_GEN_USE_FIXTURE;
  try {
    process.env.VIDEO_GEN_USE_FIXTURE = "false";
    const script = await generateExplainerScript(JSON.parse(readFileSync(request, "utf8")), { live: true, visualPlanning: true });
    writeFileSync(output, JSON.stringify(script, null, 2), { flag: "wx" });
    console.log(`Saved script: ${output}`);
  } finally {
    if (fixtureFlag === undefined) delete process.env.VIDEO_GEN_USE_FIXTURE;
    else process.env.VIDEO_GEN_USE_FIXTURE = fixtureFlag;
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Generation failed"); process.exitCode = 1; });
