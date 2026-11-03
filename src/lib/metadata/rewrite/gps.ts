import { XMP_NS, type GpsTiffDirective, type TiffWriteValue } from "./codecs";

/**
 * GPS value model (Screen 09 / Phase 7).
 *
 * Pure, dependency-free: decimal↔EXIF-rational conversion, DMS conversion,
 * input validation and hemisphere references. Shared by the writers, the
 * verification layer and the UI so the same guarantees are tested once.
 *
 * EXIF GPS numeric conventions implemented here:
 * - Coordinates are unsigned DDD+MM.mmmm rationals plus a hemisphere ref
 *   (N/S, E/W). The reference carries the sign; stored values are absolute.
 * - Arc-seconds carry 1/10000-second precision (≈3 mm on the ground),
 *   matching widespread writer practice and the repo's own fixtures.
 * - GPSAltitude is a positive rational in meters plus GPSAltitudeRef
 *   (0 = above sea level, 1 = below sea level).
 */

export const GPS_SECONDS_DENOMINATOR = 10000;
/** Verification tolerance: 1e-6 degrees ≈ 0.1 m — far tighter than the
 *  1/10000-arcsecond encoding (≈3 mm) yet immune to float noise. */
export const GPS_VERIFY_TOLERANCE_DEGREES = 1e-6;
export const GPS_VERIFY_TOLERANCE_METERS = 1e-4;

export interface GpsCoordinates {
  /** Signed decimal degrees, −90…+90. */
  latitude: number;
  /** Signed decimal degrees, −180…+180. */
  longitude: number;
  /** Signed meters, or null when not requested (never invented). */
  altitude: number | null;
}

export const GPS_LAT_RANGE = { min: -90, max: 90 } as const;
export const GPS_LON_RANGE = { min: -180, max: 180 } as const;
/** |altitude| far exceeds any recorded point on Earth or in flight. */
export const GPS_ALT_LIMIT = 20000;

export function latRefFor(latitude: number): "N" | "S" {
  return latitude >= 0 ? "N" : "S";
}

export function lonRefFor(longitude: number): "E" | "W" {
  return longitude >= 0 ? "E" : "W";
}

export function altRefFor(altitude: number): 0 | 1 {
  return altitude >= 0 ? 0 : 1;
}

// ------------------------------------------------------------ validation

export type GpsFieldError = string;

/** Strict decimal-degrees parse: optional sign, digits with an optional
 *  fraction, no exponent shortcuts that could hide precision loss. */
export function parseDecimalDegrees(input: string, kind: "lat" | "lon"): { ok: true; value: number } | { ok: false; error: GpsFieldError } {
  const raw = input.trim();
  if (raw === "") return { ok: false, error: kind === "lat" ? "Latitude is required." : "Longitude is required." };
  if (!/^[+-]?\d{1,3}(?:\.\d+)?$/.test(raw)) {
    return { ok: false, error: kind === "lat"
      ? "Latitude must be a decimal number like -34.6037 or 12.345678 (no letters or symbols)."
      : "Longitude must be a decimal number like -58.3816 or 98.765432 (no letters or symbols)." };
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) return { ok: false, error: "Coordinate is not a finite number." };
  const range = kind === "lat" ? GPS_LAT_RANGE : GPS_LON_RANGE;
  if (value < range.min || value > range.max) {
    return { ok: false, error: kind === "lat"
      ? `Latitude must be between −90 and +90 (received ${value}).`
      : `Longitude must be between −180 and +180 (received ${value}).` };
  }
  // Reject values that lose real precision when stored back to text.
  if (Number.isInteger(value) === false && raw.replace(/^[-+]|0+$/g, "").split(".")[1]?.length === 0) {
    return { ok: false, error: "Coordinate ends in a decimal point without digits." };
  }
  return { ok: true, value };
}

/** Optional altitude in signed meters; empty string = not requested. */
export function parseAltitude(input: string): { ok: true; value: number | null } | { ok: false; error: GpsFieldError } {
  const raw = input.trim();
  if (raw === "") return { ok: true, value: null };
  if (!/^[+-]?\d{1,6}(?:\.\d+)?$/.test(raw)) {
    return { ok: false, error: "Altitude must be a number of meters (e.g. 150 or -5); leave empty to skip." };
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) return { ok: false, error: "Altitude is too large to store." };
  if (Math.abs(value) > GPS_ALT_LIMIT) {
    return { ok: false, error: `Altitude must be within ±${GPS_ALT_LIMIT} meters.` };
  }
  return { ok: true, value };
}

export interface GpsFormInput {
  latitude: string;
  longitude: string;
  altitude: string;
}

export interface GpsProposalResult {
  ok: boolean;
  coords: GpsCoordinates | null;
  errors: Partial<Record<keyof GpsFormInput, GpsFieldError>>;
}

/** Validate a full manual-edit form; both coordinates are mandatory. */
export function proposeCoordinates(input: GpsFormInput): GpsProposalResult {
  const lat = parseDecimalDegrees(input.latitude, "lat");
  const lon = parseDecimalDegrees(input.longitude, "lon");
  const alt = parseAltitude(input.altitude);
  const errors: Partial<Record<keyof GpsFormInput, GpsFieldError>> = {};
  if (!lat.ok) errors.latitude = lat.error;
  if (!lon.ok) errors.longitude = lon.error;
  if (!alt.ok) errors.altitude = alt.error;
  const ok = lat.ok && lon.ok && alt.ok;
  return { ok, coords: ok ? { latitude: lat.value, longitude: lon.value, altitude: alt.value } : null, errors };
}

// ------------------------------------------------------------ conversions

export interface GpsDms {
  degrees: number;
  minutes: number;
  /** Seconds rounded to the storage denominator. */
  seconds: number;
  ref: "N" | "S" | "E" | "W";
}

/** Decimal → DMS with carry-safe rounding at the storage denominator. */
export function decimalToDms(decimal: number, kind: "lat" | "lon"): GpsDms {
  const absolute = Math.abs(decimal);
  let degrees = Math.floor(absolute);
  const minuteFloat = (absolute - degrees) * 60;
  let minutes = Math.floor(minuteFloat);
  let seconds = (minuteFloat - minutes) * 60;
  const quantum = 1 / GPS_SECONDS_DENOMINATOR;
  let rounded = Math.round(seconds / quantum) * quantum;
  if (rounded >= 60) {
    rounded -= 60;
    minutes += 1;
    if (minutes >= 60) {
      minutes -= 60;
      degrees += 1;
    }
  }
  seconds = Number(rounded.toFixed(4));
  void kind;
  return {
    degrees,
    minutes,
    seconds,
    ref: kind === "lat" ? latRefFor(decimal) : lonRefFor(decimal),
  };
}

/** DMS → signed decimal, mathematically exact (no rounding of inputs). */
export function dmsToDecimal(dms: GpsDms): number {
  const value = dms.degrees + dms.minutes / 60 + dms.seconds / 3600;
  const negative = dms.ref === "S" || dms.ref === "W";
  return negative ? -value : value;
}

/** Decimal → EXIF rational triple ((deg,1),(min,1),(sec×10000,10000)). */
export function decimalToGpsRationals(decimal: number): Array<[number, number]> {
  const dms = decimalToDms(decimal, "lat");
  return [
    [dms.degrees, 1],
    [dms.minutes, 1],
    [Math.round(dms.seconds * GPS_SECONDS_DENOMINATOR), GPS_SECONDS_DENOMINATOR],
  ];
}

/** EXIF rational triple → signed decimal via the hemisphere ref. */
export function gpsRationalsToDecimal(
  rationals: Array<[number, number]>,
  ref: "N" | "S" | "E" | "W",
): number | null {
  if (rationals.length !== 3) return null;
  const [deg, min, sec] = rationals;
  if (!deg || !min || !sec) return null;
  if (deg[1] === 0 || min[1] === 0 || sec[1] === 0) return null;
  const value = deg[0] / deg[1] + min[0] / min[1] / 60 + sec[0] / sec[1] / 3600;
  if (!Number.isFinite(value)) return null;
  return (ref === "S" || ref === "W") ? -value : value;
}

/** EXIF altitude rational + ref → signed meters (null when unreadable). */
export function gpsAltitudeFromRationals(
  alt: [number, number] | null,
  altRef: 0 | 1 | null,
): number | null {
  if (!alt || alt[1] === 0) return null;
  const meters = alt[0] / alt[1];
  if (!Number.isFinite(meters)) return null;
  return altRef === 1 ? -meters : meters;
}

// ------------------------------------------------------------ tag building

export const GPS_TAG = {
  version: 0,
  latRef: 1,
  lat: 2,
  lonRef: 3,
  lon: 4,
  altRef: 5,
  alt: 6,
} as const;

/**
 * Core GPS IFD tag writes for a coordinate set. GPSVersionId is added only
 * when building a fresh IFD (writer decides); unrelated tags (date stamp,
 * map datum…) are preserved by the codec, never silently dropped.
 *
 * Hemisphere refs are EXIF-spec ASCII ("N"/"S"/"E"/"W" + NUL, type 2): the
 * raw-BYTE variant some tools tolerate drops the sign in strict readers
 * (ExifReader maps only the ASCII form to the hemisphere).
 */
export function gpsTagWrites(coords: GpsCoordinates): TiffWriteValue[] {
  const writes: TiffWriteValue[] = [
    { tag: GPS_TAG.latRef, type: 2, values: [latRefFor(coords.latitude)] },
    { tag: GPS_TAG.lat, type: 5, values: decimalToGpsRationals(coords.latitude) },
    { tag: GPS_TAG.lonRef, type: 2, values: [lonRefFor(coords.longitude)] },
    { tag: GPS_TAG.lon, type: 5, values: decimalToGpsRationals(coords.longitude) },
  ];
  if (coords.altitude !== null) {
    const absolute = Math.abs(coords.altitude);
    const centimeterPrecision = Math.round(absolute * 100);
    writes.push(
      { tag: GPS_TAG.altRef, type: 1, values: [altRefFor(coords.altitude)] },
      { tag: GPS_TAG.alt, type: 5, values: [[centimeterPrecision, 100]] },
    );
  }
  return writes;
}

export const GPS_VERSION_WRITE: TiffWriteValue = { tag: GPS_TAG.version, type: 1, values: [2, 3, 0, 0] };

// ------------------------------------------------------------ XMP locations (removal + verification)

export interface GpsXmpQuery { ns: string; prop: string }

/**
 * Coordinate-bearing XMP locations removed by "Remove GPS location"
 * (Screen 09). GPS writes deliberately touch EXIF only (see limitations),
 * but a removal must also clear the standard XMP mirrors so the removal
 * claim can be verified structurally.
 */
export const GPS_XMP_REMOVAL_QUERIES: GpsXmpQuery[] = [
  { ns: XMP_NS.exif, prop: "GPSLatitude" },
  { ns: XMP_NS.exif, prop: "GPSLongitude" },
  { ns: XMP_NS.exif, prop: "GPSAltitude" },
  { ns: XMP_NS.exif, prop: "GPSDestLatitude" },
  { ns: XMP_NS.exif, prop: "GPSDestLongitude" },
  { ns: XMP_NS.exif, prop: "GPSDestAltitude" },
  { ns: XMP_NS.photoshop, prop: "Latitude" },
  { ns: XMP_NS.photoshop, prop: "Longitude" },
  { ns: XMP_NS.photoshop, prop: "Altitude" },
];

/** Checked after removal; any hit is disclosed as retained location evidence. */
export const GPS_XMP_RETAINED_QUERIES: GpsXmpQuery[] = [
  { ns: XMP_NS.exif, prop: "GPSLatitude" },
  { ns: XMP_NS.exif, prop: "GPSLongitude" },
  { ns: XMP_NS.exif, prop: "GPSAltitude" },
  { ns: XMP_NS.exif, prop: "GPSDestLatitude" },
  { ns: XMP_NS.exif, prop: "GPSDestLongitude" },
  { ns: XMP_NS.photoshop, prop: "Latitude" },
  { ns: XMP_NS.photoshop, prop: "Longitude" },
  { ns: XMP_NS.photoshop, prop: "Altitude" },
  { ns: XMP_NS.iptcExt, prop: "LocationCreated" },
];

/** Stable display (≤8 decimals; no precision invented or hidden). */
export function formatCoordinate(value: number, kind: "lat" | "lon"): string {
  const fixed = value.toFixed(8);
  const trimmed = fixed.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0$/, "");
  void kind;
  return trimmed === "-0" ? "0" : trimmed;
}

export function formatAltitude(value: number): string {
  const fixed = value.toFixed(6);
  const trimmed = fixed.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0$/, "");
  return trimmed === "-0" ? "0" : trimmed;
}

// ------------------------------------------------------------ engine directive

/**
 * The one GPS directive format that travels through the rewrite pipeline
 * (Screen 09). `write` carries validated coordinates; `remove` strips the
 * EXIF GPS IFD and the standard XMP coordinate mirrors. Nothing here is
 * stateful — the same directive feeds every container format.
 */
export interface GpsEngineDirective {
  op: "write" | "remove";
  /** Required for writes; validated by `proposeCoordinates` beforehand. */
  coords?: GpsCoordinates;
}

/** Materialize the EXIF GPS IFD half of the directive. */
export function toTiffDirective(directive: GpsEngineDirective): GpsTiffDirective {
  if (directive.op === "remove") return { op: "remove" };
  if (!directive.coords) throw new Error("GPS write directive without coordinates.");
  return { op: "write", values: gpsTagWrites(directive.coords), version: true };
}
