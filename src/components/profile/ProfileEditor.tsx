"use client";

import { useMemo, useRef, useState } from "react";
import type { SignedInUser } from "../../lib/firebase/auth";
import { deleteProfile, loadProfile, saveProfile } from "../../lib/firebase/profile";
import {
  MAX_KEYWORD_LENGTH,
  PROFILE_LIMITS,
  blankProfile,
  isProfileEmpty,
  parseKeywords,
  validateProfile,
  type MetadataProfile,
  type ProfileField,
} from "../../lib/metadata/rewrite/fields";
import {
  formatProfileTimestamp,
  saveStatusLabel,
  saveStatusOf,
  type SaveStatus,
} from "../../lib/profile/profile-view";
import { useDialogChrome, useDialogFocusTrap } from "../ui/dialog-chrome";

const MAX_KEYWORDS = PROFILE_LIMITS.keywords.max;

type ConfirmDialogMode = "delete" | "clear" | null;

const GROUP_DEFS = [
  {
    id: "creator",
    title: "Creator Information",
    description: "Defines the author, publisher and contact details of the content.",
    fields: ["company", "creator", "website", "contact"] as ProfileField[],
  },
  {
    id: "copyright",
    title: "Copyright Information",
    description: "Used to set copyright and usage rights.",
    fields: ["copyright", "rightsOwner"] as ProfileField[],
  },
  {
    id: "content",
    title: "Content Information",
    description: "Descriptive information reused for your images.",
    fields: ["title", "description", "keywords"] as ProfileField[],
  },
  {
    id: "location",
    title: "Location Information (Optional)",
    description: "An honest descriptive label only — GPS coordinate writing is not available yet.",
    fields: ["locationName"] as ProfileField[],
  },
] as const;

const FIELD_META: Record<ProfileField, { label: string; hint: string }> = {
  company: { label: "Company / Publisher", hint: "The distributing company or publisher. This may differ from the original creator." },
  creator: { label: "Creator / Author", hint: "The original creator or author of the image." },
  copyright: { label: "Copyright Notice", hint: "Enter the copyright notice you are authorized to use." },
  rightsOwner: { label: "Rights Owner", hint: "The person or organization that owns the rights. This may differ from the creator." },
  website: { label: "Website URL", hint: "An optional website or portfolio URL (http:// or https://)." },
  contact: { label: "Contact Information", hint: "Optional contact information to embed in images." },
  title: { label: "Image Title", hint: "Default title used when applying your saved profile." },
  description: { label: "Image Description", hint: "Default description used when applying your saved profile." },
  keywords: { label: "Keywords / Tags", hint: "Press Enter, comma or semicolon to add. Up to 30 unique keywords." },
  locationName: { label: "Location Name", hint: "An optional descriptive location name. This does not set GPS coordinates." },
};

const GROUP_ICONS: Record<string, React.ReactNode> = {
  creator: <path d="M12 3.5a2.9 2.9 0 1 1 0 5.8 2.9 2.9 0 0 1 0-5.8ZM5.5 19.5c1.1-3 3.6-4.5 6.5-4.5s5.4 1.5 6.5 4.5" />,
  copyright: <path d="M12 3 18.9 5.2v5c0 4.5-2.7 8-6.9 9.6-4.2-1.6-6.9-5.1-6.9-9.6v-5L12 3Zm2.9 7.4a3.4 3.4 0 0 0-5.8 2.1 3.4 3.4 0 0 0 5.8 2.1" />,
  content: <path d="M8 4.5h8.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2ZM10.5 9h5M10.5 12.5h5M10.5 16h3" />,
  location: <path d="M12 21s-6.6-5.6-6.6-11A6.6 6.6 0 0 1 12 3.4 6.6 6.6 0 0 1 18.6 10c0 5.4-6.6 11-6.6 11Zm0-8.6a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8Z" />,
};

const STATUS_CHIP_TONE: Record<SaveStatus, string> = {
  not_saved: "bg-slate-100 text-slate-600",
  unsaved: "bg-amber-50 text-amber-800",
  saving: "bg-blue-50 text-blue-700",
  saved: "bg-emerald-50 text-emerald-800",
  failed: "bg-red-50 text-red-700",
};

/**
 * Screen 07 center editor (approved reference): the 10 supported profile
 * fields grouped into four cards, honest save states, keyword chips and a
 * real Firestore save/delete. The saved-profile contract (limits, empty
 * profile block, URL validation) lives in the existing validation module —
 * this form only renders it.
 */
export default function ProfileEditor({
  user,
  suspended,
  profile,
  dirty,
  savedSnapshot,
  savedUpdatedAt,
  onProfileChange,
  onProfileSaved,
  onProfileDeleted,
  onNotice,
}: {
  user: SignedInUser;
  suspended: boolean;
  profile: MetadataProfile;
  dirty: boolean;
  savedSnapshot: MetadataProfile | null;
  savedUpdatedAt: string | null;
  onProfileChange: (profile: MetadataProfile) => void;
  onProfileSaved: (saved: MetadataProfile, updatedAt: string | null) => void;
  onProfileDeleted: () => void;
  onNotice: (message: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [keywordInput, setKeywordInput] = useState("");
  const [keywordAlert, setKeywordAlert] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmDialogMode>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // Hooks live at component top level: the confirm dialog mounts and
  // unmounts inside JSX, but its chrome (focus trap, Escape, scroll lock,
  // opener restoration) must stay a stable hook call.
  const focusTrap = useDialogFocusTrap(dialogRef);
  useDialogChrome({
    open: confirm !== null,
    onClose: () => setConfirm(null),
    panelRef: dialogRef,
    openerSelector: confirm === "delete" ? '[data-testid="profile-delete"]' : '[data-testid="profile-clear"]',
  });

  const { errors } = useMemo(() => validateProfile({ ...profile }), [profile]);
  const status: SaveStatus = saveStatusOf({
    saving,
    hasSavedDoc: savedSnapshot !== null,
    dirty,
    hasError: saveError !== null,
  });

  const statusOf = saveStatusLabel(status);
  const updated = formatProfileTimestamp(savedUpdatedAt);

  const setField = (field: ProfileField, value: string) => {
    onProfileChange({ ...profile, [field]: value });
  };

  /* ---- Keyword chips (Enter / comma / semicolon add; dedupe, 30 cap) ---- */

  const commitKeywords = (raw: string) => {
    const parts = parseKeywords(raw);
    if (parts.length === 0) {
      setKeywordInput("");
      setKeywordAlert(null);
      return;
    }
    const tooLong = parts.find((part) => part.length > MAX_KEYWORD_LENGTH);
    if (tooLong) {
      setKeywordAlert(`Each keyword must be ${MAX_KEYWORD_LENGTH} characters or fewer.`);
      return;
    }
    const combined = parseKeywords([...profile.keywordsList, ...parts].join("; "));
    if (combined.length > MAX_KEYWORDS) {
      setKeywordAlert(`Maximum ${MAX_KEYWORDS} unique keywords — remove one before adding more.`);
      return;
    }
    if (combined.length === profile.keywordsList.length) {
      setKeywordAlert(null);
      setKeywordInput("");
      return;
    }
    setKeywordAlert(null);
    setKeywordInput("");
    onProfileChange({ ...profile, keywords: combined.join(", "), keywordsList: combined });
  };

  const removeKeyword = (keyword: string) => {
    const next = profile.keywordsList.filter((item) => item !== keyword);
    setKeywordAlert(null);
    onProfileChange({ ...profile, keywords: next.join(", "), keywordsList: next });
  };

  const handleKeywordKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitKeywords(keywordInput);
      return;
    }
    if (event.key === "Backspace" && keywordInput === "" && profile.keywordsList.length > 0) {
      event.preventDefault();
      removeKeyword(profile.keywordsList[profile.keywordsList.length - 1]);
    }
  };

  const handleKeywordChange = (value: string) => {
    if (/[,;\n]/.test(value)) {
      commitKeywords(value);
      return;
    }
    setKeywordInput(value);
  };

  const openKeywordCount = profile.keywordsList.length;

  /* ---- Save / delete / clear ---- */

  const handleSave = async () => {
    if (saving || deleting || suspended) return;
    setSaveError(null);
    const { profile: valid, errors: fieldErrors } = validateProfile({ ...profile });
    if (Object.keys(fieldErrors).length > 0) {
      setSaveError("Fix the highlighted field errors before saving. Nothing has been changed in your account.");
      return;
    }
    if (isProfileEmpty(valid)) {
      setSaveError("The profile is empty — fill at least one field before saving.");
      return;
    }
    setSaving(true);
    try {
      const saved = await saveProfile(user.uid, valid);
      onProfileSaved(saved, null);
      // Firestore's server timestamp only materializes after the write, so
      // the authoritative "last updated" value comes from a confirmation
      // re-read. A failed re-read never fakes success — the save itself is
      // already confirmed.
      try {
        const fresh = await loadProfile(user.uid);
        onProfileSaved(saved, fresh?.updatedAt ?? null);
      } catch {
        onProfileSaved(saved, null);
      }
      onNotice("Profile saved — confirmed by Firestore. Select \"Use my saved profile\" in any image editor to apply it.");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message.slice(0, 300) : "Saving the profile failed.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setConfirm(null);
    if (deleting || saving || suspended || !savedSnapshot) return;
    setSaveError(null);
    setDeleting(true);
    try {
      await deleteProfile(user.uid);
      onProfileDeleted();
      setKeywordInput("");
      onNotice("Saved profile deleted. Images you already downloaded are unchanged.");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message.slice(0, 300) : "Deleting the saved profile failed.");
    } finally {
      setDeleting(false);
    }
  };

  const handleClear = () => {
    setConfirm(null);
    onProfileChange(blankProfile());
    setKeywordInput("");
    setKeywordAlert(null);
    setSaveError(null);
    onNotice("Form cleared. Your last saved profile in the account is untouched.");
  };

  const dialogCopy = confirm === "delete"
    ? {
        title: "Delete your saved metadata profile?",
        body: "This removes your reusable profile from your account. Images already downloaded will not change.",
        action: deleting ? "Deleting…" : "Delete profile",
        danger: true,
      }
    : {
        title: "Clear unsaved changes?",
        body: "This clears everything you typed that has not been saved yet. Your last saved profile in the account is untouched.",
        action: "Clear form",
        danger: false,
      };

  return (
    <section
      id="profile-editor"
      aria-labelledby="profile-editor-heading"
      data-testid="profile-panel"
      className="surface-card scroll-mt-24 rounded-[1.4rem] p-4 sm:p-6"
    >
      {/* Card header + honest save state */}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#e9f2fe] text-[#2d5be9]">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 4.5h10a1.6 1.6 0 0 1 1.6 1.6v11.8a1.6 1.6 0 0 1-1.6 1.6H7a1.6 1.6 0 0 1-1.6-1.6V6.1A1.6 1.6 0 0 1 7 4.5Z" />
            <path d="M9 9h6.5M9 12h6.5M9 15h4" />
          </svg>
        </span>
        <div className="min-w-0 flex-1 basis-64">
          <h2 id="profile-editor-heading" data-section-heading tabIndex={-1} className="text-lg font-bold tracking-[-0.01em] text-[#16244a]">
            Metadata Profile
          </h2>
          <p className="mt-0.5 text-[12.5px] leading-5 text-[#5a6b85]">
            These values are used when you choose &ldquo;Remove &amp; Rewrite&rdquo; or apply your profile to images.
          </p>
        </div>
        <div className="ml-auto text-right">
          <p role="status" aria-live="polite" data-testid="profile-status" className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-bold ${STATUS_CHIP_TONE[status]}`}>
            {status === "saving" ? (
              <span aria-hidden="true" className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />
            ) : status === "saved" || status === "not_saved" ? (
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m4 10.5 4 4 8-9" />
              </svg>
            ) : status === "failed" ? (
              <span aria-hidden="true">✖</span>
            ) : null}
            {statusOf}
          </p>
          <p className="mt-0.5 text-[10.5px] font-normal text-slate-400" data-testid="profile-updated">
            {updated
              ? `Last updated ${updated}`
              : savedSnapshot
                ? "Saved values confirmed by Firestore"
                : "Nothing saved in your account yet"}
          </p>
        </div>
      </div>

      {suspended ? (
        <p role="alert" className="mt-3 rounded-xl bg-amber-50 p-2.5 text-xs font-medium text-amber-900">
          Suspended: saved-profile cloud features are unavailable for this account. You can still review your values, and
          anonymous inspection, cleaning, ZIP and reports on the workspace keep working with no limits.
        </p>
      ) : null}
      {saveError ? (
        <p role="alert" data-testid="profile-save-error" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-semibold text-red-700">
          ✖ {saveError}
        </p>
      ) : null}

      {/* Grouped field cards */}
      <div className="mt-4 grid gap-3.5 sm:gap-4">
        {GROUP_DEFS.map((group) => (
          <div key={group.id} className="rounded-2xl border border-[#e6ebf3] bg-[#fbfcfe] p-3.5 sm:p-4">
            <div className="flex items-start gap-2.5">
              <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-[#2d5be9] shadow-sm">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  {GROUP_ICONS[group.id]}
                </svg>
              </span>
              <div>
                <h3 className="text-[13.5px] font-bold text-[#16244a]">{group.title}</h3>
                <p className="text-[11.5px] leading-4 text-[#5a6b85]">{group.description}</p>
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {group.fields.map((field) => {
                if (field === "keywords") {
                  return (
                    <div key={field} className="sm:col-span-2" data-testid={`profile-field-${field}`}>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                        <label htmlFor="profile-field-keywords" className="text-[12.5px] font-semibold text-[#16244a]">
                          {FIELD_META[field].label}
                        </label>
                        <span
                          aria-hidden="true"
                          className={`text-[10.5px] font-semibold tabular-nums ${keywordAlert ? "text-red-600" : "text-slate-400"}`}
                        >
                          {openKeywordCount}/{MAX_KEYWORDS} keywords
                        </span>
                      </div>
                      <p id="profile-field-keywords-hint" className="mt-0.5 text-[10.5px] font-normal text-[#5a6b85]">{FIELD_META[field].hint}</p>

                      {openKeywordCount > 0 ? (
                        <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Profile keywords">
                          {profile.keywordsList.map((keyword) => (
                            <li key={keyword.toLowerCase()} data-testid="profile-keyword-chip">
                              <span className="flex items-center gap-1 rounded-full border border-[#e3d9fb] bg-violet-50 py-0.5 pl-2.5 pr-1 text-[11.5px] font-semibold text-violet-800">
                                {keyword}
                                <button
                                  type="button"
                                  onClick={() => removeKeyword(keyword)}
                                  aria-label={`Remove keyword ${keyword}`}
                                  className="flex h-5 w-5 items-center justify-center rounded-full text-violet-700 hover:bg-violet-200/60 focus-visible:outline-3 focus-visible:outline-[#2d5be9]"
                                >
                                  <svg aria-hidden="true" viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                                    <path d="m2.5 2.5 7 7m0-7-7 7" />
                                  </svg>
                                </button>
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : null}

                      <input
                        id="profile-field-keywords"
                        type="text"
                        value={keywordInput}
                        onChange={(event) => handleKeywordChange(event.target.value)}
                        onKeyDown={handleKeywordKeyDown}
                        onBlur={() => commitKeywords(keywordInput)}
                        placeholder="Add keywords and press Enter"
                        aria-describedby="profile-field-keywords-hint"
                        aria-invalid={keywordAlert ? true : undefined}
                        className={`mt-1.5 w-full rounded-xl border px-3 py-2 text-[13px] text-[#16244a] outline-offset-2 focus-visible:outline-3 focus-visible:outline-[#2d5be9] ${
                          keywordAlert ? "border-red-300 bg-red-50/40" : "border-[#c9d5e8] bg-white"
                        }`}
                      />
                      {keywordAlert ? (
                        <p role="alert" data-testid="profile-keyword-alert" className="mt-1 text-[11px] font-semibold text-red-700">{keywordAlert}</p>
                      ) : null}
                    </div>
                  );
                }
                return (
                  <FieldRow
                    key={field}
                    field={field}
                    value={profile[field] as unknown as string}
                    error={errors[field]}
                    onChange={setField}
                  />
                );
              })}
            </div>

            {group.id === "creator" ? (
              <p className="mt-2.5 flex items-start gap-1.5 text-[11px] leading-4 text-amber-800">
                <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                  <circle cx="10" cy="10" r="7.5" />
                  <path d="M10 4.8v5.6m0 3.2v.2" />
                </svg>
                Information entered in Contact (and embedded by the image writer) may become publicly readable in
                downloaded images.
              </p>
            ) : null}
            {group.id === "location" ? (
              <p className="mt-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] font-medium leading-4 text-amber-900">
                Latitude, Longitude and Altitude inputs are intentionally absent — GPS coordinate writing is not
                implemented yet, so this text field never changes coordinates.
              </p>
            ) : null}
          </div>
        ))}
      </div>

      {/* Footer actions */}
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-[#e6ebf3] pt-4">
        <button
          type="button"
          data-testid="profile-clear"
          onClick={() => setConfirm("clear")}
          disabled={saving || deleting}
          className="btn-secondary !min-h-10 !px-4 text-xs"
        >
          Clear form
        </button>
        <button
          type="button"
          data-testid="profile-delete"
          onClick={() => setConfirm("delete")}
          disabled={saving || deleting || suspended || !savedSnapshot}
          title={!savedSnapshot ? "Nothing saved yet — fill the form and save first." : undefined}
          className="btn-danger !min-h-10 !px-4 text-xs"
        >
          Delete saved profile
        </button>
        <button
          type="button"
          data-testid="profile-save"
          onClick={() => void handleSave()}
          disabled={saving || deleting || suspended}
          title={suspended ? "Suspended accounts cannot use cloud profiles." : undefined}
          className="btn-primary ml-auto !min-h-11 !px-5"
        >
          {saving ? (
            <>
              <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent motion-reduce:animate-none" />
              Saving…
            </>
          ) : deleting ? (
            "Deleting…"
          ) : (
            <>
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 15.5V4.5m0 0L7.8 8.7M12 4.5l4.2 4.2M4.5 14.5v3.2a2.3 2.3 0 0 0 2.3 2.3h10.4a2.3 2.3 0 0 0 2.3-2.3v-3.2" />
              </svg>
              Save profile
            </>
          )}
        </button>
      </div>
      <p className="mt-2 text-[11px] leading-4 text-slate-500">
        Saving stores only these text values in your account under Firestore owner-only rules
        (users/your-uid/profile/main). Image files and their extracted data are never uploaded.
      </p>

      {confirm !== null ? (
        <div
          className="fixed inset-0 z-[110] overflow-y-auto bg-slate-950/55 p-4"
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            if (event.target !== event.currentTarget) return;
            event.preventDefault();
            setConfirm(null);
          }}
        >
          <div className="flex min-h-full items-center justify-center">
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="profile-confirm-title"
              aria-describedby="profile-confirm-body"
              tabIndex={-1}
              onKeyDown={focusTrap}
              className="w-full max-w-md rounded-2xl bg-white p-5 shadow-[0_30px_90px_rgba(15,23,42,.4)] outline-none"
            >
              <h2 id="profile-confirm-title" className="text-[15px] font-bold text-[#16244a]">{dialogCopy.title}</h2>
              <p id="profile-confirm-body" className="mt-2 text-[13px] leading-5 text-[#5a6b85]">{dialogCopy.body}</p>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button type="button" data-testid="profile-confirm-cancel" autoFocus onClick={() => setConfirm(null)} className="btn-secondary !min-h-10 text-xs">
                  Cancel
                </button>
                <button
                  type="button"
                  data-testid="profile-confirm-action"
                  onClick={() => (confirm === "delete" ? void handleDelete() : handleClear())}
                  disabled={deleting || saving}
                  className={dialogCopy.danger
                    ? "inline-flex min-h-10 items-center justify-center rounded-xl bg-[#b42318] px-4 text-xs font-semibold text-white hover:bg-[#932015] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-3 focus-visible:outline-[#b42318]"
                    : "btn-secondary !min-h-10 !px-4 text-xs"}
                >
                  {dialogCopy.action}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** One labeled profile field: label, counter, description hint, input, error. */
function FieldRow({
  field,
  value,
  error,
  onChange,
}: {
  field: Exclude<ProfileField, "keywords">;
  value: string;
  error: string | undefined;
  onChange: (field: ProfileField, value: string) => void;
}) {
  const limit = PROFILE_LIMITS[field];
  const inputValue = typeof value === "string" ? value : "";
  const labelId = `profile-field-${field}-label`;
  const hintId = `profile-field-${field}-hint`;
  const errorId = `profile-field-${field}-error`;

  return (
    <div data-testid={`profile-field-${field}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <label htmlFor={`profile-field-${field}`} id={labelId} className="text-[12.5px] font-semibold text-[#16244a]">
          {FIELD_META[field].label}
        </label>
        <span aria-hidden="true" className={`text-[10.5px] font-semibold tabular-nums ${inputValue.length > limit.max ? "text-red-600" : "text-slate-400"}`}>
          {inputValue.length}/{limit.max}
        </span>
      </div>
      <p id={hintId} className="mt-0.5 text-[10.5px] font-normal leading-4 text-[#5a6b85]">{FIELD_META[field].hint}</p>
      {field === "description" ? (
        <textarea
          id={`profile-field-${field}`}
          value={inputValue}
          rows={3}
          maxLength={limit.max}
          placeholder={FIELD_META[field].hint}
          aria-labelledby={labelId}
          aria-describedby={`${hintId}${error ? ` ${errorId}` : ""}`}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onChange(field, event.target.value)}
          className={`mt-1 w-full resize-y rounded-xl border px-3 py-2 text-[13px] text-[#16244a] outline-offset-2 focus-visible:outline-3 focus-visible:outline-[#2d5be9] ${
            error ? "border-red-300 bg-red-50/40" : "border-[#c9d5e8] bg-white"
          }`}
        />
      ) : (
        <input
          id={`profile-field-${field}`}
          type="text"
          value={inputValue}
          maxLength={limit.max}
          placeholder={FIELD_META[field].hint}
          inputMode={field === "website" ? "url" : undefined}
          autoComplete="off"
          aria-labelledby={labelId}
          aria-describedby={`${hintId}${error ? ` ${errorId}` : ""}`}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onChange(field, event.target.value)}
          className={`mt-1 w-full rounded-xl border px-3 py-2 text-[13px] text-[#16244a] outline-offset-2 focus-visible:outline-3 focus-visible:outline-[#2d5be9] ${
            error ? "border-red-300 bg-red-50/40" : "border-[#c9d5e8] bg-white"
          }`}
        />
      )}
      {error ? (
        <p id={errorId} role="alert" data-testid={`profile-error-${field}`} className="mt-1 text-[11px] font-semibold text-red-700">
          ✖ {error}
        </p>
      ) : null}
    </div>
  );
}
