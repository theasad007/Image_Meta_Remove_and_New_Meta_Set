"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { signInWithGoogle } from "../../src/lib/firebase/auth";
import { isFirebaseConfigured } from "../../src/lib/firebase/config";
import { fetchSessionUser, refreshSessionToken, type SessionUser } from "../../src/lib/firebase/session";
import {
  DEFAULT_USAGE_POLICY,
  fetchUsagePolicy,
  listAccountPage,
  saveUsagePolicy,
  setAccountStatus,
  type AccountStatus,
  type AdminAccountRow,
  type UsagePolicy,
} from "../../src/lib/firebase/directory";

/**
 * Owner dashboard (Phase 6A). Static-export safe: everything runs
 * client-side behind a custom-claim route guard (`superadmin: true`).
 * Hiding this UI is never the access control — `firestore.rules` enforces
 * listing, reads, status flips, and settings writes independently.
 *
 * Honest scope: suspending flips a Firestore status that gates signed-in
 * CLOUD features (profile + admin reads). It does NOT revoke Google
 * login, disable the Firebase Auth user, or affect anonymous
 * browser-only cleaning. Genuine Auth disables need the owner-run Admin
 * SDK (see docs/10-admin-setup.md), never this browser page.
 */
export default function AdminPage() {
  const configured = isFirebaseConfigured();
  const [session, setSession] = useState<SessionUser | null | undefined>(() =>
    configured ? undefined : null,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  const [rows, setRows] = useState<AdminAccountRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [listTruncated, setListTruncated] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | AccountStatus>("all");
  const [actingUid, setActingUid] = useState<string | null>(null);
  const [confirmUid, setConfirmUid] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const [policy, setPolicy] = useState<UsagePolicy>({ ...DEFAULT_USAGE_POLICY });
  const [policyLoaded, setPolicyLoaded] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);

  useEffect(() => {
    if (!configured || session !== undefined) return;
    let active = true;
    void fetchSessionUser().then((next) => {
      if (active) setSession(next);
    }).catch(() => {
      if (active) {
        setSession(null);
        setFatal("Could not reach authentication. Guest cleaning on the homepage is unaffected.");
      }
    });
    return () => {
      active = false;
    };
  }, [configured, session]);

  const loadPage = useCallback(async (startAfter: string | null, append: boolean) => {
    setLoadingList(true);
    setFatal(null);
    try {
      const page = await listAccountPage(50, startAfter);
      setRows((previous) => (append ? [...previous, ...page.rows] : page.rows));
      setCursor(page.nextCursor);
      setListTruncated(page.nextCursor !== null);
    } catch (err) {
      setFatal(err instanceof Error ? err.message.slice(0, 300) : "Could not load the account directory.");
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadPolicy = useCallback(async () => {
    try {
      setPolicy(await fetchUsagePolicy());
      setPolicyLoaded(true);
    } catch (err) {
      setFatal(err instanceof Error ? err.message.slice(0, 300) : "Could not load usage policy.");
    }
  }, []);

  useEffect(() => {
    if (!session?.superadmin || rows.length > 0 || loadingList) return;
    // Initial superadmin data load (user-initiated reloads go through the
    // buttons below, which own their loading states).
    void (async () => {
      await loadPage(null, false);
      await loadPolicy();
    })();
  }, [session, rows.length, loadingList, loadPage, loadPolicy]);

  const handleSignIn = async () => {
    setSigningIn(true);
    setFatal(null);
    try {
      const outcome = await signInWithGoogle();
      if (outcome.status === "signed-in") {
        setSession((await fetchSessionUser().catch(() => null)) ?? { ...outcome.user, superadmin: false });
      } else if (outcome.status === "error") {
        setFatal(outcome.message);
      }
    } catch (err) {
      setFatal(err instanceof Error ? err.message.slice(0, 300) : "Sign-in failed.");
    } finally {
      setSigningIn(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const next = await refreshSessionToken();
      setSession(next);
      setNotice(next?.superadmin
        ? "Role status refreshed — superadmin claim present."
        : "Role status refreshed — no superadmin claim on this account. If the owner just promoted you, sign out and back in.");
    } catch {
      setFatal("Token refresh failed. Check your connection and try again.");
    } finally {
      setRefreshing(false);
    }
  };

  const handleStatus = async (row: AdminAccountRow, next: AccountStatus) => {
    if (!session) return;
    setActingUid(row.uid);
    setFatal(null);
    setNotice(null);
    try {
      await setAccountStatus(session.uid, row, next, reason.trim());
      setRows((previous) => previous.map((item) => (item.uid === row.uid ? { ...item, status: next } : item)));
      setConfirmUid(null);
      setReason("");
      setNotice(next === "suspended"
        ? `${row.email || row.uid} is suspended from signed-in cloud features only (profile + admin). Google login and anonymous browser cleaning are unaffected.`
        : `${row.email || row.uid} is restored to active.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Status change failed.";
      setFatal(message.includes("backfill") ? `${message}` : message.slice(0, 300));
    } finally {
      setActingUid(null);
    }
  };

  const handleSavePolicy = async () => {
    if (!session) return;
    setSavingPolicy(true);
    setFatal(null);
    try {
      await saveUsagePolicy(session.uid, policy);
      setNotice("Usage-policy values recorded. They are NOT enforced — guest processing stays unlimited (see badges).");
    } catch (err) {
      setFatal(err instanceof Error ? err.message.slice(0, 300) : "Could not save usage policy.");
    } finally {
      setSavingPolicy(false);
    }
  };

  const visible = useMemo(() => {
    const needle = filterText.trim().toLowerCase();
    return rows.filter((row) => {
      if (filterStatus !== "all" && row.status !== filterStatus) return false;
      if (needle === "") return true;
      return row.uid.toLowerCase().includes(needle)
        || row.email.toLowerCase().includes(needle)
        || row.displayName.toLowerCase().includes(needle);
    });
  }, [rows, filterText, filterStatus]);

  const counts = useMemo(() => ({
    total: rows.length,
    active: rows.filter((row) => row.status === "active").length,
    suspended: rows.filter((row) => row.status === "suspended").length,
  }), [rows]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <p>
        <a href="./" className="text-sm font-semibold text-slate-600 hover:text-slate-950">← Back to the cleaner</a>
      </p>
      <h1 className="mt-3 text-2xl font-extrabold tracking-[-0.02em] text-slate-950">Admin Dashboard</h1>
      <p className="mt-2 text-xs leading-5 text-slate-600">
        Registered-account directory from Firestore — <strong>not</strong> the Firebase Auth user list
        (browsers can never enumerate Auth users). Superadmin authorization comes from the Auth custom
        claim, re-checked by security rules on every request.
      </p>

      {!configured ? (
        <section aria-label="Not configured" data-testid="admin-denied" className="surface-card mt-6 rounded-2xl p-5">
          <h2 className="text-base font-semibold">Google sign-in is not configured</h2>
          <p className="mt-2 text-xs text-slate-600">
            Add the Firebase web settings (`.env.local`), rebuild, and redeploy before using this page.
            Guest cleaning on the homepage works fully without sign-in.
          </p>
        </section>
      ) : session === undefined ? (
        <p role="status" className="mt-6 text-sm text-slate-600">Checking sign-in status…</p>
      ) : !session ? (
        <section aria-label="Admin sign-in required" data-testid="admin-denied" className="surface-card mt-6 rounded-2xl p-5">
          <h2 className="text-base font-semibold">Admin sign-in required</h2>
          <p className="mt-2 text-xs text-slate-600">
            Sign in with the owner Google account. Ordinary signed-in users never see admin data —
            this page and the security rules both deny them.
          </p>
          <button type="button" onClick={() => void handleSignIn()} disabled={signingIn} className="btn-success mt-4 !min-h-10 text-xs">
            {signingIn ? "Opening Google…" : "Sign in with Google"}
          </button>
        </section>
      ) : !session.superadmin ? (
        <section aria-label="Access denied" data-testid="admin-denied" className="surface-card mt-6 rounded-2xl p-5">
          <h2 className="text-base font-semibold">Access denied</h2>
          <p className="mt-2 text-xs text-slate-600">
            Signed in as {session.email ?? session.uid}, but this account has no superadmin claim.
            If the owner just promoted this account, refresh the login status below (ID tokens refresh
            on re-authentication).
          </p>
          <button type="button" onClick={() => void handleRefresh()} disabled={refreshing} className="btn-secondary mt-4 !min-h-10 text-xs">
            {refreshing ? "Refreshing…" : "Refresh login status"}
          </button>
        </section>
      ) : (
        <>
          <section aria-label="Accounts" className="surface-card mt-6 rounded-2xl p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">Registered accounts</h2>
              <span data-testid="admin-counts" className="text-xs text-slate-500">
                {counts.total} shown · {counts.active} active · {counts.suspended} suspended
                {listTruncated ? " · more pages available" : ""}
              </span>
              <span className="ml-auto flex gap-2">
                <button type="button" onClick={() => void handleRefresh()} disabled={refreshing} className="btn-secondary !min-h-9 !px-3 !py-1.5 text-xs">
                  {refreshing ? "Refreshing…" : "Refresh login status"}
                </button>
                <button type="button" onClick={() => void loadPage(null, false)} disabled={loadingList} className="btn-secondary !min-h-9 !px-3 !py-1.5 text-xs">
                  Reload list
                </button>
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                type="search"
                value={filterText}
                onChange={(event) => setFilterText(event.target.value)}
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
                    onChange={() => setFilterStatus(value)}
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
                      <p className="truncate font-bold text-slate-900">{row.displayName || "(no display name)"} <span className="font-normal text-slate-500">{row.email}</span></p>
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
                              onChange={(event) => setReason(event.target.value)}
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
                              onClick={() => void handleStatus(row, row.status === "active" ? "suspended" : "active")}
                              className="btn-success !min-h-9 !px-3 !py-1.5 text-xs"
                            >
                              {actingUid === row.uid ? "Working…" : `Confirm ${row.status === "active" ? "suspend" : "restore"}`}
                            </button>
                            <button type="button" onClick={() => { setConfirmUid(null); setReason(""); }} className="btn-secondary !min-h-9 !px-3 !py-1.5 text-xs">
                              Cancel
                            </button>
                          </span>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex gap-2 sm:justify-end">
                      {row.status === "active" ? (
                        <button
                          type="button"
                          disabled={actingUid === row.uid || session.uid === row.uid}
                          title={session.uid === row.uid ? "You cannot suspend your own owner account here." : "Suspend cloud-feature access"}
                          onClick={() => setConfirmUid(row.uid)}
                          className="btn-secondary !min-h-9 !px-3 !py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Suspend
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={actingUid === row.uid}
                          onClick={() => setConfirmUid(row.uid)}
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
              <button type="button" onClick={() => void loadPage(cursor, true)} disabled={loadingList} className="btn-secondary mt-3 !min-h-9 !px-3 !py-1.5 text-xs">
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

          <section aria-label="Usage policy" className="surface-card mt-6 rounded-2xl p-5">
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
                        setPolicy((previous) => ({ ...previous, [field]: raw === "" ? null : Math.max(0, Math.min(1000000, Math.floor(Number(raw)))) }));
                      }}
                      placeholder="No cap"
                      className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal"
                    />
                  </label>
                ))}
              </div>
            )}
            <button type="button" onClick={() => void handleSavePolicy()} disabled={savingPolicy || !policyLoaded} className="btn-secondary mt-3 !min-h-10 text-xs">
              {savingPolicy ? "Saving…" : "Record future policy values (not enforced)"}
            </button>
          </section>
        </>
      )}

      {notice ? <p role="status" className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-900">{notice}</p> : null}
      {fatal ? <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-800">{fatal}</p> : null}
    </main>
  );
}
