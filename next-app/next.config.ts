import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Remotion owns a Node bundler/native tools; do not rebundle it into Next routes.
  serverExternalPackages: ["@remotion/bundler", "@remotion/renderer"],
  // Exact trusted origins also supply Next's hostname-only dev asset allowlist.
  allowedDevOrigins: (process.env.ASTRA_ALLOWED_ORIGINS ?? "").split(",").flatMap(value => {
    try { const url = new URL(value.trim()); return ["http:", "https:"].includes(url.protocol) && !url.hostname.includes("*") ? [url.hostname] : []; }
    catch { return []; }
  }),
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
};

export default nextConfig;
