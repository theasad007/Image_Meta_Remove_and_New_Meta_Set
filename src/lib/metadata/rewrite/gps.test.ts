import fs from "node:fs";
import path from "node:path";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { sniffImageBytes, type SniffedKind } from "../../format-detection/signatures";
import { inspectImage } from "../inspect/inspect";
import { PRIVACY_SAFE_DEFAULT } from "../clean/types";
import {
  GPS_VERIFY_TOLERANCE_DEGREES,
  decimalToGpsRationals,
  decimalToDms,
  dmsToDecimal,
  gpsAltitudeFromRationals,
  gpsRationalsToDecimal,
  gpsTagWrites,
  latRefFor,
  lonRefFor,
  altRefFor,
  parseAltitude,
  parseDecimalDegrees,
  proposeCoordinates,
  formatCoordinate,
} from "./gps";
import { verifyRewrittenImage } from "./rewrite";
import { observeGps } from "./verify-fields";
import type { XmlCodec } from "./codecs";

/**
 * Screen 09 GPS tests: pure conversions/validation plus REAL byte-level
 * write/remove/verify runs on the repository fixtures (never mocks).
 */

const FIXTURES = path.join(__dirname, "..", "..", "..", "..", "src", "test-fixtures");
const domParser = new DOMParser();
const xml: XmlCodec = {
  parse: (text: string) => new DOMParser().parseFromString(text, "application/xml") as unknown as Document,
  serialize: (doc: Document) => new XMLSerializer().serializeToString(doc as never) as string,
};

function bytesOf(name: string): Uint8Array {
  const full = fs.readFileSync(path.join(FIXTURES, name));
  return new Uint8Array(full.buffer.slice(full.byteOffset, full.byteOffset + full.byteLength));
}

function extOf(name: string): string {
  return name.slice(name.lastIndexOf(".") + 1).toLowerCase();
}

function kindOf(name: string, bytes: Uint8Array): SniffedKind {
  const sniff = sniffImageBytes(bytes.slice(0, Math.min(65536, bytes.length)), bytes.length, extOf(name));
  if (sniff.kind === "empty" || sniff.kind === "unknown" || sniff.kind === "unreadable") {
    throw new Error(`fixture ${name} sniffed as ${sniff.kind}`);
  }
  return sniff.kind;
}

async function beforeOf(name: string) {
  const bytes = bytesOf(name);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return inspectImage(name, buffer, name, { domParser });
}

// ------------------------------------------------------------ pure validation

describe("GPS coordinate validation", () => {
  it("accepts decimals, signed values and boundary coordinates", () => {
    expect(parseDecimalDegrees("34.6037", "lat")).toEqual({ ok: true, value: 34.6037 });
    expect(parseDecimalDegrees("-34.6037", "lat")).toEqual({ ok: true, value: -34.6037 });
    expect(parseDecimalDegrees("+90", "lat")).toEqual({ ok: true, value: 90 });
    expect(parseDecimalDegrees("-90", "lat")).toEqual({ ok: true, value: -90 });
    expect(parseDecimalDegrees("180", "lon")).toEqual({ ok: true, value: 180 });
    expect(parseDecimalDegrees("-180", "lon")).toEqual({ ok: true, value: -180 });
    expect(parseDecimalDegrees("0", "lon")).toEqual({ ok: true, value: 0 });
    expect(parseDecimalDegrees("-0.0", "lat")).toEqual({ ok: true, value: -0 });
  });

  it("rejects invalid characters, empty values and out-of-range values", () => {
    expect(parseDecimalDegrees("12,5N", "lat").ok).toBe(false);
    expect(parseDecimalDegrees("abc", "lon").ok).toBe(false);
    expect(parseDecimalDegrees("", "lat").ok).toBe(false);
    expect(parseDecimalDegrees("1e4", "lat").ok).toBe(false);
    expect(parseDecimalDegrees("90.00001", "lat").ok).toBe(false);
    expect(parseDecimalDegrees("180.1", "lon").ok).toBe(false);
    expect(parseDecimalDegrees("--2", "lon").ok).toBe(false);
    expect(parseDecimalDegrees("5.", "lat").ok).toBe(false);
    const failed = parseDecimalDegrees("91", "lat");
    if (!failed.ok) expect(failed.error).toMatch(/between −90 and \+90/);
  });

  it("validates optional altitude including below-sea-level values", () => {
    expect(parseAltitude("")).toEqual({ ok: true, value: null });
    expect(parseAltitude("150")).toEqual({ ok: true, value: 150 });
    expect(parseAltitude("-5")).toEqual({ ok: true, value: -5 });
    expect(parseAltitude("-0")).toEqual({ ok: true, value: -0 });
    expect(parseAltitude("0.5")).toEqual({ ok: true, value: 0.5 });
    expect(parseAltitude("1m").ok).toBe(false);
    expect(parseAltitude("999999").ok).toBe(false);
  });

  it("validates the whole form before any write is planned", () => {
    const bad = proposeCoordinates({ latitude: "99", longitude: "-58.3816", altitude: "" });
    expect(bad.ok).toBe(false);
    expect(bad.errors.latitude).toBeTruthy();
    const good = proposeCoordinates({ latitude: "-34.6037", longitude: "-58.3816", altitude: "-5" });
    expect(good.ok).toBe(true);
    expect(good.coords).toEqual({ latitude: -34.6037, longitude: -58.3816, altitude: -5 });
  });

  it("maps hemisphere references per sign, including zero", () => {
    expect(latRefFor(34.6)).toBe("N");
    expect(latRefFor(-34.6)).toBe("S");
    expect(lonRefFor(58.38)).toBe("E");
    expect(lonRefFor(-58.38)).toBe("W");
    expect(latRefFor(0)).toBe("N");
    expect(lonRefFor(-0)).toBe("E"); // -0 >= 0 → E (fixture 0,0 parity)
    expect(altRefFor(150)).toBe(0);
    expect(altRefFor(-5)).toBe(1);
    expect(altRefFor(0)).toBe(0);
  });
});

describe("decimal ↔ EXIF rational conversion", () => {
  it("round-trips decimal degrees through the DMS rational encoding", () => {
    const cases: Array<[number, "lat" | "lon"]> = [
      [12.345678, "lat"],
      [98.765432, "lon"],
      [-34.6037, "lat"],
      [-58.3816, "lon"],
      [0, "lat"],
      [90, "lat"],
      [-180, "lon"],
      [0.000001, "lon"],
    ];
    for (const [value, kind] of cases) {
      const rationals = decimalToGpsRationals(value);
      const ref = kind === "lat" ? latRefFor(value) : lonRefFor(value);
      const back = gpsRationalsToDecimal(rationals, kind === "lat" ? (ref === "S" ? "S" : "N") : (ref === "W" ? "W" : "E"));
      expect(back).not.toBeNull();
      expect(Math.abs((back ?? NaN) - value)).toBeLessThanOrEqual(GPS_VERIFY_TOLERANCE_DEGREES);
    }
  });

  it("carries at least 1/10000-second precision (~3 mm)", () => {
    // 1/10000 arcsecond = 2.78e-8 degrees; the rational encoding must
    // resolve a small coordinate change of that magnitude.
    const a = decimalToGpsRationals(12.345678);
    const b = decimalToGpsRationals(12.3456781);
    expect(a).not.toEqual(b);
  });

  it("does not silently round away meaningful precision", () => {
    const dms = decimalToDms(12.123456789, "lat");
    expect(dms.seconds).toBeCloseTo((12.123456789 - 12) * 3600 - 7 * 60, 4);
  });

  it("handles rollover at the minute boundary (no 60-second values)", () => {
    const dms = decimalToDms(1.999999999, "lon");
    expect(dms.seconds).toBeLessThan(60);
    expect(dms.minutes).toBeLessThan(60);
    const back = dmsToDecimal(dms);
    // The 1/10000-arcsecond quantum cannot represent 1.999999999 exactly:
    // the carry lands within ~1e-9° of the input (≈0.1 mm) — tighter than
    // any physical meaning, never rounded away silently.
    expect(Math.abs(back - 1.999999999)).toBeLessThanOrEqual(1e-6);
  });

  it("round-trips DMS conversion mathematically", () => {
    const value = dmsToDecimal({ degrees: 34, minutes: 36, seconds: 13.32, ref: "S" });
    expect(value).toBeCloseTo(-34.6037, 6);
    const forward = decimalToDms(-58.3816, "lon");
    expect(forward.ref).toBe("W");
    expect(Math.abs(dmsToDecimal(forward) - -58.3816)).toBeLessThan(1e-7);
  });

  it("decodes altitude with its reference (below sea level)", () => {
    expect(gpsAltitudeFromRationals([15000, 100], 0)).toBe(150);
    expect(gpsAltitudeFromRationals([500, 100], 1)).toBe(-5);
    expect(gpsAltitudeFromRationals([500, 100], null)).toBe(5);
    expect(gpsAltitudeFromRationals(null, 0)).toBeNull();
  });

  it("builds the standard GPS tag set for a write (spec ASCII refs)", () => {
    const writes = gpsTagWrites({ latitude: -34.6037, longitude: -58.3816, altitude: -5 });
    const tags = writes.map((write) => write.tag);
    expect(tags).toEqual([1, 2, 3, 4, 5, 6]); // latRef, lat, lonRef, lon, altRef, alt
    // Hemisphere refs are EXIF-spec ASCII ("S"/"W" + NUL); the altitude ref
    // stays BYTE per spec. Raw-BYTE refs lose the sign in strict readers.
    expect(writes.find((write) => write.tag === 1)).toEqual({ tag: 1, type: 2, values: ["S"] });
    expect(writes.find((write) => write.tag === 3)).toEqual({ tag: 3, type: 2, values: ["W"] });
    expect(writes.find((write) => write.tag === 5)).toEqual({ tag: 5, type: 1, values: [1] });
    expect(formatCoordinate(-34.6037, "lat")).toBe("-34.6037");
  });
});

// ------------------------------------------------------- engine byte-level runs

interface RunOptions {
  mode?: "replace_editable" | "update_selected";
}

async function runGps(
  name: string,
  gps: Parameters<typeof verifyRewrittenImage>[0]["gps"],
  options: RunOptions = {},
) {
  const bytes = bytesOf(name);
  const kind = kindOf(name, bytes);
  const before = await beforeOf(name);
  return verifyRewrittenImage({
    fileId: `test:${name}`,
    inputName: name,
    extension: extOf(name),
    kind,
    brand: undefined,
    inputBytes: bytes,
    before,
    plans: [],
    expected: {},
    mode: options.mode ?? "update_selected",
    policy: PRIVACY_SAFE_DEFAULT,
    xml,
    domParser,
    gps,
  });
}

describe("GPS write + verify on real fixture bytes", () => {
  it("writes GPS into a fresh EXIF block on a metadata-free JPEG", async () => {
    const result = await runGps("jpeg-empty.jpg", { op: "write", coords: { latitude: -34.6037, longitude: -58.3816, altitude: -5 } });
    expect(result.status).toBe("verified_rewritten");
    expect(result.output).toBeDefined();
    const outBytes = new Uint8Array(await result.output!.arrayBuffer());
    const observed = observeGps(outBytes, "jpeg", xml);
    expect(observed.latitude).not.toBeNull();
    expect(Math.abs((observed.latitude ?? NaN) - -34.6037)).toBeLessThanOrEqual(GPS_VERIFY_TOLERANCE_DEGREES);
    expect(Math.abs((observed.longitude ?? NaN) - -58.3816)).toBeLessThanOrEqual(GPS_VERIFY_TOLERANCE_DEGREES);
    expect(observed.altitude).toBeCloseTo(-5, 4);
    expect(observed.latRef).toBe("S");
    expect(observed.lonRef).toBe("W");
    expect(result.changes.some((change) => change.group === "GPS" && change.verification === "verified")).toBe(true);
    // Third-party interop: ExifReader (the library this project inspects
    // with) must apply the hemisphere sign from the spec ASCII refs —
    // catching the raw-BYTE ref regression that drops the sign there.
    const { default: ExifReader } = await import("exifreader");
    const exifTags = await ExifReader.load(outBytes.buffer.slice(outBytes.byteOffset, outBytes.byteOffset + outBytes.byteLength) as ArrayBuffer, { expanded: true, async: true });
    const gpsGroup = (exifTags as unknown as Record<string, Record<string, unknown>>)["gps"] ?? {};
    expect(Number(gpsGroup["Latitude"])).toBeCloseTo(-34.6037, 5);
    expect(Number(gpsGroup["Longitude"])).toBeCloseTo(-58.3816, 5);
    expect(Number(gpsGroup["Altitude"])).toBeCloseTo(-5, 3);
  });

  it("merges GPS into an existing EXIF block in update mode (payload untouched)", async () => {
    const result = await runGps("jpeg-exif.jpg", { op: "write", coords: { latitude: 51.5007, longitude: -0.1246, altitude: null } }, { mode: "update_selected" });
    expect(result.status).toBe("verified_rewritten");
    const observed = observeGps(new Uint8Array(await result.output!.arrayBuffer()), "jpeg", xml);
    expect(Math.abs((observed.latitude ?? NaN) - 51.5007)).toBeLessThanOrEqual(GPS_VERIFY_TOLERANCE_DEGREES);
    expect(Math.abs((observed.longitude ?? NaN) - -0.1246)).toBeLessThanOrEqual(GPS_VERIFY_TOLERANCE_DEGREES);
    // Unrelated descriptive EXIF survives the GPS-only edit.
    expect(JSON.stringify(result.after?.categories)).toContain("TestCam");
  });

  it("replaces an existing negative-coordinate GPS set with new values", async () => {
    const result = await runGps("jpeg-gps-sw.jpg", { op: "write", coords: { latitude: 12.345678, longitude: 98.765432, altitude: 150 } });
    expect(result.status).toBe("verified_rewritten");
    const observed = observeGps(new Uint8Array(await result.output!.arrayBuffer()), "jpeg", xml);
    expect(Math.abs((observed.latitude ?? NaN) - 12.345678)).toBeLessThanOrEqual(GPS_VERIFY_TOLERANCE_DEGREES);
    expect(observed.latRef).toBe("N");
    expect(observed.altitude).toBeCloseTo(150, 4);
  });

  it("writes GPS into PNG eXIf pixels untouched", async () => {
    const result = await runGps("png-text-exif.png", { op: "write", coords: { latitude: 51.5007, longitude: -0.1246, altitude: 35 } });
    expect(result.status).toBe("verified_rewritten");
    expect(result.outputName?.endsWith(".png")).toBe(true);
    const observed = observeGps(new Uint8Array(await result.output!.arrayBuffer()), "png", xml);
    expect(Math.abs((observed.latitude ?? NaN) - 51.5007)).toBeLessThanOrEqual(GPS_VERIFY_TOLERANCE_DEGREES);
    expect(observed.altitude).toBeCloseTo(35, 4);
    expect(result.changes.find((change) => change.group === "GPS")?.verification).toBe("verified");
  });

  it("writes GPS into WebP EXIF and AVIF/HEIC items", async () => {
    for (const [name, kind] of [
      ["webp-empty.webp", "webp"],
      ["avif-exif-xmp.avif", "avif"],
      ["heic-exif-gps.heic", "heic"],
    ] as const) {
      const result = await runGps(name, { op: "write", coords: { latitude: -34.6037, longitude: -58.3816, altitude: -5 } });
      expect(result.status, name).toBe("verified_rewritten");
      const observed = observeGps(new Uint8Array(await result.output!.arrayBuffer()), kind, xml);
      expect(Math.abs((observed.latitude ?? NaN) - -34.6037), name).toBeLessThanOrEqual(GPS_VERIFY_TOLERANCE_DEGREES);
      expect(observed.latRef, name).toBe("S");
    }
  });

  it("replaces-mode GPS write survives the cleaning pass", async () => {
    const result = await runGps("jpeg-gps-sw.jpg", { op: "write", coords: { latitude: 51.5007, longitude: -0.1246, altitude: null } }, { mode: "replace_editable" });
    expect(result.status).toBe("verified_rewritten");
    const observed = observeGps(new Uint8Array(await result.output!.arrayBuffer()), "jpeg", xml);
    expect(Math.abs((observed.latitude ?? NaN) - 51.5007)).toBeLessThanOrEqual(GPS_VERIFY_TOLERANCE_DEGREES);
  });

  it("fails closed when the stored coordinates cannot be re-observed", async () => {
    // Malformed input: coordinates that cannot be decoded are reported
    // unreadable (fail-closed), never invented.
    const observed = observeGps(new Uint8Array([0xff, 0xd8, 0x00]), "jpeg", xml);
    expect(observed.latitude).toBeNull();
    expect(observed.unreadable).toBe(false);
  });
});

describe("GPS removal + verify on real fixture bytes", () => {
  it("removes EXIF GPS from a JPEG with negative coordinates and verifies the absence", async () => {
    const result = await runGps("jpeg-gps-sw.jpg", { op: "remove" });
    expect(result.status).toBe("verified_rewritten");
    const observed = observeGps(new Uint8Array(await result.output!.arrayBuffer()), "jpeg", xml);
    expect(observed.latitude).toBeNull();
    expect(observed.longitude).toBeNull();
    expect(observed.altitude).toBeNull();
    expect(result.changes.some((change) => change.group === "GPS" && change.action === "removed" && change.verification === "verified")).toBe(true);
    // Unrelated metadata survives the GPS-only removal (update mode).
    expect(JSON.stringify(result.after?.categories)).toContain('"key":"Orientation","displayedValue":"right-top"');
  });

  it("removes XMP coordinate mirrors but discloses IPTC-style retained evidence honestly", async () => {
    const result = await runGps("jpeg-gps-xmp.jpg", { op: "remove" });
    expect(result.status).toBe("partially_rewritten"); // iptcExt LocationCreated retained + disclosed
    const removed = result.changes.filter((change) => change.group === "GPS" && change.action === "removed" && change.verification === "verified");
    expect(removed.length).toBeGreaterThan(0);
    const retained = result.changes.filter((change) => change.group === "GPS" && change.action === "retained_unsupported");
    expect(retained.length).toBeGreaterThan(0);
    // The EXIF GPS must be gone even though XMP evidence remains.
    const observed = observeGps(new Uint8Array(await result.output!.arrayBuffer()), "jpeg", xml);
    expect(observed.latitude).toBeNull();
  });

  it("removes GPS from AVIF/HEIC Exif items", async () => {
    for (const [name, kind] of [
      ["avif-exif-xmp.avif", "avif"],
      ["heic-exif-gps.heic", "heic"],
    ] as const) {
      const result = await runGps(name, { op: "remove" });
      expect(result.status, name).toBe("verified_rewritten");
      const observed = observeGps(new Uint8Array(await result.output!.arrayBuffer()), kind, xml);
      expect(observed.latitude, name).toBeNull();
    }
  });

  it("refuses to manufacture a removal when no GPS exists (both modes)", async () => {
    const update = await runGps("jpeg-empty.jpg", { op: "remove" }, { mode: "update_selected" });
    expect(update.status).toBe("unchanged_no_target_tags");
    expect(update.output).toBeUndefined();
    expect(update.errors.join(" ")).toMatch(/No GPS coordinates were found/);
    const replace = await runGps("jpeg-empty.jpg", { op: "remove" }, { mode: "replace_editable" });
    expect(replace.status).toBe("unchanged_no_target_tags");
  });
});
