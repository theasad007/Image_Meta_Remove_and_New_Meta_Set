import {
  MIME_XMP,
  concatBytes,
  encodeIinf,
  encodeIloc,
  encodeIref,
  fullBox,
  fullVersion,
  sizedBox,
  validateStillLayout,
  type InfeEntry,
  type IrefEntry,
} from "../clean/isobmff";
import type { FieldWritePlan } from "./writes";
import {
  buildTiff,
  buildXmpPacket,
  mergeXmpPacket,
  parseTiff,
  type TiffWriteValue,
  type XmlCodec,
  type XmpProperty,
} from "./codecs";

/**
 * ISOBMFF (AVIF/HEIC) profile-field writer (Phase 6).
 *
 * Adds or merges standards-compliant metadata *items*: `Exif` (with the
 * `Exif\0\0` header writers emit) and `mime`/`application/rdf+xml` XMP.
 * New items get fresh ids, `iinf`/`iloc` are regenerated, `iref` gains a
 * `cdsc` link for new Exif items, and every offset is recomputed from the
 * final layout — the same full-rebuild discipline as the cleaner. Image
 * item payloads relocate verbatim; brands, `pitm`, `iprp`, `colr` and all
 * unrelated boxes survive in order.
 */

const EXIF_HEADER = "Exif\0\0";

export type RewriteChannel = "created" | "merged" | "absent" | "unsupported";

export interface IsobmffRewriteOutput {
  data: Uint8Array;
  warnings: string[];
  detail: { exif: RewriteChannel; xmp: RewriteChannel };
  skipped: Array<{ field: string; channel: string; reason: string }>;
}

function textBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function writeIsobmffFields(
  input: Uint8Array,
  kind: "avif" | "heic",
  plans: FieldWritePlan[],
  xml: XmlCodec,
  replaceCleaned: Uint8Array | null,
): IsobmffRewriteOutput {
  const warnings: string[] = [];
  const skipped: IsobmffRewriteOutput["skipped"] = [];
  // In replace mode the caller passes already-cleaned bytes; otherwise the
  // original bytes are edited in place (update mode preserves everything).
  const base = replaceCleaned ?? input;
  const layout = validateStillLayout(base, kind);

  const exifWrites: TiffWriteValue[] = [];
  const xmpProps: XmpProperty[] = [];
  const exifFields: string[] = [];
  const xmpFields: string[] = [];
  for (const plan of plans) {
    if (plan.exif.length > 0) {
      exifWrites.push(...plan.exif);
      exifFields.push(plan.field);
    }
    if (plan.xmp.length > 0) {
      xmpProps.push(...plan.xmp);
      xmpFields.push(plan.field);
    }
  }
  const detail: IsobmffRewriteOutput["detail"] = {
    exif: exifWrites.length === 0 ? "absent" : "unsupported",
    xmp: xmpProps.length === 0 ? "absent" : "unsupported",
  };

  const ilocById = new Map(layout.iloc.items.map((item) => [item.itemId, item]));
  const payloadOf = (itemId: number): Uint8Array | null => {
    const ilocItem = ilocById.get(itemId);
    if (!ilocItem || ilocItem.extents.length === 0) return null;
    const parts: Uint8Array[] = [];
    for (const extent of ilocItem.extents) {
      if (extent.offset < 0 || extent.length <= 0 || extent.offset + extent.length > base.length) return null;
      parts.push(base.subarray(extent.offset, extent.offset + extent.length));
    }
    return concatBytes(parts);
  };

  const exifEntry = layout.infeEntries.find((entry) => entry.itemType === "Exif");
  const xmpEntry = layout.infeEntries.find(
    (entry) => entry.itemType === "mime" && entry.contentType === MIME_XMP,
  );
  const maxId = layout.infeEntries.reduce((max, entry) => Math.max(max, entry.itemId), 0);
  if (maxId + 2 > 0xffff) {
    return { data: base.slice(), warnings: ["Item id budget exhausted; refusing rewrite."], detail, skipped };
  }

  interface PendingItem {
    itemId: number;
    entry: InfeEntry;
    payload: Uint8Array;
    mode: "merged" | "created";
  }
  const pending: PendingItem[] = [];

  if (exifWrites.length > 0) {
    if (exifEntry) {
      const current = payloadOf(exifEntry.itemId);
      if (!current || current.length < EXIF_HEADER.length + 8) {
        for (const field of exifFields) skipped.push({ field, channel: "EXIF", reason: "Existing Exif item is unreadable; refusing to rewrite it." });
      } else {
        const header = new TextDecoder("latin1").decode(current.slice(0, 6));
        if (header !== EXIF_HEADER) {
          for (const field of exifFields) skipped.push({ field, channel: "EXIF", reason: "Existing Exif item has an unexpected header; refusing to rewrite it." });
        } else {
          const parsed = parseTiff(current.slice(6));
          if (!parsed) {
            for (const field of exifFields) skipped.push({ field, channel: "EXIF", reason: "Existing Exif TIFF is malformed; refusing to rewrite it." });
          } else {
            const merged = buildTiff(parsed, exifWrites, parsed.little);
            if (!merged) {
              for (const field of exifFields) skipped.push({ field, channel: "EXIF", reason: "EXIF merge failed value encoding." });
            } else {
              pending.push({
                itemId: exifEntry.itemId,
                entry: exifEntry,
                payload: concatBytes([textBytes(EXIF_HEADER), merged]),
                mode: "merged",
              });
              detail.exif = "merged";
            }
          }
        }
      }
    } else {
      const built = buildTiff(null, exifWrites, true);
      if (!built) {
        for (const field of exifFields) skipped.push({ field, channel: "EXIF", reason: "EXIF value encoding failed." });
      } else {
        const itemId = maxId + 1;
        pending.push({
          itemId,
          entry: { itemId, itemType: "Exif", itemName: "", contentType: "", version: 2 },
          payload: concatBytes([textBytes(EXIF_HEADER), built]),
          mode: "created",
        });
        detail.exif = "created";
      }
    }
  }

  if (xmpProps.length > 0) {
    if (xmpEntry) {
      const current = payloadOf(xmpEntry.itemId);
      const text = current ? new TextDecoder("utf-8", { fatal: false }).decode(current) : null;
      const merged = text === null ? null : mergeXmpPacket(text, xmpProps, xml);
      if (merged === null) {
        for (const field of xmpFields) skipped.push({ field, channel: "XMP", reason: "Existing XMP item is missing or not parseable XML; refusing to rewrite it." });
      } else {
        pending.push({ itemId: xmpEntry.itemId, entry: xmpEntry, payload: textBytes(merged), mode: "merged" });
        detail.xmp = "merged";
      }
    } else {
      const packet = buildXmpPacket(xmpProps);
      const itemId = maxId + (pending.length > 0 ? 2 : 1);
      pending.push({
        itemId,
        entry: { itemId, itemType: "mime", itemName: "", contentType: MIME_XMP, version: 2 },
        payload: packet,
        mode: "created",
      });
      detail.xmp = "created";
    }
  }

  if (pending.length === 0) {
    return { data: base.slice(), warnings, detail, skipped };
  }

  // Rebuild: kept item payloads + pending payloads, fresh iinf/iloc/iref.
  const replaced = new Map(pending.map((item) => [item.itemId, item]));
  const ilocLookup = new Map(layout.iloc.items.map((item) => [item.itemId, item]));
  const entries: InfeEntry[] = [];
  const mdatPlan: { itemId: number; payload: Uint8Array }[] = [];
  for (const entry of layout.infeEntries) {
    const swap = replaced.get(entry.itemId);
    if (swap) {
      entries.push(swap.entry);
      mdatPlan.push({ itemId: swap.itemId, payload: swap.payload });
      continue;
    }
    const ilocItem = ilocLookup.get(entry.itemId);
    if (!ilocItem || ilocItem.extents.length === 0) {
      return { data: base.slice(), warnings: [...warnings, `Kept item ${entry.itemId} has no extents; rebuild refused.`], detail: { exif: "unsupported", xmp: "unsupported" }, skipped };
    }
    const parts: Uint8Array[] = [];
    for (const extent of ilocItem.extents) {
      if (extent.offset < 0 || extent.length <= 0 || extent.offset + extent.length > base.length) {
        return { data: base.slice(), warnings: [...warnings, `Item ${entry.itemId} extent out of bounds; rebuild refused.`], detail: { exif: "unsupported", xmp: "unsupported" }, skipped };
      }
      parts.push(base.subarray(extent.offset, extent.offset + extent.length));
    }
    entries.push(entry);
    mdatPlan.push({ itemId: entry.itemId, payload: concatBytes(parts) });
  }
  for (const item of pending) {
    if (layout.infeEntries.some((entry) => entry.itemId === item.itemId)) continue;
    entries.push(item.entry);
    mdatPlan.push({ itemId: item.itemId, payload: item.payload });
  }

  // iref: preserve existing relations, add cdsc for a newly created Exif item.
  const refs: IrefEntry[] = layout.irefEntries.map((ref) => ({ ...ref, toIds: [...ref.toIds] }));
  const newExif = pending.find((item) => item.mode === "created" && item.entry.itemType === "Exif");
  if (newExif && !refs.some((ref) => ref.fromId === newExif.itemId && ref.refType === "cdsc")) {
    refs.push({ fromId: newExif.itemId, refType: "cdsc", toIds: [layout.pitmTarget] });
  }
  const rebuiltIref = refs.length > 0 ? encodeIref(refs) : null;

  const placeholderIloc = encodeIloc(mdatPlan.map((p) => ({ itemId: p.itemId, offset: 0, length: p.payload.length })));
  const metaChildrenParts: { type: string; bytes: Uint8Array }[] = [];
  for (const child of layout.children) {
    if (child.type === "iloc") metaChildrenParts.push({ type: "iloc", bytes: placeholderIloc });
    else if (child.type === "iinf") metaChildrenParts.push({ type: "iinf", bytes: encodeIinf(entries) });
    else if (child.type === "iref") {
      if (rebuiltIref) metaChildrenParts.push({ type: "iref", bytes: rebuiltIref });
    } else {
      metaChildrenParts.push({
        type: child.type,
        bytes: layout.meta.payload.slice(child.start, child.start + child.size),
      });
    }
  }
  const metaSizeWithPlaceholder = 8 + 4 + metaChildrenParts.reduce((sum, part) => sum + part.bytes.length, 0);
  const mdatIndex = layout.topLevel.findIndex((box) => box.type === "mdat");
  let prefixSize = 0;
  layout.topLevel.forEach((box, index) => {
    if (index >= mdatIndex) return;
    prefixSize += box.type === "meta" ? metaSizeWithPlaceholder : box.size;
  });
  let cursor = prefixSize + 8;
  const finalIlocItems = mdatPlan.map((p) => {
    const item = { itemId: p.itemId, offset: cursor, length: p.payload.length };
    cursor += p.payload.length;
    return item;
  });
  const finalIloc = encodeIloc(finalIlocItems);
  const finalChildren = metaChildrenParts.map((part) => (part.type === "iloc" ? finalIloc : part.bytes));
  const finalMeta = fullBox("meta", fullVersion(layout.meta.payload), 0, concatBytes(finalChildren));
  if (finalMeta.length !== metaSizeWithPlaceholder) {
    return { data: base.slice(), warnings: [...warnings, "Rebuilt meta size drifted; refusing inconsistent output."], detail: { exif: "unsupported", xmp: "unsupported" }, skipped };
  }
  const finalMdat = sizedBox("mdat", concatBytes(mdatPlan.map((p) => p.payload)));
  const outParts: Uint8Array[] = [];
  layout.topLevel.forEach((box, index) => {
    if (index === mdatIndex) {
      outParts.push(finalMdat);
      return;
    }
    if (box.type === "meta") {
      outParts.push(finalMeta);
      return;
    }
    outParts.push(base.slice(box.start, box.start + box.size));
  });
  return { data: concatBytes(outParts), warnings, detail, skipped };
}
