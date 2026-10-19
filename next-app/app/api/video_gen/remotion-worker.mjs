// Run outside Next.js and its IDE instrumentation. Inputs are private files
// written from prepareRender's validated plan, never model-generated code.
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import net from "node:net";

function getAvailablePort(startPort = 8600) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", (err) => {
      if (startPort < 9500) {
        resolve(getAvailablePort(startPort + 1));
      } else {
        reject(err);
      }
    });
    server.listen(startPort, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : startPort;
      server.close(() => {
        setTimeout(() => resolve(port), 50);
      });
    });
  });
}

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
      const compPort = await getAvailablePort(8600);
      const composition = await selectComposition({
        serveUrl,
        id: "Explainer",
        inputProps,
        puppeteerInstance: instance,
        chromeMode: "chrome-for-testing",
        port: compPort,
      });
      const renderPort = await getAvailablePort(compPort + 1);
      await renderMedia({
        composition,
        serveUrl,
        inputProps,
        puppeteerInstance: instance,
        chromeMode: "chrome-for-testing",
        codec: "h264",
        pixelFormat: "yuv420p",
        outputLocation: job.output,
        concurrency: 1,
        muted: true,
        port: renderPort,
        ffmpegOverride: ({ type, args }) => {
          for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            if (typeof arg === "string" && (arg.includes(path.sep) || arg.includes("/"))) {
              try {
                const dir = path.dirname(arg);
                if (dir && dir !== "." && !existsSync(dir)) {
                  mkdirSync(dir, { recursive: true });
                }
              } catch {}
            }
          }
          return args;
        },
      });
    } finally {
      await instance.close({ silent: true });
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
}
