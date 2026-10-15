# 02 — Support Matrix (living, test-backed) — Spec v1.1 (AVIF + HEIC required)

> Targets, not claims. A cell becomes `Supported` only after a fixture passes independent verification (re-read + fixture comparison). Initial state for all new-engine cells: `Target / Assess`. **AVIF and HEIC are required core formats (spec v1.1 §1 rule 12, §5): every operation below is outstanding work until proven — never drop the format, never silently convert to JPEG, never claim success without fixtures.**
>
> **Feasibility tests performed in Phase 0: NONE.** No dependencies installed, no fixtures run, no code executed — research only (library docs, release notes, CVE records). Section 2.4 therefore uses: **A = verified (none — zero cells) · B = library-supported but untested · C = requires custom implementation · D = blocker/unproven**. Nothing below is marked proven.

**Status vocabulary (UI + reports):** `Detected` · `Not detected` · `Not inspected` · `Unsupported` · `Uncertain` · `Verified removed` · `Verified updated` · `Retained intentionally` · `Failed` · `Partial`

## 2.1 Containers

| Media / container | Inspect | Clean | Custom rewrite | GeoTag | Plan |
|---|---|---|---|---|---|
| JPEG / JPG (baseline + progressive) | **Proven (Phase 2)** — EXIF/GPS/XMP/IPTC + JFIF technical, byte-verified | **Proven (Phase 3)** — segment walker (SOS-aware scan incl. progressive multi-SOS + DHT/DNL), EXIF/XMP(+extended)/IPTC/COM dropped, orientation-preserving minimal EXIF, ICC/APP0/APP14 kept, APP11→partial | **Proven (Phase 6)** — EXIF (Artist 315/Copyright/DocumentName/ImageDescription) + XMP (Seq/Bag/Alt) + IPTC APP13 merged/created, scan bytes identical, ExifTool + field re-observation verified | Target EXIF GPS | Main image release (Phases 2–3, 6–7) |
| PNG (static) | **Proven (Phase 2)** — EXIF(eXIf)/XMP(iTXt)/text chunks + header technical | **Proven (Phase 3)** — chunk walk with CRC gate, eXIf/tEXt/zTXt/iTXt dropped, iCCP/palette/alpha identical, APNG refused, bad-CRC failed | **Proven (Phase 6)** — eXIf TIFF + XMP iTXt merged/created (CRC recomputed, order preserved); IPTC has no PNG home → reported unsupported, never faked; IDAT identical | Explore (eXIf/XMP only if verified) | Main image release |
| WebP (lossy/lossless, non-animated) | **Proven (Phase 2)** — EXIF/XMP/GPS + VP8X technical | **Proven (Phase 3)** — RIFF walk with padding, EXIF/XMP dropped, VP8X EXIF+XMP bits cleared only, RIFF size recomputed, animation refused | **Proven (Phase 6)** — EXIF/XMP chunks merged/created, VP8X bits set (never cleared), canvas-synthesized VP8X when needed; VP8/VP8L identical | Explore (EXIF/XMP only if verified) | Main image release |
| Animated WebP | Assess | **Unsupported (Phase 3)** — ANIM/ANMF refused with message, never flattened | Only when tested | Only when tested | Advanced / conditional |
| AVIF (`.avif`; AV1 in ISOBMFF) | **Proven (Phase 2)** — EXIF/XMP/GPS(computed)/ICC-capable + brand check; IPTC only via embedded Exif | **Proven (Phase 3)** — item-aware rebuild (Exif/XMP items dropped, `iinf`/`iloc` regen, `iref` prune, `ipma`-aware, pitm alive), hand-built + real-encoder (libavif) fixtures, Pillow-decode pixel proof | **Proven (Phase 6)** — Exif + XMP mime items created/merged, `iinf`/`iloc`/`iref` (cdsc for new Exif) rebuilt, offsets recomputed, image items verbatim; IPTC reported unsupported; real-encoder AVIF verified | **Required** — Target EXIF-GPS write once proven | Core image format; per-operation readiness tracked below |
| HEIC (`.heic`; compatible HEIF `.heif`) | **Proven (Phase 2+3)** — EXIF/XMP/GPS (computed, incl. 0,0 edge, assumed-ref + unreadable-value handling) + brand check | **Proven for tested still layouts (Phase 3 completion)** — hand-built stills, trailing-uuid partial case, **and real libavif/ExifTool layout** (`iref` dual-cdsc, 5-prop `ipma`, non-zero base_offset, real HEVC payload); multi-image/depth/aux/grid/sequence layouts stay Unsupported; other untested layouts Partial | **Proven (Phase 6)** — same ISOBMFF writer, proven on the real libheif HEIC still (non-zero base_offset, dual-cdsc preserved); Apple-encoder layouts stay Unsupported/Partial | **Required** — Target EXIF-GPS write once proven | Core image format; validated independently from AVIF |
| MP4 | Target (mediainfo.js) | Target container-dependent (box edit, no transcode) | Only when tested | Only when tested | Video phase 1 (Phase 8) |
| MOV | Target later | Conditional | Conditional | Conditional | Video phase 2 |
| WebM | Target later | Conditional | Conditional | Conditional | Video phase 2 |
| Other video / image formats | Mark `Unsupported` until proven | No unsupported ops | — | — | Future evaluation |

**Rules:** preserve original format (never silent PNG/WebP/AVIF/HEIC→JPEG); preserve transparency/animation/alpha/HDR; orientation + ICC/color behavior explicit (see §07). Lack of native browser preview (HEIC on Chrome/Firefox) is never a reason to drop metadata support — use placeholder preview; metadata ops must not depend on `<img>` decode or Canvas.

## 2.2 Metadata groups

- **EXIF** (incl. GPS, orientation, dates, device) — JPEG primary; PNG/WebP conditional; AVIF/HEIC via ISOBMFF Exif item + `iloc` extents (required, verify).
- **XMP** (rights/creator/history/prompts) — string-preserving parse, namespace-aware; AVIF/HEIC via XMP item (required, verify).
- **IPTC** (creator/rights/keywords/contact) — JPEG APP13 focus. **AVIF/HEIC/WebP: no native IPTC block; values readable only when carried inside embedded Exif (`IPTC-NAA`) — verify per fixture, never synthesize.**
- **PNG text chunks** (`tEXt`/`zTXt`/`iTXt`, XMP, `eXIf`).
- **WebP RIFF chunks** (`EXIF`, `XMP `, ICC).
- **AVIF/HEIC (ISOBMFF):** validate `ftyp` brands (not extension), `meta`/`hdlr`/`pitm`/`iinf`/`infe`/`iloc`/`iprp`/`mdat`/`idat`, item references, auxiliary/thumbnail/grid/overlay items, UUID/JUMBF boxes. AVIF and HEIC share the container shape but are validated independently. Sequences (`msf1`/`heis`, `moov`/`udta`, no `meta`) are out of scope → refuse as `Unsupported`, never corrupt.
- **C2PA / JUMBF** — presence vs cryptographic validation distinguished (browser validator reports both; test-identity fixtures show `Valid` + untrusted-credential failure vs `Invalid` + mismatch after tampering/cleaning); **removal implemented per format below** — identified stores are dropped and proven absent (`not_detected` on re-inspection); unproven JUMBF/`uuid` still forces `partially_cleaned`.
- **Video container/track tags** (encoder, creation, title, location, `udta`/`meta`/`ilst`, rotation, tracks).
- **AI indicators** — heuristic strings only, never verdicts.

## 2.3 How a cell graduates

1. Synthetic fixture with known tag → inspect → expected value observed.
2. Clean/rewrite → re-inspect output → `Verified removed/updated` + payload-integrity check (image bytes equal / video playable, duration/tracks intact).
3. Independent cross-check (ExifReader re-read + ExifTool spot-check locally, never uploaded).
4. Row added to this file + `04-test-plan.md` evidence. Until then UI shows `Target`/`Assess`, never a green badge.

## 2.5 Bulk + ZIP support by file status (Phase 4)

Guest batch cleaning runs the same sniff→inspect→clean→verify pipeline per file (sequential, cancellable, stale-guarded); no count cap; 64 MB/file budget kept.

| File status | Cleaned in batch | In ZIP | Evidence |
|---|---|---|---|
| `verified_clean` | Yes | Yes (`images/`, true extension) | 50/100/1000-file runs, all entries re-inspected clean |
| `unchanged_no_target_tags` | Yes (no-op) | Yes | Empty/metadata-free fixtures included and byte-stable |
| `partially_cleaned` | Yes | Only when explicitly opted in (per-row or master toggle, off by default); status stays visible | JUMBF JPEG + uuid-HEIC E2E; never silently relabeled |
| `failed` / `not_verified` | Attempted, recorded with reason | Never | Corrupt/truncated/oversized/budget cases; retry offered without duplication |
| `unsupported` (sequences/APNG/animated/video/unknown brands) | Refused with reason | Never | Animated WebP, APNG, avis/msf1, MP4 rows stay out |
| `cancelled` | Stops scheduling; finished work kept | Only already-verified outputs, user-initiated | Cancel-freeze E2E (progress frozen, remainder finishable) |

ZIP shape: `metadata-cleaned-YYYY-MM-DD.zip` → `images/<stem>-clean.<true-ext>` (STORE, CRC-checked, deterministic dedupe, traversal-proof). **Phase 5 reports in ZIP:** `format=none` preserves the exact Phase 4 archive (no `reports/` path); `csv`/`pdf`/`both` add only `reports/metadata-report.csv`, `reports/metadata-tags.csv` (detailed only), `reports/metadata-report.pdf` — all generated from the same frozen snapshot as the media manifest, with identical standalone bytes. No `videos/` folder is fabricated — Phase 8 owns that. C2PA/video/rewrite coverage is NOT promoted by anything in this section.

## 2.6 Reporting support (Phase 5 — proven per format via shared engine; Phase 6 extends the same snapshot)

Guest standalone + ZIP-embedded CSV/PDF for JPEG/PNG/WebP/AVIF/HEIC results (and honest rows for failures/unsupported/videos/never-processed): summary CSV one-row-per-file, detailed tags ledger, PDF cover→methodology with disclosed compact mode past 120 files. Verified-removed counts derive only from verified `changes[]`; **Phase 6 populates Verified Rewritten Tag Count only from re-observed `rewritten/verified` changes** (`requestedOperation=rewrite`, mode in Cleaning Mode column, 36-column schema unchanged); C2PA per-file status recorded as actually inspected (`detected`/`not_detected`/`not_inspected`); summary redaction default with explicit opt-in. Evidence: `snapshot/csv/pdf/zip-reports.test.ts` + `rewrite-reports.test.ts` + `e2e/reports.spec.ts` + `e2e/rewrite.spec.ts` (Chrome + Firefox), ExifTool-clean sampled archives, 1000-file PDF at 125 ms.

## 2.4 AVIF / HEIC per-operation readiness (v1.1)

**Phase 2 outcome: INSPECT proven for both formats; Phase 3 completion added scoped removal proof** — fixture-backed tests
plus ExifTool 13.55 cross-reads (see `src/test-fixtures/README.md`,
`EXIFTOOL_BASELINE.txt`, `scripts/gen-fixtures.py`). Rewrite/GPS-write
remain custom-work targets (class C, unproven).

| # | Operation | Class | AVIF | HEIC | Evidence (Phase 2) |
|---|---|---|---|---|---|
| 1 | AVIF metadata inspection | **A — proven** | Proven | — | `avif-exif-xmp.avif`: brand `avif` + `meta` verified from bytes; Make TestCam, GPS 12.345678/98.765432/150 m, XMP creator — identical in ExifReader and ExifTool |
| 2 | AVIF metadata removal | **C** (custom build) | Target, outstanding | — | No ExifReader write API (read-only by design). Requires custom ISOBMFF `meta` rebuild. Unproven. |
| 3 | AVIF custom metadata rewriting | **C** | Target, outstanding | — | XMP/EXIF item insert + `iloc`/`iinf` rebuild. Unproven. |
| 4 | AVIF GPS writing | **C** | Target, outstanding | — | EXIF GPS item write + round-trip. Unproven. |
| 5 | HEIC metadata inspection | **A — proven** | — | Proven | `heic-exif-gps.heic` (0,0 edge) + `heic-real-encoder.heic` (libavif/ExifTool layout): brand `heic` verified; Make/GPS/XMP identical in both readers. Preview-independent by construction (ArrayBuffer path, E2E-proven in Chrome). |
| 6 | HEIC metadata removal | **A — proven for tested still layouts** | — | Proven (scoped) | Hand-built stills + trailing-uuid partial + **real libavif/ExifTool layout** (`iref` dual-cdsc, 5-prop `ipma`, non-zero base_offset): `verified_clean`, independently decodable, pixels identical. Other layouts stay Unsupported/Partial. |
| 7 | HEIC custom metadata rewriting | **C** | — | Target, outstanding | Same as AVIF op 3, HEIF-validated separately. Unproven. |
| 8 | HEIC GPS writing | **C** | — | Target, outstanding | Same as AVIF op 4. Pending files stay `Unsupported`. Unproven. |
| — | Brand detection (`ftyp`) | **A — proven** | Proven | Proven | `signatures.ts` + fixture bytes (`avif`/`heic` majors, `meta` presence); spoof rejected; `mif1`-only → `heif-generic` (never proven HEIC); `avis`/`msf1` → sequence-unsupported |
| — | C2PA presence (both) | **A — proven (P0)** | Proven (JPEG APP11) | Proven (PNG caBX preflight; AVIF/HEIC via shared gate) | Browser validator `@contentauth/c2pa-web` integrated; `signed-c2pa.jpg` → `detected` (8 tags, Valid + 1 untrusted-credential failure), `signed-c2pa.png` preflights via real `caBX`; dummy markers → `not_detected`, never absent-claimed. Removal proven per format below (C2PA-removal milestone). |
| — | Preview (both) | **B** | Native where browser decodes, else placeholder | Placeholder (Safari-only inline); optional lazy WASM display-decode | Display-only; preview gap never blocks file-level ops. |

**Class A notes (Phase 3 completion):** reader GPS group is computed by ExifReader for JPEG/WebP
but our engine derives AVIF/HEIC GPS itself from raw EXIF GPS tags
(sign-aware, range-checked, assumed-ref + unreadable-value handling) — covered by the 0,0 edge,
real-encoder assumed-ref, and truncated-unreadable tests. AVIF *removal*
proven (hand-built + real-encoder evidence); HEIC *removal* proven for tested
still layouts incl. one real-encoder layout (broader layouts stay
Unsupported/Partial — no global HEIC claim). Fixture quirk:
hand-built ISOBMFF carries a dummy 8-byte primary item (box-level
fixtures, not decodability proofs); Exif item layout uses the spec's 4-byte
TIFF-header-offset prefix, without which ExifReader yields zero tags.
**Class D (blockers/unproven):** image sequences (`msf1`/`heis`, `moov`-based) — refuse, never corrupt; grid/overlay/aux edge cases; `colr`/HDR preservation proof; C2PA stores nested inside `meta` (non-top-level `uuid`) and unknown-purpose C2PA boxes (retained + partial by design); HEVC-patent boundary for any bundled decoder; `iloc`-near-EOF memory budgets; iPhone-original HEIC wanted as an extra fixture.

| # | Operation | Class | AVIF | HEIC | Evidence (Phase 3 completion) |
|---|---|---|---|---|---|
| 1 | AVIF metadata inspection | **A — proven** | Proven | — | `avif-exif-xmp.avif`: brand + `meta` byte-verified; Make/GPS/XMP identical in ExifReader and ExifTool |
| 2 | AVIF metadata removal | **A — proven** | Proven | — | `cleanIsobmff`: Exif+XMP items dropped, `iinf`/`iloc` regen, `iref` cdsc prune, `ipma`-aware (incl. libavif plain-`iprp` layout), pitm alive, payloads byte-equal; hand-built + real-encoder fixtures; Pillow-decode pixel-identical; ExifTool after-dump clean |
| 3 | AVIF custom metadata rewriting | **C** | Target, outstanding | — | XMP/EXIF item insert + `iloc`/`iinf` rebuild. Unproven. |
| 4 | AVIF GPS writing | **C** | Target, outstanding | — | EXIF GPS item write + round-trip. Unproven. |
| 5 | HEIC metadata inspection | **A — proven** | — | Proven | `heic-exif-gps.heic` (0,0 edge) + `heic-real-encoder.heic` (libheif/ExifTool layout, assumed-ref warning path); identical in both readers; preview-independent |
| 6 | HEIC metadata removal | **A — proven for tested still layouts** | — | Proven (scoped) | Hand-built stills + trailing-uuid partial case + **real libavif/ExifTool layout** (`iref` dual-cdsc, 5-prop `ipma`, non-zero base_offset): `verified_clean`, heif-convert-decodable, pixels identical, ExifTool after-dump clean. Untested layouts (multi-image/depth/aux/grid/sequences) stay Unsupported/Partial — no global HEIC claim |
| 7 | HEIC custom metadata rewriting | **C** | — | Target, outstanding | Same as AVIF op 3, HEIF-validated separately. Unproven. |
| 8 | HEIC GPS writing | **C** | — | Target, outstanding | Same as AVIF op 4. Pending files stay `Unsupported`. Unproven. |
| — | Brand detection (`ftyp`) | **A — proven** | Proven | Proven | `signatures.ts` + fixture bytes (`avif`/`heic` majors, `meta` presence); spoof rejected; `mif1`-only → `heif-generic` (never proven HEIC); `avis`/`msf1` → sequence-unsupported |
| — | C2PA presence (both) | **A — proven (P0)** | Proven (JPEG APP11) | Proven (PNG caBX preflight; AVIF/HEIC via shared gate) | Browser validator `@contentauth/c2pa-web` integrated; `signed-c2pa.jpg` → `detected` (8 tags, Valid + 1 untrusted-credential failure), `signed-c2pa.png` preflights via real `caBX`; dummy markers → `not_detected`, never absent-claimed. Removal proven per format below (C2PA-removal milestone). |
| — | Preview (both) | Proven pattern | Native where browser decodes, else placeholder | Placeholder (Safari-only inline); E2E-proven in Chrome | Display-only; preview gap never blocks file-level ops (E2E HEIC journey green) |

**Class A (verified):** JPEG/PNG/WebP/AVIF inspect+clean; HEIC inspect + still-layout cleaning incl. one real-encoder layout. GeoTag_Final contains no AVIF/HEIC path (accept list JPEG/PNG/WebP only; `piexif` JPEG-only; Canvas path converts toward JPEG — explicitly disqualified by v1.1 §6.2).
**Class D (blockers/unproven):** image sequences (`msf1`/`heis`, `moov`-based) — refuse, never corrupt; grid/overlay/aux/thumbnail/multi-image edge cases; C2PA stores nested inside `meta` and unknown-purpose C2PA boxes (retained + partial by design); HEVC-patent boundary for any bundled decoder; `iloc`-near-EOF memory budgets; iPhone-original (Apple-encoder) HEIC still wanted as an extra layout data point.

## 2.7 C2PA removal (milestone 14 Oct 2026 — proven per format)

**Embedding models used** (C2PA Technical Specification v2.4, Appendix A.3 for
JPEG APP11 / PNG `caBX` / WebP `C2PA`, Appendix A.5 for BMFF top-level `uuid`;
cross-checked against c2pa-rs `sdk/src/asset_handlers/{jpeg_io,png_io,riff_io,bmff_io}.rs`
grouping/deletion semantics plus byte dumps of official-tool outputs):

- **JPEG:** APP11 `CI="JP"`, EN box-instance, Z packet sequence; group start
  has `c2pa` at payload[24..28]; continuations share EN with strictly
  increasing Z and repeat the store LBOX+TBOX. Engine: `locateJpegC2pa`
  (`src/lib/metadata/clean/c2pa-locate.ts`), drop whole groups in `cleanJpeg`.
- **PNG:** single-chunk JUMBF store in `caBX` (LBOX==length, TBOX `jumb`,
  store UUID at +16). Engine: `locatePngC2pa`, drop in `cleanPng`. Unproven
  `caBX` is always retained, even aggressive.
- **WebP:** RIFF `C2PA` chunk with the same JUMBF proof; no VP8X flag invented.
  Engine: `locateWebpC2pa`, drop in `cleanWebp` with RIFF size recompute.
- **AVIF/HEIC:** top-level `uuid` with extended type
  `d8fec3d6-1b0e-483c-9297-5828877ec481` (≠ inner store UUID), known purpose
  (`manifest`/`merkle`/`original`/`update`), store UUID within content.
  Engine: `locateIsobmffC2pa`, elide in `cleanIsobmff` with full
  meta/`iloc`/`mdat` offset recompute. Generic `uuid` never counts as C2PA.

**Scope:** removal runs under `descriptive` or `ai_markers`-with-C2PA-evidence
(`resolvesC2paRemovalTarget`); EXIF+GPS-only selections retain identified
stores with an explicit scope reason. Verification: `C2PA` is a target group,
so absence-after must be proven (`not_detected` via real re-inspection);
`detected`/`not_inspected` after cleaning fails closed with output withheld.

| Format | Removal | Proof |
|---|---|---|
| JPEG | **Proven** | `signed-c2pa.jpg` (1 seg), `jpeg-c2pa-multi.jpg` (3 segs EN 0211), foreign-APP11 retained, truncated-store cleared, dummy/COM-text untouched; scan bytes identical; c2patool “No claim found” + ExifTool JUMBF-free on all outputs |
| PNG | **Proven** | `signed-c2pa.png` caBX dropped, IDAT identical; forged caBX retained (both policies); stray IDAT bytes untouched |
| WebP | **Proven** | `webp-c2pa-signed.webp` chunk dropped, VP8 identical, RIFF re-validated; forged chunk retained |
| AVIF | **Proven** | `avif-c2pa-signed.avif` uuid dropped, item payloads identical, structure re-validated, Pillow-decodes; generic uuid retained |
| HEIC | **Proven** | `heic-c2pa-signed.heic` (real HEVC, heif-enc) uuid dropped, decode identical pre/post clean; generic uuid retained |

## 2.8 Custom rewrite (Phase 6 — proven per format, field-level)

Replace mode runs the proven Phase 3 cleaner first (in-scope C2PA removed), then writes; update mode edits only chosen fields and preserves + re-validates C2PA (invalidation risk disclosed, never claimed valid). Every success passes re-sniff, structural re-validation, payload equality, output re-inspection, and per-field re-observation (`observeFieldValues`); IPTC outside JPEG is disclosed unsupported, never faked. No forged provenance/C2PA, no AI-invisibility claims. Auth/profile via Firebase (lazy, guest-safe); media never leaves the browser.

| Field | JPEG | PNG | WebP | AVIF | HEIC | Evidence |
|---|---|---|---|---|---|---|
| Creator | EXIF Artist 315 + XMP dc:creator + IPTC 2:80 | EXIF + XMP (IPTC unsupported) | EXIF + XMP (IPTC unsupported) | Exif item + XMP item (IPTC unsupported) | Exif item + XMP item (IPTC unsupported) | `rewrite.test.ts` (all 5 incl. real-encoder AVIF/HEIC) + ExifTool Artist/dc:creator/By-line on rewritten outputs; pixels identical (Pillow + heif-convert) |
| Company / Publisher | XMP dc:publisher + IPTC 2:110 | XMP only | XMP only | XMP only | XMP only | Same suite (field plans + verify); never EXIF Artist/Copyright |
| Copyright | EXIF 33432 + XMP dc:rights + IPTC 2:116 | EXIF + XMP | EXIF + XMP | Exif + XMP | Exif + XMP | Same suite |
| Rights Owner | XMP xmpRights:Owner | XMP only | XMP only | XMP only | XMP only | Same suite (no EXIF/IPTC home — documented) |
| Website | XMP CreatorContactInfo/CiUrlWork | XMP only | XMP only | XMP only | XMP only | Same suite; URL scheme validated |
| Contact | XMP dc:contributor + IPTC 2:118 (JPEG) | XMP only | XMP only | XMP only | XMP only | Same suite |
| Title | EXIF 269 + XMP dc:title + IPTC 2:5 (JPEG) | EXIF + XMP | EXIF + XMP | Exif + XMP | Exif + XMP | Same suite + Bengali/Unicode JPEG case |
| Description | EXIF 270 + XMP dc:description + IPTC 2:120 (JPEG) | EXIF + XMP | EXIF + XMP | Exif + XMP | Exif + XMP | Same suite |
| Keywords | XMP dc:subject Bag + IPTC 2:25 set (JPEG) | XMP Bag (distinct tags) | XMP Bag | XMP Bag | XMP Bag | Same suite incl. dedupe + multi-keyword round-trip |
| Location Name | XMP Location + IPTC 2:92 (JPEG) | XMP only | XMP only | XMP only | XMP only | Same suite; GPS coordinates remain Phase 7 |

Bug fixed in Phase 6: creator was briefly mapped to EXIF 271 (Make — camera data) and corrected to Artist 315 before release; ExifTool re-verified (`EXIF Artist` present, `Make` untouched). Gate follow-up (15 Oct 2026): `npm audit --omit=dev` is 0 vulns after the `@grpc/grpc-js@1.13.7` override; emulator rules 6/6 pass; live OAuth still owner-blocked.

## 2.9 Accounts & admin (Phase 6A — rules-proven, live OAuth owner-blocked)

No media operation changes: guest inspect/clean/ZIP/CSV/PDF stay unlimited with no login. Google sign-in gates only saved-profile apply and the owner dashboard. Superadmin rides the Auth custom claim (never email strings or client flags); the Firestore directory (`users/{uid}`) is explicitly not the Auth user list. Suspension gates signed-in cloud features only — Google login and anonymous cleaning are unaffected by design. Usage-policy values are recorded but NOT enforced (no caps active, no per-file metering). Evidence: `admin.test.ts` (8 unit) + extended `rules.test.ts` directory/admin suites (9 emulator tests incl. self-restore and escalation denial) + `e2e/admin.spec.ts` (3 journeys: hero CTA, queue preservation, `/admin` denial). Live claim promotion + two-account production isolation await owner configuration (`docs/10-admin-setup.md`).
