# AI Metadata Remover & Manager

Free, private, browser-based image metadata inspection, cleaning, bulk ZIP,
and CSV/PDF audit reports. Processing is local to the browser: selected media
is never sent to an application server.

## Quick start

Requirements: Node.js 20.9+ (developed with Node 24), npm 11+.

```bash
cd AI_meta_Data_Remover
npm install
npm run dev      # http://localhost:3000
npm run typecheck
npm run lint
npm test         # vitest, unit only
npm run test:e2e # Playwright (needs `npm run build` first; serves out/)
npm run build    # static export to out/
```

Serve the production output with any static server (no Node required), e.g.
from the project directory:

```bash
python3 -m http.server 8000 --directory out
```

The export uses relative asset paths, so it can also run from a hosting
subdirectory and in browsers that permit local `file://` application assets.
HTTP serving is still recommended because it matches production browser
security behavior.

## Scope boundaries (Phase 5)

- Upload + queue (Phase 1), real metadata inspection (Phase 2), guest
  cleaning with verification gate (Phase 3), and bulk Clean All + ZIP
  (Phase 4) still work, plus guest **audit reports**: standalone **CSV**
  (summary + detailed tag ledger) and **PDF** downloads, and optional
  `reports/` inclusion in ZIP via None/CSV/PDF/Both. Summary redaction is
  the default; original values need explicit opt-in.
- Still disabled and labeled Planned: Firebase sign-in, custom rewrite,
  GeoTag, video cleaning.

## Structure

```text
app/                     App Router shell (layout, landing page, styles)
src/components/layout/   Header, hero, footer
src/components/upload/   Dropzone + picker panel
src/components/queue/    Queue list, row w/ object-URL lifecycle, pure store
src/components/panels/   File support and privacy guidance
src/lib/format-detection/ Extension hints + byte-level container checks
src/lib/security/        Filename sanitizer (reserved for ZIP/downloads)
src/types/               Strict shared contracts (spec §12, skeletal)
docs/                    Phase 0 research + living Phase 1 log
```

Reference: `MUSE_AI_Metadata_Manager_Build_Spec.md` (master plan), `AGENTS.md`
(agent rules), `GeoTag_Final/` (read-only predecessor — do not modify).

## Third-party notices

- Metadata reading uses [ExifReader](https://github.com/mattiasw/ExifReader)
  (Copyright Mattias Wallander), licensed under the **Mozilla Public License
  2.0**. The library is used unmodified as an npm dependency; this project's
  own code is separate. MPL-2.0 license text ships with the package in
  `node_modules/exifreader/LICENSE`.
- ZIP export uses [fflate](https://github.com/101arrowz/fflate) 0.8.3
  (**MIT**, zero dependencies), lazy-loaded only when archiving. No Zip64:
  archives are refused past 4 GiB rather than corrupted.
- HEIC previews use [heic-to](https://github.com/hoppergee/heic-to) 1.6.6
  (**LGPL-3.0**, libheif/WASM) as a lazy, display-only decoder. Cleaning never
  converts or re-encodes the selected file.
- Content Credentials are read and validated locally with the official
  [@contentauth/c2pa-web](https://github.com/contentauth/c2pa-js) 0.15.3 SDK
  (**MIT**, c2pa-rs/WASM). The large validator chunk loads only after an
  embedded C2PA Manifest Store identifier is found.
- Test-only XML parsing in Node uses
  [@xmldom/xmldom](https://github.com/xmldom/xmldom) (MIT, devDependency);
  browsers use their native DOMParser. No XML parser ships extra payload for
  parsing beyond what the platform provides.
- Independent fixture verification uses local ExifTool (dev-time only, never
  bundled or called by the app).
