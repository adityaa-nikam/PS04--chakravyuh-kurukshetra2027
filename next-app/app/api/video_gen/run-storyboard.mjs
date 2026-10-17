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
  const files = mode === "explain" ? ["explain-cli"] : mode === "render-test" ? ["render-plan", "render-cli", "render.test", "explain.test", "inference.test", "visual-actions.test", "openrouter.test", "../jobs/jobs.test"] : mode === "generate" ? ["generate-script-cli"] : mode === "render" ? ["render-plan", "render-cli", "render.test"] : ["schema", "fixture", "normalize", "storyboard", "storyboard-cli", "storyboard.test"];
  const compilation = spawnSync(process.execPath, [require.resolve("typescript/bin/tsc"),
    "--outDir", output, "--rootDir", path.join(app, "app"), "--target", "ES2022", "--module", "commonjs", "--moduleResolution", "node",
    "--jsx", "react-jsx", "--strict", "--skipLibCheck", "--esModuleInterop", "--types", "node",
    ...files.map(file => path.join(__dirname, `${file}.ts`))], { cwd: app, stdio: "inherit" });
  if (compilation.status !== 0) process.exitCode = compilation.status || 1;
  else {
    const args = mode === "explain" ? [path.join(output, "api/video_gen", "explain-cli.js"), ...process.argv.slice(3)]
      : mode === "generate" ? [path.join(output, "api/video_gen", "generate-script-cli.js"), ...process.argv.slice(3)]
      : mode === "render-test" ? [path.join(output, "api/video_gen", "render.test.js")]
      : mode === "render" ? [path.join(output, "api/video_gen", "render-cli.js"), ...process.argv.slice(3)]
      : mode === "test" ? [path.join(output, "api/video_gen", "storyboard.test.js")]
      : [path.join(output, "api/video_gen", "storyboard-cli.js"), ...process.argv.slice(3)];
    const execution = spawnSync(process.execPath, args, { cwd: process.cwd(), stdio: "inherit",
      env: { ...process.env, NODE_PATH: path.join(app, "node_modules") } });
    process.exitCode = execution.status || (execution.error ? 1 : 0);
    if (mode === "render-test" && !process.exitCode) {
      for (const suite of ["explain.test", "inference.test", "visual-actions.test", "openrouter.test", "../jobs/jobs.test"]) {
        const extra = spawnSync(process.execPath, [path.join(output, "api/video_gen", `${suite}.js`)], { cwd: process.cwd(), stdio: "inherit", env: { ...process.env, NODE_PATH: path.join(app, "node_modules") } });
        process.exitCode = extra.status || (extra.error ? 1 : 0);
        if (process.exitCode) break;
      }
    }
  }
} finally { rmSync(output, { recursive: true, force: true }); }
