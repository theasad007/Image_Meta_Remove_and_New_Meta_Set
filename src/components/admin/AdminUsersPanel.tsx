"use client";

import { useState } from "react";
import type { AccountStatus, AdminAccountRow } from "../../lib/firebase/directory";

/**
 * Screen 08 Users tab — the existing Phase 6A directory management
 * (list, filter, suspend/restore with reason + self-suspend guard,
 * pagination) plus Phase 03 manual Premium entitlement management:
 * per-row tier badge, effective expiry, and superadmin-only Grant /
 * Extend / Revoke. Time-dependent "effective premium" is derived at
 * fetch time by the page (render stays pure); changes are verified by a
 * server read-back before any success notice. Suspension and entitlement
 * remain independent concepts.
 */

/** Pre-derived display model (computed by the page at fetch time). */
export interface EntitlementCellData {
  view: { tier: "free" | "premium"; status: "active" | "expired"; expiresAt: string | null };
  premiumActive: boolean;
  expiryLabel: string;
}

export type EntitlementCell = EntitlementCellData | null | "loading";

export default function AdminUsersPanel({
  rows,
  counts,
  listTruncated,
  loadingList,
  cursor,
  actorUid,
  filterText,
  onFilterText,
  filterStatus,
  onFilterStatus,
  actingUid,
  confirmUid,
  onConfirmUid,
  reason,
  onReason,
  onStatus,
  entitlements,
  onLoadEntitlement,
  onGrant,
  onRevoke,
  entitleUid,
  onLoadMore,
  onReload,
}: {
  rows: AdminAccountRow[];
  counts: { total: number; active: number; suspended: number };
  listTruncated: boolean;
  loadingList: boolean;
  cursor: string | null;
  actorUid: string;
  filterText: string;
  onFilterText: (value: string) => void;
  filterStatus: "all" | AccountStatus;
  onFilterStatus: (value: "all" | AccountStatus) => void;
  actingUid: string | null;
  confirmUid: string | null;
  onConfirmUid: (uid: string | null) => void;
  reason: string;
  onReason: (value: string) => void;
  onStatus: (row: AdminAccountRow, next: AccountStatus) => void;
  entitlements: Record<string, EntitlementCell>;
  onLoadEntitlement: (uid: string) => void;
  onGrant: (row: AdminAccountRow, expiresAt: Date | null, reason: string) => void;
  onRevoke: (row: AdminAccountRow, reason: string) => void;
  entitleUid: string | null;
  onLoadMore: () => void;
  onReload: () => void;
}) {
  const visible = rows.filter((row) => {
    if (filterStatus !== "all" && row.status !== filterStatus) return false;
    const needle = filterText.trim().toLowerCase();
    if (needle === "") return true;
    return row.uid.toLowerCase().includes(needle)
      || row.email.toLowerCase().includes(needle)
      || row.displayName.toLowerCase().includes(needle);
  });

  /** Per-row entitlement editor state: expanded uid + expiry input. */
  const [entitleExpanded, setEntitleExpanded] = useState<string | null>(null);
  const [expiryInput, setExpiryInput] = useState("");
  const [grantReason, setGrantReason] = useState("");

  const toggleEntitlement = (uid: string) => {
    if (entitleExpanded === uid) {
      setEntitleExpanded(null);
      return;
    }
    setEntitleExpanded(uid);
    setExpiryInput("");
    setGrantReason("");
    onLoadEntitlement(uid);
  };

  const parseExpiryInput = (): Date | null => {
    const raw = expiryInput.trim();
    if (raw === "") return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const renderEntitlement = (row: AdminAccountRow) => {
    const cell = entitlements[row.uid];
    const premium = cell !== "loading" && cell !== null && cell !== undefined && cell.premiumActive;
    const self = actorUid === row.uid;
    const expiryText = cell !== "loading" && cell !== null && cell !== undefined ? cell.expiryLabel : "";
    return (
      <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2" data-testid={`entitlement-section-${row.uid}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 font-bold ${premium ? "bg-[#eef2ff] text-[#3f4bb8]" : "bg-slate-100 text-slate-500"}`}
            data-testid={`tier-badge-${row.uid}`}
          >
            {premium ? "Premium" : "Free"}
          </span>
          {premium && expiryText ? (
            <span className="text-slate-500" data-testid={`tier-expiry-${row.uid}`}>
              {expiryText === "no expiry" ? "no expiry" : `expires ${expiryText}`}
            </span>
          ) : null}
          {cell === undefined ? <span className="text-slate-400">loading…</span> : null}
          {cell === null ? <span className="text-slate-400">no entitlement record</span> : null}
          {self ? <span className="text-slate-400">(owner account — use the documented CLI for your own record)</span> : null}
        </div>
        {!self ? (
          entitleExpanded === row.uid ? (
            <div className="mt-2 grid gap-1.5">
              <label className="grid gap-0.5 text-[11px] font-semibold text-slate-600">
                Expiry (optional — blank = no expiry)
                <input
                  type="date"
                  value={expiryInput}
                  onChange={(event) => setExpiryInput(event.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
                  aria-label="Premium expiry date"
                />
              </label>
              <input
                type="text"
                value={grantReason}
                onChange={(event) => setGrantReason(event.target.value)}
                placeholder="Reason (optional, shown to admins)"
                maxLength={280}
                aria-label="Entitlement reason"
                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
              />
              <span className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={entitleUid === row.uid}
                  data-testid={`grant-premium-${row.uid}`}
                  onClick={() => onGrant(row, parseExpiryInput(), grantReason)}
                  className="btn-success !min-h-8 !px-3 !py-1.5 text-xs"
                >
                  {entitleUid === row.uid ? "Working…" : premium ? "Update / extend Premium" : "Grant Premium"}
                </button>
                {premium ? (
                  <button
                    type="button"
                    disabled={entitleUid === row.uid}
                    data-testid={`revoke-premium-${row.uid}`}
                    onClick={() => onRevoke(row, grantReason)}
                    className="btn-secondary !min-h-8 !px-3 !py-1.5 text-xs !text-red-700"
                  >
                    Revoke Premium
                  </button>
                ) : null}
                <button type="button" onClick={() => setEntitleExpanded(null)} className="btn-secondary !min-h-8 !px-3 !py-1.5 text-xs">
                  Close
                </button>
              </span>
              <p className="text-[10.5px] leading-4 text-slate-500">
                Manual activation only — no payment gateway exists. Revoking keeps stored data; Premium features lock until re-granted.
                Changes are verified by a server read-back before the UI confirms.
              </p>
            </div>
          ) : (
            <button
              type="button"
              className="btn-secondary mt-2 !min-h-8 !px-3 !py-1.5 text-xs"
              data-testid={`manage-entitlement-${row.uid}`}
              onClick={() => toggleEntitlement(row.uid)}
            >
              Manage Premium access
            </button>
          )
        ) : null}
      </div>
    );
  };

  return (
    <div className="grid content-start gap-5">
      <div>
        <h1 data-testid="admin-users-heading" className="text-[19px] font-bold tracking-[-0.01em] text-[#16244a] sm:text-[21px]">Users</h1>
        <p className="mt-1 text-[12.5px] leading-5 text-[#5a6b85]">
          Registered-account directory from Firestore — <strong>not</strong> the Firebase Auth user list
          (browsers can never enumerate Auth users). Superadmin authorization comes from the Auth custom
          claim, re-checked by security rules on every request.
        </p>
      </div>

      <section aria-label="Registered accounts" className="surface-card rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">Registered accounts</h2>
          <span data-testid="admin-counts" className="text-xs text-slate-500">
            {counts.total} shown · {counts.active} active · {counts.suspended} suspended
            {listTruncated ? " · more pages available" : ""}
          </span>
          <span className="ml-auto flex gap-2">
            <button type="button" onClick={onReload} disabled={loadingList} className="btn-secondary !min-h-9 !px-3 !py-1.5 text-xs">
              {loadingList ? "Loading…" : "Reload list"}
            </button>
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            type="search"
            value={filterText}
            onChange={(event) => onFilterText(event.target.value)}
            placeholder="Filter by uid, email, or name"
            aria-label="Filter accounts"
            className="min-w-52 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          {(["all", "active", "suspended"] as const).map((value) => (
            <label key={value} className="flex cursor-pointer items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1.5 text-[11px] font-bold text-slate-700">
              <input
                type="radio"
                name="admin-status-filter"
                checked={filterStatus === value}
                onChange={() => onFilterStatus(value)}
                className="h-3.5 w-3.5 accent-[#0d9474]"
              />
              {value === "all" ? "All" : value === "active" ? "Active" : "Suspended"}
            </label>
          ))}
        </div>
        {loadingList && rows.length === 0 ? (
          <p role="status" className="mt-4 text-xs text-slate-500">Loading accounts…</p>
        ) : visible.length === 0 ? (
          <p className="mt-4 text-xs text-slate-500">
            {rows.length === 0 ? "No registered accounts yet — accounts appear here after their first Google sign-in." : "No accounts match this filter."}
          </p>
        ) : (
          <ul data-testid="admin-user-list" className="mt-3 grid gap-2">
            {visible.map((row) => (
              <li key={row.uid} className="grid gap-2 rounded-xl border border-slate-200 p-3 text-xs sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="truncate font-bold text-slate-900" title="Display name is an unverified Google profile snapshot.">
                    {row.displayName || "(no display name)"} <span className="font-normal text-slate-500">{row.email} <span className="text-[10px] font-normal">(Auth-bound email)</span></span>
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">{row.uid}</p>
                  <p className="mt-1">
                    <span className={`rounded-full px-2 py-0.5 font-bold ${row.status === "active" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
                      {row.status}
                    </span>
                    {row.statusReason ? <span className="ml-2 text-slate-500">Note: {row.statusReason}</span> : null}
                  </p>
                  {confirmUid === row.uid ? (
                    <div className="mt-2 rounded-lg bg-amber-50 p-2">
                      <p className="font-semibold text-amber-900">
                        {row.status === "active"
                          ? "Suspend this account's signed-in cloud features (profile + admin)? Google login and anonymous cleaning stay available."
                          : "Restore this account's signed-in cloud features?"}
                      </p>
                      {row.status === "active" ? (
                        <input
                          type="text"
                          value={reason}
                          onChange={(event) => onReason(event.target.value)}
                          placeholder="Reason (optional, shown to admins)"
                          maxLength={280}
                          aria-label="Suspension reason"
                          className="mt-2 w-full rounded-lg border border-amber-200 bg-white px-2 py-1.5 text-xs"
                        />
                      ) : null}
                      <span className="mt-2 flex gap-2">
                        <button
                          type="button"
                          disabled={actingUid === row.uid}
                          onClick={() => onStatus(row, row.status === "active" ? "suspended" : "active")}
                          className="btn-success !min-h-9 !px-3 !py-1.5 text-xs"
                        >
                          {actingUid === row.uid ? "Working…" : `Confirm ${row.status === "active" ? "suspend" : "restore"}`}
                        </button>
                        <button type="button" onClick={() => { onConfirmUid(null); onReason(""); }} className="btn-secondary !min-h-9 !px-3 !py-1.5 text-xs">
                          Cancel
                        </button>
                      </span>
                    </div>
                  ) : null}
                  {renderEntitlement(row)}
                </div>
                <div className="flex gap-2 sm:justify-end">
                  {row.status === "active" ? (
                    <button
                      type="button"
                      disabled={actingUid === row.uid || actorUid === row.uid}
                      title={actorUid === row.uid ? "You cannot suspend your own owner account here." : "Suspend cloud-feature access"}
                      onClick={() => onConfirmUid(row.uid)}
                      className="btn-secondary !min-h-9 !px-3 !py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Suspend
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={actingUid === row.uid}
                      onClick={() => onConfirmUid(row.uid)}
                      className="btn-secondary !min-h-9 !px-3 !py-1.5 text-xs"
                    >
                      Restore
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {cursor ? (
          <button type="button" data-testid="admin-load-more" onClick={onLoadMore} disabled={loadingList} className="btn-secondary mt-3 !min-h-9 !px-3 !py-1.5 text-xs">
            {loadingList ? "Loading…" : "Load more"}
          </button>
        ) : null}
        <p className="mt-3 text-[11px] text-slate-500">
          Accounts that signed in before the directory existed (Auth-only) cannot be suspended from
          here until their record exists — they will appear after their next sign-in (automatic
          self-registration) or via the owner backfill step in docs/10-admin-setup.md. Suspending
          never disables the Firebase Auth user itself.
        </p>
      </section>
    </div>
  );
}
