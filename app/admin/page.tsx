"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { signInWithGoogle, signOutNow, subscribeAuthState } from "../../src/lib/firebase/auth";
import { isFirebaseConfigured } from "../../src/lib/firebase/config";
import { fetchSessionUser, refreshSessionToken, type SessionUser } from "../../src/lib/firebase/session";
import {
  DEFAULT_USAGE_POLICY,
  fetchAdminDirectoryTotals,
  fetchOwnStatus,
  fetchUsagePolicy,
  listAccountPage,
  listRecentAccounts,
  saveUsagePolicy,
  setAccountStatus,
  type AccountStatus,
  type AdminAccountRow,
  type AdminDirectoryTotals,
  type UsagePolicy,
} from "../../src/lib/firebase/directory";
import AdminShell, { type AdminTab } from "../../src/components/admin/AdminShell";
import AdminDashboard from "../../src/components/admin/AdminDashboard";
import AdminUsersPanel from "../../src/components/admin/AdminUsersPanel";
import AdminSettingsPanel from "../../src/components/admin/AdminSettingsPanel";
import FeaturePolicyPanel from "../../src/components/admin/FeaturePolicyPanel";
import type { EntitlementCell } from "../../src/components/admin/AdminUsersPanel";
import {
  fetchEntitlementForAdmin,
  grantPremium,
  revokePremium,
  type EntitlementView,
} from "../../src/lib/firebase/entitlement";
import {
  DEFAULT_FEATURE_POLICY,
  fetchFeaturePolicy,
  saveFeaturePolicy,
  type FeatureKey,
  type FeaturePolicy,
  type FeaturePolicyMap,
} from "../../src/lib/firebase/feature-policy";

/**
 * Screen 08: Super Admin Dashboard (Phase 6A foundation + Screen 08 shell).
 * Static-export safe: everything runs client-side behind a custom-claim
 * route guard (`superadmin: true`). Hiding UI is never the access control
 * — `firestore.rules` enforces listing, reads, status flips and settings
 * writes independently, and directory totals use real server count
 * queries. Processing statistics are never invented: they are marked
 * "Not collected — processing stays private."
 *
 * Honest scope of suspension (unchanged from Phase 6A): flipping a
 * Firestore status gates signed-in CLOUD features (profile + admin
 * reads). It does NOT revoke Google login, disable the Firebase Auth
 * user, or affect anonymous browser-only cleaning. Genuine Auth disables
 * need the owner-run Admin SDK (docs/10-admin-setup.md).
 */
export default function AdminPage() {
  const configured = isFirebaseConfigured();
  const [session, setSession] = useState<SessionUser | null | undefined>(() =>
    configured ? undefined : null,
  );
  const [suspended, setSuspended] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  const [tab, setTab] = useState<AdminTab>("overview");

  const [rows, setRows] = useState<AdminAccountRow[]>([]);
  // Overview "Recent users" — a dedicated createdAt-descending server query
  // (never the uid-ordered first page); null while not yet loaded.
  const [recent, setRecent] = useState<AdminAccountRow[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [listTruncated, setListTruncated] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | AccountStatus>("all");
  const [actingUid, setActingUid] = useState<string | null>(null);
  const [confirmUid, setConfirmUid] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const [totals, setTotals] = useState<AdminDirectoryTotals | null>(null);
  const [totalsLoading, setTotalsLoading] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);

  const [policy, setPolicy] = useState<UsagePolicy>({ ...DEFAULT_USAGE_POLICY });
  const [policyLoaded, setPolicyLoaded] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);

  // ---- Feature policy (Phase 02): state, load, toggle/save --------------
  const [featurePolicy, setFeaturePolicy] = useState<FeaturePolicy>({ ...DEFAULT_FEATURE_POLICY });
  const [featurePolicyLoaded, setFeaturePolicyLoaded] = useState(false);
  const [featurePolicyDegraded, setFeaturePolicyDegraded] = useState(false);
  const [savingFeaturePolicy, setSavingFeaturePolicy] = useState(false);

  const loadFeaturePolicy = useCallback(async () => {
    setFeaturePolicy(await fetchFeaturePolicy());
    setFeaturePolicyLoaded(true);
    setFeaturePolicyDegraded(false);
  }, []);

  // ---- Manual Premium entitlements (Phase 03) ----------------------------
  const [entitlements, setEntitlements] = useState<Record<string, EntitlementCell>>({});
  const [entitleUid, setEntitleUid] = useState<string | null>(null);

  /** Derive the display model at FETCH time (not render): effective
   *  premium status depends on "now", which belongs in event handlers. */
  const toCell = useCallback((view: EntitlementView | null): EntitlementCell => {
    if (!view) return null;
    const expiresMs = view.expiresAt !== null ? Date.parse(view.expiresAt) : Number.NaN;
    const expiredByTime = !Number.isNaN(expiresMs) && expiresMs <= Date.now();
    const premium = view.tier === "premium" && view.status === "active" && !expiredByTime;
    const label = !Number.isNaN(expiresMs)
      ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(expiresMs)
      : view.tier === "premium" && view.status === "active" ? "no expiry" : "";
    return { view, premiumActive: premium, expiryLabel: label };
  }, []);

  const loadEntitlement = useCallback(async (uid: string) => {
    setEntitlements((previous) => ({ ...previous, [uid]: "loading" }));
    try {
      const view = await fetchEntitlementForAdmin(uid);
      setEntitlements((previous) => ({ ...previous, [uid]: toCell(view) }));
    } catch {
      setEntitlements((previous) => ({ ...previous, [uid]: null }));
    }
  }, [toCell]);

  const handleGrantPremium = async (row: AdminAccountRow, expiresAt: Date | null, grantReason: string) => {
    if (!session) return;
    setEntitleUid(row.uid);
    setFatal(null);
    try {
      await grantPremium(session.uid, row.uid, { expiresAt, reason: grantReason || undefined });
      // Read-back before claiming success (roadmap 03 §2).
      const stored = await fetchEntitlementForAdmin(row.uid);
      setEntitlements((previous) => ({ ...previous, [row.uid]: toCell(stored) }));
      const cell = toCell(stored);
      if (cell && cell !== "loading" && cell.premiumActive) {
        setNotice(`Premium granted for ${row.email || row.uid}${cell.expiryLabel && cell.expiryLabel !== "no expiry" ? ` (expires ${cell.expiryLabel})` : " (no expiry)"}. Manual activation — no payment involved.`);
      } else {
        setFatal("The entitlement write was accepted but the read-back does not show active Premium — re-check the panel.");
      }
    } catch (err) {
      setFatal(err instanceof Error ? err.message.slice(0, 300) : "Could not grant Premium.");
    } finally {
      setEntitleUid(null);
    }
  };

  const handleRevokePremium = async (row: AdminAccountRow, revokeReason: string) => {
    if (!session) return;
    setEntitleUid(row.uid);
    setFatal(null);
    try {
      await revokePremium(session.uid, row.uid, revokeReason || undefined);
      const stored = await fetchEntitlementForAdmin(row.uid);
      setEntitlements((previous) => ({ ...previous, [row.uid]: toCell(stored) }));
      setNotice(`Premium revoked for ${row.email || row.uid}. Their stored data is kept; Premium features lock until re-granted.`);
    } catch (err) {
      setFatal(err instanceof Error ? err.message.slice(0, 300) : "Could not revoke Premium.");
    } finally {
      setEntitleUid(null);
    }
  };

  // Suspended superadmins keep their claim but lose all cloud reads; the
  // rules deny listing, so check honest access before rendering data.
  const checkOwnAccess = useCallback(async (next: SessionUser | null) => {
    if (!next) return false;
    try {
      setSuspended((await fetchOwnStatus(next.uid)) === "suspended");
      return true;
    } catch {
      return false;
    }
  }, []);

  // Auth state via subscription (restore-safe): a plain reload keeps the
  // session because onAuthStateChanged fires after the SDK restores the
  // stored user — a one-shot fetchSessionUser could race that restore and
  // show "sign-in required" to an actually signed-in owner.
  useEffect(() => {
    if (!configured) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void subscribeAuthState((user) => {
      if (!active) return;
      if (!user) {
        setSession(null);
        return;
      }
      void (async () => {
        const next = await fetchSessionUser().catch(() => null);
        if (!active) return;
        if (next) {
          setSession(next);
          void checkOwnAccess(next);
        } else {
          setSession({ ...user, superadmin: false });
        }
      })();
    }).then((stop) => {
      if (active) unsubscribe = stop;
      else stop();
    }).catch(() => {
      if (active) {
        setSession(null);
        setFatal("Could not reach authentication. Guest cleaning on the homepage is unaffected.");
      }
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [configured, checkOwnAccess]);

  const loadTotals = useCallback(async () => {
    setTotalsLoading(true);
    try {
      setTotals(await fetchAdminDirectoryTotals());
      setRefreshedAt(
        new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date()),
      );
    } catch {
      setTotals(null);
    } finally {
      setTotalsLoading(false);
    }
  }, []);

  const loadPage = useCallback(async (startAfter: string | null, append: boolean) => {
    setLoadingList(true);
    try {
      const page = await listAccountPage(50, startAfter);
      setRows((previous) => {
        if (!append) return page.rows;
        // Cursor-paged appends cannot overlap, but a defensively de-duplicated
        // merge keeps uid-keyed rows unique under any stale/retry race.
        const seen = new Set(previous.map((row) => row.uid));
        return [...previous, ...page.rows.filter((row) => !seen.has(row.uid))];
      });
      setCursor(page.nextCursor);
      setListTruncated(page.nextCursor !== null);
    } catch (err) {
      setFatal(err instanceof Error ? err.message.slice(0, 300) : "Could not load the account directory.");
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadRecent = useCallback(async () => {
    try {
      setRecent(await listRecentAccounts());
    } catch {
      // Same availability as every other directory read; the shell shows
      // an honest fatal notice and the card falls back to its empty state.
      setFatal((previous) => previous ?? "Could not load the recent-accounts list. Guest cleaning on the homepage is unaffected.");
      setRecent([]);
    }
  }, []);

  const loadPolicy = useCallback(async () => {
    try {
      setPolicy(await fetchUsagePolicy());
      setPolicyLoaded(true);
    } catch {
      setPolicyLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!session?.superadmin || suspended) return;
    if (rows.length > 0 || loadingList || totalsLoading) return;
    // Initial superadmin data load (user-initiated reloads go through the
    // buttons below, which own their loading states).
    void (async () => {
      await Promise.all([loadPage(null, false), loadTotals()]);
      await Promise.all([loadPolicy(), loadRecent(), loadFeaturePolicy()]);
    })();
  }, [session, suspended, rows.length, loadingList, totalsLoading, loadPage, loadTotals, loadPolicy, loadRecent, loadFeaturePolicy]);

  const handleSignIn = async () => {
    setSigningIn(true);
    setFatal(null);
    try {
      const outcome = await signInWithGoogle();
      if (outcome.status === "signed-in") {
        const next = (await fetchSessionUser().catch(() => null))
          ?? { ...outcome.user, superadmin: false };
        setSession(next);
        // The admin is a registered account like any other: sign-ins from
        // this page self-register the directory record (homepage parity).
        void (async () => {
          try {
            await ensureDirectory(next.uid, {
              email: next.email ?? "",
              displayName: next.displayName ?? "",
              photoURL: next.photoURL ?? "",
            });
          } catch {
            // Directory bookkeeping is best effort; loads still surface errors.
          }
          await checkOwnAccess(next);
        })();
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
      await checkOwnAccess(next);
      setNotice(next?.superadmin
        ? "Role status refreshed — superadmin claim present."
        : "Role status refreshed — no superadmin claim on this account. If the owner just promoted you, sign out and back in.");
    } catch {
      setFatal("Token refresh failed. Check your connection and try again.");
    } finally {
      setRefreshing(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOutNow();
      setSession(null);
      setSuspended(false);
      setTab("overview");
      setRows([]);
      setRecent(null);
      setTotals(null);
      setPolicy({ ...DEFAULT_USAGE_POLICY });
      setPolicyLoaded(false);
      setNotice("Signed out of the admin dashboard.");
    } catch {
      setFatal("Sign out failed. Close the browser tab to end the session.");
    }
  };

  const handleRefreshData = useCallback(async () => {
    setNotice(null);
    setFatal(null);
    await Promise.all([loadPage(null, false), loadTotals()]);
    await Promise.all([loadPolicy(), loadRecent(), loadFeaturePolicy()]);
  }, [loadPage, loadTotals, loadPolicy, loadRecent, loadFeaturePolicy]);

  const handleStatus = async (row: AdminAccountRow, next: AccountStatus) => {
    if (!session) return;
    setActingUid(row.uid);
    setFatal(null);
    setNotice(null);
    try {
      await setAccountStatus(session.uid, row, next, reason.trim());
      setRows((previous) => previous.map((item) => (item.uid === row.uid ? { ...item, status: next } : item)));
      setRecent((previous) => previous?.map((item) => (item.uid === row.uid ? { ...item, status: next } : item)) ?? previous);
      setConfirmUid(null);
      setReason("");
      setNotice(next === "suspended"
        ? `${row.email || row.uid} is suspended from signed-in cloud features only (profile + admin). Google login and anonymous browser cleaning are unaffected.`
        : `${row.email || row.uid} is restored to active.`);
      // Keep the overview metric cards in sync with the real directory.
      const refreshed = await fetchAdminDirectoryTotals();
      setTotals(refreshed);
      setRefreshedAt(
        new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date()),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Status change failed.";
      setFatal(message);
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

  // ---- Feature policy toggle/save (declared here; state above) ----------
  const handleToggleFeature = async (feature: FeatureKey, next: FeaturePolicyMap[FeatureKey]) => {
    if (!session) return;
    setSavingFeaturePolicy(true);
    setFatal(null);
    try {
      const nextFeatures = { ...featurePolicy.features, [feature]: next };
      await saveFeaturePolicy(session.uid, nextFeatures);
      // Confirmation read-back: the UI shows "saved" only after the server
      // accepted the write and the sanitized doc round-trips.
      const stored = await fetchFeaturePolicy();
      setFeaturePolicy(stored);
      setFeaturePolicyLoaded(true);
      setNotice(stored.features[feature] === next
        ? `Feature policy updated: ${feature.replace(/_/g, " ")} is now ${next}.`
        : `Feature policy saved, but the read-back value differs — re-check the panel.`);
    } catch (err) {
      setFatal(err instanceof Error ? err.message.slice(0, 300) : "Could not save the feature policy.");
    } finally {
      setSavingFeaturePolicy(false);
    }
  };

  const counts = useMemo(() => ({
    total: rows.length,
    active: rows.filter((row) => row.status === "active").length,
    suspended: rows.filter((row) => row.status === "suspended").length,
  }), [rows]);

  const renderFeedback = (
    <>
      {notice ? <p role="status" className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-900">{notice}</p> : null}
      {fatal ? <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-800">{fatal}</p> : null}
    </>
  );

  const guardCard = (title: string, children: React.ReactNode, action?: React.ReactNode, testid = "admin-denied") => (
    <section aria-label={title} data-testid={testid} className="surface-card rounded-2xl p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-2 text-xs leading-5 text-slate-600">{children}</p>
      {action}
    </section>
  );

  if (!configured) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <p><a href="./" className="text-sm font-semibold text-slate-600 hover:text-slate-950">← Back to the cleaner</a></p>
        {guardCard("Google sign-in is not configured", (
          <>Add the Firebase web settings (`.env.local`), rebuild, and redeploy before using this page.
          Guest cleaning on the homepage works fully without sign-in.</>
        ))}
      </main>
    );
  }

  if (session === undefined) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div role="status" data-testid="admin-loading" className="grid gap-2">
          <p className="text-sm font-semibold text-slate-700">Checking sign-in status…</p>
          <div className="grid gap-2" aria-hidden="true">
            <span className="h-4 w-56 animate-pulse rounded bg-slate-200" />
            <span className="h-4 w-72 max-w-full animate-pulse rounded bg-slate-100" />
          </div>
        </div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <p><a href="./" className="text-sm font-semibold text-slate-600 hover:text-slate-950">← Back to the cleaner</a></p>
        {guardCard("Admin sign-in required", (
          <>Sign in with the owner Google account. Ordinary signed-in users never see admin data —
          this page and the security rules both deny them.</>
        ), (
          <button type="button" onClick={() => void handleSignIn()} disabled={signingIn} className="btn-success mt-4 !min-h-10 text-xs">
            {signingIn ? "Opening Google…" : "Sign in with Google"}
          </button>
        ))}
        {renderFeedback}
      </main>
    );
  }

  if (!session.superadmin) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <p><a href="./" className="text-sm font-semibold text-slate-600 hover:text-slate-950">← Back to the cleaner</a></p>
        {guardCard("Access denied", (
          <>Signed in as {session.email ?? session.uid}, but this account has no superadmin claim.
          If the owner just promoted this account, refresh the login status below (ID tokens refresh
          on re-authentication).</>
        ), (
          <button type="button" onClick={() => void handleRefresh()} disabled={refreshing} className="btn-secondary mt-4 !min-h-10 text-xs">
            {refreshing ? "Refreshing…" : "Refresh login status"}
          </button>
        ))}
        {renderFeedback}
      </main>
    );
  }

  if (suspended) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <p><a href="./" className="text-sm font-semibold text-slate-600 hover:text-slate-950">← Back to the cleaner</a></p>
        {guardCard("This account's cloud access is suspended", (
          <>Safety rules deny every signed-in cloud read for suspended accounts — including the
          directory behind this dashboard. Public guest cleaning on the homepage is unaffected.</>
        ), undefined, "admin-restricted")}
        {renderFeedback}
      </main>
    );
  }

  return (
    <AdminShell
      tab={tab}
      onSelectTab={setTab}
      displayName={session.displayName || "Super Admin"}
      emailHint={session.email ?? ""}
      photoURL={session.photoURL ?? ""}
      refreshingRole={refreshing}
      onRefreshRole={() => void handleRefresh()}
      onSignOut={() => void handleSignOut()}
      onRefreshData={() => void handleRefreshData()}
    >
      <div className="mx-auto w-full max-w-[1120px]">
        {tab === "overview" ? (
          <AdminDashboard
            totals={totals}
            totalsLoading={totalsLoading}
            recent={recent}
            directoryLoading={loadingList || recent === null}
            refreshedAt={refreshedAt}
            onViewAllUsers={() => setTab("users")}
            onOpenSettings={() => setTab("settings")}
          />
        ) : tab === "users" ? (
          <AdminUsersPanel
            rows={rows}
            counts={counts}
            listTruncated={listTruncated}
            loadingList={loadingList}
            cursor={cursor}
            actorUid={session.uid}
            filterText={filterText}
            onFilterText={setFilterText}
            filterStatus={filterStatus}
            onFilterStatus={setFilterStatus}
            actingUid={actingUid}
            confirmUid={confirmUid}
            onConfirmUid={setConfirmUid}
            reason={reason}
            onReason={setReason}
            onStatus={(row, next) => void handleStatus(row, next)}
            entitlements={entitlements}
            onLoadEntitlement={(uid) => void loadEntitlement(uid)}
            onGrant={(row, expiresAt, grantReason) => void handleGrantPremium(row, expiresAt, grantReason)}
            onRevoke={(row, revokeReason) => void handleRevokePremium(row, revokeReason)}
            entitleUid={entitleUid}
            onLoadMore={() => void loadPage(cursor, true)}
            onReload={() => void loadPage(null, false)}
          />
        ) : (
          <>
            <AdminSettingsPanel
              policy={policy}
              onPolicy={setPolicy}
              policyLoaded={policyLoaded}
              savingPolicy={savingPolicy}
              onSave={() => void handleSavePolicy()}
            />
            <FeaturePolicyPanel
              policy={featurePolicy}
              policyLoaded={featurePolicyLoaded}
              degraded={featurePolicyDegraded}
              saving={savingFeaturePolicy}
              actorIsSuperadmin={Boolean(session?.superadmin) && !suspended}
              onToggle={(feature, next) => void handleToggleFeature(feature, next)}
            />
          </>
        )}
        {renderFeedback}
      </div>
    </AdminShell>
  );
}

async function ensureDirectory(
  uid: string,
  identity: { email: string; displayName: string; photoURL: string },
): Promise<void> {
  const { ensureAccountRecord } = await import("../../src/lib/firebase/directory");
  await ensureAccountRecord(uid, identity);
}
