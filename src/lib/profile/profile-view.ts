import {
  PROFILE_FIELDS,
  blankProfile,
  validateProfile,
  type MetadataProfile,
  type ProfileField,
} from "../metadata/rewrite/fields";
import { editorFieldLabel } from "../workspace/editor-state";

/**
 * Screen 07 view-model helpers (pure, browser-independent).
 *
 * The editor component and the preview card share these helpers so the
 * live preview always reflects the same normalization the save path and
 * Screen 06's saved-profile source use. Field labels come from the Screen
 * 06 editor vocabulary — never a second, competing label map.
 */

export type SaveStatus = "not_saved" | "unsaved" | "saving" | "saved" | "failed";

export interface ProfilePreviewRow {
  field: ProfileField;
  label: string;
  value: string;
  isSet: boolean;
}

/** Right-panel preview order (approved reference; Author first). */
const PREVIEW_FIELD_ORDER: ProfileField[] = [
  "creator",
  "company",
  "title",
  "description",
  "keywords",
  "copyright",
  "rightsOwner",
  "website",
  "contact",
  "locationName",
];

/** Preview rows for a profile; empty fields keep an empty value (caller renders "Not set"). */
export function profilePreviewRows(profile: MetadataProfile): ProfilePreviewRow[] {
  return PREVIEW_FIELD_ORDER.map((field) => {
    const raw = field === "keywords"
      ? profile.keywordsList?.join(", ") ?? ""
      : typeof profile[field] === "string" ? profile[field] : "";
    return { field, label: editorFieldLabel(field), value: raw, isSet: raw.trim() !== "" };
  });
}

function normalizedCopy(profile: MetadataProfile): MetadataProfile {
  // The engine normalization (trim, whitespace collapse, keyword
  // dedupe/join) is authoritative — the dirty check must never disagree
  // with what saving would persist.
  const keywords = profile.keywordsList && profile.keywordsList.length > 0
    ? profile.keywordsList.join(", ")
    : profile.keywords;
  return validateProfile({ ...profile, keywords }).profile;
}

/** True when the editor draft would save different values than the snapshot. */
export function profilesDiffer(draft: MetadataProfile, snapshot: MetadataProfile | null): boolean {
  const baseline = snapshot ?? blankProfile();
  const a = normalizedCopy(draft);
  const b = normalizedCopy(baseline);
  return PROFILE_FIELDS.some((field) => a[field] !== b[field]);
}

export function saveStatusOf(input: { saving: boolean; hasSavedDoc: boolean; dirty: boolean; hasError: boolean }): SaveStatus {
  if (input.saving) return "saving";
  if (input.hasError) return "failed";
  if (input.dirty) return "unsaved";
  return input.hasSavedDoc ? "saved" : "not_saved";
}

export function saveStatusLabel(status: SaveStatus): string {
  switch (status) {
    case "saving": return "Saving…";
    case "failed": return "Save failed";
    case "unsaved": return "Unsaved changes";
    case "saved": return "Saved";
    case "not_saved": return "Not saved";
  }
}

/** Firestore-facing short timestamp ("Oct 18, 2026, 10:24 AM") or null when absent/invalid. */
export function formatProfileTimestamp(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(ms);
}
