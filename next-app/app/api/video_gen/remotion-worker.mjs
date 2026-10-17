// Run outside Next.js and its IDE instrumentation. Inputs are private files
// written from prepareRender's validated plan, never model-generated code.
import { readFileSync } from "node:fs";
import path from "node:path";

try {
  const [input, browser] = process.argv.slice(2);
  const { openBrowser, selectComposition, renderMedia } = await import("@remotion/renderer");
  if (input === "--check-browser") {
    const instance = await openBrowser("chrome", { browserExecutable: browser, chromeMode: "chrome-for-testing" });
    await instance.close({ silent: true });
    console.log("Browser launch and shutdown succeeded.");
  } else {
    /** @type {{plan: import('./render-plan.js').RenderPlan, entryPoint: string, directory: string, browser: string, output: string}} */
    const job = JSON.parse(readFileSync(input, "utf8"));
    const { bundle } = await import("@remotion/bundler");
    const serveUrl = await bundle({ entryPoint: job.entryPoint, outDir: path.join(job.directory, "bundle"), webpackOverride: config => ({ ...config, cache: false }) });
    const inputProps = { plan: job.plan };
    const instance = await openBrowser("chrome", { browserExecutable: job.browser, chromeMode: "chrome-for-testing" });
    try {
      const composition = await selectComposition({ serveUrl, id: "Explainer", inputProps, puppeteerInstance: instance, chromeMode: "chrome-for-testing" });
      await renderMedia({ composition, serveUrl, inputProps, puppeteerInstance: instance, chromeMode: "chrome-for-testing", codec: "h264", pixelFormat: "yuv420p", outputLocation: job.output, concurrency: 1, muted: true });
    } finally {
      await instance.close({ silent: true });
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
}
