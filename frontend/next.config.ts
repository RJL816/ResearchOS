import type { NextConfig } from "next";

/**
 * Two build modes:
 * - Web/dev (default): Cache Components + PPR, served by `next start`.
 * - Desktop (`DESKTOP_BUILD=1 next build`): full static export consumed by the
 *   Electron shell (desktop/). The backend runs as a local sidecar, so the
 *   API base is injected at runtime (desktop/config.js -> window.__RESEARCH_OS_API_BASE__).
 */
const isDesktopBuild = process.env.DESKTOP_BUILD === "1";

const TURBOPACK_CSS = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

const nextConfig: NextConfig = isDesktopBuild
  ? {
      output: "export",
      images: { unoptimized: true },
      ...TURBOPACK_CSS,
    }
  : {
      cacheComponents: true,
      partialPrefetching: true,
      ...TURBOPACK_CSS,
    };

export default nextConfig;
