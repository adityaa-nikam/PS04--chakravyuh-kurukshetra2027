import type { NextConfig } from "next";

// Console Ninja injects a Node native addon through LD_PRELOAD. Chrome/FFmpeg
// cannot load that addon (napi_get_global); retain any unrelated preload entries.
if (process.env.LD_PRELOAD?.includes("console-ninja")) {
  const remaining = process.env.LD_PRELOAD.split(/[\s:]+/).filter(entry => entry && !entry.includes("console-ninja"));
  if (remaining.length) process.env.LD_PRELOAD = remaining.join(":");
  else delete process.env.LD_PRELOAD;
}

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  serverExternalPackages: ["@remotion/bundler", "@remotion/renderer"],
};

export default nextConfig;
