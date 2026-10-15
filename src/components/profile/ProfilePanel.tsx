"use client";

import { useMemo, useState } from "react";
import type { SignedInUser } from "../../lib/firebase/auth";
import { deleteProfile, loadProfile, saveProfile } from "../../lib/firebase/profile";
import {
  blankProfile,
  PROFILE_FIELDS,
  PROFILE_LIMITS,
  validateProfile,
  type MetadataProfile,
  type ProfileField,
} from "../../lib/metadata/rewrite/fields";

const FIELD_LABELS: Record<ProfileField, { label: string; hint: string }> = {
  company: { label: "Company / Publisher", hint: "Distributing entity; distinct from original creator. XMP dc:publisher + IPTC 2:110 (JPEG)." },
  creator: { label: "Creator / Author", hint: "Original creator only if accurate; never auto-filled. EXIF Artist + XMP dc:creator + IPTC 2:80 (JPEG)." },
  copyright: { label: "Copyright Notice", hint: "Your copyright text; no automatic legal claim. EXIF Copyright + XMP dc:rights + IPTC 2:116 (JPEG)." },
  rightsOwner: { label: "Rights Owner", hint: "May differ from creator. XMP xmpRights:Owner (no IPTC/EXIF home)." },
  website: { label: "Website URL", hint: "Optional http(s) URL; never fetched. XMP CreatorContactInfo/CiUrlWork." },
  contact: { label: "Contact Information", hint: "Optional; will be embedded in downloads. XMP dc:contributor + IPTC 2:118 (JPEG)." },
  title: { label: "Image Title", hint: "EXIF DocumentName + XMP dc:title (alt) + IPTC 2:5 (JPEG)." },
  description: { label: "Image Description", hint: "EXIF ImageDescription + XMP dc:description (alt) + IPTC 2:120 (JPEG)." },
  keywords: { label: "Keywords / Tags", hint: "Comma/newline/semicolon separated; deduped; max 30. XMP dc:subject Bag + IPTC 2:25 per keyword (JPEG)." },
  locationName: { label: "Location Name", hint: "Descriptive name only (non-GPS field). GPS coordinates are Phase 7 — no coordinate form here." },
};

/**
 * Saved-profile form (Phase 6). The canonical apply source is the current
 * form values (validated on Apply); Save persists them to Firestore for
 * reuse. Saving without an image is supported; blank profiles block both
 * Save and Apply with a message.
 */
export default function ProfilePanel({
  user,
  profile,
  suspended,
  onProfile,
  onNotice,
}: {
  user: SignedInUser | null;
  profile: MetadataProfile;
  suspended: boolean;
  onProfile: (profile: MetadataProfile) => void;
  onNotice: (message: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { errors } = useMemo(() => validateProfile(profile as unknown as Record<string, unknown>), [profile]);
  const errorCount = Object.keys(errors).length;

  const setField = (field: ProfileField, value: string) => {
    onProfile({ ...profile, [field]: value, keywordsList: field === "keywords" ? profile.keywordsList : profile.keywordsList });
  };

  const handleLoad = async () => {
    if (!user || suspended) return;
    setLoading(true);
    setFormError(null);
    try {
      const saved = await loadProfile(user.uid);
      if (saved) {
        onProfile({ ...blankProfile(), ...saved, keywordsList: saved.keywordsList ?? [] });
        setHasSaved(true);
        onNotice("Saved profile loaded.");
      } else {
        onNotice("No saved profile yet — the blank form is ready to fill.");
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message.slice(0, 300) : "Load failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!user || suspended) return;
    setSaving(true);
    setFormError(null);
    try {
      const saved = await saveProfile(user.uid, profile as unknown as Record<string, unknown>);
      onProfile({ ...saved });
      setHasSaved(true);
      onNotice("Profile saved — acknowledged by Firestore.");
    } catch (err) {
      setFormError(err instanceof Error ? err.message.slice(0, 300) : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!user || suspended) return;
    setSaving(true);
    setFormError(null);
    try {
      await deleteProfile(user.uid);
      onProfile(blankProfile());
      setHasSaved(false);
      onNotice("Saved profile deleted. Form cleared; queue and outputs untouched.");
    } catch (err) {
      setFormError(err instanceof Error ? err.message.slice(0, 300) : "Delete failed.");
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return (
      <section aria-label="Metadata profile" data-testid="profile-panel" className="surface-card mt-6 rounded-[1.5rem] p-4 sm:p-6">
        <h2 className="text-base font-semibold">My Metadata Profile</h2>
        <p className="mt-2 text-xs text-slate-600">
          Sign in with Google above to save and apply your own reusable metadata. Guests keep full cleaning
          and reporting access. Cancelling sign-in preserves your queue.
        </p>
      </section>
    );
  }

  return (
    <section id="account" aria-label="Metadata profile" data-testid="profile-panel" className="surface-card mt-6 rounded-[1.5rem] p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">My Metadata Profile</h2>
        <span className="text-[11px] text-slate-500">Applying uses the current form values (validated). Save persists them for reuse.</span>
        <span className="ml-auto flex gap-2">
          <button type="button" onClick={() => void handleLoad()} disabled={loading || saving || suspended} title={suspended ? "Suspended accounts cannot use cloud profiles." : undefined} className="btn-secondary !min-h-9 !px-3 !py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40">
            {loading ? "Loading…" : "Load saved"}
          </button>
          <button type="button" onClick={() => void handleSave()} disabled={saving || loading || suspended} title={suspended ? "Suspended accounts cannot use cloud profiles." : undefined} data-testid="profile-save" className="btn-success !min-h-9 !px-3 !py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40">
            {saving ? "Saving…" : hasSaved ? "Save changes" : "Save profile"}
          </button>
          <button type="button" onClick={() => void handleDelete()} disabled={saving || loading || suspended} title={suspended ? "Suspended accounts cannot use cloud profiles." : undefined} className="btn-secondary !min-h-9 !px-3 !py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40">
            Delete saved
          </button>
        </span>
      </div>
      {suspended ? (
        <p role="alert" className="mt-3 rounded-lg bg-amber-50 p-2 text-xs font-medium text-amber-800">
          Suspended: saved-profile cloud features are unavailable for this account. Anonymous
          inspection, cleaning, ZIP, and reports on this page keep working with no limits.
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {PROFILE_FIELDS.map((field) => {
          const limit = PROFILE_LIMITS[field];
          const max = field === "keywords" ? 2000 : limit.max;
          const value = profile[field] as unknown as string;
          const error = errors[field];
          return (
            <label key={field} className="grid gap-1 text-xs font-semibold text-slate-700">
              <span>
                {FIELD_LABELS[field].label}{" "}
                <span className="font-normal text-slate-400">
                  ({typeof value === "string" ? value.length : 0}/{field === "keywords" ? "30 keywords" : `${max} chars`})
                </span>
              </span>
              {field === "description" ? (
                <textarea
                  value={typeof value === "string" ? value : ""}
                  onChange={(e) => setField(field, e.target.value)}
                  rows={3}
                  maxLength={2000}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900"
                  aria-invalid={error ? true : undefined}
                />
              ) : (
                <input
                  type="text"
                  value={typeof value === "string" ? value : ""}
                  onChange={(e) => setField(field, e.target.value)}
                  maxLength={field === "keywords" ? 2000 : max}
                  inputMode={field === "website" ? "url" : undefined}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900"
                  aria-invalid={error ? true : undefined}
                />
              )}
              <span className="font-normal text-slate-500">{FIELD_LABELS[field].hint}</span>
              {error ? <span role="alert" className="font-normal text-red-700">✖ {error}</span> : null}
            </label>
          );
        })}
      </div>

      <p className="mt-3 text-[11px] text-slate-500">
        Contact and copyright values are embedded into downloaded images when you apply them. Bengali and other
        Unicode text is stored as UTF-8 and written where the file standard supports it; PDF reports use standard
        fonts and may show a counted “?” for non-WinAnsi glyphs — exact UTF-8 values remain in CSV. Location name
        is a descriptive text field only; GPS coordinate writing is a planned Phase 7 feature.
      </p>
      {formError ? <p role="alert" className="mt-2 text-xs text-red-700">✖ {formError}</p> : null}
      {errorCount > 0 ? (
        <p className="mt-2 text-xs text-amber-800">⚠ {errorCount} field(s) need attention before saving or applying.</p>
      ) : null}

      <details className="mt-3 text-xs text-slate-600">
        <summary className="cursor-pointer font-semibold">Metadata-to-standard-tags mapping preview</summary>
        <ul className="mt-2 grid gap-1">
          <li>Creator → EXIF Artist (315) · XMP dc:creator (Seq) · IPTC 2:80 (JPEG only)</li>
          <li>Company / Publisher → XMP dc:publisher (Seq) · IPTC 2:110 (JPEG only); never EXIF Artist/Copyright</li>
          <li>Copyright → EXIF Copyright (33432) · XMP dc:rights (Alt) · IPTC 2:116 (JPEG only)</li>
          <li>Rights Owner → XMP xmpRights:Owner (Bag); no EXIF/IPTC home (documented)</li>
          <li>Website → XMP Iptc4xmpCore CreatorContactInfo/CiUrlWork; no EXIF MakerNote</li>
          <li>Contact → XMP dc:contributor (Bag) · IPTC 2:118 (JPEG only)</li>
          <li>Title → EXIF DocumentName (269) · XMP dc:title (Alt) · IPTC 2:5 (JPEG only)</li>
          <li>Description → EXIF ImageDescription (270) · XMP dc:description (Alt) · IPTC 2:120 (JPEG only)</li>
          <li>Keywords → XMP dc:subject (Bag, distinct tags) · IPTC 2:25 per keyword (JPEG only)</li>
          <li>Location Name → XMP Iptc4xmpCore Location · IPTC 2:92 (JPEG only); GPS coordinates are Phase 7</li>
          <li>PNG/WebP/AVIF/HEIC carry values in EXIF/XMP only; requested IPTC locations there are reported unsupported, not faked.</li>
        </ul>
      </details>
    </section>
  );
}
