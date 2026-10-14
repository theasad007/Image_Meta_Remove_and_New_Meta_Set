# Phase 2 test fixtures (synthetic, non-sensitive)

Real image files with real embedded metadata. Every person/company name, GPS
coordinate and timestamp is invented for testing. **Never commit real client
or personal photos here.**

## Provenance

Generated deterministically by `scripts/gen-fixtures.py` (Pillow pixels +
hand-built EXIF/XMP/IPTC/ISOBMFF blocks; every expected value is explicit in
that script). Regenerate with:

```bash
python3 scripts/gen-fixtures.py
```

Independently verified with local ExifTool 13.55 (dev-time only, never a
runtime dependency). Full dump: `EXIFTOOL_BASELINE.txt` in this directory.
After-clean dumps of all cleaned outputs: `EXIFTOOL_AFTER_CLEAN.txt`.
Pixel-equality evidence (Pillow decode before/after): recorded in
`docs/00-development-log.md` Phase 3 entry.

## Expected values (mirror of the generator + ExifTool baseline)

| Fixture | Key expectations |
|---|---|
| `jpeg-exif.jpg` | Make TestCam, Model `TestCam Model X`, Orientation normal, DateTimeOriginal 2026:10:01 12:34:56, GPS 12.345678 N / 98.765432 E, alt 150 m |
| `jpeg-gps-sw.jpg` | Orientation Rotate 90 CW, GPS 34.6037 S / 58.3816 W, alt −5 m (below sea level) |
| `jpeg-xmp-iptc.jpg` | XMP CreatorTool `PhaseTwoTest/? 1.0`, dc:creator/rights/description; IPTC ObjectName `Harbor Noon`, 2 keywords, By-line, CopyrightNotice, Caption |
| `jpeg-ai.jpg` | XMP CreatorTool `Stable Diffusion WebUI v1.9`, DigitalSourceType `…/trainedAlgorithmicMedia`, AIPromptInformation present → explicit indicators |
| `jpeg-caption-ai.jpg` | Caption `Portrait of Ai at the market` → **zero** indicators (negative control) |
| `jpeg-empty.jpg` | Valid pixels, no metadata → all inspected groups `not_detected` |
| `jpeg-truncated.jpg` | Cut mid-APP1 → still parses partial EXIF; truncation warning required |
| `png-text-exif.png` | tEXt Title/Author/Description/Software/Comment, zTXt CompressedNote, valid-namespaced iTXt XMP, eXIf Orientation + Software |
| `png-empty.png` | No metadata |
| `png-huge-length.png` | 2 GB declared chunk length in a 17-byte file → safe refusal path |
| `webp-exif-xmp.webp` | EXIF Make/GPS, XMP creator, VP8X container flags |
| `webp-empty.webp` | No metadata |
| `avif-exif-xmp.avif` | ftyp `avif`, EXIF Make/GPS 12.345678,98.765432, XMP creator |
| `avif-truncated-box.avif` | Largesize flag with missing bytes → malformed-box warning |
| `heic-exif-gps.heic` | ftyp `heic`, EXIF Make TestPhone, GPS **0.0, 0.0** (valid edge case), XMP creator |
| `spoof-jpg-with-png-bytes.jpg` | PNG bytes → detected `png` + extension-mismatch warning |
| `empty-file.bin` / `random-bytes.bin` | Safe `failed` outcomes, no throws |
| `jpeg-progressive.jpg` | Progressive JPEG + EXIF/GPS → cleaner handles multi-scan SOS + interleaved DHT; scan payload preserved |
| `jpeg-xmp-extended.jpg` | Main XMP + 2 extended fragments (shared GUID) → all dropped, verified |
| `jpeg-jumbf.jpg` | APP11 JUMBF dummy + EXIF → EXIF verified removed, APP11 retained → `partially_cleaned` |
| `jpeg-icc.jpg` | EXIF + single-chunk ICC APP2 → EXIF removed, ICC bytes preserved |
| `png-icc.png` | tEXt Title + iCCP → text removed, profile bytes identical |
| `png-bad-crc.png` | Corrupted IDAT CRC → `failed`, no output emitted |
| `webp-lossless-alpha.webp` | Lossless + alpha + EXIF → verified clean, VP8L/alpha payload equal |
| `webp-animated.webp` | ANIM/ANMF → refused `unsupported`, never flattened |
| `avif-real-encoder.avif` | Pillow/libavif-encoded AVIF + EXIF/GPS → real `iref`/`iprp` layout cleaned, Pillow-decodable output, pixels identical |
| `heic-uuid.heic` | Trailing top-level `uuid` box → kept + `partially_cleaned` |
| `heic-real-encoder.heic` | **Real-encoder still:** libheif 1.23.6 HEVC (64×48), ExifTool-written EXIF/GPS/XMP; non-zero iloc base_offset, dual `cdsc`, 5-prop `ipma`; cleaned to `verified_clean`, heif-convert-decodable, pixels identical |

## Known fixture quirk

`avif-exif-xmp.avif` / `heic-exif-gps.heic` carry a dummy 8-byte primary
image item (no real codec payload): box-level inspection fixtures, not
decodability fixtures. Both parse identically in ExifTool and ExifReader.
Animated/sequence brands (`avis`, `msf1`) are covered by synthetic byte
tests, not files, and remain honestly unsupported operations.
