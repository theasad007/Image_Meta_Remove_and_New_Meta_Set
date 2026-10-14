# 01 — GeoTag_Final Reference Audit (Phase 0)

**Date:** 13 Oct 2026
**Scope:** `GeoTag_Final/` only. Read-only audit. No files modified.
**Spec ref:** `MUSE_AI_Metadata_Manager_Build_Spec.md` §4, §6.4, §15 (Phase 0)

## 1. Inventory (actual files)

```text
GeoTag_Final/
├── app/
│   ├── layout.jsx        (15 lines)
│   ├── page.jsx          (307 lines, client component)
│   └── globals.css       (242 lines, hand-rolled CSS)
├── lib/
│   ├── exifWriter.js     (68 lines)
│   └── imageConverter.js (20 lines)
├── next.config.js        (7 lines, output:'export')
├── package.json          (Next 14.2.33, React 18.2.0, exifr 7.1.3, piexifjs 1.0.6)
├── package-lock.json
├── README.md             (21 lines)
├── out/                  (built static export, not audited byte-for-byte)
├── node_modules/
└── .next/
```

No TypeScript, no tests, no workers, no Tailwind, no Firebase, no ZIP/CSV/PDF, no video code.

## 2. Architecture

- Next.js Pages-era App Router with single route `/` (`app/page.jsx:25`). All logic client-side (`"use client"` at `app/page.jsx:1`).
- State: `imageFile`, `preview` (object URL), `fields` (`oldGeo/lat/lon/keywords/desc/coordsRaw/fileName`) at `app/page.jsx:26-38`.
- Flow: `processFile()` → optional `convertToJpeg()` → `URL.createObjectURL` → `exifr.parse()` → form → `writeMetadata()` → anchor download.
- Config `next.config.js:2-5` correctly uses `output:"export"` + `reactStrictMode:true`. This pattern is reusable for Hostinger static hosting.

## 3. Feature-by-feature findings

### 3.1 Image uploading (`app/page.jsx:57-97`)
- Supports drag/drop + file input, `accept="image/jpeg,image/jpg,image/png,image/webp"` (`app/page.jsx:163-166`, `186-189`).
- **Single-file only:** `e.target.files[0]` (`app/page.jsx:88`), `e.dataTransfer.files[0]` (`app/page.jsx:95`). Extra files silently ignored. No bulk queue, no folder picker, no cancel/retry, no MIME-vs-magic-byte validation.
- No file-size guard, no error path for empty/unsupported files.

### 3.2 Image preview (`app/page.jsx:67`, `183`)
- `setPreview(URL.createObjectURL(workingFile))`. Works but **never calls `URL.revokeObjectURL`** — leak on every re-upload/reset. `handleReset` (`app/page.jsx:109-121`) nulls state without revoking.
- Large images held fully in memory + object URL; no virtualized/lazy preview strategy for bulk.

### 3.3 EXIF metadata reading (`app/page.jsx:70`, dep `exifr@7.1.3`)
- `exifr.parse(workingFile)` then checks `exif.latitude/longitude` (`app/page.jsx:71`).
- Only surfaces GPS as `oldGeo` string. No EXIF/XMP/IPTC/C2PA/PNG-text/WebP-chunk inspection, no per-field table, no before/after model.
- **Critical flaw:** parses the *converted* JPEG, not the original. PNG/WebP EXIF/XMP is destroyed by conversion before it is ever read, so original metadata is unobservable.
- GPS state reset bug (spec §4 predicted, confirmed): on no-GPS file, only `oldGeo` is reset (`app/page.jsx:79`); stale `lat/lon` from previous file persist. Uploading `gps.jpg` then `no-gps.jpg` leaves old coordinates in the form — high risk of mis-tagging.

### 3.4 GPS metadata writing (`lib/exifWriter.js:1-68`)
- Decimal → DMS rational conversion (`convertToDMS`, `lib/exifWriter.js:40-52`): `[[d,1],[m,1],[round(s*100),100]]` with `GPSLatitudeRef N/S`, `GPSLongitudeRef E/W` (`lib/exifWriter.js:22-26`). **Mathematically correct and reusable** (with rewrite to TypedArrays).
- Writes `ImageDescription` from `desc` (`lib/exifWriter.js:9-11`) and `XPKeywords` UTF-16LE from `keywords` (`lib/exifWriter.js:13-16`).
- Uses `piexif.dump` + `piexif.insert` (`lib/exifWriter.js:29-30`). JPEG-only. **Discards all pre-existing EXIF** (fresh `{"0th":{},"Exif":{},"GPS":{},"1st":{}}` at line 6) — orientation, camera, dates silently dropped. No XMP/IPTC/C2PA handling. No re-read verification.
- Binary-string conversion (`arrayBufferToBinaryString` loop + `String.fromCharCode`, `lib/exifWriter.js:54-59`) materializes giant strings — O(n) memory blowup, will OOM on 500–1000 image batches or large video. Must be replaced with `Uint8Array`/`DataView` walkers + Workers.

### 3.5 Google Maps coordinate input (`app/page.jsx:8-23`, `44-55`, `209-224`)
- `parseLatLon` strips everything except digits/`-+,.whitespace` (`app/page.jsx:9`), splits on comma or whitespace, requires 2 numbers.
- Idea of paste-then-“Use This Lat/Long” is good UX and reusable.
- Bugs: (a) silent lat/lon auto-swap if `|lat|>90 && |lon|<=90` (`app/page.jsx:19-21`) — masks user error instead of validating; (b) no range check (`[-90,90]/[-180,180]`), no hemisphere/precision handling, no negative-zero handling, no error message beyond generic alert; (c) strips `N/S/E/W` letters and `°` so `34.15N 118.25W` parses incorrectly.

### 3.6 Image downloading (`app/page.jsx:123-138`)
- `writeMetadata` → `URL.createObjectURL(blob)` → `<a download>` click. Works for single JPEG.
- Filename: `fields.fileName.trim()+".jpg"` — no sanitization (slashes, `../`, Unicode, duplicate names, 255-char limits). No `a.remove()`/revoke. Always `.jpg` even if input was PNG/WebP — silent format conversion.
- No ZIP, no CSV/PDF, no batch download, no failure report.

### 3.7 Styling / UX (`app/globals.css`, `app/page.jsx:140-306`)
- Clean centered card, dropzone, two-column editor (collapses at 900px). Readable, good starting aesthetic.
- Hand-rolled CSS, no Tailwind, no design tokens, no dark mode, no i18n.
- Template-literal bug at `app/page.jsx:177`: `` className={`dropzone \${dragOver ? "hover" : ""}`} `` — escaped `\${}` renders literally, so hover state never applies in editor view (compare correct usage at line 151).
- Accessibility gaps: label wrapping input without `htmlFor`, no keyboard focus style, `alert()` for errors, disabled `oldGeo` input without `aria-live` status, no progress/status roles for future queue.

## 4. Dependency audit

| Dep | Version in repo | Status Oct 2026 | Verdict |
|---|---|---|---|
| `next` | 14.2.33 | Outdated. Active LTS 16.3.8, Maintenance 15.5.27. Sep 2026 security releases fix 1 High + 5 Medium + 1 Low; CVE-2025-66478 (CVSS 10 RCE in RSC) affects 15.x/16.x lineage — 14.2.33 must not ship to prod. | Upgrade to Next 16.3.x LTS in Phase 1 |
| `react` / `react-dom` | 18.2.0 | Outdated. Next 16 requires React 19.2+ / 19.3, Node ≥20.9, modern browsers. | Upgrade with Next |
| `exifr` | 7.1.3 | **Inactive 5 years**, 53 open issues, 13 open PRs, no commits. MIT, fast, but no PNG-text/XMP depth vs ExifReader. | Keep read-only reference in Phase 2 trials, then replace |
| `piexifjs` | 1.0.6 | **Inactive 7 years**, 18 open issues. MIT, JPEG-only, string-based. | Do not reuse for cleaning; reimplement GPS math only |
| — | — | No TS, no Tailwind, no test runner, no linter, no Firebase, no ZIP/PDF libs | Add in Phase 1 per §03 |

## 5. Reusable (with rewrite)

1. Static-export config skeleton (`output:"export"`) — port to `next.config.ts`.
2. Drag/drop + file-picker UX copy and `accept` list — extend to multi-file + folder picker + magic-byte check.
3. Google-Maps paste UX concept — replace parser with strict validator (range, variants, no auto-swap).
4. Decimal→DMS rational algorithm — port to `Uint8Array` implementation with round-trip test.
5. Object-URL preview pattern — add `revokeObjectURL` lifecycle + lazy thumbnails.
6. Single-anchor download pattern — add sanitization + multi/ZIP path.

## 6. Do-not-copy list

- `imageConverter.js` Canvas `toBlob(...,'image/jpeg',0.92)` — recompresses, strips alpha, changes type. Banned for cleaning (spec §4).
- Fresh-EXIF overwrite in `exifWriter.js:6` — destroys orientation/camera data.
- Binary-string whole-file materialization — OOM risk at scale.
- `alert()` errors, single-file assumption, stale-lat/lon state, unsanitized filename, escaped template literal.
- README “alt text” wording — HTML `alt` ≠ embedded EXIF `ImageDescription`; relabel in new UI.

## 6b. AVIF / HEIC gap (v1.1 — required, entirely absent in reference)

- Accept list (`app/page.jsx:163-166`, `186-189`) allows only JPEG/PNG/WebP — no `.avif/.heic/.heif`; uploader, converter, `exifr.parse` path, and `piexif.insert` writer are all non-ISOBMFF. Any AVIF/HEIC dropped today is either rejected by the picker or — worse — Canvas-converted toward JPEG, which v1.1 §6.2 explicitly says **does not count** as native cleaning.
- Nothing reusable for ISOBMFF: no `ftyp` brand check, no `meta`/`iloc`/`iinf` handling, no placeholder-preview concept for non-decodable HEIC. New `src/lib/metadata/avif-heic/` module required; GPS math reusable only after Exif-item transport is proven.

## 7. Audit acceptance

- [x] All source files read line-by-line; reusable logic isolated.
- [x] Compatibility risks flagged (Next/React/exifr/piexifjs age, JPEG-only writer, Canvas converter).
- [x] Reference ZIP/project left unmodified (read-only).
- Proven vs proposed strictly separated — see `02-support-matrix.md` and `07-known-limitations.md`.
