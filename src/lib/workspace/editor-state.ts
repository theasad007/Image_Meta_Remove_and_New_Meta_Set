import type { SniffedKind } from "../format-detection/signatures";
import type { MetadataProfile, ProfileField } from "../metadata/rewrite/fields";
import {
  MAX_KEYWORD_LENGTH,
  PROFILE_FIELDS,
  PROFILE_LIMITS,
  isProfileEmpty,
  parseKeywords,
  validateProfile,
} from "../metadata/rewrite/fields";
import type { GpsCoordinates } from "../metadata/rewrite/gps";
import type { RewriteMode } from "../metadata/rewrite/rewrite";
import { planFieldWrite } from "../metadata/rewrite/writes";
import { projectToProfile, type ProjectRecord } from "../projects/project-schema";

/**
 * Screen 06 editor state — pure planning layer.
 *
 * The modal UI and the page handler both consume these functions; the same
 * source-precedence rules are therefore testable without a browser.
 *
 * Non-negotiable rules encoded here:
 * - A per-image custom draft NEVER merges saved-profile or project data
 *   (Rule C/13): the effective profile is exactly the validated draft.
 * - The saved profile is a full source only when the user is signed in and
 *   a non-empty profile exists (Rules B/D); profiles are never edited here.
 * - A saved project (Phase 05) is a full source for its NON-EMPTY fields —
 *   missing project values stay absent, never inherited from the profile
 *   or the custom draft. Project GPS coordinates become a verified GPS
 *   write directive; null project coordinates never touch GPS.
 * - There is no automatic authorship (Rule F): nothing is prefilled from
 *   account data unless the user explicitly copies it.
 */

export type EditorSource = "custom" | "profile" | "project";

export interface EditorDraft {
  source: EditorSource;
  /** Raw input values; keywords is a raw comma/newline/semicolon string. */
  values: Record<ProfileField, string>;
  mode: RewriteMode;
  /** Selected saved project (Phase 05) — retained per file for the current
   *  browser session only. Never merged into custom values. */
  projectId: string | null;
}

export function blankEditorDraft(mode: RewriteMode): EditorDraft {
  const values = {} as Record<ProfileField, string>;
  for (const field of PROFILE_FIELDS) values[field] = "";
  return { source: "custom", values, mode, projectId: null };
}

export function editorDraftHasValues(draft: EditorDraft): boolean {
  const list = parseKeywords(draft.values.keywords ?? "");
  return PROFILE_FIELDS.some((field) => (field === "keywords" ? list.length > 0 : (draft.values[field] ?? "").trim() !== ""));
}

/** Draft → engine profile. Oversized/malformed input becomes errors, never truncation. */
export function draftToProfile(draft: EditorDraft): { profile: MetadataProfile; errors: Partial<Record<ProfileField, string>> } {
  const { profile, errors } = validateProfile({ ...draft.values });
  // validateProfile slices keywords to the schema max; the surplus check
  // must count the RAW input so surplus keywords are rejected, not cropped.
  const uniqueRaw = rawUniqueKeywords(draft.values.keywords ?? "");
  if (uniqueRaw > PROFILE_LIMITS.keywords.max) {
    errors.keywords = `Use at most ${PROFILE_LIMITS.keywords.max} unique keywords (currently ${uniqueRaw}).`;
  }
  return { profile, errors };
}

/** Unique keyword count computed from the raw input (pre-slice). */
function rawUniqueKeywords(raw: string): number {
  const seen = new Set<string>();
  for (const part of raw.split(/[,\n;]+/)) {
    const word = part.trim().replace(/\s+/g, " ");
    if (word) seen.add(word.toLowerCase());
  }
  return seen.size;
}

export interface EditorApplyPlan {
  /** Rejected-invalid: never applied while errors exist. */
  profile: MetadataProfile;
  errors: Partial<Record<ProfileField, string>>;
  /** Fields that carry a nonempty value in the active source. */
  selectedFields: ProfileField[];
  mode: RewriteMode;
  source: EditorSource;
  canApply: boolean;
  blockedReason: string | null;
  /** Saved-project GPS coordinates (write directive) — null when the
   *  project has no coordinates or another source is active. */
  gps: GpsCoordinates | null;
}

/**
 * Resolve the exact rewrite inputs for ONE image from its draft (custom),
 * the current saved profile (signed-in source), or a saved project
 * (Phase 05, premium-gated at the UI/pipeline boundary). No cross-source
 * merging ever happens: the selected source is used exclusively.
 */
export function editorPlanFor(draft: EditorDraft, savedProfile: MetadataProfile, project: ProjectRecord | null = null): EditorApplyPlan {
  const blocked = (reason: string, extra?: Partial<EditorApplyPlan>): EditorApplyPlan => ({
    profile: { ...savedProfile },
    errors: {},
    selectedFields: [],
    mode: draft.mode,
    source: draft.source,
    canApply: false,
    blockedReason: reason,
    gps: null,
    ...extra,
  });

  if (draft.source === "project") {
    if (!project) {
      return blocked("Select a saved project first — project values are used exactly as saved, never merged with other sources.");
    }
    const projectProfile = projectToProfile(project);
    const projectErrors = validateProfile({ ...projectProfile, keywords: projectProfile.keywordsList.join(", ") }).errors;
    if (Object.keys(projectErrors).length > 0) {
      return blocked("The selected project contains invalid values — fix it on the profile page before applying.");
    }
    const selectedFields = PROFILE_FIELDS.filter((field) => {
      if (field === "keywords") return projectProfile.keywordsList.length > 0;
      return projectProfile[field].trim() !== "";
    });
    const gps = project.latitude !== null && project.longitude !== null
      ? { latitude: project.latitude, longitude: project.longitude, altitude: project.altitudeMeters }
      : null;
    if (selectedFields.length === 0 && gps === null) {
      return blocked("This project has no metadata or GPS values to apply yet — fill it in on the profile page.");
    }
    return {
      profile: projectProfile,
      errors: {},
      selectedFields,
      mode: draft.mode,
      source: "project",
      canApply: true,
      blockedReason: null,
      gps,
    };
  }

  if (draft.source === "profile") {
    const savedErrors = validateProfile({ ...savedProfile, keywords: savedProfile.keywordsList.join(", ") }).errors;
    if (Object.keys(savedErrors).length > 0) {
      return blocked("The saved profile contains invalid values — fix it on the profile page before applying.");
    }
    if (isProfileEmpty(savedProfile)) {
      return blocked("The saved profile is empty — fill it on the profile page or use custom values for this image.");
    }
    return {
      profile: savedProfile,
      errors: {},
      selectedFields: [...PROFILE_FIELDS],
      mode: draft.mode,
      source: "profile",
      canApply: true,
      blockedReason: null,
      gps: null,
    };
  }

  const { profile, errors } = draftToProfile(draft);
  const selectedFields = PROFILE_FIELDS.filter((field) => {
    if (field === "keywords") return profile.keywordsList.length > 0;
    return profile[field].trim() !== "";
  });
  if (Object.keys(errors).length > 0) {
    return {
      profile,
      errors,
      selectedFields,
      mode: draft.mode,
      source: "custom",
      canApply: false,
      blockedReason: "Fix the highlighted field errors first.",
      gps: null,
    };
  }
  if (selectedFields.length === 0) {
    return {
      profile,
      errors,
      selectedFields,
      mode: draft.mode,
      source: "custom",
      canApply: false,
      blockedReason: "Enter at least one supported value to apply — empty forms write nothing.",
      gps: null,
    };
  }
  return {
    profile,
    errors,
    selectedFields,
    mode: draft.mode,
    source: "custom",
    canApply: true,
    blockedReason: null,
    gps: null,
  };
}

/* ---- Preview diff (client-side, honest; not a verified write) ---- */

const EXIF_TAG_LABELS: Record<number, string> = {
  315: "Artist (315)",
  33432: "Copyright (33432)",
  269: "DocumentName (269)",
  270: "ImageDescription (270)",
};

const IPTC_DATASET_LABELS: Record<number, string> = {
  5: "2:5 ObjectName",
  25: "2:25 Keywords",
  80: "2:80 By-line",
  92: "2:92 Sub-location",
  110: "2:110 Credit",
  116: "2:116 CopyrightNotice",
  118: "2:118 ContactInfo",
  120: "2:120 Caption",
};

function xmpLabel(prop: import("../metadata/rewrite/codecs").XmpProperty): string {
  if (prop.kind === "contactUrl") return "XMP Iptc4xmpCore:CreatorContactInfo (CreatorContactInfo/UrlWork)";
  return `XMP ${prop.prefix}:${prop.prop}`;
}

export interface PreviewWriteLine {
  field: ProfileField;
  label: string;
  value: string;
  keywords?: string[];
  channels: string[];
}

export interface EditorPreview {
  mode: RewriteMode;
  writes: PreviewWriteLine[];
  /** Replace mode strip summary (privacy defaults). */
  stripSummary: string | null;
  /** Mode-specific C2PA honesty note. */
  c2paNote: string;
  /** Per-format unsupported-channel disclosures. */
  unsupported: Array<{ field: ProfileField; label: string; note: string }>;
}

const FIELD_LABELS: Record<ProfileField, string> = {
  company: "Company / Publisher",
  creator: "Creator / Author",
  copyright: "Copyright Notice",
  rightsOwner: "Rights Owner",
  website: "Website URL",
  contact: "Contact Information",
  title: "Image Title",
  description: "Image Description",
  keywords: "Keywords / Tags",
  locationName: "Location Name",
};

export function editorFieldLabel(field: ProfileField): string {
  return FIELD_LABELS[field];
}

/** Build the client-side preview from resolved plan + live detection. */
export function buildEditorPreview(
  plan: EditorApplyPlan,
  kind: SniffedKind,
): EditorPreview {
  const writes: PreviewWriteLine[] = [];
  const unsupported: EditorPreview["unsupported"] = [];
  for (const field of plan.selectedFields) {
    const fieldPlan = planFieldWrite(field, plan.profile[field] ?? "", field === "keywords" ? plan.profile.keywordsList : []);
    const channels: string[] = [];
    for (const write of fieldPlan.exif) {
      channels.push(`EXIF ${EXIF_TAG_LABELS[write.tag] ?? `tag ${write.tag}`}`);
    }
    for (const prop of fieldPlan.xmp) {
      channels.push(xmpLabel(prop));
    }
    for (const dataset of fieldPlan.iptc) {
      if (kind !== "jpeg") {
        unsupported.push({
          field,
          label: FIELD_LABELS[field],
          note: `IPTC 2:${dataset.dataset} has no standard home in ${kind.toUpperCase()} — the value is carried in EXIF/XMP only.`,
        });
        continue;
      }
      channels.push(`JPEG IPTC ${IPTC_DATASET_LABELS[dataset.dataset] ?? `2:${dataset.dataset}`}`);
    }
    writes.push({
      field,
      label: FIELD_LABELS[field],
      value: field === "keywords" ? plan.profile.keywordsList.join(", ") : plan.profile[field],
      keywords: field === "keywords" ? [...plan.profile.keywordsList] : undefined,
      channels: [...new Set(channels)],
    });
  }

  return {
    mode: plan.mode,
    writes,
    stripSummary: plan.mode === "replace_editable"
      ? "Before writing, the proven cleaner removes removable non-technical metadata with the privacy defaults (EXIF, GPS, XMP, IPTC plus AI-associated evidence and in-scope C2PA). ICC profile, orientation and the encoded pixels are preserved."
      : null,
    c2paNote: plan.mode === "replace_editable"
      ? "C2PA / Content Credentials: handled per cleaning scope — where a manifest survives, that is disclosed as retained, never claimed removed or valid."
      : "C2PA / Content Credentials: kept byte-for-byte and re-validated afterward; the edits may invalidate a retained signature — the output reports its actual state, never a trust claim.",
    unsupported,
  };
}

/* ---- Keyword input utilities (shared by form counter) ---- */

export function editorKeywordList(raw: string): string[] {
  return parseKeywords(raw);
}

export const EDITOR_MAX_KEYWORD_LENGTH = MAX_KEYWORD_LENGTH;
