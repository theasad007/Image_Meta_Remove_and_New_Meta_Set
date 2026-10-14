# 05 — Metadata Field Mapping (draft for Phase 6, Spec v1.1)

Profile fields are optional; writer support is per-format and must verify on re-read. Never place every value in arbitrary EXIF comments or forge camera/C2PA history. **AVIF/HEIC use XMP (`dc:`/`photoshop:`/`xmpRights:`/PLUS) + EXIF items — never legacy IPTC-IIM, never JPEG conversion.**

| UI field | Meaning | JPEG | PNG / WebP | AVIF / HEIC (required, verify) |
|---|---|---|---|---|
| Company / Publisher | Distributor | XMP `dc:publisher` / IPTC Credit | XMP (field-dependent) | XMP item `dc:publisher` |
| Creator / Author | True creator | EXIF `Artist` · XMP `dc:creator` · IPTC Creator | XMP (field-dependent) | XMP `dc:creator` + EXIF `Artist` item where proven |
| Copyright Notice | Notice text | EXIF `Copyright` · XMP `rights` · IPTC CopyrightNotice | XMP (field-dependent) | XMP `dc:rights`/`photoshop:Copyright` + EXIF item where proven |
| Rights Owner | Holder if ≠ creator | IPTC/XMP rights-owner where supported | XMP where supported | XMP rights-owner where supported |
| Website / URL | Link | XMP/IPTC contact/url where supported | XMP where supported | XMP `xmpRights:WebStatement`/PLUS where supported |
| Contact | Email/phone | IPTC contact set where supported | XMP where supported | XMP where supported |
| Image Title | Friendly title | EXIF `DocumentName` · XMP `dc:title` | XMP `dc:title` | XMP `dc:title` + EXIF item where proven |
| Image Description | What it shows | EXIF `ImageDescription` · XMP `dc:description` (not HTML `alt`) | XMP `dc:description` | XMP `dc:description` + EXIF item where proven |
| Keywords / Tags | Controlled list | IPTC Keywords · XMP `dc:subject` (avoid `XPKeywords` as primary) | XMP `dc:subject` | XMP `dc:subject` |
| Location Name | Human place | IPTC/XMP location where supported | XMP where supported | XMP location where supported |
| Latitude / Longitude | Coords | EXIF GPS (JPEG target) | EXIF/XMP only if verified | **EXIF GPS item (required target, per-format proof)** |
| Altitude | Elevation | EXIF GPS altitude where supported | Only if verified | **EXIF GPS altitude (required target, per-format proof)** |

Modes: `Replace existing editable metadata` (clears editable, keeps technical/display-critical, explicit list) vs `Update only selected fields` (touches requested fields only). Multi-file: global profile + optional per-file title/desc overrides (defer overrides if needed). Each change emits `MetadataChange{namespace,tag,oldValue,expectedValue,observedValue,action,verified}`.
