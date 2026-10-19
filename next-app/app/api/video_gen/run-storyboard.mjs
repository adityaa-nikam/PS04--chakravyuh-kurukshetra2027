// Compile into an isolated temporary directory using the existing TypeScript dependency.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(__dirname, "../../..");
const output = mkdtempSync(path.join(tmpdir(), "explainer-storyboard-"));
const mode = process.argv[2];
try {
  const files = mode === "animation-test" ? ["local-narration.test", "plant-animation.test"] : mode === "tech-test" ? ["tech-catalog.test"] : mode === "explain" ? ["explain-cli"] : mode === "render-test" ? ["render-plan", "render-cli", "render.test", "local-narration.test", "elevenlabs.test", "plant-animation.test", "explain.test", "inference.test", "visual-actions.test", "openrouter.test", "tech-catalog.test"] : mode === "generate" ? ["generate-script-cli"] : mode === "render" ? ["render-plan", "render-cli", "render.test"] : ["schema", "fixture", "normalize", "storyboard", "storyboard-cli", "storyboard.test"];
  const compilation = spawnSync(process.execPath, [require.resolve("typescript/bin/tsc"),
    "--outDir", output, "--target", "ES2022", "--module", "commonjs", "--moduleResolution", "node",
    "--jsx", "react-jsx", "--strict", "--skipLibCheck", "--esModuleInterop", "--types", "node",
    ...files.map(file => path.join(__dirname, `${file}.ts`))], { cwd: app, stdio: "inherit" });
  if (compilation.status !== 0) process.exitCode = compilation.status || 1;
  else {
    const args = mode === "animation-test" ? ["--test", path.join(output, "local-narration.test.js"), path.join(output, "plant-animation.test.js")] : mode === "tech-test" ? [path.join(output, "tech-catalog.test.js")] : mode === "explain" ? [path.join(output, "explain-cli.js"), ...process.argv.slice(3)]
      : mode === "generate" ? [path.join(output, "generate-script-cli.js"), ...process.argv.slice(3)]
      : mode === "render-test" ? [path.join(output, "render.test.js")]
      : mode === "render" ? [path.join(output, "render-cli.js"), ...process.argv.slice(3)]
      : mode === "test" ? [path.join(output, "storyboard.test.js")]
      : [path.join(output, "storyboard-cli.js"), ...process.argv.slice(3)];
    const execution = spawnSync(process.execPath, args, { cwd: process.cwd(), stdio: "inherit",
      env: { ...process.env, NODE_PATH: path.join(app, "node_modules") } });
    process.exitCode = execution.status || (execution.error ? 1 : 0);
    if (mode === "render-test" && !process.exitCode) {
      for (const suite of ["local-narration.test", "elevenlabs.test", "plant-animation.test", "tech-catalog.test", "explain.test", "inference.test", "visual-actions.test", "openrouter.test"]) {
        const extra = spawnSync(process.execPath, [path.join(output, `${suite}.js`)], { cwd: process.cwd(), stdio: "inherit", env: { ...process.env, NODE_PATH: path.join(app, "node_modules") } });
        process.exitCode = extra.status || (extra.error ? 1 : 0);
        if (process.exitCode) break;
      }
    }
  }
} finally { rmSync(output, { recursive: true, force: true }); }
