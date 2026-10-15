"use client";

import type { SignedInUser } from "../../lib/firebase/auth";
import { PROFILE_FIELDS, validateProfile, type ProfileField } from "../../lib/metadata/rewrite/fields";
import type { RewriteMode, FileRewriteResult } from "../../lib/metadata/rewrite/rewrite";

const FIELD_SHORT: Record<ProfileField, string> = {
  company: "Company",
  creator: "Creator",
  copyright: "Copyright",
  rightsOwner: "Rights",
  website: "Website",
  contact: "Contact",
  title: "Title",
  description: "Description",
  keywords: "Keywords",
  locationName: "Location",
};

/**
 * Rewrite controls (Phase 6). Applying uses the current validated profile
 * form values narrowed to the checked fields. Replace mode cleans first
 * (proven pipeline, in-scope C2PA removed); update mode preserves unrelated
 * metadata incl. C2PA (re-validated after, invalidation risk disclosed).
 */
export default function RewritePanel({
  user,
  profileValues,
  mode,
  selectedFields,
  eligibleCount,
  selectedCount,
  applying,
  progress,
  onMode,
  onToggleField,
  onApplySelected,
  onApplyAll,
  onCancel,
}: {
  user: SignedInUser | null;
  profileValues: Record<string, unknown>;
  mode: RewriteMode;
  selectedFields: readonly ProfileField[];
  eligibleCount: number;
  selectedCount: number;
  applying: boolean;
  progress: string | null;
  onMode: (mode: RewriteMode) => void;
  onToggleField: (field: ProfileField) => void;
  onApplySelected: () => void;
  onApplyAll: () => void;
  onCancel: () => void;
}) {
  const { profile, errors } = validateProfile(profileValues);
  const errorCount = Object.keys(errors).length;
  const blank = PROFILE_FIELDS.every((field) => {
    if (field === "keywords") return (profile.keywordsList ?? []).length === 0;
    return (profile[field] as unknown as string).trim() === "";
  });
  const checkedBlank = selectedFields.length === 0;
  const canApply = user !== null && !applying && !blank && !checkedBlank && errorCount === 0 && (eligibleCount > 0);

  return (
    <section aria-label="Rewrite metadata" data-testid="rewrite-panel" className="surface-card mt-6 rounded-[1.5rem] p-4 sm:p-6">
      <h2 className="text-base font-semibold">Rewrite Metadata — apply my profile</h2>
      {!user ? (
        <p className="mt-2 text-xs text-slate-600">
          Sign in to apply a profile. Guests keep full cleaning and reporting without sign-in.
        </p>
      ) : null}

      <fieldset className="mt-3 grid gap-2 text-xs">
        <legend className="font-semibold">Mode</legend>
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-2">
          <input
            type="radio"
            name="rewrite-mode"
            checked={mode === "replace_editable"}
            onChange={() => onMode("replace_editable")}
            className="mt-1 accent-[#0d9474]"
          />
          <span>
            <strong>Replace editable metadata and apply my profile</strong> (default, privacy-conscious) — removes
            existing removable non-technical metadata with the verified cleaner first, then writes the selected
            supported fields. Technical ICC/orientation/pixels stay intact. Retained unsupported provenance is disclosed.
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-2">
          <input
            type="radio"
            name="rewrite-mode"
            checked={mode === "update_selected"}
            onChange={() => onMode("update_selected")}
            className="mt-1 accent-[#0d9474]"
          />
          <span>
            <strong>Update only selected fields</strong> (advanced) — edits only the chosen writable fields, preserves
            unrelated metadata, and warns that previous GPS/AI/provenance/identity metadata may remain. Never runs a
            silent full clean. Retained C2PA is re-validated after; edits may invalidate its signature.
          </span>
        </label>
      </fieldset>

      <fieldset className="mt-3">
        <legend className="text-xs font-semibold">Fields to apply (from current form values)</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {PROFILE_FIELDS.map((field) => (
            <label key={field} className="flex cursor-pointer items-center gap-1 rounded-full border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={selectedFields.includes(field)}
                onChange={() => onToggleField(field)}
                className="h-3.5 w-3.5 accent-[#0d9474]"
              />
              {FIELD_SHORT[field]}
            </label>
          ))}
        </div>
      </fieldset>

      <p className="mt-3 text-[11px] text-slate-500">
        Per-format notes: JPEG writes EXIF + XMP + IPTC; PNG/WebP/AVIF/HEIC write EXIF + XMP only (requested IPTC
        locations there report unsupported). C2PA manifests are never forged; replace mode reuses the verified
        C2PA cleaner in scope, update mode preserves and re-validates. Video rows never enter the image writer.
        No GPS coordinate form here — that is planned Phase 7 GeoTag work.
      </p>

      {blank ? <p className="mt-2 text-xs text-amber-800">⚠ The profile form is blank — fill at least one field to enable rewriting.</p> : null}
      {checkedBlank && !blank ? <p className="mt-2 text-xs text-amber-800">⚠ No fields checked — check at least one field to apply.</p> : null}
      {errorCount > 0 ? <p className="mt-2 text-xs text-amber-800">⚠ {errorCount} profile field(s) are invalid — fix them in My Metadata Profile before applying.</p> : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onApplySelected}
          disabled={!canApply || selectedCount === 0}
          data-testid="rewrite-apply-selected"
          className="btn-success !min-h-10 text-xs disabled:cursor-not-allowed disabled:opacity-40"
          title={!user ? "Sign in to apply a profile." : `Apply to ${selectedCount} selected file(s).`}
        >
          {applying ? "Rewriting…" : `Apply profile to selected (${selectedCount})`}
        </button>
        <button
          type="button"
          onClick={onApplyAll}
          disabled={!canApply}
          data-testid="rewrite-apply-all"
          className="btn-secondary !min-h-10 text-xs disabled:cursor-not-allowed disabled:opacity-40"
          title={!user ? "Sign in to apply a profile." : `Apply to ${eligibleCount} eligible file(s).`}
        >
          {applying ? "Rewriting…" : `Apply profile to all eligible (${eligibleCount})`}
        </button>
        {applying ? (
          <button type="button" onClick={onCancel} className="btn-secondary !min-h-10 text-xs">
            Cancel rewrite
          </button>
        ) : null}
      </div>
      {progress ? <p role="status" className="mt-2 text-xs text-slate-600">{progress}</p> : null}
    </section>
  );
}

export function RewriteResultSummary({ result }: { result: FileRewriteResult }) {
  const verified = result.changes.filter((c) => c.action === "rewritten" && c.verification === "verified").length;
  return (
    <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-800">
      {result.status.replace(/_/g, " ")} · {verified} rewritten verified
    </span>
  );
}
