import type { ProfileField } from "./fields";
import { XMP_NS, type TiffWriteValue, type XmpProperty } from "./codecs";

/**
 * Profile field → standard tag mapping (Phase 6).
 *
 * EXIF: Artist(315), Copyright(33432), DocumentName(269),
 * ImageDescription(270). XMP with standard Seq/Bag/Alt shapes plus
 * CreatorContactInfo/CiUrlWork for the website. IPTC-IIM only where a
 * native dataset exists (JPEG APP13); AVIF/HEIC never carry legacy
 * IPTC-IIM (spec §6.3, docs/05). Contact rides IPTC Contact (2:118) plus
 * XMP dc:contributor; rights owner is XMP xmpRights:Owner (no IIM home).
 */

export interface FieldWritePlan {
  field: ProfileField;
  exif: TiffWriteValue[];
  xmp: XmpProperty[];
  iptc: Array<{ record: number; dataset: number; text: string }>;
}

function seq(ns: string, prefix: string, prop: string, values: string[]): XmpProperty {
  return { ns, prefix, prop, kind: "seq", values };
}

function bag(ns: string, prefix: string, prop: string, values: string[]): XmpProperty {
  return { ns, prefix, prop, kind: "bag", values };
}

function alt(ns: string, prefix: string, prop: string, value: string): XmpProperty {
  return { ns, prefix, prop, kind: "alt", values: [value] };
}

const DC = XMP_NS.dc;

export function planFieldWrite(
  field: ProfileField,
  value: string,
  keywords: string[],
): FieldWritePlan {
  switch (field) {
    case "company":
      return {
        field,
        exif: [],
        xmp: [seq(DC, "dc", "publisher", [value])],
        iptc: [{ record: 2, dataset: 110, text: value }],
      };
    case "creator":
      return {
        field,
        exif: [{ tag: 315, type: 2, values: [value] }],
        xmp: [seq(DC, "dc", "creator", [value])],
        iptc: [{ record: 2, dataset: 80, text: value }],
      };
    case "copyright":
      return {
        field,
        exif: [{ tag: 33432, type: 2, values: [value] }],
        xmp: [alt(DC, "dc", "rights", value)],
        iptc: [{ record: 2, dataset: 116, text: value }],
      };
    case "rightsOwner":
      return {
        field,
        exif: [],
        xmp: [bag(XMP_NS.xmpRights, "xmpRights", "Owner", [value])],
        iptc: [],
      };
    case "website":
      return {
        field,
        exif: [],
        xmp: [{ ns: XMP_NS.iptcCore, prefix: "Iptc4xmpCore", prop: "CreatorContactInfo", kind: "contactUrl", values: [value] }],
        iptc: [],
      };
    case "contact":
      return {
        field,
        exif: [],
        xmp: [bag(DC, "dc", "contributor", [value])],
        iptc: [{ record: 2, dataset: 118, text: value }],
      };
    case "title":
      return {
        field,
        exif: [{ tag: 269, type: 2, values: [value] }],
        xmp: [alt(DC, "dc", "title", value)],
        iptc: [{ record: 2, dataset: 5, text: value }],
      };
    case "description":
      return {
        field,
        exif: [{ tag: 270, type: 2, values: [value] }],
        xmp: [alt(DC, "dc", "description", value)],
        iptc: [{ record: 2, dataset: 120, text: value }],
      };
    case "keywords":
      return {
        field,
        exif: [],
        xmp: keywords.length > 0 ? [bag(DC, "dc", "subject", keywords)] : [],
        iptc: keywords.map((word) => ({ record: 2, dataset: 25, text: word })),
      };
    case "locationName":
      return {
        field,
        exif: [],
        xmp: [{ ns: XMP_NS.iptcCore, prefix: "Iptc4xmpCore", prop: "Location", kind: "simple", values: [value] }],
        iptc: [{ record: 2, dataset: 92, text: value }],
      };
  }
}

/** Fields with no EXIF home stay XMP/IPTC-only (documented, not faked). */
export function exifWritables(): ProfileField[] {
  return ["creator", "copyright", "title", "description"];
}
