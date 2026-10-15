import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import {
  buildApp13,
  buildTiff,
  buildXmpPacket,
  mergeXmpPacket,
  parseApp13,
  parseTiff,
  readXmpProperties,
  XMP_NS,
  type XmlCodec,
} from "./codecs";

const xml: XmlCodec = {
  parse: (text: string) => new DOMParser().parseFromString(text, "application/xml") as unknown as Document,
  serialize: (doc: Document) => new XMLSerializer().serializeToString(doc as never) as string,
};

function asciiBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("TIFF builder and merger", () => {
  it("builds a fresh little-endian IFD0 that re-parses", () => {
    const tiff = buildTiff(null, [
      { tag: 271, type: 2, values: ["TestCam"] },
      { tag: 33432, type: 2, values: ["© 2026 Acme — test"] },
      { tag: 274, type: 3, values: [6] },
    ]);
    expect(tiff).not.toBeNull();
    const parsed = parseTiff(tiff as Uint8Array);
    expect(parsed?.little).toBe(true);
    const byTag = new Map((parsed?.entries ?? []).map((e) => [e.tag, e]));
    expect(new TextDecoder().decode(byTag.get(271)?.value)).toBe("TestCam\x00");
    expect(byTag.get(274)?.value).toEqual(new Uint8Array([6, 0]));
  });
  it("merges new tags while preserving unknown tags byte-identical", () => {
    const base = buildTiff(null, [
      { tag: 271, type: 2, values: ["OldCam"] },
      { tag: 42036, type: 2, values: ["Lens 50mm"] },
      { tag: 9999, type: 7, values: [1, 2, 3, 4, 5, 6] },
    ]) as Uint8Array;
    const parsed = parseTiff(base);
    expect(parsed).not.toBeNull();
    const merged = buildTiff(parsed, [{ tag: 270, type: 2, values: ["New description"] }]);
    expect(merged).not.toBeNull();
    const again = parseTiff(merged as Uint8Array);
    const byTag = new Map((again?.entries ?? []).map((e) => [e.tag, e]));
    expect(new TextDecoder().decode(byTag.get(270)?.value)).toBe("New description\x00");
    expect(new TextDecoder().decode(byTag.get(271)?.value)).toBe("OldCam\x00");
    expect(byTag.get(9999)?.value).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
  });
  it("overwrites an existing tag and keeps sibling values", () => {
    const base = buildTiff(null, [
      { tag: 271, type: 2, values: ["OldCam"] },
      { tag: 270, type: 2, values: ["Old description"] },
    ]) as Uint8Array;
    const merged = buildTiff(parseTiff(base), [{ tag: 271, type: 2, values: ["NewCam with a much longer value here"] }]);
    const byTag = new Map((parseTiff(merged as Uint8Array)?.entries ?? []).map((e) => [e.tag, e]));
    expect(new TextDecoder().decode(byTag.get(271)?.value)).toBe("NewCam with a much longer value here\x00");
    expect(new TextDecoder().decode(byTag.get(270)?.value)).toBe("Old description\x00");
  });
  it("rejects malformed TIFF input instead of guessing", () => {
    expect(parseTiff(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(parseTiff(asciiBytes("NOTATIFF"))).toBeNull();
  });
});

describe("XMP packet builder, merger and reader", () => {
  it("builds namespace-valid packets with Seq/Bag/Alt shapes", () => {
    const packet = buildXmpPacket([
      { ns: XMP_NS.dc, prefix: "dc", prop: "creator", kind: "seq", values: ["A. Photographer"] },
      { ns: XMP_NS.dc, prefix: "dc", prop: "subject", kind: "bag", values: ["harbor", "noon"] },
      { ns: XMP_NS.dc, prefix: "dc", prop: "title", kind: "alt", values: ["Harbor <noon> & dusk"] },
    ]);
    const text = new TextDecoder().decode(packet);
    expect(text).toContain("<dc:creator><rdf:Seq>");
    expect(text).toContain("Harbor &lt;noon&gt; &amp; dusk");
    const read = readXmpProperties(
      text,
      [
        { ns: XMP_NS.dc, prop: "creator" },
        { ns: XMP_NS.dc, prop: "subject" },
        { ns: XMP_NS.dc, prop: "title" },
      ],
      xml,
    );
    expect(read.get(`${XMP_NS.dc}#creator`)).toEqual(["A. Photographer"]);
    expect(read.get(`${XMP_NS.dc}#subject`)).toEqual(["harbor", "noon"]);
    expect(read.get(`${XMP_NS.dc}#title`)).toEqual(["Harbor <noon> & dusk"]);
  });
  it("merges into existing packets without duplicating or dropping siblings", () => {
    const original = new TextDecoder().decode(
      buildXmpPacket([
        { ns: XMP_NS.dc, prefix: "dc", prop: "creator", kind: "seq", values: ["Old Creator"] },
        { ns: XMP_NS.photoshop, prefix: "photoshop", prop: "Credit", kind: "simple", values: ["Old Studio"] },
      ]),
    );
    const merged = mergeXmpPacket(
      original,
      [{ ns: XMP_NS.dc, prefix: "dc", prop: "creator", kind: "seq", values: ["New Creator"] }],
      xml,
    );
    expect(merged).not.toBeNull();
    const read = readXmpProperties(
      merged as string,
      [
        { ns: XMP_NS.dc, prop: "creator" },
        { ns: XMP_NS.photoshop, prop: "Credit" },
      ],
      xml,
    );
    expect(read.get(`${XMP_NS.dc}#creator`)).toEqual(["New Creator"]);
    expect(read.get(`${XMP_NS.photoshop}#Credit`)).toEqual(["Old Studio"]);
    expect((merged as string).match(/<dc:creator>/g)?.length).toBe(1);
  });
  it("returns null for unparseable packets (caller must partial, not invent)", () => {
    expect(mergeXmpPacket("not xml at all <<<", [], xml)).toBeNull();
  });
});

describe("IPTC APP13 parse and rebuild", () => {
  it("round-trips datasets and preserves foreign IRBs", () => {
    const foreign = new Uint8Array([0x38, 0x42, 0x49, 0x4d, 0x04, 0x0b, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0xaa, 0xbb]);
    const payload = buildApp13([foreign], [
      { record: 2, dataset: 80, data: asciiBytes("Old Creator") },
      { record: 2, dataset: 25, data: asciiBytes("harbor") },
      { record: 2, dataset: 25, data: asciiBytes("noon") },
    ]);
    const parsed = parseApp13(payload);
    expect(parsed.kept).toHaveLength(1);
    expect(parsed.iptc.map((d) => [d.record, d.dataset])).toEqual([[2, 80], [2, 25], [2, 25]]);
    const rebuilt = buildApp13(parsed.kept, [
      ...parsed.iptc.filter((d) => !(d.record === 2 && d.dataset === 80)),
      { record: 2, dataset: 80, data: asciiBytes("New Creator") },
    ]);
    const again = parseApp13(rebuilt);
    expect(again.kept).toHaveLength(1);
    expect(new TextDecoder().decode(again.iptc.find((d) => d.dataset === 80)?.data)).toBe("New Creator");
    expect(again.iptc.filter((d) => d.dataset === 25)).toHaveLength(2);
  });
  it("yields no datasets (not an error) for non-Photoshop payloads", () => {
    expect(parseApp13(asciiBytes("nothing here")).iptc).toHaveLength(0);
  });
});
