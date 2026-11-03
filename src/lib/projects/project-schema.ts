import { GPS_ALT_LIMIT } from "../metadata/rewrite/gps";

/**
 * Premium multi-project schema (Phase 04) — pure validation layer, mirror
 * of the firestore.rules `validProject` validator.
 *
 * A project is a named metadata PRESET. `projectTitle` names the saved
 * project itself; `imageTitle` is the title written INTO an image. They
 * are different fields and are never conflated. Coordinates are only what
 * the user typed — never auto-geocoded, never extracted from media.
 */

export const PROJECT_SCHEMA_VERSION = 1;

export const PROJECT_TEXT_FIELDS = [
  "companyPublisher",
  "creatorAuthor",
  "copyrightNotice",
  "rightsOwner",
  "websiteUrl",
  "contactInformation",
  "imageTitle",
  "imageDescription",
  "locationName",
] as const;

export type ProjectTextField = (typeof PROJECT_TEXT_FIELDS)[number];

/** Text ceilings mirror the existing profile editor (roadmap §04). */
export const PROJECT_TEXT_LIMITS: Record<ProjectTextField, number> = {
  companyPublisher: 120,
  creatorAuthor: 120,
  copyrightNotice: 300,
  rightsOwner: 120,
  websiteUrl: 200,
  contactInformation: 200,
  imageTitle: 200,
  imageDescription: 2000,
  locationName: 200,
};

export const PROJECT_MAX_KEYWORDS = 30;
export const PROJECT_MAX_KEYWORD_LENGTH = 60;
export const PROJECT_MAX_TITLE = 120;
export const PROJECT_MAX_CLIENT_NAME = 120;

/** SOL-004: keywords are STORED as one packed string (items joined with
 *  \u0001), mirroring the approved profile schema (`keywords` string +
 *  derived list). Firestore rules validate the packed form with a single
 *  RE2 regex — per-item 1–60 printable chars, ≤30 items — inside the
 *  rules evaluation budget (the previous 30-OR-clause list validator
 *  exceeded the 1000-expression limit; proven in the emulator). */
export const PROJECT_KEYWORD_SEPARATOR = "\u0001";
/** 30 × 60 chars + 29 separators. */
export const PROJECT_MAX_KEYWORDS_PACKED = PROJECT_MAX_KEYWORDS * PROJECT_MAX_KEYWORD_LENGTH + (PROJECT_MAX_KEYWORDS - 1);

export function packKeywords(list: readonly string[]): string {
  return list.join(PROJECT_KEYWORD_SEPARATOR);
}

export function unpackKeywords(packed: string): string[] {
  if (packed === "") return [];
  return packed.split(PROJECT_KEYWORD_SEPARATOR);
}

/** SOL-006: empty or an absolute http(s) URL with a dotted host — no
 *  other schemes, no ports/userinfo, no control characters. */
export function isValidProjectWebsiteUrl(value: string): boolean {
  if (value === "") return true;
  if (value.length > PROJECT_TEXT_LIMITS.websiteUrl) return false;
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  if (!/^https?:\/\//i.test(value)) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.username !== "" || parsed.password !== "") return false;
  if (parsed.port !== "") return false;
  // Dotted host requirement — mirrors the rules regex exactly.
  if (!/^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$/.test(parsed.hostname)) return false;
  return true;
}

/** Pure: exact stored-website acceptance (mirrors firestore.rules). */
export function validWebsiteUrlForRules(value: unknown): boolean {
  return typeof value === "string" && isValidProjectWebsiteUrl(value);
}

/** SOL-005: deterministic normalized-title key for atomic uniqueness.
 *  The UTF-8 hex encoding is collision-free for the normalized title and is
 *  independently checkable as a Firestore document-id-safe value. */
export function normalizeProjectTitle(title: string): string {
  // Keep this deliberately limited to operations Firestore Rules can
  // reproduce independently at the security boundary.
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

export function projectTitleKey(title: string): string {
  const normalized = normalizeProjectTitle(title);
  return Array.from(new TextEncoder().encode(normalized), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface ProjectMetadata {
  companyPublisher: string;
  creatorAuthor: string;
  copyrightNotice: string;
  rightsOwner: string;
  websiteUrl: string;
  contactInformation: string;
  imageTitle: string;
  imageDescription: string;
  keywords: string[];
  locationName: string;
  /** Decimal degrees or null (unset ≠ explicit remove — a write of null
   *  means "no GPS in this project", never "wipe image GPS"). */
  latitude: number | null;
  longitude: number | null;
  altitudeMeters: number | null;
}

export interface ProjectRecord extends ProjectMetadata {
  projectId: string;
  projectTitle: string;
  titleKey?: string;
  clientName: string;
  schemaVersion: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export type ProjectDraft = Omit<ProjectRecord, "projectId" | "schemaVersion" | "createdAt" | "updatedAt" | "titleKey">;

export function blankProjectDraft(): ProjectDraft {
  return {
    projectTitle: "",
    clientName: "",
    companyPublisher: "",
    creatorAuthor: "",
    copyrightNotice: "",
    rightsOwner: "",
    websiteUrl: "",
    contactInformation: "",
    imageTitle: "",
    imageDescription: "",
    keywords: [],
    locationName: "",
    latitude: null,
    longitude: null,
    altitudeMeters: null,
  };
}

export function validateProjectDraft(input: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof input !== "object" || input === null) {
    return { ok: false, errors: ["Project must be an object."] };
  }
  const record = input as Record<string, unknown>;

  // Strict allowlist — mirrors the rules' hasOnly and blocks media-shaped
  // or privilege-shaped fields at the client boundary too.
  const allowed = new Set([
    "projectTitle", "clientName",
    ...PROJECT_TEXT_FIELDS,
    "keywords", "latitude", "longitude", "altitudeMeters",
    "schemaVersion", "createdAt", "updatedAt",
  ]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      errors.push(`Unexpected field: ${key}.`);
    }
  }

  if (typeof record.projectTitle !== "string" || record.projectTitle.trim() === "" || record.projectTitle.length > PROJECT_MAX_TITLE) {
    errors.push(`Project title is required (≤${PROJECT_MAX_TITLE} characters).`);
  }
  if (record.clientName !== undefined && (typeof record.clientName !== "string" || record.clientName.length > PROJECT_MAX_CLIENT_NAME)) {
    errors.push(`Client name must be a string (≤${PROJECT_MAX_CLIENT_NAME}).`);
  }

  for (const field of PROJECT_TEXT_FIELDS) {
    const value = record[field];
    const max = PROJECT_TEXT_LIMITS[field];
    if (typeof value !== "string" || value.length > max) {
      errors.push(`${field} must be a string (≤${max} characters).`);
    }
  }
  // SOL-006: website scheme contract (TS side of the TS+rules agreement).
  if (typeof record.websiteUrl === "string" && !isValidProjectWebsiteUrl(record.websiteUrl)) {
    errors.push("websiteUrl must be empty or an absolute http(s) URL with a host like example.com.");
  }

  const keywords = record.keywords;
  if (!Array.isArray(keywords) || keywords.length > PROJECT_MAX_KEYWORDS) {
    errors.push(`keywords must be an array of at most ${PROJECT_MAX_KEYWORDS} entries.`);
  } else {
    for (const keyword of keywords) {
      if (typeof keyword !== "string" || keyword.length === 0 || keyword.length > PROJECT_MAX_KEYWORD_LENGTH || /[\u0000-\u001f\u007f]/.test(keyword)) {
        errors.push(`Each keyword must be a non-empty control-character-free string (≤${PROJECT_MAX_KEYWORD_LENGTH}).`);
        break;
      }
    }
  }

  for (const [field, range] of [["latitude", { min: -90, max: 90 }], ["longitude", { min: -180, max: 180 }]] as const) {
    const value = record[field];
    if (value !== null && value !== undefined) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < range.min || value > range.max) {
        errors.push(`${field} must be null or a decimal degree within ${range.min}…${range.max}.`);
      }
    }
  }
  const altitude = record.altitudeMeters;
  if (altitude !== null && altitude !== undefined) {
    if (typeof altitude !== "number" || !Number.isFinite(altitude) || Math.abs(altitude) > GPS_ALT_LIMIT) {
      errors.push(`altitudeMeters must be null or a finite value within ±${GPS_ALT_LIMIT} m.`);
    }
  }

  // SOL-015: coordinates are a PAIR — both present or both absent — and
  // altitude without the pair is rejected. Zero coordinates stay valid.
  const lat = record.latitude ?? null;
  const lon = record.longitude ?? null;
  if ((lat === null) !== (lon === null)) {
    errors.push("Latitude and longitude must be provided together (or both left empty).");
  }
  if (record.altitudeMeters !== null && record.altitudeMeters !== undefined && lat === null) {
    errors.push("Altitude requires latitude and longitude — remove the altitude or add both coordinates.");
  }

  return { ok: errors.length === 0, errors };
}

/** Pure: parse + normalize a draft from UI state (trims, dedupes keywords). */
export function normalizeProjectDraft(input: ProjectDraft): ProjectDraft {
  const keywords: string[] = [];
  const seen = new Set<string>();
  for (const keyword of Array.isArray(input.keywords) ? input.keywords : []) {
    if (typeof keyword !== "string") continue;
    const trimmed = keyword.trim().slice(0, PROJECT_MAX_KEYWORD_LENGTH);
    const key = trimmed.toLowerCase();
    if (trimmed === "" || seen.has(key)) continue;
    seen.add(key);
    keywords.push(trimmed);
    if (keywords.length >= PROJECT_MAX_KEYWORDS) break;
  }
  return {
    ...input,
    projectTitle: input.projectTitle.trim().slice(0, PROJECT_MAX_TITLE),
    clientName: input.clientName.trim().slice(0, PROJECT_MAX_CLIENT_NAME),
    // SOL-006: surrounding whitespace is trimmed before persistence.
    websiteUrl: input.websiteUrl.trim().slice(0, PROJECT_TEXT_LIMITS.websiteUrl),
    keywords,
    latitude: input.latitude !== null && Number.isFinite(input.latitude) ? input.latitude : null,
    longitude: input.longitude !== null && Number.isFinite(input.longitude) ? input.longitude : null,
    altitudeMeters: input.altitudeMeters !== null && Number.isFinite(input.altitudeMeters) ? input.altitudeMeters : null,
  };
}

/** Pure: is a project completely empty (no values at all)? */
export function isProjectEmpty(project: ProjectDraft): boolean {
  const draft = normalizeProjectDraft(project);
  if (draft.projectTitle !== "") return false;
  if (draft.clientName !== "") return false;
  for (const field of PROJECT_TEXT_FIELDS) {
    if (draft[field] !== "") return false;
  }
  return draft.keywords.length === 0
    && draft.latitude === null
    && draft.longitude === null
    && draft.altitudeMeters === null;
}

/** Map a project onto the existing image MetadataProfile shape (Phase 05). */
export function projectToProfile(project: ProjectRecord): {
  company: string;
  creator: string;
  copyright: string;
  rightsOwner: string;
  website: string;
  contact: string;
  title: string;
  description: string;
  keywords: string;
  keywordsList: string[];
  locationName: string;
} {
  return {
    company: project.companyPublisher,
    creator: project.creatorAuthor,
    copyright: project.copyrightNotice,
    rightsOwner: project.rightsOwner,
    website: project.websiteUrl,
    contact: project.contactInformation,
    title: project.imageTitle,
    description: project.imageDescription,
    keywords: project.keywords.join(", "),
    keywordsList: project.keywords,
    locationName: project.locationName,
  };
}
