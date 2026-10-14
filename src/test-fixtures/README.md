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
| `signed-c2pa.jpg` | **Genuine C2PA manifest (test identity, untrusted):** own synthetic base + c2patool-signed JUMBF APP11; claim generator `AI Metadata Remover P0 proof signer`, `c2pa.created` + `trainedAlgorithmicMedia` source type, signer `C2PA Signer` / `C2PA Test Signing Cert`; browser reports `detected`, Validation State `Valid`, 1 failure (untrusted credential) |
| `signed-c2pa.png` | Same manifest embedded by c2patool in a real PNG **`caBX`** chunk (store UUID at chunk offset 57); proves the format-independent preflight on PNG bytes |
| `jpeg-c2pa-tampered.jpg` | One flipped bit in scan data of the signed JPEG → c2patool `Invalid` + `claimSignature.mismatch`; still parses/decodes; must stay `detected` with failures, never absent/valid |
| `jpeg-openai.jpg` | **Synthetic OpenAI tag (NOT real provenance):** XMP CreatorTool `OpenAI GPT-Image` → exactly 1 explicit indicator, row chip `OpenAI 1` |
| `jpeg-caption-openai.jpg` | Caption `A visitor reading about OpenAI at the market`, ordinary CreatorTool → **zero** indicators, chip `AI 0` (OpenAI negative control) |
| `expired-cert.jpg` | **Expired-credential fixture (test identity):** own synthetic base signed under a locally minted ES256 cert valid Jan 2024 only (EE←intermediate←root, faketime-assisted signing); browser reports `detected` + `Invalid` with `signingCredential.expired` + `signingCredential.untrusted` — the same shape as real expired-signer files (e.g. older ChatGPT PNG exports). SHA-256 `c168ec85…bb02b59` (36,324 B) |
| `jpeg-c2pa-multi.jpg` | **Multi-segment store:** c2patool-signed (100 KB custom assertion forces 3 APP11, EN `0211`, Z 1–3 with duplicated LBOX/TBOX); `Valid`. All parts removed as one group |
| `jpeg-c2pa-foreign-app11.jpg` | Multi-segment store + interleaved foreign APP11 (`UNRELATED-DATA`, different EN): C2PA parts removed, foreign retained |
| `jpeg-c2pa-truncated-store.jpg` | Multi-segment store minus its last part: present parts removed, nothing left behind |
| `jpeg-com-c2pa-text.jpg` | COM comment mentioning “c2pa”, no APP11: no phantom C2PA event (negative control) |
| `png-c2pa-forged-cabx.png` | `caBX` chunk with valid CRC but garbage payload: fails structural proof → always retained, even aggressive (negative) |
| `png-c2pa-stray-cabx.png` | `caBX` byte string inside IDAT pixel bytes (decodable): chunk-walk never false-fires; IDAT preserved (negative) |
| `webp-c2pa-signed.webp` | c2patool-signed real WebP (Pillow-decodable, `Valid`): RIFF `C2PA` chunk removed, VP8 intact |
| `webp-c2pa-forged.webp` | `C2PA` chunk with garbage payload: always retained (negative) |
| `avif-c2pa-signed.avif` | c2patool-signed real-encoder AVIF (Pillow-decodable 32×24, `Valid`): top-level C2PA `uuid` (purpose `manifest`) dropped, items/offsets recomputed |
| `avif-uuid-unrelated.avif` | Trailing synthetic `uuid` (non-C2PA type): retained (negative, mirrors `heic-uuid.heic`) |
| `heic-c2pa-signed.heic` | c2patool-signed real HEVC still from `heif-enc` (decodable 64×48, `Valid`): C2PA `uuid` dropped, decode identical |

## P0 C2PA/OpenAI fixtures — provenance (NOT from `gen-fixtures.py`)

Base pixels/metadata are the project's own synthetic fixtures
(`jpeg-exif.jpg`, `png-text-exif.png`). Signed 14 Oct 2026 with
**c2patool 0.27.22** (Homebrew, embedded c2pa-rs 0.90.22) using its
**built-in test certificate** — no private test material was created,
downloaded, or committed. Exact manifest definition and commands are
recorded in `docs/09-c2pa-openai-proof-report.md`. Regeneration reproduces
the structure (timestamps differ, so hashes will not match byte-for-byte).

SHA-256 of the committed bytes:

```text
1e2c4308c0541f5e98c84369ad07806faf6ddaf70b3abfabd6215dcec7af3ede  jpeg-openai.jpg
2cd80de8c5eb141db17641de33921c5daca3b1b6dbe5f455a6f553ba897959cf  jpeg-caption-openai.jpg
4d44ecc0064999278cef91c81e4cd49fde3141695b9d143d4dd55ee1b2ab6e09  signed-c2pa.jpg
74a78e7d6e50f83911a1d7bc556fc2142e5cd1e719b205f981d9e8f30fa3a68d  signed-c2pa.png
22dd094935dbc92ab47458a06868018d47d24e1db0fe1379f4454cf3e975ba3e  jpeg-c2pa-tampered.jpg
c168ec856e2147c8b58fdf449877716e152fe3be21cb7f1335b078242bb02b59  expired-cert.jpg
0e9e25ce833a2f8c9e87ea188e252a6d66fe2eefe4ede97c72e10353ef106a28  jpeg-c2pa-multi.jpg
040e505b5e6abb2b72704b89c17fc66de9a7023e9a3fed22cb5feef3fead4a1b  jpeg-c2pa-foreign-app11.jpg
ae80bb687433c54d7b7415ce90ed69300f04d1ff05df1508fe5347971132ce90  jpeg-c2pa-truncated-store.jpg
fe0318e4f100f1929f350c352ebf561bc7ac7ab60ca379a70cbad2ba1574e9c2  jpeg-com-c2pa-text.jpg
08ad2cbcef67737d30d8a3a51d6be20d410f1257fbefe2e5ef2bdd73eba90251  png-c2pa-forged-cabx.png
8482e7fa0c43fe49c34ab963e9365f3a7118bb4474228687c9d25bde6e28ae7a  png-c2pa-stray-cabx.png
0f07b66fb2b4cd19a053dd215ccd85e036e602b72484b5a2e56d0dcb0e5d0fa2  webp-c2pa-forged.webp
8224d9277890614ff67e1d1a1099a13cf5ea399149c305ef8112936b1daae8f0  avif-uuid-unrelated.avif
62f234ae2533ea9ecd5e2a6a46c93a15b42931e001240c3abb384e2cc63ee3c1  webp-c2pa-signed.webp
8dfcfec02a15eadd1ee2f28f5a805a54b7b67b8412593faabe4d4ada02bb7a7c  avif-c2pa-signed.avif
7864ea7e5feb94e83fc8338d3cf94900793df3baec568464c28f9fb370e1dea3  heic-c2pa-signed.heic
```

Independent verification (local only): `c2patool <file>` (manifest,
`validation_state`, failure codes) and `exiftool -G -s <file>` (JUMBF
groups, `DigitalSourceType`, `ActionsSoftwareAgentName`). The OpenAI JPEGs
are hand-built with the same XMP packet shape as `gen-fixtures.py` and
carry no C2PA store by construction (negative preflight cases).

## Known fixture quirk

`avif-exif-xmp.avif` / `heic-exif-gps.heic` carry a dummy 8-byte primary
image item (no real codec payload): box-level inspection fixtures, not
decodability fixtures. Both parse identically in ExifTool and ExifReader.
Animated/sequence brands (`avis`, `msf1`) are covered by synthetic byte
tests, not files, and remain honestly unsupported operations.
