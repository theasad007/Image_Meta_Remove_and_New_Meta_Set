# 06 — Deployment: Hostinger Static (plan for Phase 9, constraints now)

- Build: `next.config.ts` → `{ output:'export' }` → `next build` → `out/`. Upload `out/` contents to Hostinger `public_html` (Cloud/static). No Node server, no SSR routes.
- Forbidden with export: server actions, API routes for processing, runtime cookies/middleware requiring Node, `next/image` default optimizer (use custom loader or `images.unoptimized`), `getServerSideProps`/ISR.
- WASM assets (`mediainfo`, `c2pa`, optional `ffmpeg-core`, optional HEIC display-decoder) served as static files with correct MIME (`application/wasm`); verify Hostinger serves them, else self-host path rewrite. Verify `image/avif`, `image/heic`, `image/heif` MIME/download behavior for direct outputs; app must not rely on inline HEIC rendering outside Safari.
- Client-only modules (Workers, WASM, Leaflet, Firebase, pdf-lib, mediainfo.js, ffmpeg trial, ISOBMFF engine, ExifReader ≥4.41.1) must be `dynamic(...,{ssr:false})` / lazy `import()` so prerender doesn't execute browser APIs.
- COOP/COEP (`SharedArrayBuffer` for multithread ffmpeg) generally **not settable** on cheap static hosts → plan assumes single-thread fallback; never require MT build.
- Fonts/tiles: OSM tiles are remote (attribution required); everything else local. Add cache headers where Hostinger allows; test Firefox/Safari + mobile.
- Env: Firebase web config is public; never ship Admin keys. Donate URL via env (`NEXT_PUBLIC_DONATE_URL`).
- Smoke: clean `next build`, load `/`, upload→inspect→clean→ZIP→CSV/PDF offline-after-load check (DevTools Network proves no media upload).
