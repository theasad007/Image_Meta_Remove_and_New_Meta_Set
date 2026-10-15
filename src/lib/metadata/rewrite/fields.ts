/**
 * Saved-profile field model (Phase 6): keys, limits, validation.
 *
 * Length/type ceilings here MUST match `firestore.rules`. Firestore CRUD
 * lives in `../firebase/profile`; writers consume the validated shape.
 */
export const PROFILE_SCHEMA_VERSION = 1;

export const PROFILE_FIELDS = [
  "company",
  "creator",
  "copyright",
  "rightsOwner",
  "website",
  "contact",
  "title",
  "description",
  "keywords",
  "locationName",
] as const;

export type ProfileField = (typeof PROFILE_FIELDS)[number];

export const PROFILE_LIMITS: Record<ProfileField, { max: number; kind: "string" | "keywords" }> = {
  company: { max: 120, kind: "string" },
  creator: { max: 120, kind: "string" },
  copyright: { max: 300, kind: "string" },
  rightsOwner: { max: 120, kind: "string" },
  website: { max: 200, kind: "string" },
  contact: { max: 200, kind: "string" },
  title: { max: 200, kind: "string" },
  description: { max: 2000, kind: "string" },
  keywords: { max: 30, kind: "keywords" },
  locationName: { max: 200, kind: "string" },
};

export const MAX_KEYWORD_LENGTH = 60;

export type MetadataProfile = Record<ProfileField, string> & {
  keywordsList: string[];
};

export function blankProfile(): MetadataProfile {
  return {
    company: "",
    creator: "",
    copyright: "",
    rightsOwner: "",
    website: "",
    contact: "",
    title: "",
    description: "",
    keywords: "",
    locationName: "",
    keywordsList: [],
  };
}

/** Split free keyword input on commas/newlines/semicolons; trim + dedupe. */
export function parseKeywords(input: string): string[] {
  const seen = new Set<string>();
  for (const part of input.split(/[,\n;]+/)) {
    const word = part.trim().replace(/\s+/g, " ");
    if (word && !seen.has(word.toLowerCase())) seen.add(word);
  }
  return [...seen].slice(0, PROFILE_LIMITS.keywords.max);
}

export interface ProfileValidation {
  profile: MetadataProfile;
  errors: Partial<Record<ProfileField, string>>;
}

/**
 * Validate + sanitize raw form input. Oversized/malformed values are
 * REJECTED with per-field messages (never silently truncated), matching
 * the Firestore rules ceilings.
 */
export function validateProfile(input: Record<string, unknown>): ProfileValidation {
  const profile = blankProfile();
  const errors: Partial<Record<ProfileField, string>> = {};
  for (const field of PROFILE_FIELDS) {
    const limit = PROFILE_LIMITS[field];
    const raw = input[field];
    if (raw === undefined || raw === null || raw === "") continue;
    if (typeof raw !== "string") {
      errors[field] = "Must be text.";
      continue;
    }
    const value = raw.trim().replace(/\s+/g, field === "description" ? " " : " ");
    if (field === "keywords") {
      const list = parseKeywords(value);
      const tooLong = list.find((word) => word.length > MAX_KEYWORD_LENGTH);
      if (tooLong) {
        errors[field] = `Each keyword must be ${MAX_KEYWORD_LENGTH} characters or fewer.`;
        continue;
      }
      profile.keywords = list.join(", ");
      profile.keywordsList = list;
      continue;
    }
    if (value.length > limit.max) {
      errors[field] = `Must be ${limit.max} characters or fewer (currently ${value.length}).`;
      continue;
    }
    if (field === "website" && value !== "" && !/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(value)) {
      errors[field] = "Website must start with http:// or https://.";
      continue;
    }
    profile[field] = value;
  }
  profile.keywordsList = parseKeywords(profile.keywords);
  return { profile, errors };
}

/** A profile with every field blank applies nothing — block the no-op. */
export function isProfileEmpty(profile: MetadataProfile): boolean {
  return PROFILE_FIELDS.every((field) => {
    if (field === "keywords") return profile.keywordsList.length === 0;
    return profile[field].trim() === "";
  });
}

/** Narrow a profile to explicitly selected fields (update-selected mode). */
export function selectProfileFields(
  profile: MetadataProfile,
  selected: readonly ProfileField[],
): Partial<Record<ProfileField, string>> {
  const out: Partial<Record<ProfileField, string>> = {};
  for (const field of selected) {
    if (field === "keywords") {
      if (profile.keywordsList.length > 0) out.keywords = profile.keywordsList.join(", ");
    } else if (profile[field].trim() !== "") {
      out[field] = profile[field];
    }
  }
  return out;
}

