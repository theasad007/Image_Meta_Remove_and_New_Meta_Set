"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FeaturePolicy, PolicyProvenance } from "../firebase/feature-policy";
import { DEFAULT_FEATURE_POLICY, fetchFeaturePolicyWithProvenance } from "../firebase/feature-policy";
import { fetchOwnEntitlement } from "../firebase/entitlement";
import { fetchSessionUser, type SessionUser } from "../firebase/session";
import { subscribeAuthState } from "../firebase/auth";
import type { UserEntitlement } from "./policy-state";

export type PolicyLoadState = "defaults" | "loaded" | "degraded";

/**
 * SOL-014: every policy read reports WHERE its values came from, so a
 * degraded read is observable instead of silently masquerading as loaded.
 */
export const PROVENANCE_LOAD_STATE: Record<PolicyProvenance, PolicyLoadState> = {
  "remote": "loaded",
  "missing-default": "degraded",
  "malformed-default": "degraded",
  "error-default": "degraded",
  "unconfigured-default": "degraded",
};

export interface FeaturePolicyState {
  /** Last-known policy map (defaults until a fetch lands). */
  policy: FeaturePolicy;
  session: SessionUser | null;
  entitlement: UserEntitlement | null;
  loadState: PolicyLoadState;
  /** Why the current values are what they are (SOL-014 diagnostics). */
  provenance: PolicyProvenance | null;
  /**
   * SOL-002: false until Firebase Auth has resolved its initial state
   * (signed-in or guest). While false, a premium gate must show a
   * "checking access" state — NEVER a final denial — because a restored
   * session may still be arriving.
   */
  authReady: boolean;
  /**
   * Fetch-on-demand: resolves the CURRENT server policy (cached for
   * `POLICY_TTL_MS`; `force: true` always bypasses the cache — protected
   * action authorization must never read a stale entry).
   *
   * Privacy/behavior contract: NOTHING touches the network on page load —
   * guests browsing, inspecting and single-file cleaning stay completely
   * offline. Only actions governed by an admin-adjustable feature call
   * this, and the request carries only the sanitized policy document path
   * (never media, metadata, filenames, or GPS).
   */
  refreshPolicy: (options?: { force?: boolean }) => Promise<FeaturePolicy>;
  /** Re-read the signed-in user's entitlement (revocation safety check).
   *  Returns the fresh view (null for guests/absent). */
  refreshEntitlement: () => Promise<UserEntitlement | null>;
}

const POLICY_TTL_MS = 60_000;

/**
 * Workspace-facing policy + entitlement state (Phases 02/03, SOL-002/014).
 *
 * LAZY by design: no Firestore subscription, no load-time policy fetch, no
 * hydration mismatch. AUTH is the exception (SOL-002): Auth restoration is
 * subscribed reactively, because a page reload that restores a signed-in
 * session MUST eventually surface that session — a one-shot fetch races
 * the SDK and would leave a Premium user mislabeled as a guest. Only the
 * local session/entitlement views update on auth changes; no policy
 * document is read until a policy-adjustable action asks for one.
 */
export function useFeaturePolicy(): FeaturePolicyState {
  const [policy, setPolicy] = useState<FeaturePolicy>(DEFAULT_FEATURE_POLICY);
  const [session, setSession] = useState<SessionUser | null>(null);
  const [entitlement, setEntitlement] = useState<UserEntitlement | null>(null);
  const [loadState, setLoadState] = useState<PolicyLoadState>("defaults");
  const [provenance, setProvenance] = useState<PolicyProvenance | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const policyRef = useRef<FeaturePolicy>(DEFAULT_FEATURE_POLICY);
  const fetchedAtRef = useRef(0);
  const inFlightRef = useRef<Promise<FeaturePolicy> | null>(null);
  // Stale-response guards (SOL-002): a late entitlement/session response
  // for a previous UID (or an unmounted hook) must never overwrite state.
  const activeRef = useRef(true);
  const sessionUidRef = useRef<string | null>(null);
  const entitlementRequestRef = useRef(0);
  // Multiple controls can preflight the same action in one event loop turn.
  // Share that read instead of creating a Firestore request fan-out; each
  // later action still gets a fresh request once this promise settles.
  const entitlementInFlightRef = useRef<{ uid: string; promise: Promise<UserEntitlement | null> } | null>(null);

  useEffect(() => {
    activeRef.current = true;
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;

    const loadEntitlementFor = (uid: string) => {
      const requestId = ++entitlementRequestRef.current;
      void (async () => {
        const view = await fetchOwnEntitlement(uid).catch(() => null);
        if (!activeRef.current || requestId !== entitlementRequestRef.current) return;
        setEntitlement(view
          ? { tier: view.tier, status: view.status, expiresAt: view.expiresAt }
          : null);
      })();
    };

    void (async () => {
      try {
        unsubscribe = await subscribeAuthState((user) => {
          if (cancelled || !activeRef.current) return;
          const uid = user?.uid ?? null;
          // Same user re-emitted (token refresh) → nothing to redo.
          if (uid === sessionUidRef.current) {
            setAuthReady(true);
            return;
          }
          sessionUidRef.current = uid;
          // User switch / sign-out: drop the OLD entitlement immediately.
          entitlementRequestRef.current += 1;
          setEntitlement(null);
          setAuthReady(true);
          if (!uid) {
            setSession(null);
            return;
          }
          void (async () => {
            // Claims (superadmin) come from the ID token, not the event user.
            const full = await fetchSessionUser().catch(() => null);
            if (!activeRef.current || full?.uid !== sessionUidRef.current) return;
            setSession(full);
            loadEntitlementFor(full.uid);
          })();
        });
      } catch {
        // Firebase unconfigured (offline demo build): guest, ready, no fetch.
        if (!cancelled && activeRef.current) {
          setAuthReady(true);
          setSession(null);
        }
      }
    })();

    return () => {
      cancelled = true;
      activeRef.current = false;
      unsubscribe?.();
    };
  }, []);

  const refreshPolicy = useCallback(async (options?: { force?: boolean }): Promise<FeaturePolicy> => {
    const now = Date.now();
    if (!options?.force && inFlightRef.current === null && now - fetchedAtRef.current < POLICY_TTL_MS) {
      return policyRef.current;
    }
    if (inFlightRef.current) return inFlightRef.current;
    const fetchPromise = fetchFeaturePolicyWithProvenance()
      .then(({ policy: next, provenance: source }) => {
        policyRef.current = next;
        fetchedAtRef.current = Date.now();
        setPolicy(next);
        setProvenance(source);
        // SOL-014: only a genuine remote read counts as "loaded".
        setLoadState(PROVENANCE_LOAD_STATE[source]);
        return next;
      })
      .finally(() => {
        inFlightRef.current = null;
      });
    inFlightRef.current = fetchPromise;
    return fetchPromise;
  }, []);

  const refreshEntitlement = useCallback(async (): Promise<UserEntitlement | null> => {
    const user = await fetchSessionUser().catch(() => null);
    if (!user) {
      // Only clear when the session truly has no user (not for a stale
      // read while another UID's fetch is in flight).
      if (sessionUidRef.current === null) setEntitlement(null);
      return null;
    }
    const inFlight = entitlementInFlightRef.current;
    if (inFlight?.uid === user.uid) return inFlight.promise;
    const requestId = ++entitlementRequestRef.current;
    setSession(user);
    const promise = fetchOwnEntitlement(user.uid)
      .catch(() => null)
      .then((view) => {
        if (requestId !== entitlementRequestRef.current) {
          // A newer request superseded this one — its result is authoritative.
          return null;
        }
        const next = view
          ? { tier: view.tier, status: view.status, expiresAt: view.expiresAt }
          : null;
        setEntitlement(next);
        return next;
      })
      .finally(() => {
        if (entitlementInFlightRef.current?.promise === promise) entitlementInFlightRef.current = null;
      });
    entitlementInFlightRef.current = { uid: user.uid, promise };
    return promise;
  }, []);

  return { policy, session, entitlement, loadState, provenance, authReady, refreshPolicy, refreshEntitlement };
}
