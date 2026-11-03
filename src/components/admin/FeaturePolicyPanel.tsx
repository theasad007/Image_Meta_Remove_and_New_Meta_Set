"use client";

import { useState } from "react";
import type { FeatureKey, FeaturePolicy, FeaturePolicyValue } from "../../lib/firebase/feature-policy";
import {
  ADMIN_ADJUSTABLE_FEATURES,
  DEFAULT_FEATURE_POLICY,
  LOCKED_FREE_FEATURES,
} from "../../lib/firebase/feature-policy";

/**
 * Screen 08 Settings — Feature Management section (Phase 02).
 *
 * Shows the server-stored feature policy with honest defaults and safe
 * editing: free-by-contract single-file operations are visibly locked,
 * bulk-cleaning switches to premium only behind an explicit confirmation,
 * and the panel states exactly what happens when no policy document exists
 * (the shipped defaults apply and bulk cleaning remains free).
 */

const FEATURE_LABELS: Record<FeatureKey, { title: string; description: string }> = {
  single_metadata_clean: {
    title: "Single-file metadata cleaning",
    description: "Remove metadata from one file. Free by contract — every visitor, always.",
  },
  single_ai_metadata_clean: {
    title: "Single-file AI metadata cleaning",
    description: "Remove detected AI metadata from one file. Free by contract.",
  },
  bulk_metadata_clean: {
    title: "Bulk metadata cleaning",
    description: "Remove metadata from many files in one run. Free today; you may switch this to Premium later.",
  },
  bulk_ai_metadata_clean: {
    title: "Bulk AI metadata cleaning",
    description: "Remove AI metadata from many files in one run. Free today; switchable later.",
  },
  single_custom_rewrite: {
    title: "Single-file custom metadata rewrite",
    description: "Rewrite selected fields (and GPS) on one file. Free by contract — including guests.",
  },
  batch_metadata_rewrite: {
    title: "Multiple-file metadata rewriting",
    description: "Apply custom fields or a saved project to two or more files in one verified run.",
  },
  batch_gps_write: {
    title: "Bulk GPS writing / updating",
    description: "Write or update GPS coordinates on two or more images in one run. Pure GPS removal under a cleaning action is not affected.",
  },
  multiple_named_projects: {
    title: "Multiple saved projects",
    description: "Create and manage more than one named metadata project (in addition to the single reusable profile).",
  },
  saved_project_apply: {
    title: "Saved project-based rewriting",
    description: "Apply a saved project's metadata to files. Reading projects still requires signing in.",
  },
};

function valueBadge(value: FeaturePolicyValue, isDefault: boolean): string {
  if (value === "free") return isDefault ? "Free (default)" : "Free";
  return isDefault ? "Premium (default)" : "Premium";
}

export default function FeaturePolicyPanel({
  policy,
  policyLoaded,
  degraded,
  saving,
  onToggle,
  actorIsSuperadmin,
}: {
  policy: FeaturePolicy;
  policyLoaded: boolean;
  degraded: boolean;
  saving: boolean;
  onToggle: (feature: FeatureKey, next: FeaturePolicyValue) => void;
  actorIsSuperadmin: boolean;
}) {
  const [confirming, setConfirming] = useState<FeatureKey | null>(null);

  const renderRow = (feature: FeatureKey) => {
    const meta = FEATURE_LABELS[feature];
    const current = policy.features[feature];
    const isDefault = DEFAULT_FEATURE_POLICY.features[feature] === current;
    const locked = (LOCKED_FREE_FEATURES as readonly string[]).includes(feature);
    const adjustable = (ADMIN_ADJUSTABLE_FEATURES as readonly string[]).includes(feature);
    const flipToPremium = current === "free";
    return (
      <li key={feature} className="grid gap-1.5 rounded-xl border border-slate-200 p-3" data-testid={`feature-row-${feature}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-bold text-[#16244a]">{meta.title}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${
              current === "free" ? "bg-emerald-50 text-emerald-800" : "bg-[#eef2ff] text-[#3f4bb8]"
            }`}
            data-testid={`feature-value-${feature}`}
          >
            {valueBadge(current, isDefault)}
          </span>
          {locked ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-bold text-slate-500">Free by contract — locked</span> : null}
        </div>
        <p className="text-[11.5px] leading-4 text-slate-600">{meta.description}</p>
        {adjustable && actorIsSuperadmin ? (
          confirming === feature ? (
            <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-2.5 py-1.5" data-testid={`feature-confirm-${feature}`}>
              <span className="text-[11px] font-semibold text-amber-900">
                {flipToPremium
                  ? "Switch this currently-free action to Premium? Existing guests will see a clear Premium-required message on their next run."
                  : "Open this action to everyone (Free)?"}
              </span>
              <button
                type="button"
                className="rounded-md border border-amber-300 bg-white px-2 py-1 text-[11px] font-bold text-amber-900"
                data-testid={`feature-confirm-yes-${feature}`}
                onClick={() => { setConfirming(null); onToggle(feature, flipToPremium ? "premium" : "free"); }}
              >
                Confirm
              </button>
              <button
                type="button"
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-600"
                onClick={() => setConfirming(null)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn-secondary mt-1 !min-h-7 !px-2.5 text-[11px]"
              disabled={saving || !policyLoaded}
              data-testid={`feature-toggle-${feature}`}
              onClick={() => setConfirming(feature)}
            >
              Switch to {current === "free" ? "Premium" : "Free"}
            </button>
          )
        ) : null}
      </li>
    );
  };

  return (
    <section aria-label="Feature management" className="surface-card rounded-2xl p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">Feature Management</h2>
        {!policyLoaded ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">Loading policy…</span>
        ) : degraded ? (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800" data-testid="feature-policy-degraded">
            Unavailable — shipped defaults apply (bulk cleaning stays free)
          </span>
        ) : (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-800" data-testid="feature-policy-loaded">
            Server policy active
          </span>
        )}
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-600">
        These access policies control which capabilities are Free or Premium. Single-file cleaning
        and single-file custom rewriting are free by contract and cannot be switched. If no policy
        is stored (or it cannot be read), the shipped defaults apply and bulk cleaning remains free.
        No payment checkout exists — Premium is granted manually by the administrator.
      </p>
      {policy.updatedBy && policy.updatedAt ? (
        <p className="mt-1 text-[11px] text-slate-400" data-testid="feature-policy-meta">
          Last updated by {policy.updatedBy} · {new Date(policy.updatedAt).toLocaleString()}
        </p>
      ) : null}
      <ul className="mt-3 grid gap-2 lg:grid-cols-2">
        {(Object.keys(FEATURE_LABELS) as FeatureKey[]).map(renderRow)}
      </ul>
    </section>
  );
}
