import { readFileSync } from "node:fs";
import { renderStoryboard } from "./render-service";
import type { RenderOptions } from "./render-plan";

async function main() {
  const [input, ...remaining] = process.argv.slice(2);
  const output = remaining[0] && !remaining[0].startsWith("--") ? remaining.shift() : undefined;
  const args = remaining;
  if (!input) throw new Error("Usage: npm run render:storyboard -- storyboard.json [output.mp4] [--visuals specifications.json] [--approve-overrun] [--width 720] [--height 1280] [--fps 15] [--browser /usr/bin/google-chrome]");
  const options: RenderOptions = {};
  let visualSpecs: unknown = {};
  let browser = process.env.REMOTION_BROWSER_EXECUTABLE || (process.platform === "win32" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : "/usr/bin/google-chrome");
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--visuals" && args[i + 1]) visualSpecs = JSON.parse(readFileSync(args[++i], "utf8"));
    else if (arg === "--approve-overrun") options.approveOverrun = true;
    else if (["--width", "--height", "--fps"].includes(arg) && args[i + 1]) options[arg.slice(2) as "width" | "height" | "fps"] = Number(args[++i]);
    else if (arg === "--browser" && args[i + 1]) browser = args[++i];
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  const original: unknown = JSON.parse(readFileSync(input, "utf8"));
  console.log(JSON.stringify(await renderStoryboard(original, options, visualSpecs, output, {}, undefined, browser), null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Render failed"); process.exitCode = 1; });
