# 02 — Support Matrix (living, test-backed) — Spec v1.1 (AVIF + HEIC required)

> Targets, not claims. A cell becomes `Supported` only after a fixture passes independent verification (re-read + fixture comparison). Initial state for all new-engine cells: `Target / Assess`. **AVIF and HEIC are required core formats (spec v1.1 §1 rule 12, §5): every operation below is outstanding work until proven — never drop the format, never silently convert to JPEG, never claim success without fixtures.**
>
> **Feasibility tests performed in Phase 0: NONE.** No dependencies installed, no fixtures run, no code executed — research only (library docs, release notes, CVE records). Section 2.4 therefore uses: **A = verified (none — zero cells) · B = library-supported but untested · C = requires custom implementation · D = blocker/unproven**. Nothing below is marked proven.

**Status vocabulary (UI + reports):** `Detected` · `Not detected` · `Not inspected` · `Unsupported` · `Uncertain` · `Verified removed` · `Verified updated` · `Retained intentionally` · `Failed` · `Partial`

## 2.1 Containers

| Media / container | Inspect | Clean | Custom rewrite | GeoTag | Plan |
|---|---|---|---|---|---|
| JPEG / JPG (baseline + progressive) | **Proven (Phase 2)** — EXIF/GPS/XMP/IPTC + JFIF technical, byte-verified | **Proven (Phase 3)** — segment walker (SOS-aware scan incl. progressive multi-SOS + DHT/DNL), EXIF/XMP(+extended)/IPTC/COM dropped, orientation-preserving minimal EXIF, ICC/APP0/APP14 kept, APP11→partial | Target, field-dependent | Target EXIF GPS | Main image release (Phases 2–3, 6–7) |
| PNG (static) | **Proven (Phase 2)** — EXIF(eXIf)/XMP(iTXt)/text chunks + header technical | **Proven (Phase 3)** — chunk walk with CRC gate, eXIf/tEXt/zTXt/iTXt dropped, iCCP/palette/alpha identical, APNG refused, bad-CRC failed | Target, field-dependent | Explore (eXIf/XMP only if verified) | Main image release |
| WebP (lossy/lossless, non-animated) | **Proven (Phase 2)** — EXIF/XMP/GPS + VP8X technical | **Proven (Phase 3)** — RIFF walk with padding, EXIF/XMP dropped, VP8X EXIF+XMP bits cleared only, RIFF size recomputed, animation refused | Target, field-dependent | Explore (EXIF/XMP only if verified) | Main image release |
| Animated WebP | Assess | **Unsupported (Phase 3)** — ANIM/ANMF refused with message, never flattened | Only when tested | Only when tested | Advanced / conditional |
| AVIF (`.avif`; AV1 in ISOBMFF) | **Proven (Phase 2)** — EXIF/XMP/GPS(computed)/ICC-capable + brand check; IPTC only via embedded Exif | **Proven (Phase 3)** — item-aware rebuild (Exif/XMP items dropped, `iinf`/`iloc` regen, `iref` prune, `ipma`-aware, pitm alive), hand-built + real-encoder (libavif) fixtures, Pillow-decode pixel proof | **Required** — Target XMP + EXIF fields incl. GPS where standards-compliant, verify | **Required** — Target EXIF-GPS write once proven | Core image format; per-operation readiness tracked below |
| HEIC (`.heic`; compatible HEIF `.heif`) | **Proven (Phase 2+3)** — EXIF/XMP/GPS (computed, incl. 0,0 edge, assumed-ref + unreadable-value handling) + brand check | **Proven for tested still layouts (Phase 3 completion)** — hand-built stills, trailing-uuid partial case, **and real libavif/ExifTool layout** (`iref` dual-cdsc, 5-prop `ipma`, non-zero base_offset, real HEVC payload); multi-image/depth/aux/grid/sequence layouts stay Unsupported; other untested layouts Partial | **Required** — Target XMP + EXIF fields incl. GPS where standards-compliant, verify | **Required** — Target EXIF-GPS write once proven | Core image format; validated independently from AVIF |
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
- **C2PA / JUMBF** — presence vs cryptographic validation distinguished; removal only if JUMBF-strip proven per-format.
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

## 2.6 Reporting support (Phase 5 — proven per format via shared engine)

Guest standalone + ZIP-embedded CSV/PDF for JPEG/PNG/WebP/AVIF/HEIC results (and honest rows for failures/unsupported/videos/never-processed): summary CSV one-row-per-file, detailed tags ledger, PDF cover→methodology with disclosed compact mode past 120 files. Verified-removed counts derive only from verified `changes[]`; rewrites always 0/n-a; C2PA `not_inspected`; summary redaction default with explicit opt-in. Evidence: `snapshot/csv/pdf/zip-reports.test.ts` + `e2e/reports.spec.ts` (Chrome + Firefox), ExifTool-clean sampled archives, 1000-file PDF at 125 ms.

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
| — | C2PA presence (both) | **D** | not_inspected | not_inspected | No parser integrated (blocker documented in §03/§07). Never reported absent. |
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
**Class D (blockers/unproven):** image sequences (`msf1`/`heis`, `moov`-based) — refuse, never corrupt; grid/overlay/aux edge cases; `colr`/HDR preservation proof; C2PA/JUMBF removal in ISOBMFF; HEVC-patent boundary for any bundled decoder; `iloc`-near-EOF memory budgets; iPhone-original HEIC wanted as an extra fixture.

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
| — | C2PA presence (both) | **D** | not_inspected | not_inspected | No parser integrated (blocker documented in §03/§07). Never reported absent. |
| — | Preview (both) | Proven pattern | Native where browser decodes, else placeholder | Placeholder (Safari-only inline); E2E-proven in Chrome | Display-only; preview gap never blocks file-level ops (E2E HEIC journey green) |

**Class A (verified):** JPEG/PNG/WebP/AVIF inspect+clean; HEIC inspect + still-layout cleaning incl. one real-encoder layout. GeoTag_Final contains no AVIF/HEIC path (accept list JPEG/PNG/WebP only; `piexif` JPEG-only; Canvas path converts toward JPEG — explicitly disqualified by v1.1 §6.2).
**Class D (blockers/unproven):** image sequences (`msf1`/`heis`, `moov`-based) — refuse, never corrupt; grid/overlay/aux/thumbnail/multi-image edge cases; C2PA/JUMBF removal in ISOBMFF; HEVC-patent boundary for any bundled decoder; `iloc`-near-EOF memory budgets; iPhone-original (Apple-encoder) HEIC still wanted as an extra layout data point.
