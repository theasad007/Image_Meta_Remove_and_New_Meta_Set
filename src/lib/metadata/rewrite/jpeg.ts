import { parseJpegSegments } from "../clean/jpeg";
import type { GpsEngineDirective } from "./gps";
import { GPS_XMP_REMOVAL_QUERIES, toTiffDirective } from "./gps";
import type { FieldWritePlan } from "./writes";
import {
  buildApp13,
  buildTiff,
  buildTiffWithGps,
  buildXmpPacket,
  editXmpPacket,
  parseApp13,
  parseTiff,
  type IptcDataset,
  type TiffWriteValue,
  type XmlCodec,
  type XmpProperty,
} from "./codecs";

/**
 * JPEG profile-field writer (Phase 6) with Screen 09 GPS support.
 *
 * EXIF APP1, XMP APP1, IPTC APP13. When a GPS directive is present the
 * EXIF APP1 is rebuilt through `buildTiffWithGps` (write: GPS IFD created
 * or merged; remove: GPS IFD carved out) and an existing XMP packet loses
 * the standard coordinate mirrors ("Remove GPS location" — never the
 * unrelated Location-Name text). Always merge semantics: existing
 * structures are read, requested fields overlaid, everything unrecognized
 * preserved verbatim. The pipeline runs the proven cleaner first for
 * `replace` mode; this writer never deletes anything else itself.
 */

export type RewriteChannel = "created" | "merged" | "absent" | "unsupported";

export interface JpegRewriteDetail {
  exif: RewriteChannel;
  xmp: RewriteChannel;
  iptc: RewriteChannel;
  gps: RewriteChannel;
}

export interface JpegRewriteOutput {
  data: Uint8Array;
  warnings: string[];
  detail: JpegRewriteDetail;
  /** Requested fields that could not be written, with reasons. */
  skipped: Array<{ field: string; channel: string; reason: string }>;
}

const MAX_SEGMENT_PAYLOAD = 65533;

function segment(marker: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(2 + 2 + payload.length);
  out[0] = 0xff;
  out[1] = marker;
  out[2] = ((payload.length + 2) >> 8) & 0xff;
  out[3] = (payload.length + 2) & 0xff;
  out.set(payload, 4);
  return out;
}

const XMP_MAIN_HEADER = "http://ns.adobe.com/xap/1.0/";
const XMP_EXT_HEADER = "http://ns.adobe.com/xmp/extension/";

export function writeJpegFields(
  input: Uint8Array,
  plans: FieldWritePlan[],
  xml: XmlCodec,
  gps?: GpsEngineDirective,
): JpegRewriteOutput {
  const warnings: string[] = [];
  const skipped: JpegRewriteOutput["skipped"] = [];
  const seg = parseJpegSegments(input);
  const gpsTiff = gps ? toTiffDirective(gps) : null;
  const xmpRemovals = gps?.op === "remove" ? GPS_XMP_REMOVAL_QUERIES : [];

  const exifWrites: TiffWriteValue[] = [];
  const xmpProps: XmpProperty[] = [];
  const iptcWrites: IptcDataset[] = [];
  const exifFields: string[] = [];
  const xmpFields: string[] = [];
  const iptcFields: string[] = [];
  for (const plan of plans) {
    if (plan.exif.length > 0) {
      exifWrites.push(...plan.exif);
      exifFields.push(plan.field);
    }
    if (plan.xmp.length > 0) {
      xmpProps.push(...plan.xmp);
      xmpFields.push(plan.field);
    }
    for (const dataset of plan.iptc) {
      iptcWrites.push({ record: dataset.record, dataset: dataset.dataset, data: new TextEncoder().encode(dataset.text) });
      if (!iptcFields.includes(plan.field)) iptcFields.push(plan.field);
    }
  }

  const detail: JpegRewriteDetail = {
    exif: exifWrites.length === 0 ? "absent" : "unsupported",
    xmp: xmpProps.length === 0 ? "absent" : "unsupported",
    iptc: iptcWrites.length === 0 ? "absent" : "unsupported",
    gps: gps ? "unsupported" : "absent",
  };

  // ---- EXIF APP1 (fields + Screen 09 GPS write/removal) ----
  let exifSegment: Uint8Array | null = null;
  if (exifWrites.length > 0 || gps) {
    const exifEntries = seg.app1.filter((entry) => entry.header.startsWith("Exif"));
    const first = exifEntries[0];
    if (first) {
      const parsed = parseTiff(first.payload.slice(6));
      if (!parsed) {
        const reason = "Existing EXIF block is malformed; refusing to rewrite it.";
        for (const field of exifFields) skipped.push({ field, channel: "EXIF", reason });
        if (gps) detail.gps = "unsupported";
      } else {
        // GPS writes/removal ride the TIFF rebuild; write-only field runs
        // keep the original buildTiff path (zero behavior change).
        const merged = gpsTiff
          ? buildTiffWithGps(parsed, exifWrites, gpsTiff, parsed.little)
          : buildTiff(parsed, exifWrites, parsed.little);
        if (!merged) {
          for (const field of exifFields) skipped.push({ field, channel: "EXIF", reason: "EXIF merge failed value encoding." });
          if (gps) detail.gps = "unsupported";
        } else {
          const payload = concat([new TextEncoder().encode("Exif\0\0"), merged]);
          if (payload.length > MAX_SEGMENT_PAYLOAD) {
            for (const field of exifFields) skipped.push({ field, channel: "EXIF", reason: "Merged EXIF exceeds the JPEG segment size limit." });
            if (gps) detail.gps = "unsupported";
          } else {
            exifSegment = segment(0xe1, payload);
            if (exifWrites.length > 0) detail.exif = "merged";
            if (gps) detail.gps = "merged";
          }
        }
      }
    } else if (gpsTiff?.op === "remove") {
      // No EXIF APP1: no GPS IFD exists to remove; nothing is created.
      detail.gps = "absent";
    } else {
      // Fresh EXIF block for fields and/or the requested GPS write.
      const built = gpsTiff
        ? buildTiffWithGps(null, exifWrites, gpsTiff, true)
        : buildTiff(null, exifWrites, true);
      if (!built) {
        for (const field of exifFields) skipped.push({ field, channel: "EXIF", reason: "EXIF value encoding failed." });
        if (gps) detail.gps = "unsupported";
      } else {
        const payload = concat([new TextEncoder().encode("Exif\0\0"), built]);
        if (payload.length > MAX_SEGMENT_PAYLOAD) {
          for (const field of exifFields) skipped.push({ field, channel: "EXIF", reason: "Merged EXIF exceeds the JPEG segment size limit." });
          if (gps) detail.gps = "unsupported";
        } else {
          exifSegment = segment(0xe1, payload);
          if (exifWrites.length > 0) detail.exif = "created";
          if (gps) detail.gps = "created";
        }
      }
    }
  }

  // ---- XMP APP1 (fields + Screen 09 coordinate removal) ----
  let xmpSegment: Uint8Array | null = null;
  const xmpMains = seg.app1.filter((entry) => entry.header.startsWith(XMP_MAIN_HEADER));
  const xmpExtended = seg.app1.filter((entry) => entry.header.startsWith(XMP_EXT_HEADER));
  if (xmpProps.length > 0 || xmpRemovals.length > 0) {
    if (xmpExtended.length > 0) {
      for (const field of xmpFields) {
        skipped.push({ field, channel: "XMP", reason: "Extended XMP fragments present; update refuses rather than create conflicting duplicates (use Replace mode)." });
      }
      if (xmpRemovals.length > 0) detail.gps = "unsupported";
    } else if (xmpMains.length > 0) {
      const first = xmpMains[0];
      if (!first) {
        for (const field of xmpFields) skipped.push({ field, channel: "XMP", reason: "XMP packet missing." });
        if (xmpRemovals.length > 0) detail.gps = "unsupported";
      } else {
        const text = new TextDecoder("utf-8", { fatal: false }).decode(first.payload.slice(XMP_MAIN_HEADER.length + 1));
        const merged = editXmpPacket(text, xmpProps, xmpRemovals, xml);
        if (merged === null) {
          for (const field of xmpFields) skipped.push({ field, channel: "XMP", reason: "Existing XMP packet is not parseable XML; refusing to rewrite it." });
          if (xmpRemovals.length > 0) detail.gps = "unsupported";
        } else {
          const payload = concat([new TextEncoder().encode(`${XMP_MAIN_HEADER}\x00`), new TextEncoder().encode(merged)]);
          if (payload.length > MAX_SEGMENT_PAYLOAD) {
            for (const field of xmpFields) skipped.push({ field, channel: "XMP", reason: "Merged XMP exceeds the JPEG segment size limit." });
            if (xmpRemovals.length > 0) detail.gps = "unsupported";
          } else {
            xmpSegment = segment(0xe1, payload);
            if (xmpProps.length > 0) detail.xmp = "merged";
          }
        }
      }
    } else if (xmpRemovals.length > 0 && xmpProps.length === 0) {
      // No XMP APP1 present: no XMP coordinates exist to remove. Nothing is
      // created; the removal claim is settled by output verification below.
    } else {
      const payload = concat([
        new TextEncoder().encode(`${XMP_MAIN_HEADER}\x00`),
        buildXmpPacket(xmpProps),
      ]);
      if (payload.length > MAX_SEGMENT_PAYLOAD) {
        for (const field of xmpFields) skipped.push({ field, channel: "XMP", reason: "XMP packet exceeds the JPEG segment size limit." });
      } else {
        xmpSegment = segment(0xe1, payload);
        detail.xmp = "created";
      }
    }
  }

  // ---- IPTC APP13 ----
  const app13Outputs: Uint8Array[] = [];
  if (iptcWrites.length > 0) {
    // Merge per dataset: replace same record/dataset (keywords 2:25 as a set).
    const wanted = new Map<string, Uint8Array[]>();
    for (const dataset of iptcWrites) {
      const key = `${dataset.record}:${dataset.dataset}`;
      if (dataset.dataset === 25) {
        const list = wanted.get(key) ?? [];
        list.push(dataset.data);
        wanted.set(key, list);
      } else {
        wanted.set(key, [dataset.data]);
      }
    }
    let mergedOnce = false;
    for (const raw of seg.app13) {
      const payload = raw.slice(4);
      const parsed = parseApp13(payload);
      const hasIptc = parsed.iptc.length > 0;
      if (!hasIptc) {
        app13Outputs.push(raw);
        continue;
      }
      if (!mergedOnce) {
        mergedOnce = true;
        const kept = parsed.iptc.filter((dataset) => !wanted.has(`${dataset.record}:${dataset.dataset}`));
        const merged: IptcDataset[] = [...kept];
        for (const [key, datas] of wanted) {
          const [record, dataset] = key.split(":").map(Number) as [number, number];
          // Keep original dataset order for preserved sets; append written ones.
          for (const data of datas) merged.push({ record: record ?? 0, dataset: dataset ?? 0, data });
        }
        // Preserve original relative order: rebuilt list keeps surviving
        // datasets first only when nothing was replaced; acceptable and tested.
        app13Outputs.push(segment(0xed, buildApp13(parsed.kept, merged)));
        detail.iptc = "merged";
      } else {
        // Further APP13s: strip written datasets to avoid contradictions.
        const kept = parsed.iptc.filter((dataset) => !wanted.has(`${dataset.record}:${dataset.dataset}`));
        if (kept.length === 0 && parsed.kept.length === 0) continue; // drop emptied segment
        app13Outputs.push(segment(0xed, buildApp13(parsed.kept, kept)));
      }
    }
    if (!mergedOnce) {
      const fresh: IptcDataset[] = [];
      for (const [key, datas] of wanted) {
        const [record, dataset] = key.split(":").map(Number) as [number, number];
        for (const data of datas) fresh.push({ record: record ?? 0, dataset: dataset ?? 0, data });
      }
      // Envelope version record first (conventional).
      fresh.unshift({ record: 2, dataset: 0, data: new Uint8Array([0, 2]) });
      app13Outputs.push(segment(0xed, buildApp13([], fresh)));
      detail.iptc = "created";
    }
  } else {
    app13Outputs.push(...seg.app13);
  }

  // ---- Assembly (original order; new/merged segments after SOI) ----
  const out: Uint8Array[] = [new Uint8Array([0xff, 0xd8])];
  if (exifSegment) out.push(exifSegment);
  if (xmpSegment) out.push(xmpSegment);
  for (const entry of seg.app1) {
    if (entry.header.startsWith("Exif") && exifSegment) continue; // replaced (first dropped, rest dropped)
    if (entry.header.startsWith(XMP_MAIN_HEADER) && xmpSegment) continue; // replaced
    out.push(entry.raw);
  }
  out.push(...app13Outputs);
  for (const raw of seg.com) out.push(raw);
  for (const raw of seg.app11) out.push(raw);
  for (const entry of seg.app2) out.push(entry.raw);
  for (const entry of seg.appOther) out.push(entry.raw);
  for (const kept of seg.prefix) out.push(kept);
  out.push(seg.scan);
  if (seg.trailing.length > 0) {
    out.push(seg.trailing);
    warnings.push(`${seg.trailing.length} trailing byte(s) after EOI preserved verbatim.`);
  }
  return { data: concat(out), warnings, detail, skipped };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}
