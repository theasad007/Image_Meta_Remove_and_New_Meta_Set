"use client";

import { profilePreviewRows } from "../../lib/profile/profile-view";
import type { MetadataProfile } from "../../lib/metadata/rewrite/fields";

const ROW_ICONS: Record<string, React.ReactNode> = {
  creator: <path d="M12 7.6a2.9 2.9 0 1 1 0 5.8 2.9 2.9 0 0 1 0-5.8ZM6 19c1.1-2.9 3.4-4.4 6-4.4s4.9 1.5 6 4.4" />,
  company: <path d="M4.5 20.5h15M6.5 20.5V5.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v15m2.5 0V10.5h2a1 1 0 0 1 1 1v9M9 8.5h3M9 12h3M9 15.5h3" />,
  title: <path d="M5 5.5h14M5 9.5h14M5 18.5h9M5 14.5h14" />,
  description: <path d="M5 5.5h14M5 18.5h9M5 14.5h14M5 10.5h14" />,
  keywords: <path d="M4.5 9.2c0-.9.5-1.7 1.2-2.2l4.6-3.2c.9-.6 2.2-.6 3.1 0l4.6 3.2c.8.5 1.2 1.3 1.2 2.2v5.6c0 .9-.4 1.7-1.2 2.2l-4.6 3.2c-.9.6-2.2.6-3.1 0l-4.6-3.2c-.7-.5-1.2-1.3-1.2-2.2V9.2Zm3.6 1.9h3.2a1.9 1.9 0 0 1 0 3.8" />,
  copyright: <path d="M12 3.4a8.6 8.6 0 1 1 0 17.2 8.6 8.6 0 0 1 0-17.2Zm-1.6 6a3.3 3.3 0 0 1 5.3 1.1m0 3a3.3 3.3 0 0 1-5.3 1.1" />,
  rightsOwner: <path d="M12 2.8 18.9 5v5.3c0 4.7-2.7 8.3-6.9 10-4.2-1.7-6.9-5.3-6.9-10V5L12 2.8Z" />,
  website: <path d="M9.5 14.5l5-5M7.6 11.6 5.1 14.1a3.5 3.5 0 0 0 5 5l2.5-2.6M16.4 12.4l2.5-2.5a3.5 3.5 0 0 0-5-5l-2.5 2.6" />,
  contact: <path d="M4.5 6.5h15v11h-15v-11Zm.6.4 6.9 5.6 6.9-5.6" />,
  locationName: <path d="M12 21s-6.6-5.6-6.6-11A6.6 6.6 0 0 1 12 3.4 6.6 6.6 0 0 1 18.6 10c0 5.4-6.6 11-6.6 11Zm0-8.6a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8Z" />,
};

function rowIcon(field: string): React.ReactNode {
  const path = ROW_ICONS[field] ?? ROW_ICONS.creator;
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {path}
    </svg>
  );
}

const ROW_TONES: Record<string, string> = {
  creator: "bg-[#e9f2fe] text-[#2d5be9]",
  company: "bg-[#eef3fe] text-[#3157d5]",
  title: "bg-[#eef2f7] text-[#5a6b85]",
  description: "bg-[#eef2f7] text-[#5a6b85]",
  keywords: "bg-violet-50 text-violet-700",
  copyright: "bg-emerald-50 text-emerald-700",
  rightsOwner: "bg-[#e9f2fe] text-[#2d5be9]",
  website: "bg-[#eef4ff] text-[#3157d5]",
  contact: "bg-amber-50 text-amber-700",
  locationName: "bg-rose-50 text-rose-700",
};

/** Screen 07 right column (approved reference): live profile preview and
 *  the privacy card. Rows are vertically stacked (icon + label on top,
 *  the full value on its own line below) so long names, URLs, emails and
 *  copyright stays readable in the narrow column. Rows show exactly what
 *  the editor holds — nothing is invented; unset fields render a subtle
 *  "Not set". The source chip says whether the rows are saved values or
 *  unsaved draft values. */
export default function ProfilePreviewCard({
  profile,
  dirty,
  hasSavedDoc,
}: {
  profile: MetadataProfile;
  dirty: boolean;
  hasSavedDoc: boolean;
}) {
  const rows = profilePreviewRows(profile);
  const keywordList = profile.keywordsList ?? [];

  return (
    <div className="grid content-start gap-4">
      <section aria-labelledby="preview-heading" data-testid="profile-preview" className="surface-card rounded-[1.4rem] p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#e9f2fe] text-[#2d5be9]">
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="6.5" />
              <path d="m15.8 15.8 4 4" />
            </svg>
          </span>
          <div className="min-w-0">
            <h2 id="preview-heading" data-section-heading tabIndex={-1} className="text-[15px] font-bold text-[#16244a]">Profile preview</h2>
            <p className="mt-0.5 text-[11.5px] leading-4 text-[#5a6b85]">
              This is how your saved metadata can be applied to an image.
            </p>
          </div>
        </div>

        <p
          role="status"
          aria-live="polite"
          data-testid="profile-preview-source"
          className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${
            dirty ? "bg-amber-50 text-amber-800" : hasSavedDoc ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"
          }`}
        >
          {dirty
            ? "Previewing unsaved changes"
            : hasSavedDoc
              ? "Saved profile preview"
              : "Previewing your new profile"}
        </p>

        {/* Vertically stacked items: value row aligns under the label
            (icon width h-8 w-8 + gap-2.5 = 2.625rem indent), full width,
            `overflow-wrap: anywhere` lets long URLs/emails break at safe
            points without horizontal scroll — natural words are never
            broken when they fit. */}
        <dl className="mt-3 grid">
          {rows.map((row, index) => (
            <div
              key={row.field}
              data-testid={`profile-preview-row-${row.field}`}
              className={`grid gap-1.5 px-1 py-3 ${index < rows.length - 1 ? "border-b border-[#eef2f8]" : ""}`}
            >
              <dt className="flex min-w-0 items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${ROW_TONES[row.field] ?? "bg-slate-100 text-slate-500"}`}
                >
                  {rowIcon(row.field)}
                </span>
                <span className="text-[12.5px] font-semibold text-[#43536e]">{row.label}</span>
              </dt>
              <dd className="min-w-0 pl-[2.625rem] text-[13px] leading-[1.55] text-[#16244a] [overflow-wrap:anywhere]">
                {row.field === "keywords" && keywordList.length > 0 ? (
                  <span className="flex flex-wrap gap-1.5">
                    {keywordList.map((keyword) => (
                      <span
                        key={keyword.toLowerCase()}
                        className="rounded-full bg-violet-50 px-2.5 py-0.5 text-[11px] font-semibold leading-5 text-violet-800 [overflow-wrap:anywhere]"
                      >
                        {keyword}
                      </span>
                    ))}
                  </span>
                ) : row.isSet ? (
                  row.value
                ) : (
                  <span className="text-slate-400">Not set</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="privacy-heading" className="rounded-[1.4rem] border border-emerald-200 bg-[#f2fbf8] p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0d9474] text-white shadow-[0_8px_18px_rgba(13,148,116,.25)]">
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3 18 5.3v4.6c0 4-2.4 7.2-6 8.7-3.6-1.5-6-4.7-6-8.7V5.3L12 3Z" />
              <path d="m9.4 11.6 1.9 1.9 3.5-3.9" />
            </svg>
          </span>
          <div className="min-w-0">
            <h2 id="privacy-heading" className="text-[14px] font-semibold text-[#16244a]">Your profile stays private</h2>
            <p className="mt-1 text-[11.5px] leading-5 text-[#5a6b85]">
              Your metadata profile is saved to your account. Image inspection and rewriting happen locally in your
              browser. Your original images are not uploaded.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
