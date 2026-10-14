# 08 — Post-Codex Implementation Audit (audit-only, no code changed)

**Date:** 14 Oct 2026 · **Mode:** READ, VERIFY, TEST, DOCUMENT — no fixes implemented
**App directory:** `AI_meta_Data_Remover/` · **Spec:** `MUSE_AI_Metadata_Manager_Build_Spec.md` v1.1
**Auditor method:** live source inspection + executed checks (`typecheck`, `lint`, `test`, `build`, `audit --omit=dev`, full Playwright suite against fresh `out/`) + browser E2E evidence. No dependencies installed, no source edited, `GeoTag_Final/` untouched, no git history available (see §6.1).

---

## 1. Executive Summary

**Current working baseline:** A single-route (`app/page.tsx`, 957 lines) Next.js static-export app that does guest **image inspect → selective clean → verify → single/ZIP download → CSV/PDF reports** for JPEG/PNG/WebP/AVIF/HEIC stills, fully locally. All executed checks pass: `typecheck` clean, `lint` clean, **142/142 unit tests (16 files)**, `next build` clean, `npm audit --omit=dev` **0 vulnerabilities**, **48/48 Playwright tests** (desktop Chrome + mobile + Firefox) against the freshly built `out/`.

**Last demonstrably finished phase:** **Phase 5** (CSV/PDF reports). Phases 0–5 are implemented and verified subject to the caveats below. A later un-phased increment added queue-first UX, lazy HEIC preview (`heic-to`), and a **real C2PA browser validator** (`@contentauth/c2pa-web` 0.15.3) — the C2PA *inspector* exists and is UI-wired, but its `detected` path has **no committed signed fixture and no automated test asserting it** (§4).

**Blockers:** (a) C2PA/OpenAI user-image failure is undiagnosable to a single root cause without the owner's original file — most probable classes are `metadata absent from sample` + `test gap` (§4.6); (b) Phase 6 (Firebase rewrite), Phase 7 (GeoTag), Phase 8 (video ops) are **not implemented** — correctly labeled, not broken; (c) stale `docs/02-support-matrix.md` C2PA rows contradict the shipped C2PA code (§8, P1).

**Confidence:** **High** for inspect/clean/verify/bulk-ZIP/reports on tested still layouts (unit + E2E + ExifTool baselines agree). **Medium** for the C2PA `detected` path (real code, honest UI wiring, but no committed proof artifact). **High** that Phase 6/7/8 are absent (not half-built). **No functional regression attributable to the Codex redesign was found** — every rendered button is wired, 48/48 E2E pass on the current tree — but without git history a pre/post diff is impossible, so this is stated as *no evidence of regression*, not *proof of none* (§5).

---

## 2. Phase Status Table (0–9)

| Phase | Status | Evidence |
|---|---|---|
| 0 — Reference audit & feasibility | `Complete + verified` | `docs/01-reference-audit.md`, `docs/00-development-log.md:7-28`; GeoTag reference inventoried, AVIF/HEIC feasibility researched. No code claimed. |
| 1 — Foundation & file workspace | `Complete + verified` | `app/page.tsx`, `src/lib/format-detection/*`, `src/components/upload/*`, `src/components/queue/*`; 24-test origin reconciled to current 142 (§6); static export builds. |
| 2 — Image metadata inspector | `Complete + verified` (C2PA caveat) | `src/lib/metadata/inspect/inspect.ts:86-167`, `normalize.ts` (518 lines), `ai-indicators.ts:1-137`, `c2pa.ts:1-202`; 18 fixtures + `EXIFTOOL_BASELINE.txt` (539 lines); ExifTool cross-reads agree. Caveat: C2PA `detected` path untested by committed suite (§4). |
| 3 — Cleaning + verification | `Complete + verified` (scoped HEIC) | `src/lib/metadata/clean/{jpeg,png,webp,isobmff,index}.ts`, `src/lib/metadata/verify/verify.ts:110-348`; `EXIFTOOL_AFTER_CLEAN.txt` (445 lines); 14 `verified_clean` + 2 `partially_cleaned` + 3 no-op + refusals; HEIC scoped to tested stills + one real-encoder layout (`heic-real-encoder.heic`, libheif 1.23.6). |
| 4 — Bulk queue + ZIP | `Complete + verified` | `src/lib/queue/batch-{scheduler,pipeline}.ts`, `src/lib/zip/zip-{names,builder}.ts` (fflate STORE, FS-stream + Blob fallback, 4 GiB refusal); `e2e/bulk.spec.ts`, `e2e/scale.spec.ts` green incl. 1000-file runs. |
| 5 — CSV/PDF reports | `Complete + verified` | `src/lib/reporting/{snapshot,csv,pdf,privacy,download}.ts`, `src/components/reports/ReportsPanel.tsx`; frozen-snapshot model; `e2e/reports.spec.ts` green (CSV schema/redaction/C2PA-honesty, PDF props, ZIP Both, 200-file compact). |
| 6 — Firebase login + custom rewrite | `Not implemented` (correctly labeled) | **No** `src/lib/firebase/*`, no auth/profile UI, no rewrite engine. Only skeletal type mentions (`src/types/media.ts:50,100,125,128`; `src/types/reporting.ts:8`) + honest disclaimer (`src/components/panels/FuturePanel.tsx:35`) + `rewrites 0/n-a` in reports. Spec §6.3/Phase-6 acceptance unmet — this is the true next build. |
| 7 — GeoTag | `Not implemented` (correctly labeled) | **No** `src/lib/geo/*`, no map/coordinate editor. GPS is inspect-only + removed-with-EXIF (`verify.ts:289-299`); `InspectorPanel.tsx:178-181` states no map. No fake success path exists. |
| 8 — Video inspect + clean | `Partial` (preview-only, honestly gated) | Detection + `<video>` preview wired (`format-detection.ts:23,65`; `QueueItem.tsx:37-46,81`); cleaning **refused** (`clean/index.ts:54-55`; `normalize.ts:342-348` `not_inspected`; `page.tsx:211-214,254-260,560-566` exclusion); `FormatsPanel.tsx:7` shows `Preview only / ready:false`. No unsupported video op is presented as active. |
| 9 — Usability/perf/security/deploy | `Partial` | a11y/keyboard/mobile E2E pass (`e2e/a11y-mobile.spec.ts`, `upload-interactions.spec.ts`); responsive queue-first UI; `docs/06-deployment-hostinger.md` (10 lines, minimal); **no donation link shipped** (was disabled placeholder in Phase 1, now absent — spec-compliant since donation is optional); Next.js Oct-14 OOB (2 Critical + 1 High) still pending per `docs/07-known-limitations.md:7`. |
| Post-phase increment (un-phased): queue-first UX + HEIC preview + C2PA validation | `Implemented but unverified` (C2PA detected path) | `docs/00-development-log.md:106-110`; `c2pa.ts` + `inspect.ts:66-84` real; `heic-to` lazy preview real; 142 unit + 48 E2E green. But: no committed signed C2PA fixture, no test asserting `detected`, stale `02` rows (§4, §8 P0/P1). |

**Phase 6 actual status (explicit): NOT STARTED.** No Firebase Auth/Firestore code, config, rules, emulator test, sign-in modal, profile form, or per-format writer exists in `src/` or `app/`. Guest flows never trigger login (nothing to trigger). This matches the repair-pass note (`00-development-log.md:102`: rewrite/geotag/video/C2PA-validation "remain unavailable") as partially superseded only for C2PA *inspection*.

---

## 3. Feature × Image Format Matrix

Legend: ✅ proven by tests+E2E · ⚠️ scoped/partial · ❌ not implemented · ➖ honestly refused/labeled. Operation-level, not extension-recognition.

### 3a. Images — inspect / clean / verify

| Format | Inspect | Clean | Verified output | Evidence |
|---|---|---|---|---|
| JPEG/JPG (baseline + progressive) | ✅ EXIF/GPS/XMP/IPTC + JFIF | ✅ SOS-aware segment walk, orientation-minimal EXIF + ICC kept, APP11→partial | ✅ re-inspect + ExifTool after-dump | `clean/jpeg.ts:1-398`; `verify.ts`; `e2e/journey.spec.ts:37` |
| PNG (static) | ✅ eXIf/XMP(iTXt)/tEXt/zTXt/iTXt + header | ✅ CRC-gated chunk walk, APNG refused, bad-CRC failed | ✅ re-inspect + Pillow pixel-identical | `clean/png.ts:101-107,186-197`; `e2e/journey.spec.ts:52` |
| WebP (non-animated) | ✅ EXIF/XMP/GPS + VP8X | ✅ RIFF walk + padding, VP8X bits cleared only, animated refused | ✅ re-inspect + decode-equal | `clean/webp.ts:85-156`; `e2e/journey.spec.ts:62`; `e2e/robustness.spec.ts:45` |
| Animated WebP | ➖ Assess → refused | ➖ `Unsupported`, never flattened | ➖ no output (correct) | `clean` + `verify` refusal; E2E robustness |
| AVIF still | ✅ brand+meta, Make/GPS/XMP/ICC-capable | ✅ item-aware rebuild (`iinf`/`iloc` regen, `iref` prune, `ipma`-aware), hand + libavif real fixtures, Pillow pixel-identical 922→345 B | ✅ re-inspect + third-party decode | `clean/isobmff.ts:1-803` (803 lines); `e2e/journey.spec.ts:71` |
| HEIC/HEIF still (tested layouts) | ✅ brand+meta incl. 0,0 edge, assumed-ref + unreadable handling | ⚠️ proven **scoped**: hand stills + trailing-uuid partial + one real libheif/ExifTool layout (dual-cdsc, 5-prop ipma, non-zero base_offset, 4693→955 B, heif-convert identical) | ✅ for scoped layouts; otherwise `Partial`/`Unsupported`, never silent | `docs/02:18,103-104`; `clean.test.ts`; `e2e/journey.spec.ts:81` (HEIC preview journey) |
| HEIC multi-image/depth/aux/grid/sequence, 64-bit iloc, idat-backed, multi-mdat, movie boxes | ➖ refused | ➖ `Unsupported`/`Partial` | ➖ no false clean | `isobmff.ts:451,689-701`; `07-known-limitations.md:5` |
| iPhone Apple-encoder HEIC | ⚠️ wanted data point, not blocker | ⚠️ untested layout → `Partial`/`Unsupported` by rule | ❌ no proof claimed | `02:95,111-112`; `07:5` |

### 3b. C2PA inspect / C2PA remove

| Format | C2PA inspect | C2PA remove | Evidence |
|---|---|---|---|
| JPEG | ✅ engine real (UUID preflight + c2pa-rs/WASM validator); `not_detected` when no store, `not_inspected` on parser failure, `detected` + validation state + generator + source-type when present | ❌ **not removed** — APP11/JUMBF unconditionally retained (`clean/jpeg.ts:319-325`), `coverageLimited=true`, `retained_unsupported`, outcome capped at `partially_cleaned` | `c2pa.ts:122-200`; `inspect.ts:66-84`; `verify.ts:306-315` |
| PNG | ✅ same byte-level engine (format-independent UUID scan, so a `caBX`/adjacent-chunk store would still preflight-hit) — **no PNG-specific manifest-location parsing** (`caBX` zero hits in `src/`) | ❌ no C2PA-strip path; unknown ancillary kept (`png.ts:186-197`) | grep `caBX`=0; `clean/png.ts:101-107` |
| WebP | ✅ same engine via `mimeFor` | ❌ no JUMBF/`uuid` branch (`webp.ts:85-156` drops only EXIF/XMP) | `clean/webp.ts` |
| AVIF/HEIC | ✅ same engine via `mimeFor` | ❌ top-level `uuid`/`jumb` preserved verbatim + `retained_unsupported` (`isobmff.ts:697-701`); no payload inspection, no removal path | `isobmff.ts:697-701`; fixtures are synthetic (`gen-fixtures.py:684-688`) |
| Video (MP4/MOV/WebM) | ➖ `not_inspected` (fast-path, no validator invoked) | ➖ refused with Phase-8 reason | `inspect.ts:132-138`; `normalize.ts:342-348` |

Critical honesty property (verified in code): cleaning a C2PA-bearing file can never yield silent `verified_clean` — JUMBF/`uuid` retention forces `coverageLimited` → `partially_cleaned` (`verify.ts:329-331`), and `verify.ts:306-315` appends an explicit C2PA warning without letting `not_inspected`/`detected` alone block honest non-C2PA cleans.

### 3c. Custom rewrite / GPS write / preview

| Format | Custom rewrite | GPS write | Native preview | Evidence |
|---|---|---|---|---|
| JPEG | ❌ engine absent | ❌ writer absent (GPS inspect-only) | ✅ native `<img>` | `src/lib/metadata/*` has `clean/inspect/verify` only — no `rewrite/` dir |
| PNG | ❌ absent | ❌ absent (correct home `eXIf`/XMP still Target) | ✅ native | `07:4`; `05-metadata-field-mapping.md` |
| WebP | ❌ absent | ❌ absent | ✅ native | same |
| AVIF | ❌ absent (Required Target) | ❌ absent (Required Target) | ✅ native where browser decodes, else placeholder | `QueueItem` preview logic; `07:8` |
| HEIC/HEIF | ❌ absent (Required Target) | ❌ absent (Required Target) | ⚠️ native (Safari) else lazy `heic-to`/libheif WASM display-decode (display-only, never in clean path), else icon | `QueueItem.tsx:48-73`; `FormatsPanel.tsx:6`; E2E HEIC journey green |

### 3d. Video rows (Phase 8)

| Container | Inspection | Cleaning | Rewriting | Evidence |
|---|---|---|---|---|
| MP4 | ➖ `not_inspected`, preview only | ➖ refused, no transcode offered | ❌ absent | `clean/index.ts:54-55`; `FormatsPanel.tsx:7`; `future` disclaimers |
| MOV / WebM | ➖ same as MP4 (Target later) | ➖ refused | ❌ absent | `02:20-21`; `07:11` |
| Oversize / OOM | ➖ clear budget error, no output | ➖ no misleading download | — | 64 MB budget + 65 MB E2E (`queue.spec.ts:85`) |

### 3e. Intake / safety / queue / reports (format-independent)

- Extension/magic-byte/brand detection with spoof + mismatch + truncation handling: ✅ (`signatures.ts:1-383`, `SNIFF_WINDOW 65536`; `e2e/robustness.spec.ts:16,26`).
- Single/multi drag-drop + picker + folder-where-allowed, duplicates (`-2` dedupe), zero-byte/corrupt/cancel/retry/clear, object-URL cleanup: ✅ (`queue-store.ts:18-114`; `batch-scheduler.ts:31-79` concurrency clamped 1–2, default 1; `e2e/queue.spec.ts`, `upload-interactions.spec.ts`).
- No artificial count cap; proven 1000-file runs (unit 57 ms node for scheduling path; E2E 1000 mixed @~50 s, heap 21→121 MB per prior log; 200-file PDF in-browser this run §6): ✅ with honest device-constraint framing.
- ZIP: deterministic `images/<stem>-clean.<true-ext>` STORE, safe names, partials opt-in (default excluded), failures never archived, CRC/integrity, FS-stream vs Blob fallback, >4 GiB refused (no Zip64): ✅ (`zip-names.ts:55-83`; `zip-builder.ts:79-171`; `e2e/bulk.spec.ts:75,92,108,124,148,162`).
- CSV/PDF: standalone + ZIP None/CSV/PDF/Both, one row per input incl. failures/never-processed, `not detected/inspected/unsupported` distinct, formula-injection guard, GPS/profile redaction default with opt-in, WinAnsi `?`-with-count disclosure, compact PDF past 120 files: ✅ (`reporting/*`; `e2e/reports.spec.ts:93,120,130,144,158,193,204`).

---

## 4. C2PA + OpenAI Root-Cause Investigation (PRIORITY P0)

### 4.1 What is actually implemented (not assumed)

**Real parser, real dependency, real wiring — verified in source:**

- `src/lib/metadata/inspect/c2pa.ts` (202 lines, entire file is logic):
  - `c2pa.ts:3-4` — types against `@contentauth/c2pa-web/inline` (package `0.15.3`, installed; `node_modules/@contentauth/c2pa-web/dist/` contains `inline.js`, `c2pa-ekHbRvhf.js`, `c2pa_worker.js`). Only imports in `src/` are `c2pa.ts:3,38,137` (both dynamic `import()`, lazy).
  - `c2pa.ts:13-16` — standard 128-bit C2PA Manifest Store JUMBF UUID constant.
  - `c2pa.ts:28-34` — `hasEmbeddedManifestStore()`: full-blob exact byte scan ("cheap local gate that avoids loading 12 MB validator WASM for the overwhelmingly common no-C2PA case").
  - `c2pa.ts:36-41` — lazy `createC2pa()` runtime, cached.
  - `c2pa.ts:122-144` — `inspectC2pa()`: no-Worker/WASM → `not_inspected`; preflight miss → `not_detected` ("No embedded C2PA Manifest Store identifier was found"); validator finds nothing → `not_detected`; else `Reader.fromBlob(sdk, mimeType, blob)` → `manifestStore()` → tags for Manifest Store / Validation State / Active Manifest / Claim Generator + Software Agents (`namedSoftware`, `c2pa.ts:63-100`) / Digital Source Types (recursive `findDigitalSourceTypes`, `c2pa.ts:102-116`) / Signer (`signature_info.common_name|issuer`); AI indicators from software-name regex and AI source-type regex (`c2pa.ts:166-186`); failure-counted warnings (`c2pa.ts:187-191`); parse exceptions → `not_inspected` (`c2pa.ts:195-200`).
- Overlay wiring `src/lib/metadata/inspect/inspect.ts:66-84` (`withC2pa`, called `164-166` after ExifReader normalization; skipped on `failed`/`unsupported`; Node (no `Worker`) early-return; `completed→partial` downgrade when C2PA `not_inspected`).
- Placeholder-then-overlay design: `normalize.ts:501-502,517-518` seeds `not_inspected` with `C2PA_BLOCKER` ("never not detected" without a run); video/sequence fast paths seed `not_inspected` (`normalize.ts:342-351,357-366`).
- UI reflects state, not static labels: `QueueItem.tsx:97-122` (`C2PA {n}` pill from `status==="detected" && tags.length>0`, else grey `C2PA 0`; `OpenAI` chip only when an indicator's label+value matches `/openai|dall[ -]?e|chatgpt/i`, else generic `AI {n}`); `InspectorPanel.tsx:37-96,140-177` renders category/status/tags/reader verbatim + `AI_INDICATOR_DISCLAIMER`; `BeforeAfterPanel.tsx:12,81-86` warns C2PA is separate ("not a total clean"); reports record `C2PA Before/After` from category status (`reporting/csv.ts:16,19`; `snapshot.ts:75`; `pdf.ts:239,269,315-316`).
- **Cleaning never strips C2PA** (§3b): JPEG APP11 retained (`clean/jpeg.ts:319-325`), ISOBMFF `uuid`/`jumb` retained (`clean/isobmff.ts:697-701`), PNG/WebP no C2PA-strip path. `verify.ts:306-315` discloses without over-blocking.

**OpenAI detector — designated-field heuristic with negative control (`ai-indicators.ts:20-50,69-134`):** signatures include `dall-e, dalle, openai, chatgpt, gpt-image, sora` (`ai-indicators.ts:28-33`) but matching fires **only** in software/provenance fields (`SOFTWARE_FIELDS`, `ai-indicators.ts:46-50`) or via `DigitalSourceType=trainedAlgorithmicMedia` / `AIPrompt*/AIGeneration*/AISystem*` fields. Ordinary `Description/Title/Caption` never matches (early return; `normalize.ts:273-299` only feeds eligible keys). Proven by `inspect.test.ts:106-110` (`CreatorTool="OpenAI GPT-Image"` → 1 explicit; `Description="Made with OpenAI"` → 0) and the caption control `inspect.test.ts:122-126` (`jpeg-caption-ai.jpg`, `dc:description="Portrait of Ai at the market"` → 0 indicators).

### 4.2 Supported containers — proven vs untested vs unsupported

| Path | State | Reason |
|---|---|---|
| Byte preflight (any container) | ✅ implemented, format-independent full-blob UUID scan | `c2pa.ts:28-34`; a store anywhere in bytes preflight-hits regardless of chunk/box name |
| JPEG APP11 inspection | ✅ validator invoked on preflight hit (`mimeFor` → `image/jpeg`) | `inspect.ts:54-64,164-166`; `c2pa.ts:136-138` |
| PNG (`caBX` et al.) inspection | ⚠️ preflight works; **no PNG-specific manifest-location parsing** (`caBX` zero hits in `src/`) | Validator still decides; location-aware handling unproven |
| WebP / AVIF / HEIC inspection | ✅ validator invoked on preflight hit | `mimeFor` covers `image/webp`, `image/avif`, `image/heic` |
| AVIF/HEIC sequences, video | ➖ never reach validator (fast-path `not_inspected`) | `inspect.ts:132-138` |
| Claim interpretation (presence vs signer/trust/validity vs external assertions) | ✅ distinguished in tags + warnings | `c2pa.ts:150-163,187-191`; never calls presence "valid/trusted" |
| JPEG APP11/JUMBF removal | ❌ retained by design | `clean/jpeg.ts:319-325` |
| PNG `caBX` removal | ❌ no path | `clean/png.ts` |
| WebP JUMBF removal | ❌ no path | `clean/webp.ts:85-156` |
| ISOBMFF `uuid`/`jumb` removal | ❌ retained by design | `clean/isobmff.ts:697-701` |

### 4.3 Why a user image shows no C2PA / no OpenAI — failure taxonomy applied

For the reported symptom ("UI fails to identify C2PA and OpenAI in at least one owner-tested image"), the code admits **five live possibilities**, in likelihood order for typical web-sourced AI images:

1. **`metadata absent from sample` (most likely for OpenAI web downloads).** ChatGPT/DALL-E downloads, screenshots, re-saves, and social-media copies routinely carry **no** EXIF `Software`, XMP `CreatorTool`, `DigitalSourceType`, prompt fields, **and** no embedded C2PA store. The engine then *correctly* returns C2PA `not_detected` (preflight miss, `c2pa.ts:130-134`) and zero AI indicators — the grey `C2PA 0` / `AI 0` chips are truthful, not a bug. Absence proves nothing about AI origin (disclaimer in UI, reports, and `ai-indicators.ts:3-11`).
2. **`unsupported container/manifest`.** PNG `caBX`-carried stores have no location-aware parsing; exotic/segmented JUMBF layouts are unproven; sequences/video never reach the validator. A store in one of these paths could preflight-hit yet fail validation → `not_inspected`, or (PNG) be found only by luck of the byte scan.
3. **`parse/verification failure`.** `Reader.fromBlob` exceptions, WASM load failure, or corrupt manifests → `not_inspected` with message (`c2pa.ts:195-200`). Validator-reported failures surface as `detected` + "do not treat as trusted" (`c2pa.ts:187-191`) — present but untrusted, which a user may misread as "not identified."
4. **`test gap`.** No authentic OpenAI/C2PA image exists in `src/test-fixtures/`; the only C2PA-adjacent fixtures are **synthetic byte markers**: `jpeg-jumbf.jpg` = `APP11 "JUMBF\0" + 64×0x00` dummy (`gen-fixtures.py:604-616`, **not** the real store UUID), `heic-uuid.heic` = trailing `uuid(range(16) + b"synthetic-uuid-payload")` (`gen-fixtures.py:684-688`). Neither exercises the validator's `detected` path. Unit tests assert only the Node fallback (`inspect.test.ts:233-238`, `not_inspected` × 4) and never the WASM path (impossible under Node: `withC2pa` early-returns without `Worker`). The dev-log claim ("c2pa-rs signed fixture reports detected with nine claim tags", `00-development-log.md:109`) has **no committed artifact** — unverified claim, possibly a manual Chrome-only check.
5. **`not implemented` / `not connected to UI` — RULED OUT.** Both exist (§4.1). Do not use these classifications.

**Verdict class: `undetermined — requires sample`, with `metadata absent from sample` as the leading hypothesis and `test gap` as the confirmed systemic cause.** No code evidence supports "detector broken on valid input"; no fixture evidence supports "detector proven on valid input" either. The honest UI (`Not Detected` only after a completed preflight, `Not Inspected` otherwise) means a misdiagnosis by the UI itself is unlikely — but only the owner's bytes can close this.

### 4.4 Reproduction plan (no user media uploaded anywhere)

1. In a desktop Chrome, open the deployed/`out/` app → upload the original file → open row details → record the **C2PA row status + warning text** and the **AI indicator list** (empty or not).
2. Locally (never upload): run `exiftool -G -a -s <file> | grep -i -E "software|creatortool|generator|history|digitalsource|aiprompt|openai|dall|chatgpt|c2pa|jumb"` and `exiftool -x c2pa -b <file> | head -c 200 | xxd | head` (or strings search for `c2pa`). If both are empty, the file carries no detectable provenance — the app is correct and the expectation needs resetting.
3. If EXIF/XMP names OpenAI but the app shows zero indicators, capture the exact field name/value and file format → that is a true detector miss (file `P0` bug with repro).
4. If a C2PA store exists (EXIF `Jumb`/`C2PA` groups non-empty) but the app says `not_inspected`, capture the warning text → validator-failure bug. If it says `not_detected` despite a real store UUID in bytes, capture `xxd` of the UUID region → preflight bug.
5. Share **only** the finding triplet (C2PA status string / indicator count / relevant field names) or, ideally, a **regenerable equivalent**: a fresh DALL-E/original download with documented provenance, or permission to commit a redacted synthetic twin, so a permanent `detected`-path fixture can be added.

---

## 5. Codex UI/UX Regression Audit

**Attribution limit (stated plainly):** the workspace has **no git repository** (`git branch/status/log` → `fatal: not a git repository`), so no pre/post-Codex diff exists and no change can be attributed to Codex vs prior Muse work. No `Codex`/`redesign` mentions exist in `docs/00-07`, `AGENTS.md`, configs (only `node_modules` harness strings). The audit therefore checks the **current tree for dead/fake/regressed actions** instead.

**Result: no functional regression found; every action is wired.**

- ** Buttons inventory** (`app/page.tsx` orchestrator + `UploadPanel`, `QueueList`/`QueueItem`, `BatchPanel`, `BeforeAfterPanel`, `ReportsPanel`, `InspectorPanel`): every rendered `<button>` has an `onClick` → real handler (`handleCleanOne:page.tsx:208-252`, `startBatch:257-326`, `handleDownloadZip:572-724`, `handleDownloadCsv/Tags/Pdf:744-816`, cancel/retry/clear paths). All `disabled` states are honest guards (`busy`, `noTarget`, `selected==0`, `eligible==0`, `fileCount==0`, `archiving`, no verified output). Video/unknown rows show a `Review only` span, not a fake button. Anchors (`Header`/`Hero` `#upload`, `#how-it-works`) resolve.
- **Operations preserved:** Inspect (auto on add `page.tsx:399-404` + per-row + Inspect-all, cancel `QueueList.tsx:78`), Clean (single + `Clean selected/all` + scopes EXIF+GPS/descriptive/AI-only `QueueList.tsx:98-104`), Batch (progress, cancel, retry), Download (single + ZIP + ZIP-without-reports fallback), Reports (None/CSV/PDF/Both + Summary/Detailed + opt-in exposure) — all exercised green in E2E on the **current** static export (§6).
- **State/event integrity:** stale-result guards, run tokens (`runRef`), quartile announcements, privacy-choice resets at workflow boundaries, stale ZIP/report invalidation, scroll/focus-into-view result panels — present per repair pass (`00-development-log.md:94-104`) and E2E-passing.
- **Placeholders:** the six disabled Planned placeholders + donate placeholder from Phase 1 no longer exist; the only "future" surface is the honest `FuturePanel` disclaimer + `FormatsPanel` `Preview only / ready:false` video row. **Zero dead buttons, zero mock success states.**
- **Doc staleness (not a UI regression):** `docs/02-support-matrix.md:82,108` still claim "No parser integrated … Never reported absent" (Class D) for C2PA presence — **contradicted** by shipped `c2pa.ts`, `07-known-limitations.md:2`, `README.md:75-78`, and the dev log. Filed as P1 doc bug (§8), not a functional regression.
- **Screenshots:** none captured during this audit (headless suite retains only-on-failure; no failures occurred). Prior-phase `e2e/artifacts/` are gitignored and were not used as evidence here.

---

## 6. Test Evidence Ledger

Environment: `node v24.15.0`, `npm 11.12.1`, installed `next 16.4.0`, `react 19.3.0`, `typescript 5.9.3`, `tailwindcss 4.3.3`, `exifreader 4.50.0`, `fflate 0.8.3`, `pdf-lib 1.17.1`, `heic-to ^1.6.6` (installed), `@contentauth/c2pa-web 0.15.3`, `vitest 5.0.4`, `@playwright/test 1.64.0`. Deps per `package.json:15-42`; static export per `next.config.ts:11-17` (`output:'export'`, prod-only `assetPrefix:"."`, `images.unoptimized:true`); single route `/` (+ `_not-found`, `icon.svg`).

### 6.1 Baseline VCS

- `git branch/status/log` → `fatal: not a git repository (…/Volumes)`. **No branch, commit, or diff available; Codex modifications cannot be isolated or preserved-by-diff.** Nothing was reset/reverted/reformatted (nothing *could* be). Recommendation: initialize git before any fix phase (§11).

### 6.2 Commands executed (this audit, current tree, unmodified)

| Command | Result |
|---|---|
| `npm run typecheck` (`tsc --noEmit`) | ✅ clean, exit 0 |
| `npm run lint` (`eslint .`) | ✅ clean, exit 0 |
| `npm run test` (`vitest run`) | ✅ **16 files / 142 passed**, Duration ~406 ms (tests 65%); scale probes observed: `scale/20: 34ms, /50: 43ms, /100: 26ms, /500: 31ms, /1000: 50ms`; `pdf/1000: 130ms pages=35 bytes=330273` |
| `npm run build` (`next build`, 16.4.0 Turbopack) | ✅ compiled → TypeScript ok → 3/3 static pages (`/`, `/_not-found`, `/icon.svg`), exit 0 |
| `npm audit --omit=dev` | ✅ **0 vulnerabilities**, exit 0 |
| `npx playwright test --list` | 48 tests in 8 files (desktop + mobile + firefox projects) |
| `npm run test:e2e` (fresh `out/` + `python3 -m http.server 8130`) | ✅ **48/48 passed (~3.0 min)** across desktop-Chrome, mobile (Pixel 7), Firefox — incl. journeys with independent download re-reads, bulk/ZIP extract + re-inspect, CSV/PDF parse, 200-file compact PDF (`browser-pdf/200: 130ms bytes=72938 pages=8`) |

### 6.3 Historical count reconciliation (24 → 142)

`00:32` 4 files/24 → `00:46` 6 files/51 → `00:56` 7 files/76 → `00:90` 7 files/82 + 19 E2E → `00:81` 12 files/112 + 32 E2E → `00:72` 16 files/137+ → `00:101` 16 files/139 + 48 E2E → `00:110` 16 files/142 → **this audit: 16 files/142 + 48 E2E, all green.** Monotonic growth, no disappearing suites; the "137" figure was an intermediate Phase-5 count superseded by 139 then 142. No fabricated timings are reported above — only this run's observed values plus quoted log values clearly attributed to the log.

### 6.4 What is proven by execution vs inspection vs untested

- **Execution-proven (unit):** format sniffing, EXIF/GPS/XMP/IPTC normalization, AI-indicator rules + caption negative control, JPEG/PNG/WebP/ISOBMFF cleaning incl. JUMBF/`uuid` partial paths, verify state machine, scheduler/pipeline/scale, ZIP names/builder, snapshot/CSV/PDF/zip-reports (incl. formula-guard, redaction, WinAnsi counting).
- **Execution-proven (browser E2E, real Chrome/Firefox vs production `out/`):** upload (picker + real `DataTransfer` drop + same-file reselect + keyboard), auto-inspect, selective clean, single + ZIP downloads with **byte-level re-inspection** (system `unzip` + ExifReader/ExifTool re-reads), CSV/PDF download + parse, redaction/opt-in, partial opt-in/out, failures-never-in-ZIP, retry, cancel, 65 MB budget refusal, spoof/corrupt/truncated/animated-WebP/JUMBF-partial handling, 100/200/1000-file scale, mobile layout + keyboard, request-log locality (GET-local + `blob:` only).
- **Static-inspection only:** C2PA `detected`-path internals (code-read, no committed exercising test); PNG `caBX` absence (grep-verified zero hits); Firebase/GeoTag/video-ops absence (directory + grep verified).
- **Untested / not claimed:** genuine signed-C2PA image end-to-end (no fixture); authentic OpenAI-attributed image end-to-end (no fixture); iPhone Apple-encoder HEIC; FS-picker streaming save (mock-tested only, native dialog unautomatable headless); >4 GiB ZIP (refused by design); Safari manual pass; production Hostinger URL smoke test.

### 6.5 Network check

- `grep fetch(|XMLHttpRequest|sendBeacon|WebSocket|firebase|firestore|googleapis|openstreet|tile` over `src/ + app/` → **zero media/network sinks** (only unrelated test-word and quartile-ref hits). No `localStorage`/`IndexedDB` writes in `src` per `07:17` (not re-grepped here; claim retained as doc-sourced). E2E `queue.spec.ts:100` ("no image bytes leave the browser") passed in this run's 48/48. Static assets (`/_next/*`, `icon.svg`) are fetched as normal page loads — the guarantee is *no user media upload*, which holds.

---

## 7. Security & Privacy Findings

1. **Media locality ✅:** zero upload paths in code; E2E request-log proof passes; static-only `out/` servable by plain HTTP (`python3 -m http.server`), no API routes/server actions.
2. **Production deps ✅ minimal & clean:** runtime = `next` (build-time only for export), `react`, `exifreader`, `fflate`, `heic-to` (lazy display-only), `pdf-lib` (lazy), `@contentauth/c2pa-web` (lazy, post-preflight), `@xmldom/xmldom` dev-only. `npm audit --omit=dev` = 0 vulns. No paid/subscription/ads/tracking deps.
3. **Known patch window ⚠️ (no action taken per audit rules):** Next.js 16.4.0 pinned; Oct-14 OOB (2 Critical + 1 High) unreleased at audit time (`07:7`); 15.x EOL ~21 Oct; dev-only `braces`-chain high via eslint tooling not shipped. Documented, not upgraded (see P2).
4. **Input hardening ✅:** 64 KiB sniff window + 64 MB/file budget (pre-allocation `File.size` reject), chunk/box length + CRC + `iloc` budgets, tag/value caps (400/500), failed/unsupported/missing-category can never verify, exceptions → `failed`, hostile filename/CSV-cell sanitization, `../` ZIP traversal block, deterministic dedupe.
5. **Output honesty ✅:** `Verified removed/updated` only on re-read proof; `Retained intentionally` (ICC, orientation-minimal EXIF); `Partial` for JUMBF/`uuid`; C2PA never auto-stripped; reports default Summary-redacted with explicit opt-in; PDF carries no author/user data (`pdf.test.ts:127`, E2E PDF-props test).
6. **Secrets ✅:** no Firebase config/keys in tree (nothing to leak because Phase 6 absent); `docs/06:9` correctly notes web config is public / never Admin keys — applicable when Phase 6 lands.
7. **Cleaning-path purity ✅:** no Canvas/`toBlob`/`readAsDataURL` in clean path (sole "canvas" hit is a WebP error string about canvas *size*); HEIC `heic-to` decode is preview-only (`QueueItem.tsx:56-57`, quality-0.82 JPEG blob for display; source/output bytes untouched).
8. **Donation ✅ spec-compliant:** no donate button/URL shipped (optional per spec rule 2); no paywall, caps, accounts, or ads anywhere.

---

## 8. Issues Ranked P0/P1/P2/P3 (remedy = proposal only, NO implementation)

**P0-1 — C2PA/OpenAI user-image failure undiagnosed for lack of sample; `detected` path unproven by committed tests.**
Impact: owner cannot trust C2PA/OpenAI badges on real-world AI images. Evidence: §4 (code `c2pa.ts:1-202`, wiring `inspect.ts:66-84`, UI `QueueItem.tsx:97-122`; fixtures synthetic `gen-fixtures.py:604-616,684-688`; `inspect.test.ts:233-238` fallback-only; dev-log 9-tag claim without artifact `00:109`; stale `02:82,108`). Smallest safe remedy: obtain a reproducible sample (or regenerable equivalent) → commit a real-manifest fixture + `detected`-path unit/browser tests → update stale `02` rows; do **not** broaden OpenAI matching to captions/titles (would create false positives against `ai-indicators.ts` design + `04:17` negative control).

**P1-1 — Stale `docs/02-support-matrix.md` C2PA rows contradict shipped code.**
Impact: auditors/owners misread C2PA as "no parser integrated." Evidence: `02:82,108` ("No parser integrated (blocker…)") vs `c2pa.ts`, `07:2`, `README.md:75-78`, `00:109-110`. Remedy: reword rows to "browser validator present; `detected` path needs committed fixture proof; removal unsupported" — docs-only edit.

**P1-2 — No committed genuine C2PA-signed or OpenAI-attributed fixtures (authentic / synthetic / adversarial ladder missing).**
Impact: every future C2PA/OpenAI claim stays unverifiable. Evidence: fixture dir listing (§6.4: 18+ hand/synthetic files, zero signed manifests); `04-test-plan.md:26,29,30` lists C2PA fixtures as "when/where available" — still unavailable. Remedy: add fixture ladder (real signed → synthetic UUID-positive → adversarial caption-only negative) + exact input/output tests; never invent green results.

**P1-3 — PNG C2PA location handling (`caBX`) has no explicit code or fixture.**
Impact: PNG-borne manifests rely solely on the format-independent byte scan + generic validator. Evidence: grep `caBX` = 0 in `src/`; `clean/png.ts:101-107,186-197`. Remedy: research PNG C2PA chunk placement, add parse-aware handling or document as unsupported-with-test.

**P2-1 — Next.js Oct-14 OOB (2 Critical + 1 High) pending; 15.x EOL ~21 Oct.**
Impact: release-readiness risk. Evidence: `07:7`; installed `16.4.0` pinned, audit clean today. Remedy (post-approval, not in audit): re-run `npm audit`, evaluate patched Next.js, rebuild + full suite; never downgrade to 14.2.33.

**P2-2 — No git repository; Codex vs prior work unattributable; no redox safety net.**
Impact: future fixes cannot be diffed/reviewed safely. Evidence: §6.1 `fatal: not a git repository`. Remedy: `git init` + initial commit of current tree before any fix phase (process step, not app change).

**P2-3 — ISOBMFF long-tail layouts stay Unsupported/Partial by design (grids/overlays/aux, 64-bit iloc, idat-backed, multi-mdat, sequences).**
Impact: some real AVIF/HEIC files will refuse or partial-clean — correct behavior, but coverage-limited. Evidence: `isobmff.ts:451,689-701`; `02:95,111-112`; `07:5`. Remedy: per-layout fixture expansion in a dedicated milestone, never silent conversion.

**P3-1 — `docs/06-deployment-hostinger.md` minimal (10 lines); no production-URL smoke evidence.**
Impact: deploy step under-documented. Evidence: file length; `03:64` Phase-9 acceptance unmet. Remedy: post-approval deploy + URL smoke test doc.

**P3-2 — PDF non-WinAnsi `?` substitution + 400-transition appendix cap (disclosed).**
Impact: cosmetic for Bangla/non-Latin detail in PDF (exact values preserved in CSV). Evidence: `07:19`; `pdf.ts`. Remedy: none required unless owner prioritizes full-Unicode PDF fonts (would grow bundle).

**P3-3 — No donation URL configured (optional).**
Impact: none functional. Evidence: §7.8; `06:9` env placeholder. Remedy: owner supplies URL if wanted; single-link addition later.

Explicitly **not** issues: Phase 6/7 absence (correctly labeled, no fake UI); video refusal (honest gating); grey `AI 0`/`C2PA 0` on metadata-free files (truthful output); `heic-to` LGPL-3.0 display-decoder laziness (display-only, replaceable, disclosed `07:9`).

---

## 9. Remaining Work Roadmap (original requirements preserved; C2PA split as ordered)

**Done (verified):** Phases 0–5 per §2; queue-first UX; HEIC lazy preview; C2PA *inspection* engine + UI wiring (detected-path proof outstanding).
**Not done (in spec order):**
1. **C2PA inspector milestone (proof, not new engine):** committed real-manifest fixtures + `detected`/failure-path tests + stale-doc correction (closes P0-1/P1-1/P1-2). Separate from removal.
2. **C2PA removal milestone (per-format, only if proven):** JPEG APP11/JUMBF, PNG `caBX`, WebP, ISOBMFF `uuid`/`jumb` strip fixtures + independent validation; until then retention + `partially_cleaned` stays (spec §6.2/§13 compliant).
3. **Phase 6 — Firebase login + custom rewrite** (guest flows untouched; owner-only Firestore rules + emulator tests; per-format field writers incl. AVIF/HEIC where standards-compliant; bulk rewrite; ZIP/report integration).
4. **Phase 7 — GeoTag** (paste + lat/lon + optional Leaflet/OSM with attribution; EXIF GPS write + round-trip verify per supported format; bulk apply; signed-in only).
5. **Phase 8 — Video** (MediaInfo.js evaluation → MP4 inspect + metadata-only clean first; MOV/WebM only after fixture proof; playability/duration/track verification; size/RAM guards).
6. **Phase 9 — Final hardening + Hostinger deploy** (Next.js OOB resolve, full a11y/perf pass, donation link if supplied, production-URL smoke, final regression).
Out of scope (unchanged): paywalls, paid APIs, server-side processing, cloud media storage, content-based AI detection, invisibility guarantees, forged provenance (§16 of spec).

---

## 10. Explicit Questions / Evidence Needed from Owner (blocking only)

1. **The original OpenAI/C2PA image (or a regenerable equivalent).** Without it the P0 diagnosis stays `undetermined — requires sample` (§4.3). A fresh DALL-E/GPT-Image download with documented provenance, or permission to commit a redacted twin, unblocks the `detected`-path fixture. Repro steps without uploading media are in §4.4.
2. **Firebase decision for Phase 6:** supply the web config + approved domains when that phase is approved, or defer Phase 6 explicitly (guest app is complete without it).
3. **Donation URL (optional, Phase 9):** provide the Buy-Me-a-Coffee link if wanted; otherwise the link stays absent by design.
4. **iPhone Apple-encoder HEIC sample (wanted, not blocking):** strengthens HEIC layout coverage; current libheif proof stands without it.
5. **Confirm audit-recording preference:** this report is the single new file (`docs/08-*`); `docs/00-development-log.md` was **not** touched (audit-only strictness). Approve a one-line log entry next phase if desired.

---

## 11. STOP / Next Approval Gate

**Do not start fixes until the owner approves.** Recommended **single next scoped step: P0 proof milestone — "C2PA/OpenAI reproducibility + committed proof"** (no behavior change to cleaning, UI, deps, or phases):

- **Acceptance criteria:** (a) owner sample (or equivalent) classified per §4.3 taxonomy with recorded C2PA status string + indicator list; (b) a committed real-manifest C2PA fixture + passing `detected`-path tests (unit + browser) and a committed OpenAI-positive + caption-negative fixture pair; (c) stale `02:82,108` rows corrected; (d) full suite re-green (`typecheck`, `lint`, 142+ new unit total, `build`, `audit --omit=dev`, 48+ E2E); (e) git initialized with clean baseline commit first.
- **Test scope estimate:** +2–4 unit test files/cases, +1–2 E2E cases (real Chrome `detected` + failure-path), fixture documentation updates only.
- **Explicit non-goals for that step:** no C2PA removal, no OpenAI heuristic broadening, no Firebase/rewrite/GeoTag/video work, no UI redesign, no dependency upgrades (Next.js OOB handled separately in Phase 9).

**Audit complete. Awaiting approval before any implementation.**
