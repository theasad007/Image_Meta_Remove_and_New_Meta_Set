import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

// Fully static, browser-only export for Hostinger / any static host.
// The production site is served at the domain root (Cloudflare Pages or a
// static host), so absolute asset paths keep nested static routes such as
// /account/profile styled after a trailing-slash redirect. Development must
// keep Next's default asset path so Turbopack hydration and HMR use the live
// server instead of a static-export prefix.
// No server actions, API routes, SSR backend, or Cache Components.
export default function nextConfig(phase: string): NextConfig {
  return {
    output: "export",
    trailingSlash: true,
    assetPrefix: phase === PHASE_DEVELOPMENT_SERVER ? undefined : "/",
    allowedDevOrigins: phase === PHASE_DEVELOPMENT_SERVER ? ["127.0.0.1"] : undefined,
    images: {
      unoptimized: true,
    },
  };
}
