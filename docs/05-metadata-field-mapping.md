# 05 — Metadata Field Mapping (Phase 6 proven)

Profile fields are optional; writer support is per-format and verified on re-read. Never place every value in arbitrary EXIF comments or forge camera/C2PA history. **AVIF/HEIC use XMP (`dc:`/`xmpRights:`/`Iptc4xmpCore`) + EXIF items — never legacy IPTC-IIM, never JPEG conversion.**

| UI field | Meaning | JPEG | PNG / WebP | AVIF / HEIC |
|---|---|---|---|---|
| Company / Publisher | Distributor (≠ creator) | XMP `dc:publisher` (Seq) + IPTC 2:110 | XMP `dc:publisher` (IPTC unsupported) | XMP item `dc:publisher` (IPTC unsupported) |
| Creator / Author | True creator only | EXIF `Artist` (315) + XMP `dc:creator` (Seq) + IPTC 2:80 | EXIF + XMP (IPTC unsupported) | Exif item + XMP item (IPTC unsupported) |
| Copyright Notice | Notice text | EXIF `Copyright` (33432) + XMP `dc:rights` (Alt) + IPTC 2:116 | EXIF + XMP | Exif + XMP |
| Rights Owner | Holder if ≠ creator | XMP `xmpRights:Owner` (Bag) — no EXIF/IPTC home | XMP only | XMP only |
| Website / URL | Link (http/https) | XMP `Iptc4xmpCore:CreatorContactInfo/CiUrlWork` | XMP only | XMP only |
| Contact | Consented contact | XMP `dc:contributor` (Bag) + IPTC 2:118 | XMP only | XMP only |
| Image Title | Friendly title | EXIF `DocumentName` (269) + XMP `dc:title` (Alt) + IPTC 2:5 | EXIF + XMP | Exif + XMP |
| Image Description | What it shows | EXIF `ImageDescription` (270) + XMP `dc:description` (Alt) + IPTC 2:120 | EXIF + XMP | Exif + XMP |
| Keywords / Tags | Controlled list (≤30, deduped) | XMP `dc:subject` (Bag, distinct) + IPTC 2:25 per keyword | XMP `dc:subject` Bag | XMP `dc:subject` Bag |
| Location Name | Human place (non-GPS) | XMP `Iptc4xmpCore:Location` + IPTC 2:92 | XMP only | XMP only |
| Latitude / Longitude | Coords | Phase 7 (EXIF GPS target) | Phase 7 | Phase 7 |
| Altitude | Elevation | Phase 7 | Phase 7 | Phase 7 |

Verification semantics: every claimed field is re-observed in its mapped locations (`observeFieldValues`); `verified` requires all supported locations to match semantically (keyword sets compared order-insensitively). IPTC locations outside JPEG are `retained_unsupported` (disclosed, not failures). Malformed existing blocks refuse with per-field reasons; oversized JPEG segments refuse. Modes: `replace_editable` (proven clean first, then write) vs `update_selected` (chosen fields only; unrelated incl. C2PA preserved + re-validated). Each change emits `MetadataChange{group,key,action,before,after,verification,reason}` with `action=rewritten` for verified writes.
