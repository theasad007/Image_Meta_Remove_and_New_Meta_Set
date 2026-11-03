"use client";

import type { UsagePolicy } from "../../lib/firebase/directory";

/**
 * Screen 08 Settings tab — the existing, honest usage-policy editor
 * (Phase 6A), unchanged in behavior: unlimited guest processing stays
 * the enforced mode and stored values remain explicitly non-enforcing.
 */
export default function AdminSettingsPanel({
  policy,
  onPolicy,
  policyLoaded,
  savingPolicy,
  onSave,
}: {
  policy: UsagePolicy;
  onPolicy: (next: UsagePolicy) => void;
  policyLoaded: boolean;
  savingPolicy: boolean;
  onSave: () => void;
}) {
  return (
    <div className="grid content-start gap-5">
      <div>
        <h1 data-testid="admin-settings-heading" className="text-[19px] font-bold tracking-[-0.01em] text-[#16244a] sm:text-[21px]">Settings</h1>
        <p className="mt-1 text-[12.5px] leading-5 text-[#5a6b85]">
          The only genuine administrative setting today is the usage-policy record. No API keys,
          rate limiting or maintenance tooling exists — this app is a free static browser cleaner.
        </p>
      </div>

      <section aria-label="Usage policy" className="surface-card rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">Usage Policy</h2>
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-800">Unlimited (default; no caps enabled)</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">Values below are NOT enforced</span>
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-600">
          This static browser app cannot reliably meter local file operations — local counters can
          be bypassed by editing scripts, clearing storage, using guest mode, or working offline.
          These stored values only record a future intent and require a separate trusted-metering
          design (plus approval) before any cap may be claimed or switched on. Guest inspection,
          cleaning, ZIP, and reports stay unlimited and free. No per-file activity is logged to
          Firebase — ever.
        </p>
        {!policyLoaded ? (
          <p role="status" className="mt-3 text-xs text-slate-500">Loading policy…</p>
        ) : (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {([
              ["inspectHourly", "Inspections per hour"],
              ["inspectDaily", "Inspections per day"],
              ["cleanHourly", "Cleanings per hour"],
              ["cleanDaily", "Cleanings per day"],
            ] as const).map(([field, label]) => (
              <label key={field} className="grid gap-1 text-xs font-semibold text-slate-700">
                <span>{label} <span className="font-normal text-slate-400">(blank = none · not enforced)</span></span>
                <input
                  type="number"
                  min={0}
                  max={1000000}
                  step={1}
                  value={policy[field] ?? ""}
                  onChange={(event) => {
                    const raw = event.target.value;
                    onPolicy({
                      ...policy,
                      [field]: raw === "" ? null : Math.max(0, Math.min(1000000, Math.floor(Number(raw)))),
                    });
                  }}
                  placeholder="No cap"
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal"
                />
              </label>
            ))}
          </div>
        )}
        <button type="button" onClick={onSave} disabled={savingPolicy || !policyLoaded} className="btn-secondary mt-3 !min-h-10 text-xs">
          {savingPolicy ? "Saving…" : "Record future policy values (not enforced)"}
        </button>
      </section>
    </div>
  );
}
