# 04 — Test Plan (fixture-gated, Spec v1.1: AVIF + HEIC required)

**Principle:** No green badge without a fixture that actually contains the tag + independent re-read. UI/report counters derive from the typed result model — never a second guess. AVIF and HEIC ops graduate only on real fixtures; extension recognition ≠ support; JPEG conversion ≠ clean.

## Image clean — Phase 3 evidence (all with real fixture bytes + ExifTool before/after + Pillow pixel-compare)

- JPEG: EXIF/XMP(+extended)/IPTC/COM dropped with field-level verified evidence; rotated Orientation kept via minimal technical EXIF (single-tag EXIF after); progressive multi-SOS + interleaved DHT/DNL handled; ICC APP2 bytes preserved; APP11 JUMBF → `partially_cleaned` with retained note; empty → `unchanged_no_target_tags`; truncated → `failed` with no output; unknown APPn retained by default / dropped under aggressive (both tested).
- PNG: eXIf/tEXt/zTXt/iTXt dropped; IHDR/PLTE/IDAT/IEND/iCCP/sRGB identical (IDAT fingerprint equal, CRCs re-validated); bad-CRC → `failed`; APNG → `unsupported`; unknown ancillary retained by default / dropped under aggressive.
- WebP: EXIF/XMP chunks dropped with only their VP8X bits cleared (Alpha/Animation/ICC bits intact); RIFF size recomputed and re-validated; lossless+alpha payload equal; animation → `unsupported`.
- AVIF: hand-built + real-encoder (libavif `iref`/`iprp`/`colr`, plain-`iprp` layout discovered and handled) stills → `verified_clean`; Exif/XMP items dropped; image payloads byte-equal; Pillow decodes output pixel-identical (922→345 bytes); brands intact.
- HEIC: hand-built stills → `verified_clean` (incl. 0,0 GPS); trailing-uuid → `partially_cleaned` with retained note. **Missing:** real-encoder/iPhone layout proof → cell Partial.
- Cross-cutting: re-clean → `unchanged_no_target_tags`; spoof cleaned by bytes-kind; empty/random/oversized/budget → `failed` without writer invocation; dangerous output names sanitized; Blob bytes equal verified output; run-guard unit-tested; source bytes hash-identical after runs.

## Image inspect — Phase 2 evidence (unchanged, still valid)

- JPEG: `jpeg-exif.jpg` (Make/Model/DateTimeOriginal/Orientation exact), `jpeg-gps-sw.jpg` (S/W refs, Rotate 90 CW, −5 m altitude), `jpeg-xmp-iptc.jpg` (XMP creator/rights/description + IPTC ObjectName/Keywords/By-line/Copyright/Caption exact), `jpeg-empty.jpg` (all inspected groups `not_detected`, zero indicators).
- AI indicators: `jpeg-ai.jpg` (DigitalSourceType + CreatorTool + AIPrompt → ≥2 explicit findings with evidence); `jpeg-caption-ai.jpg` (caption “Portrait of Ai …” → zero findings — negative control green); **`jpeg-openai.jpg` (P0, synthetic tag: XMP CreatorTool `OpenAI GPT-Image` → exactly 1 explicit indicator, chip `OpenAI 1`)**; **`jpeg-caption-openai.jpg` (P0: caption mentions OpenAI, ordinary CreatorTool → zero findings, chip `AI 0`)**.
- PNG: `png-text-exif.png` (Title/Author/Description/Software/Comment/zTXt/iTXt-XMP/eXIf-Orientation exact; header group technical); invalid XMP packets tolerated (group absent, parse continues).
- WebP: `webp-exif-xmp.webp` (EXIF Make/GPS, XMP creator, VP8X technical) vs `webp-empty.webp` (honest absence).
- AVIF: `avif-exif-xmp.avif` (brand `avif` + `meta` byte-verified; Make/GPS 12.345678,98.765432/XMP creator identical in both readers). Fixture lesson recorded: HEIF Exif items require the 4-byte TIFF-header-offset prefix or ExifReader yields zero tags.
- HEIC: `heic-exif-gps.heic` (brand `heic`; Make TestPhone; GPS **0,0 kept as detected data**; XMP creator). Preview-independent (ArrayBuffer path, no decode).
- Robustness: `spoof-jpg-with-png-bytes.jpg` (bytes win + warning), `jpeg-truncated.jpg` (partial + warning, no throw), `avif-truncated-box.avif` + `png-huge-length.png` (warnings, bounded walk), `random-bytes.bin`/`empty-file.bin` (failed, no throw), 64 MB/file budget enforced, C2PA states proven by P0 fixtures below (`not_detected` on ordinary/dummy, `detected` on signed — never absent-claimed, never fake-detected).
- Test counts: `signatures.test.ts` (14) + `inspect.test.ts` (13) + Phase 1 suites (24) = 51 green; zero mocks of the reader.

## Image clean (Phase 3+, unchanged)
- JPEG baseline + progressive; EXIF orientation 1 vs rotated; GPS/software/author/EXIF/IPTC/XMP/C2PA fixtures when available.
- **P0 C2PA/OpenAI proof (executed, genuine manifests):** `signed-c2pa.jpg` (c2patool-signed JUMBF APP11, test identity) → browser `detected`, 8 tags, `Valid` + 1 untrusted-credential failure, 2 AI source-type indicators; `signed-c2pa.png` (real `caBX` chunk) → same gate; `jpeg-c2pa-tampered.jpg` (1 flipped scan-data bit) → `detected` + failures incl. `claimSignature.mismatch`, `Invalid`; `jpeg-jumbf.jpg` dummy + ordinary files → `not_detected` (preflight miss); cleaning a signed file retains APP11 → `partially_cleaned`, output re-inspects `Invalid` + 3 failures with UUID bytes intact. See `docs/09-c2pa-openai-proof-report.md` + `src/test-fixtures/README.md` for SHAs/commands.
- PNG ±transparency; `tEXt`/`zTXt`/`iTXt`/`eXIf`/XMP; CRC validity after edit.
- WebP lossy/lossless + EXIF/XMP; animated WebP must refuse or preserve frames.
- **AVIF (required):** still AVIF with/without EXIF, XMP, ICC, AI-associated XMP, C2PA/UUID-JUMBF where available; alpha, HDR/`colr`, thumbnails/aux, grid/overlay refs; animated `avis` sequences handled explicitly (refuse or preserve, never corrupt); `ftyp`-brand checks (`avif`/`avis`/`mif1`); malformed/truncated ISOBMFF (incl. CVE-2026-53496/85715 regression shapes: empty `free` boxes, truncated largesize, zero-width `iloc` fields, huge item/extent counts) → `Failed` with message, queue/worker survives.
- **HEIC (required, independent from AVIF):** real iPhone HEIC with EXIF/GPS + without; XMP/C2PA where available; orientation, multi-image, depth/aux, `colr`; brands `heic`/`heix`/`hevc`/`mif1` + `.heif` alias; sequences (`msf1`/`heis`, `moov`-based) → `Unsupported` refuse; same malformed-box suite as AVIF.
- **AVIF/HEIC cross-browser:** run inspect/clean/write suites in a browser that cannot preview HEIC (Chrome/Firefox) — ops must pass with placeholder preview; Canvas decode must never be in the clean/write path.
- **Lossless proof (all 5 formats):** compressed image bytes relocated verbatim (decode-compare: ImageMagick/exiftool/third-party decode identical); format/alpha/HDR preserved; re-inspect confirms `Verified removed`; leftovers listed.
- No-metadata file → `Not detected`, output still valid.
- Corrupt/truncated/extension-mismatch/malformed-chunk (memory-bomb lengths, bad UTF) → `Failed` with message, queue survives.

## GeoTag
- N/S/E/W, zero, poles/dateline, precision/rounding, invalid chars, out-of-range.
- EXIF GPS round-trip read-back; no cross-file leakage (regression for `01` stale-state bug).
- PNG/WebP write only after verified support; else `Unsupported` + disabled UI.
- **AVIF/HEIC GPS (required targets):** EXIF-GPS item write + re-read precision check per format; pending files stay `Unsupported` with disabled apply — never omitted silently, never faked.

## Bulk / ZIP / reports
- 1/20/50/100/500/1000+ small images with memory profiling; cancel/retry; duplicate/Unicode/long names; mixed success/failure.
- ZIP extracts, counts match, `images/ videos/ reports/` layout, no `../`, deterministic names, mapping table in reports.
- CSV opens in sheets; formula-injection (`=+-@`) neutralized; raw values preserved internally.
- PDF readable, cover + overview + per-file (compact mode for 1000+), legend + methodology + privacy notice; generation doesn't freeze UI.

## Bulk / ZIP — Phase 4 evidence (all executed, none simulated)
- Unit scales (genuine files, full clean+verify except 500/1000 with cached inspection): 1/20/50/100/500/1000 all `verified_clean`; fastest 1000-run 57 ms node (tiny fixtures — browser numbers below are the honest reference).
- Scheduler: order + progress honesty, concurrency bound (peak ≤2 even under delay, clamped from 99), pre/during-cancel, ineligible-skip, throwing-processor survival, stale-commit refusal.
- Mixed-outcome batch (rich/free/corrupt/spoof/animated/video/partial): per-file truth preserved, batch completes, retry keeps proven outputs without duplication.
- ZIP: byte-identity round-trips, STORE no-shrink check, empty-input refusal, mid-build cancel, ordered FS-sink writes, sink-failure surfacing; naming (collisions case-insensitive, unicode/emoji/traversal/long) deterministic; budget guard via small-maxBytes test.
- Browser E2E vs production `out/` (Chrome 155 desktop + Pixel 7, Firefox 157 journeys): 50 mixed → ZIP → system-unzip → all 50 entries re-inspected clean (ExifTool-clean on sampled archive); partial opt-in off/on; failures excluded + retry; duplicates collapse; repeated ZIP byte-stable; cancel-freeze + finish-remainder; 100 mixed @0.9 s (heap 8.7→20.6 MB); 1000 mixed @50 s (heap 21→121 MB); keyboard/mobile overflow; request log (GET-local + blob: only).

## Reports — Phase 5 evidence (all executed, none simulated; Phase 6 extends the same snapshot)

- Snapshot mapping: every status incl. cancelled/not-processed/video/never-run, GPS 0,0 + assumed-ref callouts, C2PA per-file status as actually inspected, **Phase 6 populates rewrites from re-observed `rewritten/verified` changes (`requestedOperation=rewrite`)**, byte/exclusion totals honest.
- CSV: exact 36-column schema, one-row-per-file incl. failures; adversarial formula set neutralized (numeric GPS stays numeric; **Phase 6 profile company/author/keywords guarded**); Unicode/emoji preserved; RFC-4180 round-trip parsed; redaction default vs opt-in proven on real GPS digits; tags ledger with group coverage rows + dedupe; cancellation mid-build tested.
- PDF: pdf-lib parse-back (pages, title, no user data in properties); cover/overview/per-file/appendix/methodology/privacy/footer; compact auto past 120 files (disclosed); Unicode sanitize-with-count; failures-only report claims nothing; cancel tested; node 1000-file PDF 125 ms / 330 KB / 35 pages. **Phase 6: per-file line shows Verified Rewritten counts; appendix includes `rewritten` actions; Bengali/Unicode exact values remain in UTF-8 CSV with the WinAnsi limitation disclosed.**
- ZIP reconciliation: None preserves Phase 4 bytes; embedded reports byte-equal standalone from the same snapshot; media bytes identical across choices; traversal-safe CRC-valid archives; excluded files reported but not archived. **Phase 6: rewritten outputs archive as `images/<stem>-rewritten.<ext>` and take manifest precedence when present.**
- Browser E2E (Chrome + Firefox journeys/reports): standalone CSV parse + redaction + opt-in exposure + ledger + PDF open + ZIP Both structure match + failures-only CSV with disabled ZIP + 200-file compact PDF at 110 ms; request log extended over report downloads (GET-local + blob: only); no localStorage/IndexedDB writes (code-level: no storage APIs in src).

## Phase 6 evidence (all executed, none simulated)

- Unit: `codecs.test.ts` (TIFF merge/preserve/overwrite, XMP Seq/Bag/Alt + merge without duplication, IPTC round-trip + foreign-IRB preservation) + `rewrite.test.ts` (16 tests: JPEG replace/update/Unicode, PNG create/merge + IPTC-unsupported disclosure, WebP still + animated refusal honesty, real-encoder AVIF/HEIC stills, C2PA replace-structural-removal + update-preservation with locator proof, video refusal, malformed-writer withholding) + `firebase.test.ts` (config gating, sign-in state machine with injected backend, profile validation/sanitization) + `rewrite-reports.test.ts` (rewrite precedence, clean fallback, filename + profile formula guards). Full suite: 225 unit pass / 6 skipped (emulator-gated rules tests skip without `FIRESTORE_EMULATOR_HOST`).
- Independent fixture evidence: all five formats rewritten from real fixtures and cross-read with ExifTool 13.55 (EXIF Artist 315/DocumentName/ImageDescription/Copyright + XMP dc:* + IPTC By-line/ObjectName/Keywords for JPEG verified); Pillow decode pixel-identical for JPEG/PNG/WebP/AVIF; heif-convert decode for rewritten HEIC. Creator→Artist 315 mapping corrected pre-release (was 271/Make) with re-proof.
- Browser E2E: `e2e/rewrite.spec.ts` (3 tests: guest gates without login wall, mode/field keyboard + queue preservation, 36-column CSV with rewrite counts) + full regression (45 desktop + 22 Firefox/mobile = 67 green vs production `out/`).
- Rules: `rules.test.ts` covers unauthenticated deny, owner create/read/update/delete, cross-user deny both directions, unknown-path/privilege-field deny, oversize/wrong-type deny, and re-login round-trip — executed against the real Firestore emulator via `npm run test:rules`. **NOT RUN here: local `firebase-tools` requires Java 21+ (environment has older Java), so the emulator could not start; the suite skips explicitly under plain `npm test` instead of faking a pass. Run `npm run test:rules` with Java 21+ and deploy `firestore.rules` separately before enabling sign-in in production.**
- Live Google OAuth: NOT VERIFIED (no real Firebase project/authorized domain supplied). Emulator-independent auth state machine is unit-tested with an injected backend; the app shows honest not-configured/unavailable states and a manual checklist lives in `docs/06`. Do not declare live login proven until that checklist passes on the Hostinger domain.
- Rules emulator: PASS (Gate follow-up, 15 Oct 2026) — Java Temurin 25.0.1+8 (`JAVA_HOME` set for the test invocation only; default env Java remains 17), Firebase CLI 15.3.1, project `phase6-rules-test`, `rules.test.ts` 6/6 pass, emulator exit code 0, tested file = published file (`firestore.rules`, SHA-256 `0bf8e7f0…f212601b` at test time; `firebase.json` points at the same path). Re-ran green after the `@grpc/grpc-js@1.13.7` override (Firestore Node-path compatibility proof).
- Security override: `@grpc/grpc-js` 1.9.16 → 1.13.7 via `overrides` (firebase 13.0.0 / firestore 4.18.0 unchanged); `npm audit --omit=dev` 0 vulns after (was 4 high); full gates re-run green (see `00` gate entry). Remaining full-`npm audit` findings are dev-only eslint-config-next/micromatch chain, not shipped.

## Firebase / UI / static
- Guest clean/bulk/video/reports never trigger login; Write/Apply/GeoTag prompts modal; cancel preserves queue.
- Firestore owner-only rules (emulator-tested); sign-out clears profile; Firebase outage doesn't break guest flows.
- `next build` static `out/` smoke on Chrome/Firefox/Safari; no `next/image` default optimizer, no server actions/routes.

## Video
- MP4 empty / typical QT tags / GPS / rotation / audio+subs; output playable, duration/tracks intact, no transcode.
- Corrupt/unsupported codec → clear `Unsupported`/`Failed`.
- Oversize/WASM OOM → helpful no-output error, never fake success; no 2GB+/1000-video guarantee.
- MOV/WebM listed only after equivalent validation.

## Tooling
- Vitest: 225 tests / 22 files (+6 emulator-gated rules tests skipped without `FIRESTORE_EMULATOR_HOST`) + Playwright E2E: 67 tests green (45 desktop + 22 Firefox/mobile, incl. 3 new `rewrite.spec.ts` guest-safety journeys) vs production `out/` — prior journeys/robustness/queue/scale/a11y/upload/c2pa-openai coverage plus rewrite regression.
- Fixtures: 31 committed files (30 generated + `heic-real-encoder.heic`: libheif 1.23.6 HEVC still, 64×48, SHA-256 `1ce3a75b…f1fcc2b55`, ExifTool-written EXIF/GPS/XMP; self-generated gradient pixels, nonsensitive) + `EXIFTOOL_BASELINE.txt` + `EXIFTOOL_AFTER_CLEAN.txt`. No personal GPS/serials; hand-built ISOBMFF primary item is dummy bytes (inspection-valid only); Nokia-conformance files never committed. ExifTool 13.55 + heif-convert + Pillow locally for cross-checks (never uploaded, never bundled).

## Phase 6A evidence (auth entry + admin foundation, 15 Oct 2026)

- Unit: `admin.test.ts` (8 tests: claim derivation rejects non-`true`/role-string flags, directory create/update/status/policy validators, self-suspend guard, identity slicing) — all pass without emulator.
- Rules emulator: extended directory/admin suites 9/9 pass on the same invocation (total `rules.test.ts` 15/15, exit 0) — unauth denial on directory + settings paths; owner self-registration boundaries (active-only, no role fields, oversize denied); no-list + no-cross-read for ordinary users; identity-only owner updates; superadmin list/suspend/restore; stale-claim (claim-less) denial on admin paths; suspension gating of profile read/write without affecting others; self-restore denial; escalation/malformed denial; usage-policy superadmin gating + strict validation; legacy no-directory accounts keep working. The emulator caught two real pre-release defects: a 3-segment settings path (invalid doc ref → `adminSettings/usagePolicy`) and a self-restore hole (suspended owners could write back `active` — closed with a current-status check in rules).
- Browser E2E: `e2e/admin.spec.ts` (3 tests: hero Google CTA visible with no admin-link leak, queue preserved under auth gates, `/admin(.html)` denied without claim and without user list) — green on desktop vs production `out/`. Full-suite regression pending final gate run.
- Live OAuth + claim promotion + two-account production isolation: NOT executed (no owner Firebase config; never faked). Manual checklist in `docs/10-admin-setup.md` §7.
