#!/usr/bin/env python3
"""Phase 2 fixture generator — synthetic, non-sensitive, deterministic.

Creates real image files with real embedded metadata for the browser
inspector test suite. No personal data: company names, GPS coordinates and
timestamps are invented. Run from the project root:

    python3 scripts/gen-fixtures.py

Requires: Pillow (pixels + PNG text chunks). EXIF/XMP/IPTC/ISOBMFF blocks are
hand-built below so every expected value is explicit and auditable.
Verify afterwards with:  exiftool -G -s src/test-fixtures/<file>
"""
import os
import struct
import sys
import zlib

try:
    from PIL import Image
    from PIL.PngImagePlugin import PngInfo
except ImportError:
    sys.exit("Pillow is required: pip3 install pillow")

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                    "..", "src", "test-fixtures")
os.makedirs(ROOT, exist_ok=True)

# ---------------------------------------------------------------- TIFF/EXIF

T_BYTE, T_ASCII, T_SHORT, T_LONG, T_RATIONAL, T_UNDEF = 1, 2, 3, 4, 5, 7


def _pack_val(tiff_type, value):
    if tiff_type == T_BYTE:
        vals = list(value)
        return len(vals), struct.pack(f"<{len(vals)}B", *vals)
    if tiff_type == T_ASCII:
        raw = value.encode("ascii", "replace") + b"\x00"
        return len(raw), raw
    if tiff_type == T_SHORT:
        vals = list(value)
        return len(vals), struct.pack(f"<{len(vals)}H", *vals)
    if tiff_type == T_LONG:
        vals = list(value)
        return len(vals), struct.pack(f"<{len(vals)}I", *vals)
    if tiff_type == T_RATIONAL:
        raw = b"".join(struct.pack("<II", n, d) for n, d in value)
        return len(value), raw
    if tiff_type == T_UNDEF:
        return len(value), bytes(value)
    raise ValueError(tiff_type)


def build_tiff(ifd0, exif=None, gps=None):
    """Assemble a little-endian TIFF with optional EXIF + GPS sub-IFDs."""
    parts = [b"II*\x00\x08\x00\x00\x00"]  # header, IFD0 at offset 8
    offset = 8
    # Reserve space: IFD0 block, then EXIF block, then GPS block, then data.
    ifd_blocks = []
    for entries in [ifd0] + [e for e in (exif, gps) if e is not None]:
        ifd_blocks.append(entries)
    # First pass: compute sizes.
    sizes = [2 + 12 * len(e) + 4 for e in ifd_blocks]
    data_start = offset + sum(sizes)
    # Second pass: emit.
    data_blobs = []
    cursor = data_start
    out = [parts[0]]
    ptr_tags = []  # (position_of_value_field, target_block_index)
    for bi, entries in enumerate(ifd_blocks):
        n = len(entries)
        out.append(struct.pack("<H", n))
        for tag, ttype, value in entries:
            if isinstance(value, dict) and value.get("__subifd__") is not None:
                # Pointer to a later block: LONG count=1 + 4-byte offset
                # value field (12 bytes total); offset patched below.
                out.append(struct.pack("<HHI", tag, T_LONG, 1) + b"\x00\x00\x00\x00")
                ptr_tags.append((len(b"".join(out)) - 4, value["__subifd__"]))
                continue
            count, raw = _pack_val(ttype, value)
            if len(raw) <= 4:
                out.append(struct.pack("<HHI", tag, ttype, count))
                field = raw + b"\x00" * (4 - len(raw))
                # Overwrite: we already wrote count; now patch value bytes.
                out[-1] = out[-1][:8] + field
            else:
                out.append(struct.pack("<HHI", tag, ttype, count))
                out[-1] = out[-1][:8] + struct.pack("<I", cursor)
                data_blobs.append(raw)
                cursor += len(raw)
        out.append(struct.pack("<I", 0))  # next IFD = none
    # Resolve sub-IFD pointers.
    block_offsets = []
    pos = offset
    for s in sizes:
        block_offsets.append(pos)
        pos += s
    blob = b"".join(out) + b"".join(data_blobs)
    blob = bytearray(blob)
    for field_pos, target in ptr_tags:
        struct.pack_into("<I", blob, field_pos, block_offsets[target])
    return bytes(blob)


def SUBIFD(index):
    return {"__subifd__": index}


def dms_rational(decimal):
    dec = abs(decimal)
    d = int(dec)
    m_float = (dec - d) * 60.0
    m = int(m_float)
    s_float = (m_float - m) * 60.0
    return [(d, 1), (m, 1), (int(round(s_float * 1000)), 1000)]


def gps_ifd(lat, lon, alt):
    return [
        (0, T_BYTE, [2, 3, 0, 0]),
        (1, T_ASCII, "N" if lat >= 0 else "S"),
        (2, T_RATIONAL, dms_rational(lat)),
        (3, T_ASCII, "E" if lon >= 0 else "W"),
        (4, T_RATIONAL, dms_rational(lon)),
        (5, T_BYTE, [0 if alt >= 0 else 1]),
        (6, T_RATIONAL, [(int(round(abs(alt) * 100)), 100)]),
    ]


def photo_ifd0(make, model, software, artist, desc, copyright_, dt,
               orientation=1):
    return [
        (270, T_ASCII, desc),
        (271, T_ASCII, make),
        (272, T_ASCII, model),
        (274, T_SHORT, [orientation]),
        (282, T_RATIONAL, [(300, 1)]),
        (283, T_RATIONAL, [(300, 1)]),
        (296, T_SHORT, [2]),
        (305, T_ASCII, software),
        (306, T_ASCII, dt),
        (315, T_ASCII, artist),
        (33432, T_ASCII, copyright_),
        (34665, T_LONG, SUBIFD(1)),
        (34853, T_LONG, SUBIFD(2)),
    ]


def photo_exif(dt):
    return [
        (36867, T_ASCII, dt),          # DateTimeOriginal
        (42036, T_ASCII, "Test Lens 50mm"),
    ]


DT = "2026:10:01 12:34:56"

# ---------------------------------------------------------------- JPEG

def jpeg_segment(marker, payload):
    return b"\xff" + bytes([marker]) + struct.pack(">H", len(payload) + 2) + payload


def xmp_packet(meta_inner):
    return (
        b'<?xpacket begin="\xef\xbb\xbf" id="W5M0MpCehiHzreSzNTczkc9d"?>\n'
        b'<x:xmpmeta xmlns:x="adobe:ns:meta/">\n'
        b'<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n'
        + meta_inner +
        b'\n</rdf:RDF>\n</x:xmpmeta>\n'
        b'<?xpacket end="w"?>'
    )


XMP_JPEG_BASE = xmp_packet(
    b'<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">\n'
    b'  <dc:creator><rdf:Seq><rdf:li>Phase Two Test Creator</rdf:li></rdf:Seq></dc:creator>\n'
    b'  <dc:rights><rdf:Alt><rdf:li xml:lang="x-default">Phase Two Test Rights 2026</rdf:li></rdf:Alt></dc:rights>\n'
    b'  <dc:description><rdf:Alt><rdf:li xml:lang="x-default">Synthetic test photo of a harbor at noon</rdf:li></rdf:Alt></dc:description>\n'
    b'</rdf:Description>\n'
    b'<rdf:Description rdf:about="" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" photoshop:Credit="Phase Two Test Studio" />\n'
    b'<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:CreatorTool="PhaseTwoTest/? 1.0" />'
)

XMP_JPEG_AI = xmp_packet(
    b'<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">\n'
    b'  <dc:description><rdf:Alt><rdf:li xml:lang="x-default">Synthetic neon market scene</rdf:li></rdf:Alt></dc:description>\n'
    b'</rdf:Description>\n'
    b'<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:CreatorTool="Stable Diffusion WebUI v1.9" />\n'
    b'<rdf:Description rdf:about="" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/c2aa9dmt/trainedAlgorithmicMedia">\n'
    b'  <Iptc4xmpExt:AIPromptInformation><rdf:Alt><rdf:li xml:lang="x-default">neon street market, rain reflections</rdf:li></rdf:Alt></Iptc4xmpExt:AIPromptInformation>\n'
    b'</rdf:Description>'
)

XMP_JPEG_CAPTION_AI = xmp_packet(
    b'<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">\n'
    b'  <dc:description><rdf:Alt><rdf:li xml:lang="x-default">Portrait of Ai at the market</rdf:li></rdf:Alt></dc:description>\n'
    b'</rdf:Description>\n'
    b'<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:CreatorTool="PhaseTwoTest/? 1.0" />'
)


def iptc_dataset(record, dataset, data):
    if isinstance(data, str):
        data = data.encode("utf-8")
    return b"\x1c" + bytes([record, dataset]) + struct.pack(">H", len(data)) + data


def iptc_app13():
    records = [
        iptc_dataset(2, 0, b"\x00\x02"),
        iptc_dataset(2, 5, "Harbor Noon"),
        iptc_dataset(2, 25, "harbor"),
        iptc_dataset(2, 25, "synthetic-test"),
        iptc_dataset(2, 80, "Phase Two Test Creator"),
        iptc_dataset(2, 116, "Phase Two Test Rights 2026"),
        iptc_dataset(2, 120, "Synthetic test photo of a harbor at noon"),
    ]
    payload = b"".join(records)
    resource = (
        b"8BIM" + struct.pack(">H", 0x0404) + b"\x00\x00" +
        struct.pack(">I", len(payload)) + payload
    )
    if len(payload) % 2 == 1:
        resource += b"\x00"
    return b"Photoshop 3.0\x00" + resource


def splice_after_soi(jpeg_bytes, segments):
    assert jpeg_bytes[:2] == b"\xff\xd8", "not a JPEG"
    return jpeg_bytes[:2] + b"".join(segments) + jpeg_bytes[2:]


def base_jpeg(path, color):
    img = Image.new("RGB", (16, 12), color)
    img.save(path, "JPEG", quality=85)


def make_jpegs():
    # 1. EXIF camera/date/orientation + GPS N/E.
    p = os.path.join(ROOT, "jpeg-exif.jpg")
    base_jpeg(p, (200, 120, 60))
    tiff = build_tiff(
        photo_ifd0("TestCam", "TestCam Model X", "PhaseTwoTest/? 1.0",
                   "Phase Two Test Creator", "Synthetic harbor photo",
                   "Phase Two Test Rights 2026", DT),
        photo_exif(DT), gps_ifd(12.345678, 98.765432, 150.0))
    raw = open(p, "rb").read()
    open(p, "wb").write(splice_after_soi(
        raw, [jpeg_segment(0xE1, b"Exif\x00\x00" + tiff)]))

    # 2. GPS S/W + below-sea-level altitude, rotated orientation.
    p = os.path.join(ROOT, "jpeg-gps-sw.jpg")
    base_jpeg(p, (60, 120, 200))
    tiff = build_tiff(
        photo_ifd0("TestCam", "TestCam Model X", "PhaseTwoTest/? 1.0",
                   "Phase Two Test Creator", "Synthetic southern photo",
                   "Phase Two Test Rights 2026", DT, orientation=6),
        photo_exif(DT), gps_ifd(-34.603700, -58.381600, -5.0))
    raw = open(p, "rb").read()
    open(p, "wb").write(splice_after_soi(
        raw, [jpeg_segment(0xE1, b"Exif\x00\x00" + tiff)]))

    # 3. XMP + IPTC.
    p = os.path.join(ROOT, "jpeg-xmp-iptc.jpg")
    base_jpeg(p, (120, 200, 60))
    tiff = build_tiff(
        photo_ifd0("TestCam", "TestCam Model X", "PhaseTwoTest/? 1.0",
                   "Phase Two Test Creator", "Synthetic harbor photo",
                   "Phase Two Test Rights 2026", DT),
        photo_exif(DT), gps_ifd(12.345678, 98.765432, 150.0))
    raw = open(p, "rb").read()
    open(p, "wb").write(splice_after_soi(raw, [
        jpeg_segment(0xE1, b"Exif\x00\x00" + tiff),
        jpeg_segment(0xE1, b"http://ns.adobe.com/xap/1.0/\x00" + XMP_JPEG_BASE),
        jpeg_segment(0xED, iptc_app13()),
    ]))

    # 4. AI indicators (explicit).
    p = os.path.join(ROOT, "jpeg-ai.jpg")
    base_jpeg(p, (180, 60, 180))
    raw = open(p, "rb").read()
    open(p, "wb").write(splice_after_soi(raw, [
        jpeg_segment(0xE1, b"http://ns.adobe.com/xap/1.0/\x00" + XMP_JPEG_AI),
    ]))

    # 5. Ordinary caption mentioning "Ai" (negative control).
    p = os.path.join(ROOT, "jpeg-caption-ai.jpg")
    base_jpeg(p, (60, 180, 180))
    raw = open(p, "rb").read()
    open(p, "wb").write(splice_after_soi(raw, [
        jpeg_segment(0xE1, b"http://ns.adobe.com/xap/1.0/\x00" + XMP_JPEG_CAPTION_AI),
    ]))

    # 6. Empty (valid pixels, no metadata).
    p = os.path.join(ROOT, "jpeg-empty.jpg")
    base_jpeg(p, (128, 128, 128))

    # 7. Truncated inside APP1.
    src = open(os.path.join(ROOT, "jpeg-exif.jpg"), "rb").read()
    soi_end = 2 + 2 + struct.unpack(">H", src[4:6])[0]
    open(os.path.join(ROOT, "jpeg-truncated.jpg"), "wb").write(
        src[:soi_end - 25])

# ---------------------------------------------------------------- PNG


def png_chunk(ctype, data):
    return (struct.pack(">I", len(data)) + ctype + data +
            struct.pack(">I", zlib.crc32(ctype + data) & 0xFFFFFFFF))


def make_pngs():
    p = os.path.join(ROOT, "png-text-exif.png")
    img = Image.new("RGB", (16, 12), (90, 140, 200))
    info = PngInfo()
    info.add_text("Title", "Synthetic PNG Title")
    info.add_text("Author", "Phase Two Test Creator")
    info.add_text("Description", "Synthetic test PNG with text chunks")
    info.add_text("Software", "PhaseTwoTest/? 1.0")
    info.add_text("Comment", "plain-tEXt-comment", zip=False)
    info.add_text("CompressedNote", "zTXt-compressed-note", zip=True)
    info.add_itxt("XML:com.adobe.xmp",
                  '<x:xmpmeta xmlns:x="adobe:ns:meta">'
                  '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
                  '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">'
                  '<dc:creator><rdf:Seq><rdf:li>Phase Two Test Creator</rdf:li></rdf:Seq></dc:creator>'
                  "</rdf:Description></rdf:RDF></x:xmpmeta>",
                  lang="en", tkey="XML:com.adobe.xmp")
    img.save(p, "PNG", pnginfo=info)
    # Insert eXIf chunk before IDAT (minimal EXIF: orientation + software).
    raw = open(p, "rb").read()
    assert raw[:8] == b"\x89PNG\r\n\x1a\n"
    tiff = build_tiff(
        [(274, T_SHORT, [1]), (305, T_ASCII, "PhaseTwoTest/? 1.0")], None, None)
    # eXIf chunk data starts with the TIFF header ("II", byte order + IFD).
    exif_body = tiff
    out = bytearray(raw[:8])
    pos = 8
    inserted = False
    while pos < len(raw):
        (length,) = struct.unpack(">I", raw[pos:pos + 4])
        ctype = raw[pos + 4:pos + 8]
        end = pos + 12 + length
        if ctype == b"IDAT" and not inserted:
            out += png_chunk(b"eXIf", exif_body)
            inserted = True
        out += raw[pos:end]
        pos = end
        if ctype == b"IEND":
            break
    assert inserted
    open(p, "wb").write(bytes(out))

    p = os.path.join(ROOT, "png-empty.png")
    Image.new("RGB", (16, 12), (128, 128, 128)).save(p, "PNG")

    # Malformed: declared chunk length far beyond EOF.
    raw = open(os.path.join(ROOT, "png-empty.png"), "rb").read()
    bad = raw[:8] + struct.pack(">I", 0x7FFFFFFF) + b"tEXt" + b"X"
    open(os.path.join(ROOT, "png-huge-length.png"), "wb").write(bad)

# ---------------------------------------------------------------- WebP


def make_webps():
    p = os.path.join(ROOT, "webp-exif-xmp.webp")
    img = Image.new("RGB", (16, 12), (200, 90, 140))
    tiff = build_tiff(
        photo_ifd0("TestCam", "TestCam Model X", "PhaseTwoTest/? 1.0",
                   "Phase Two Test Creator", "Synthetic webp photo",
                   "Phase Two Test Rights 2026", DT),
        photo_exif(DT), gps_ifd(12.345678, 98.765432, 150.0))
    # Pillow WebP: exif= wants raw TIFF; xmp= wants the raw packet.
    xmp = (b'<x:xmpmeta xmlns:x="adobe:ns:meta">'
           b'<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
           b'<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">'
           b'<dc:creator><rdf:Seq><rdf:li>Phase Two Test Creator</rdf:li></rdf:Seq></dc:creator>'
           b'</rdf:Description></rdf:RDF></x:xmpmeta>')
    try:
        img.save(p, "WEBP", exif=tiff, xmp=xmp)
    except TypeError:
        img.save(p, "WEBP", exif=tiff)

    p = os.path.join(ROOT, "webp-empty.webp")
    Image.new("RGB", (16, 12), (128, 128, 128)).save(p, "WEBP")

# ---------------------------------------------------------------- ISOBMFF (AVIF / HEIC)


def box(ctype, payload):
    return struct.pack(">I", 8 + len(payload)) + ctype + payload


def fullbox(ctype, version, flags, payload):
    return box(ctype, struct.pack(">I", (version << 24) | flags) + payload)


def ftyp(major, compat):
    return box(b"ftyp", major + b"\x00\x00\x00\x00" + b"".join(compat))


def hdlr():
    return fullbox(b"hdlr", 0, 0,
                   struct.pack(">I", 0) + b"pict" + b"\x00" * 12 + b"\x00")


def pitm(item_id):
    return fullbox(b"pitm", 0, 0, struct.pack(">H", item_id))


def infe_v2(item_id, item_type, name, content_type=b""):
    # ISO-BMFF infe version 2 (as written by real cameras/encoders):
    # version/flags + item_ID(16) + protection(16) + item_type(4) +
    # item_name NUL + content_type NUL + content_encoding NUL.
    return box(b"infe",
               struct.pack(">IHH", 2 << 24, item_id, 0) + item_type +
               name + b"\x00" + content_type + b"\x00\x00")


def iinf(entries):
    return box(
        b"iinf", struct.pack(">I", 0) + struct.pack(">H", len(entries)) +
        b"".join(entries))


def iloc(items):
    """items: [(item_id, offset, length)] absolute (construction method 0).

    base_offset is 0; extent offsets are absolute file offsets.
    """
    body = struct.pack(">I", 0) + struct.pack(">BBH", 0x44, 0x40, len(items))
    for item_id, offset, length in items:
        body += struct.pack(">HHIH", item_id, 0, 0, 1)
        body += struct.pack(">II", offset, length)
    return box(b"iloc", body)


def build_isobmff(path, major, compat, codec_type, exif_tiff, xmp_packet,
                  gps_for_name):
    """Two-pass ISOBMFF: Exif item + XMP item + dummy primary image item."""
    # HEIF Exif item layout: 4-byte big-endian TIFF-header offset (6 = size
    # of the "Exif\0\0" header that follows), then "Exif\0\0", then TIFF.
    exif_payload = struct.pack(">I", 6) + b"Exif\x00\x00" + exif_tiff
    items = [
        # (item_id, item_type, name, content_type, data)
        (1, codec_type, b"primary", b"", b"\x00" * 8),
        (2, b"Exif", b"Exif", b"", exif_payload),
        (3, b"mime", b"XMP", b"application/rdf+xml", xmp_packet),
    ]
    for attempt in range(2):
        if attempt == 0:
            offsets = [(i, 0, len(d)) for i, _, _, _, d in items]
        else:
            base = len(ftyp_blob) + meta_len + 8  # + mdat header
            cursor = base
            offsets = []
            for (i, _, _, _, d) in items:
                offsets.append((i, cursor, len(d)))
                cursor += len(d)
        iloc_blob = iloc(offsets)
        iinf_blob = iinf([infe_v2(i, t, n, ct) for i, t, n, ct, _ in items])
        meta_children = hdlr() + pitm(1) + iloc_blob + iinf_blob
        meta_blob = fullbox(b"meta", 0, 0, meta_children)
        meta_len = len(meta_blob)
        if attempt == 0:
            ftyp_blob = ftyp(major, compat)
    mdat_blob = box(b"mdat", b"".join(d for _, _, _, _, d in items))
    # Rebuild iloc with final offsets (fixed widths -> identical meta size).
    base = len(ftyp_blob) + len(meta_blob) + 8
    cursor = base
    offsets = []
    for (i, _, _, _, d) in items:
        offsets.append((i, cursor, len(d)))
        cursor += len(d)
    iloc_blob = iloc(offsets)
    iinf_blob = iinf([infe_v2(i, t, n, ct) for i, t, n, ct, _ in items])
    meta_children = hdlr() + pitm(1) + iloc_blob + iinf_blob
    meta_final = fullbox(b"meta", 0, 0, meta_children)
    assert len(meta_final) == len(meta_blob), "meta must be size-stable"
    open(path, "wb").write(ftyp_blob + meta_final + mdat_blob)
    print(f"wrote {os.path.basename(path)} ({gps_for_name})")


XMP_AVIF = xmp_packet(
    b'<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">\n'
    b'  <dc:creator><rdf:Seq><rdf:li>Phase Two Test Creator</rdf:li></rdf:Seq></dc:creator>\n'
    b'  <dc:description><rdf:Alt><rdf:li xml:lang="x-default">Synthetic AVIF test image</rdf:li></rdf:Alt></dc:description>\n'
    b'</rdf:Description>\n'
    b'<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:CreatorTool="PhaseTwoTest/? 1.0" />'
)

XMP_HEIC = xmp_packet(
    b'<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">\n'
    b'  <dc:creator><rdf:Seq><rdf:li>Phase Two Test Creator</rdf:li></rdf:Seq></dc:creator>\n'
    b'  <dc:description><rdf:Alt><rdf:li xml:lang="x-default">Synthetic HEIC test image</rdf:li></rdf:Alt></dc:description>\n'
    b'</rdf:Description>\n'
    b'<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:CreatorTool="PhaseTwoTest/? 1.0" />'
)


def make_isobmff():
    tiff_avif = build_tiff(
        photo_ifd0("TestCam", "TestCam Model X", "PhaseTwoTest/? 1.0",
                   "Phase Two Test Creator", "Synthetic AVIF photo",
                   "Phase Two Test Rights 2026", DT),
        photo_exif(DT), gps_ifd(12.345678, 98.765432, 150.0))
    build_isobmff(os.path.join(ROOT, "avif-exif-xmp.avif"),
                  b"avif", [b"avif", b"mif1", b"miaf"], b"av01",
                  tiff_avif, XMP_AVIF, "gps 12.345678, 98.765432")

    # HEIC with zero coordinates (valid edge case) + S/W covered by JPEG.
    tiff_heic = build_tiff(
        photo_ifd0("TestPhone", "TestPhone 1", "PhaseTwoTest/? 1.0",
                   "Phase Two Test Creator", "Synthetic HEIC photo",
                   "Phase Two Test Rights 2026", DT),
        photo_exif(DT), gps_ifd(0.0, 0.0, 10.0))
    build_isobmff(os.path.join(ROOT, "heic-exif-gps.heic"),
                  b"heic", [b"heic", b"heix", b"mif1", b"miaf"], b"hvc1",
                  tiff_heic, XMP_HEIC, "gps 0.0, 0.0")

    # Malformed: largesize flag set but file ends mid-header.
    bad = ftyp(b"avif", [b"avif", b"mif1"]) + struct.pack(">I", 1) + b"meta" + b"\x00\x00"
    open(os.path.join(ROOT, "avif-truncated-box.avif"), "wb").write(bad)

# ---------------------------------------------------------------- real-encoder AVIF

def make_real_avif():
    """Pillow/libavif-encoded AVIF (real encoder layout) + our proven TIFF.

    Whether Pillow actually persists the EXIF/XMP is verified with exiftool
    after generation; whatever survives becomes the fixture's contract.
    """
    from PIL import Image as PILImage
    img = PILImage.new("RGB", (32, 24))
    px = img.load()
    for x in range(32):
        for y in range(24):
            px[x, y] = ((x * 8) % 256, (y * 10) % 256, ((x + y) * 4) % 256)
    tiff = build_tiff(
        photo_ifd0("RealCam", "RealCam AV1", "PillowReal/? 11.3",
                   "Real Encoder Creator", "Real encoder AVIF photo",
                   "Real Rights 2026", DT),
        photo_exif(DT), gps_ifd(48.8566, 2.3522, 35.0))
    p = os.path.join(ROOT, "avif-real-encoder.avif")
    try:
        img.save(p, "AVIF", exif=tiff)
        print(f"wrote {os.path.basename(p)} (pillow avif + exif attempt)")
    except Exception as exc:
        print(f"pillow AVIF+exif failed ({exc}); saving plain AVIF")
        img.save(p, "AVIF")
        print(f"wrote {os.path.basename(p)} (pillow avif, no metadata)")


def minimal_icc_profile():
    """Tiny synthetic ICC profile (mntr/RGB + desc text tag). Byte-level
    preservation is what matters; semantic validity is best-effort."""
    desc_text = b"Phase3TestProfile\x00"
    tag_data = b"text\x00\x00\x00\x00" + desc_text
    tag_table = struct.pack(">I", 1) + b"desc" + struct.pack(">II", 128 + 4 + 12, len(tag_data))
    header = (struct.pack(">I", 128 + 4 + 12 + len(tag_data)) + b"TEST" +
              struct.pack(">I", 0x04000000) + b"mntr" + b"RGB " + b"XYZ " +
              struct.pack(">HHHHHH", 2026, 10, 13, 0, 0, 0) + b"acsp" + b"APPL" +
              struct.pack(">I", 0) + b"\x00\x00\x00\x00" + b"\x00\x00\x00\x00" +
              b"\x00" * (128 - 4 - 4 - 4 - 4 - 4 - 4 - 12 - 4 - 4 - 4 - 4 - 4))
    assert len(header) == 128
    return header + tag_table + tag_data


def make_phase3_fixtures():
    # Progressive JPEG with EXIF+GPS.
    p = os.path.join(ROOT, "jpeg-progressive.jpg")
    img = __import__("PIL.Image", fromlist=["x"]).new("RGB", (16, 12), (40, 160, 200))
    img.save(p, "JPEG", progressive=True, quality=85)
    tiff = build_tiff(
        photo_ifd0("TestCam", "TestCam Model X", "PhaseTwoTest/? 1.0",
                   "Phase Two Test Creator", "Synthetic progressive photo",
                   "Phase Two Test Rights 2026", DT),
        photo_exif(DT), gps_ifd(12.345678, 98.765432, 150.0))
    raw = open(p, "rb").read()
    open(p, "wb").write(splice_after_soi(
        raw, [jpeg_segment(0xE1, b"Exif\x00\x00" + tiff)]))

    # Extended XMP (main packet + 2 fragments, shared GUID).
    guid = b"0123456789ABCDEF0123456789ABCDEF"
    main = xmp_packet(
        b'<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:CreatorTool="PhaseTwoTest/? 1.0" />\n'
        b'<rdf:Description rdf:about="" xmlns:xmpNote="http://ns.adobe.com/xmp/note/" xmpNote:HasExtendedXMP="' + guid + b'" />')
    frag_payload = b"<extended>synthetic-extended-xmp-fragment-</extended>"
    frag1 = (b"http://ns.adobe.com/xmp/extension/\x00" + guid +
             struct.pack(">II", len(frag_payload) * 2, 0) + frag_payload)
    frag2 = (b"http://ns.adobe.com/xmp/extension/\x00" + guid +
             struct.pack(">II", len(frag_payload) * 2, len(frag_payload)) + frag_payload)
    p = os.path.join(ROOT, "jpeg-xmp-extended.jpg")
    base_jpeg(p, (100, 100, 200))
    raw = open(p, "rb").read()
    open(p, "wb").write(splice_after_soi(raw, [
        jpeg_segment(0xE1, b"http://ns.adobe.com/xap/1.0/\x00" + main),
        jpeg_segment(0xE1, frag1),
        jpeg_segment(0xE1, frag2),
    ]))

    # JUMBF APP11 (unassessed container data -> partial-coverage fixture).
    p = os.path.join(ROOT, "jpeg-jumbf.jpg")
    base_jpeg(p, (200, 100, 100))
    tiff = build_tiff(
        photo_ifd0("TestCam", "TestCam Model X", "PhaseTwoTest/? 1.0",
                   "Phase Two Test Creator", "Synthetic jumbf photo",
                   "Phase Two Test Rights 2026", DT),
        photo_exif(DT), gps_ifd(12.345678, 98.765432, 150.0))
    raw = open(p, "rb").read()
    open(p, "wb").write(splice_after_soi(raw, [
        jpeg_segment(0xE1, b"Exif\x00\x00" + tiff),
        jpeg_segment(0xEB, b"JUMBF\x00" + b"\x00" * 64),
    ]))

    # JPEG with ICC APP2 (preservation fixture).
    p = os.path.join(ROOT, "jpeg-icc.jpg")
    base_jpeg(p, (150, 150, 60))
    icc = minimal_icc_profile()
    icc_seg = b"ICC_PROFILE\x00" + bytes([1, 1]) + icc
    tiff = build_tiff(
        photo_ifd0("TestCam", "TestCam Model X", "PhaseTwoTest/? 1.0",
                   "Phase Two Test Creator", "Synthetic icc photo",
                   "Phase Two Test Rights 2026", DT),
        photo_exif(DT), gps_ifd(12.345678, 98.765432, 150.0))
    raw = open(p, "rb").read()
    open(p, "wb").write(splice_after_soi(raw, [
        jpeg_segment(0xE1, b"Exif\x00\x00" + tiff),
        jpeg_segment(0xE2, icc_seg),
    ]))

    # PNG with iCCP + text (text removed, profile identical).
    p = os.path.join(ROOT, "png-icc.png")
    from PIL.PngImagePlugin import PngInfo as _PngInfo
    img = __import__("PIL.Image", fromlist=["x"]).new("RGB", (16, 12), (60, 200, 120))
    info = _PngInfo()
    info.add_text("Title", "Synthetic PNG ICC Title")
    img.save(p, "PNG", pnginfo=info)
    raw = open(p, "rb").read()
    iccp = png_chunk(b"iCCP", b"ICC Profile\x00\x00" + zlib.compress(icc))
    out = bytearray(raw[:8])
    pos, done = 8, False
    while pos < len(raw):
        (length,) = struct.unpack(">I", raw[pos:pos + 4])
        ctype = raw[pos + 4:pos + 8]
        end = pos + 12 + length
        if ctype == b"IDAT" and not done:
            out += iccp
            done = True
        out += raw[pos:end]
        pos = end
        if ctype == b"IEND":
            break
    open(p, "wb").write(bytes(out))

    # PNG with a corrupted CRC (must fail safely, no output).
    src = open(os.path.join(ROOT, "png-text-exif.png"), "rb").read()
    i = src.find(b"IDAT")
    bad = src[:i - 4] + struct.pack(">I", 0xDEADBEEF) + src[i:]
    open(os.path.join(ROOT, "png-bad-crc.png"), "wb").write(bad)

    # Lossless WebP with alpha + metadata.
    from PIL import Image as _Image
    img = _Image.new("RGBA", (16, 12), (200, 90, 140, 128))
    tiff = build_tiff(
        photo_ifd0("TestCam", "TestCam Model X", "PhaseTwoTest/? 1.0",
                   "Phase Two Test Creator", "Synthetic lossless webp",
                   "Phase Two Test Rights 2026", DT),
        photo_exif(DT), gps_ifd(12.345678, 98.765432, 150.0))
    p = os.path.join(ROOT, "webp-lossless-alpha.webp")
    try:
        img.save(p, "WEBP", lossless=True, exif=tiff)
    except TypeError:
        img.convert("RGB").save(p, "WEBP", lossless=True, exif=tiff)

    # Animated WebP (must be refused as unsupported).
    f1 = _Image.new("RGB", (16, 12), (200, 90, 140))
    f2 = _Image.new("RGB", (16, 12), (90, 140, 200))
    f1.save(os.path.join(ROOT, "webp-animated.webp"), "WEBP",
            save_all=True, append_images=[f2], duration=100, loop=0)

    # HEIC with an extra top-level uuid box (unassessed data -> partial).
    src = open(os.path.join(ROOT, "heic-exif-gps.heic"), "rb").read()
    uuid_box = box(b"uuid", bytes(range(16)) + b"synthetic-uuid-payload")
    open(os.path.join(ROOT, "heic-uuid.heic"), "wb").write(src + uuid_box)
    print("wrote heic-uuid.heic (trailing uuid box)")


# ---------------------------------------------------------------- misc corrupt


def make_misc():    # PNG bytes with .jpg name (spoof).
    src = open(os.path.join(ROOT, "png-empty.png"), "rb").read()
    open(os.path.join(ROOT, "spoof-jpg-with-png-bytes.jpg"), "wb").write(src)
    # Zero-byte + random.
    open(os.path.join(ROOT, "empty-file.bin"), "wb").write(b"")
    open(os.path.join(ROOT, "random-bytes.bin"), "wb").write(
        bytes(range(256)) * 4)


if __name__ == "__main__":
    make_jpegs()
    make_pngs()
    make_webps()
    make_isobmff()
    make_real_avif()
    make_phase3_fixtures()
    make_misc()
    names = sorted(os.listdir(ROOT))
    print(f"\n{len(names)} fixtures in {ROOT}:")
    for n in names:
        print(f"  {n} ({os.path.getsize(os.path.join(ROOT, n))} bytes)")
