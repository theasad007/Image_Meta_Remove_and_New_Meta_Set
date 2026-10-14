# AGENTS.md — Rules for AI agents (Muse + subagents)

**Source of truth:** `MUSE_AI_Metadata_Manager_Build_Spec.md` + `docs/`. One phase at a time; stop for review.

1. Free only: no paid APIs/libs/services. Browser-only media processing; zero uploads (prove via Network/offline test).
2. Guests: inspect/clean/bulk/ZIP/CSV/PDF with no login, no count cap. Login only to save/apply custom metadata incl. GeoTag; canceling login preserves queue.
3. Never Canvas-convert for cleaning; preserve format/quality/transparency/animation; lossless segment/chunk surgery + verification re-read.
4. Honest statuses only (`Detected/Not detected/Not inspected/Unsupported/Uncertain/Verified removed/Verified updated/Retained intentionally/Failed/Partial`). No “fully clean” or “AI-undetectable” claims. No forged provenance/C2PA.
5. Static export safe: no server actions/API processing routes/Node runtime; lazy-load Workers/WASM/maps/PDF; `out/` deployable to Hostinger.
6. Security: escape UI/PDF/CSV (formula-injection guard), sanitize filenames, block `../` ZIP paths, harden parsers, revoke object URLs, minimal Firestore profile-only I/O with owner rules.
7. Do not touch `GeoTag_Final/`; do not overwrite spec; no installs until Phase 1 approval.
8. After each phase report: files, done vs incomplete, commands/results, samples, new limits, log + matrix updates, next recommendation (don't start it).

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
