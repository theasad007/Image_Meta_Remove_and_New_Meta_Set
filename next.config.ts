import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

// Fully static, browser-only export for Hostinger / any static host.
// Relative assets keep hydration working from a subdirectory (and from
// local index.html in browsers that allow local application assets).
// Development must keep Next's default asset path so Turbopack hydration
// and HMR use the live server instead of a relative static-export prefix.
// No server actions, API routes, SSR backend, or Cache Components.
export default function nextConfig(phase: string): NextConfig {
  return {
    output: "export",
    assetPrefix: phase === PHASE_DEVELOPMENT_SERVER ? undefined : ".",
    allowedDevOrigins: phase === PHASE_DEVELOPMENT_SERVER ? ["127.0.0.1"] : undefined,
    images: {
      unoptimized: true,
    },
  };
}
