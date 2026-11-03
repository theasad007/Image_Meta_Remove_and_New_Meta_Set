"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AuthPanel from "../../../src/components/auth/AuthPanel";
import AccountSidebar, { type ProfileSection } from "../../../src/components/profile/AccountSidebar";
import Footer from "../../../src/components/layout/Footer";
import Header from "../../../src/components/layout/Header";
import ProfileEditor from "../../../src/components/profile/ProfileEditor";
import ProfileHero from "../../../src/components/profile/ProfileHero";
import ProfilePreviewCard from "../../../src/components/profile/ProfilePreviewCard";
import RewritePanel from "../../../src/components/rewrite/RewritePanel";
import type { SignedInUser } from "../../../src/lib/firebase/auth";
import { subscribeAuthState } from "../../../src/lib/firebase/auth";
import { isFirebaseConfigured } from "../../../src/lib/firebase/config";
import { ensureAccountRecord, fetchOwnStatus } from "../../../src/lib/firebase/directory";
import { loadProfile } from "../../../src/lib/firebase/profile";
import { fetchOwnEntitlement, type EntitlementView } from "../../../src/lib/firebase/entitlement";
import ProjectsPanel from "../../../src/components/projects/ProjectsPanel";
import { fetchSessionUser } from "../../../src/lib/firebase/session";
import { blankProfile, type MetadataProfile, type ProfileField } from "../../../src/lib/metadata/rewrite/fields";
import type { RewriteMode } from "../../../src/lib/metadata/rewrite/rewrite";
import {
  DEFAULT_REWRITE_FIELDS,
  DEFAULT_REWRITE_MODE,
  readRewriteSettings,
  writeRewriteSettings,
} from "../../../src/lib/metadata/rewrite/settings";
import { profilesDiffer } from "../../../src/lib/profile/profile-view";

/**
 * Screen 07 — My Metadata Profile (approved reference).
 *
 * Existing Firebase services (auth, profile CRUD, directory/session) are
 * reused without duplicates. The page gates ONLY profile saving: guests
 * keep every workspace feature, and profile values are never auto-filled
 * from the Google identity. Loading is generation-guarded so a slow
 * Firestore read for one account can never populate another user's form.
 */
type AuthUiState = "loading" | "unconfigured" | "signed-out" | "signed-in";

export default function ProfilePage() {
  const [authUi, setAuthUi] = useState<AuthUiState>(() => (isFirebaseConfigured() ? "loading" : "unconfigured"));
  const [user, setUser] = useState<SignedInUser | null>(null);
  const [superadmin, setSuperadmin] = useState(false);
  const [suspended, setSuspended] = useState(false);
  const [entitlement, setEntitlement] = useState<EntitlementView | null>(null);
  const [profile, setProfile] = useState<MetadataProfile>(() => blankProfile());
  const [savedSnapshot, setSavedSnapshot] = useState<MetadataProfile | null>(null);
  const [savedUpdatedAt, setSavedUpdatedAt] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<ProfileSection>("editor");
  const [rewriteMode, setRewriteMode] = useState<RewriteMode>(DEFAULT_REWRITE_MODE);
  const [rewriteFields, setRewriteFields] = useState<readonly ProfileField[]>(DEFAULT_REWRITE_FIELDS);
  const [notice, setNotice] = useState("");
  /** Monotonic guard: every auth transition invalidates older async loads. */
  const loadSeqRef = useRef(0);

  useEffect(() => {
    const settings = readRewriteSettings();
    const timer = window.setTimeout(() => {
      setRewriteMode(settings.mode);
      setRewriteFields(settings.fields);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      // useState already renders the honest unconfigured card; an absent
      // subscription keeps guest features untouched.
      return;
    }
    let active = true;
    let unsubscribe: (() => void) | null = null;

    void subscribeAuthState((next) => {
      if (!active) return;
      const seq = ++loadSeqRef.current;
      setUser(next);
      if (!next) {
        setAuthUi("signed-out");
        setProfile(blankProfile());
        setSavedSnapshot(null);
        setSavedUpdatedAt(null);
        setSuperadmin(false);
        setSuspended(false);
        setEntitlement(null);
        return;
      }
      setAuthUi("signed-in");
      // The previous account's (or the signed-out blank) values must never
      // be shown while this account's real profile is loading.
      setProfile(blankProfile());
      setSavedSnapshot(null);
      setSavedUpdatedAt(null);
      void (async () => {
        const [session, saved] = await Promise.all([
          fetchSessionUser().catch(() => null),
          loadProfile(next.uid).catch(() => null),
        ]);
        if (!active || loadSeqRef.current !== seq) return;
        setSuperadmin(session?.superadmin ?? false);
        if (saved) {
          const loaded: MetadataProfile = {
            ...blankProfile(),
            ...saved.profile,
            keywordsList: saved.profile.keywordsList ?? [],
          };
          setSavedSnapshot(loaded);
          setSavedUpdatedAt(saved.updatedAt);
          // A slow profile read must never clobber input the user has
          // already typed while it was in flight (Rule: unsaved input is
          // preserved) — apply the loaded values only while the editable
          // draft is still blank.
          setProfile((previous) => (profilesDiffer(previous, blankProfile()) ? previous : loaded));
        }
      })();
      void (async () => {
        try {
          await ensureAccountRecord(next.uid, {
            email: next.email ?? "",
            displayName: next.displayName ?? "",
            photoURL: next.photoURL ?? "",
          });
          const status = await fetchOwnStatus(next.uid);
          if (!active || loadSeqRef.current !== seq) return;
          setSuspended(status === "suspended");
          // Own-tier read for the sidebar badge (server-authored only).
          const ownTier = await fetchOwnEntitlement(next.uid);
          if (!active || loadSeqRef.current !== seq) return;
          setEntitlement(ownTier);
        } catch {
          // Directory bookkeeping is best effort outside production config.
        }
      })();
    }).then((stop) => {
      if (active) unsubscribe = stop;
      else stop();
    }).catch(() => {
      if (active) setAuthUi("unconfigured");
    });

    return () => {
      active = false;
      loadSeqRef.current += 1;
      unsubscribe?.();
    };
  }, []);

  const dirty = useMemo(() => profilesDiffer(profile, savedSnapshot), [profile, savedSnapshot]);

  const handleProfileSaved = (saved: MetadataProfile, updatedAt: string | null) => {
    const snapshot: MetadataProfile = { ...saved };
    setProfile(snapshot);
    setSavedSnapshot(snapshot);
    setSavedUpdatedAt(updatedAt);
  };

  const handleProfileDeleted = () => {
    setProfile(blankProfile());
    setSavedSnapshot(null);
    setSavedUpdatedAt(null);
  };

  const updateRewriteMode = (mode: RewriteMode) => {
    setRewriteMode(mode);
    writeRewriteSettings({ mode, fields: rewriteFields });
  };

  const toggleRewriteField = (field: ProfileField) => {
    const next = rewriteFields.includes(field)
      ? rewriteFields.filter((item) => item !== field)
      : [...rewriteFields, field];
    setRewriteFields(next);
    writeRewriteSettings({ mode: rewriteMode, fields: next });
  };

  const signedIn = user !== null;

  return (
    <>
      <a href="#profile-main" className="fixed left-4 top-3 z-[100] -translate-y-20 rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white focus:translate-y-0">
        Skip to profile
      </a>
      <Header active="profile" />
      <main id="profile-main" tabIndex={-1} className="mx-auto max-w-7xl px-4 pb-14 pt-6 outline-none focus:outline-none sm:px-6 lg:px-8 lg:pt-8">
        <ProfileHero />

        {notice ? (
          <p role="status" className="mt-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-[13px] font-semibold text-blue-900">
            {notice}
          </p>
        ) : null}

        {/* Signed-out / loading keep the workspace hidden — no fake editable
            profile is ever rendered for guests or while auth resolves. */}
        {authUi === "loading" ? (
          <section data-testid="auth-loading" aria-label="Checking sign-in status" className="surface-card mt-6 rounded-[1.4rem] p-6">
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="h-5 w-5 animate-spin rounded-full border-2 border-[#2d5be9] border-t-transparent motion-reduce:animate-none" />
              <p className="text-sm font-semibold text-[#43536e]">Checking your Google sign-in status…</p>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Image inspection and cleaning do not need an account and are not affected.
            </p>
          </section>
        ) : null}

        {authUi === "signed-out" || authUi === "unconfigured" ? (
          <div className="mx-auto mt-6 max-w-3xl">
            <AuthPanel onNotice={setNotice} />
          </div>
        ) : null}

        {signedIn && user ? (
          <>
            {/* The editor is the dominant column; side columns stay wide
                enough for their content (minmax(0,…) prevents overflow). */}
            <div className="mt-6 grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,17.5rem)]">
              <div className="min-w-0 lg:row-span-2">
                <AccountSidebar
                  user={user}
                  superadmin={superadmin}
                  suspended={suspended}
                  entitlement={entitlement}
                  active={activeSection}
                  onActive={setActiveSection}
                  onNotice={setNotice}
                  onRefreshed={(claim) => setSuperadmin(claim === true)}
                />
              </div>
              <div className="min-w-0">
                <ProfileEditor
                  user={user}
                  suspended={suspended}
                  profile={profile}
                  dirty={dirty}
                  savedSnapshot={savedSnapshot}
                  savedUpdatedAt={savedUpdatedAt}
                  onProfileChange={setProfile}
                  onProfileSaved={handleProfileSaved}
                  onProfileDeleted={handleProfileDeleted}
                  onNotice={setNotice}
                />
              </div>
              <div className="min-w-0">
                <ProfilePreviewCard profile={profile} dirty={dirty} hasSavedDoc={savedSnapshot !== null} />
              </div>
            </div>

            {/* Rewrite preferences: the existing two engine modes + field
                selection, persisted through the app's existing settings store. */}
            <div id="rewrite-preferences" className="mt-5 scroll-mt-24">
              <RewritePanel
                user={user}
                profileValues={profile as unknown as Record<string, unknown>}
                mode={rewriteMode}
                selectedFields={rewriteFields}
                eligibleCount={0}
                selectedCount={0}
                applying={false}
                progress={null}
                workspaceOnly
                onMode={updateRewriteMode}
                onToggleField={toggleRewriteField}
                onApplySelected={() => setNotice("Return to the image workspace to apply your saved profile.")}
                onApplyAll={() => setNotice("Return to the image workspace to apply your saved profile.")}
                onCancel={() => undefined}
              />
            </div>

            {/* My Projects (Phase 04): Premium multi-project presets. Free
                accounts keep their single reusable profile untouched. */}
            <ProjectsPanel uid={user.uid} onNotice={setNotice} />

            {/* Security & Privacy: accurate statements about what is stored
                and what local processing guarantees. */}
            <section
              id="security-privacy"
              aria-labelledby="security-heading"
              className="surface-card mt-5 scroll-mt-24 rounded-[1.4rem] p-4 sm:p-6"
            >
              <div className="flex items-start gap-3">
                <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#e9f2fe] text-[#2d5be9]">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2.8 18.9 5v5.3c0 4.7-2.7 8.3-6.9 10-4.2-1.7-6.9-5.3-6.9-10V5L12 2.8Z" />
                    <path d="m9 11.6 2.1 2.1 4-4.7" />
                  </svg>
                </span>
                <div>
                  <h2 id="security-heading" data-section-heading tabIndex={-1} className="text-lg font-bold text-[#16244a]">
                    Security &amp; Privacy
                  </h2>
                  <p className="mt-0.5 text-[12.5px] text-[#5a6b85]">
                    What your account stores — and what stays local, always.
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-3.5 md:grid-cols-2">
                <div className="rounded-2xl border border-[#e6ebf3] bg-[#fbfcfe] p-4">
                  <h3 className="text-[13.5px] font-semibold text-[#16244a]">What is saved for your account</h3>
                  <ul className="mt-2 grid gap-1.5 text-[12.5px] leading-5 text-[#3b4a66]">
                    <li className="flex gap-2"><Bullet />The profile text values you type above, stored at your user&apos;s
                      <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px]">users/&lt;uid&gt;/profile/main</code> document. Firestore rules allow only
                      your signed-in uid to read, update or delete it.</li>
                    <li className="flex gap-2"><Bullet />Your Google email, display name and photo URL in your own
                      account directory record, so the profile list stays yours.</li>
                    <li className="flex gap-2"><Bullet />Deleting the saved profile (button in the editor) removes it
                      from Firestore permanently when the delete is confirmed.</li>
                  </ul>
                </div>
                <div className="rounded-2xl border border-[#e6ebf3] bg-[#fbfcfe] p-4">
                  <h3 className="text-[13.5px] font-semibold text-[#16244a]">What is never uploaded</h3>
                  <ul className="mt-2 grid gap-1.5 text-[12.5px] leading-5 text-[#3b4a66]">
                    <li className="flex gap-2"><Bullet />Original, cleaned or rewritten image files — no image bytes,
                      thumbnails or pixels leave your browser.</li>
                    <li className="flex gap-2"><Bullet />GPS data or any metadata extracted from files you inspect.</li>
                    <li className="flex gap-2"><Bullet />Inspection results, scan history, reports or download records.</li>
                  </ul>
                </div>
              </div>
              <p className="mt-3 text-[11.5px] leading-5 text-[#5a6b85]">
                Image inspection and rewriting run entirely in your browser. Every guest feature — inspection, cleaning,
                bulk ZIP, CSV/PDF reports and single-image editing — works without an account as before.
              </p>
            </section>
          </>
        ) : null}
      </main>
      <Footer />
    </>
  );
}

function Bullet() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-1 h-3 w-3 shrink-0 text-[#0d9474]" fill="currentColor">
      <circle cx="10" cy="10" r="4" />
    </svg>
  );
}
