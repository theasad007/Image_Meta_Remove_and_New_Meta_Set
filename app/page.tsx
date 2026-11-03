"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AfterUploadWorkspace from "../src/components/workspace/AfterUploadWorkspace";
import BeforeUploadHome from "../src/components/workspace/BeforeUploadHome";
import Footer from "../src/components/layout/Footer";
import Header from "../src/components/layout/Header";
import {
  applyBinaryVerification,
  clearEntries,
  createEntries,
  removeEntry,
  sniffEntryHead,
} from "../src/components/queue/queue-store";
import { createRunGuard } from "../src/lib/metadata/verify/run-guard";
import {
  DEFAULT_CLEANING_TARGETS,
  PRIVACY_SAFE_DEFAULT,
  type CleaningTarget,
  type CleaningStatus,
  type FileCleaningResult,
} from "../src/lib/metadata/clean/types";
import { inspectImage } from "../src/lib/metadata/inspect/inspect";
import { inspectAudio } from "../src/lib/metadata/audio/inspect-audio";
import { processBatchFile } from "../src/lib/queue/batch-pipeline";
import { mapWithConcurrency, runBatchIds } from "../src/lib/queue/batch-scheduler";
import { partitionRewriteIds } from "../src/lib/queue/rewrite-eligibility";
import {
  buildZipArchive,
  supportsFileSystemAccess,
  ZipCancelled,
  type ZipSource,
} from "../src/lib/zip/zip-builder";
import { buildZipMapping, zipArchiveName } from "../src/lib/zip/zip-names";
import { buildSummaryCsv, buildTagsCsv } from "../src/lib/reporting/csv";
import { downloadNamedBlob, reportFileName } from "../src/lib/reporting/download";
import { buildReportPdf } from "../src/lib/reporting/pdf";
import { buildReportSnapshot } from "../src/lib/reporting/snapshot";
import type { ReportSnapshot } from "../src/types/reporting";
import type { ReportChoices } from "../src/components/reports/ReportsPanel";
import type { BatchCounts, ZipBuildState } from "../src/types/batch";
import { emptyBatchCounts } from "../src/types/batch";
import type {
  ImageInspectionResult,
  InspectionOutcome,
} from "../src/types/inspection";
import { emptyInspection } from "../src/types/inspection";
import type { QueueEntry } from "../src/types/media";
import type { SignedInUser } from "../src/lib/firebase/auth";
import { subscribeAuthState } from "../src/lib/firebase/auth";
import { isFirebaseConfigured } from "../src/lib/firebase/config";
import ImageDetailsModal from "../src/components/inspector/ImageDetailsModal";
import EditMetadataModal, { type EditorPlanPayload } from "../src/components/editor/EditMetadataModal";
import BatchRewriteDialog, { type BatchRewriteSource } from "../src/components/rewrite/BatchRewriteDialog";
import {
  blankEditorDraft,
  editorPlanFor,
  type EditorDraft,
  type EditorSource,
} from "../src/lib/workspace/editor-state";
import { loadProfile } from "../src/lib/firebase/profile";
import { useFeaturePolicy } from "../src/lib/workspace/use-feature-policy";
import { resolveFeatureAccess } from "../src/lib/workspace/policy-state";
import type { FeatureKey } from "../src/lib/firebase/feature-policy";
import { getProject, listProjects, type ProjectSummary } from "../src/lib/firebase/projects";
import type { ProjectRecord } from "../src/lib/projects/project-schema";
import { blankProfile, validateProfile, type ProfileField } from "../src/lib/metadata/rewrite/fields";
import { isRewriteDownloadable, type FileRewriteResult, type RewriteMode, type RewriteStatus } from "../src/lib/metadata/rewrite/rewrite";
import { DEFAULT_REWRITE_FIELDS, DEFAULT_REWRITE_MODE, readRewriteSettings } from "../src/lib/metadata/rewrite/settings";
import { processRewriteFile } from "../src/lib/queue/rewrite-pipeline";
import type { GpsCoordinates, GpsEngineDirective } from "../src/lib/metadata/rewrite/gps";
import {
  blankGeoDraft,
  bulkGeoSnapshot,
  type GeoDraft,
  type GeoOperation,
} from "../src/lib/workspace/geotag-state";
import {
  REMOVE_AI_METADATA_TARGETS,
  REMOVE_METADATA_TARGETS,
  type WorkspaceTool,
} from "../src/lib/workspace/actions";

/** Max simultaneous inspections; the queue itself has no count cap. */
const INSPECT_CONCURRENCY = 2;
/** Warn (never block) when the estimated archive passes this size. */
const ZIP_SIZE_WARN_BYTES = 500 * 1024 * 1024;
const DEFAULT_REPORT_CHOICES: ReportChoices = {
  format: "none",
  detail: "summary",
  includeOriginalValues: false,
};
const idleZipState = (): ZipBuildState => ({
  phase: "idle",
  filesDone: 0,
  filesTotal: 0,
  bytesWritten: 0,
});

export default function Home() {
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [announcement, setAnnouncement] = useState("");
  // Feature policy + entitlement (Phases 02/03): one resolver drives every
  // gate. LAZY — nothing touches the network on load; only admin-adjustable
  // bulk/batch actions fetch the sanitized policy document on demand, and
  // free-by-contract single-file operations never do.
  const { policy: policyState, entitlement, refreshPolicy, refreshEntitlement, authReady } = useFeaturePolicy();
  const [premiumNotice, setPremiumNotice] = useState<string | null>(null);
  /** Async gate: free-by-contract features are allowed with zero network;
   *  adjustable features resolve against a fresh server policy and a fresh
   *  entitlement (revocation while the page is open is honored). */
  const checkAccess = async (feature: FeatureKey) => {
    const { isContractFree } = await import("../src/lib/firebase/feature-policy");
    if (isContractFree(feature)) {
      return resolveFeatureAccess(feature, entitlement, null);
    }
    const [policy, freshEntitlement] = await Promise.all([
      refreshPolicy(),
      refreshEntitlement(),
    ]);
    return resolveFeatureAccess(feature, freshEntitlement, policy);
  };
  const [results, setResults] = useState<Record<string, ImageInspectionResult>>({});
  const [inspectingIds, setInspectingIds] = useState<string[]>([]);
  const [cleaning, setCleaning] = useState<Record<string, FileCleaningResult>>({});
  const [cleaningIds, setCleaningIds] = useState<string[]>([]);
  const [selection, setSelection] = useState<string[]>([]);
  const [cleaningTargets, setCleaningTargets] = useState<CleaningTarget[]>(DEFAULT_CLEANING_TARGETS);
  const [activeTool, setActiveTool] = useState<WorkspaceTool>("ai_metadata");
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [editorId, setEditorId] = useState<string | null>(null);
  const [editorFromDetails, setEditorFromDetails] = useState(false);
  const [editorDrafts, setEditorDrafts] = useState<Record<string, EditorDraft>>({});
  const [editorProgress, setEditorProgress] = useState<string | null>(null);
  const editorDraftsRef = useRef<Record<string, EditorDraft>>({});
  const [partialIncluded, setPartialIncluded] = useState<string[]>([]);
  const [includeAllPartials, setIncludeAllPartials] = useState(false);
  const [user, setUser] = useState<SignedInUser | null>(null);
  const [isSuspended, setIsSuspended] = useState(false);
  const [profile, setProfile] = useState(() => blankProfile());
  const [rewriteMode, setRewriteMode] = useState<RewriteMode>(DEFAULT_REWRITE_MODE);
  const [rewriteFields, setRewriteFields] = useState<readonly ProfileField[]>(DEFAULT_REWRITE_FIELDS);
  const [rewrites, setRewrites] = useState<Record<string, FileRewriteResult>>({});
  const [rewritingIds, setRewritingIds] = useState<string[]>([]);
  const [rewriteProgress, setRewriteProgress] = useState<string | null>(null);
  // Screen 09 GeoTag drafts — keyed by the queue's stable per-file id, so
  // editing image A can never leak coordinates into image B.
  const [geoDrafts, setGeoDrafts] = useState<Record<string, GeoDraft>>({});
  const [geoLastOp, setGeoLastOp] = useState<Record<string, "write" | "remove">>({});
  /** The GPS operation currently in flight (cleared when the run ends). */
  const [geoPendingOp, setGeoPendingOp] = useState<"write" | "remove" | null>(null);
  const [batch, setBatch] = useState<{ jobId: number; total: number; done: number; current: string | null } | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [reportChoices, setReportChoices] = useState<ReportChoices>(DEFAULT_REPORT_CHOICES);
  const [reportBusy, setReportBusy] = useState<string | null>(null);
  const [reportProgress, setReportProgress] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [zipReportFailed, setZipReportFailed] = useState<string | null>(null);
  const reportGuardRef = useRef(createRunGuard());
  const scopeCounter = useRef(0);
  const [zip, setZip] = useState<ZipBuildState>(idleZipState);
  const runRef = useRef(0);
  const entriesRef = useRef<QueueEntry[]>([]);
  const cleanGuardRef = useRef(createRunGuard());
  const batchGuardRef = useRef(createRunGuard());
  const rewriteGuardRef = useRef(createRunGuard());
  const zipGuardRef = useRef(createRunGuard());
  const resultsRef = useRef<Record<string, ImageInspectionResult>>({});
  const announcedQuartile = useRef(0);
  useEffect(() => {
    resultsRef.current = results;
  }, [results]);
  useEffect(() => {
    editorDraftsRef.current = editorDrafts;
  }, [editorDrafts]);
  useEffect(() => {
    const settings = readRewriteSettings();
    const timer = window.setTimeout(() => {
      setRewriteMode(settings.mode);
      setRewriteFields(settings.fields);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // ---- Phase 05: saved-project picker state (declared before the auth
  // effect that loads it) ---------------------------------------------------
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectDetails, setProjectDetails] = useState<Record<string, ProjectRecord>>({});

  /** Lazy per-session load when a signed-in user is present. */
  const loadProjectsForPicker = useCallback(async (uid: string) => {
    try {
      const rows = await listProjects(uid);
      setProjects(rows);
    } catch {
      setProjects([]);
    }
  }, []);

  // Subscribe to Firebase auth transitions when configured; guests are
  // unaffected (no network, no account) when configuration is absent.
  // On sign-in, best-effort extras run silently in the background: the
  // custom-claim check (superadmin link), the account-directory
  // self-registration, and the suspension flag. None of them may disturb
  // the queue, inspections, or cleaned outputs.
  useEffect(() => {
    if (!isFirebaseConfigured()) return;
    let unsubscribe: (() => void) | null = null;
    let active = true;
    void subscribeAuthState((next) => {
      if (!active) return;
      setUser(next);
      if (!next) {
        // Sign-out clears in-memory profile authority; queue/outputs stay.
        setProfile(blankProfile());
        setIsSuspended(false);
        setProjects([]);
        setProjectDetails({});
        return;
      }
      void (async () => {
        setProfile(blankProfile());
        // Phase 05: the project picker loads the signed-in user's own
        // project summaries (details are fetched on selection).
        void loadProjectsForPicker(next.uid);
        try {
          const saved = await loadProfile(next.uid);
          // loadProfile returns { profile, updatedAt }; unwrap the validated
          // profile so Screen 06 actually receives the saved values.
          if (active && saved) {
            setProfile({
              ...blankProfile(),
              ...saved.profile,
              keywordsList: saved.profile.keywordsList ?? [],
            });
          }
        } catch {
          // Profile loading is best effort. Guest cleaning and the queue stay local.
        }
        try {
          const { ensureAccountRecord, fetchOwnStatus } = await import("../src/lib/firebase/directory");
          await ensureAccountRecord(next.uid, {
            email: next.email ?? "",
            displayName: next.displayName ?? "",
            photoURL: next.photoURL ?? "",
          }).catch(() => "exists" as const);
          if (!active) return;
          const status = await fetchOwnStatus(next.uid);
          if (active) setIsSuspended(status === "suspended");
        } catch {
          if (active) setIsSuspended(false);
        }
      })();
    }).then((stop) => {
      unsubscribe = stop;
    }).catch(() => {
      // Auth unavailable: guest flows continue; panel shows the error path.
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [loadProjectsForPicker]);
  const resetExportStatus = () => {
    zipGuardRef.current.cancel();
    reportGuardRef.current.cancel();
    setZip(idleZipState());
    setZipReportFailed(null);
    setReportBusy(null);
    setReportProgress(null);
    setReportError(null);
  };

  const isInspecting = (id: string) => inspectingIds.includes(id);

  /** Screen 05: the details dialog targets items with a live inspection result. */
  const detailsEntry = detailsId ? entries.find((entry) => entry.item.id === detailsId) : undefined;
  const detailsNavList = entries.filter((entry) => results[entry.item.id] !== undefined);
  const detailsNavIndex = detailsId ? detailsNavList.findIndex((entry) => entry.item.id === detailsId) : -1;

  /* ---- Screen 06 — single-image editor (guest usable, source-pure) ---- */

  const editorEntry = editorId ? entries.find((entry) => entry.item.id === editorId) : undefined;
  const editorDraftForOpen = editorId
    ? editorDrafts[editorId] ?? blankEditorDraft(DEFAULT_REWRITE_MODE)
    : blankEditorDraft(DEFAULT_REWRITE_MODE);

  const ensureEditorDraft = (id: string) => {
    setEditorDrafts((previous) => {
      if (previous[id]) return previous;
      return { ...previous, [id]: blankEditorDraft(readRewriteSettings().mode) };
    });
  };

  /** Row Edit trigger: opens Screen 06 for that file only. */
  const handleOpenEditor = (id: string) => {
    ensureEditorDraft(id);
    setEditorId(id);
    setEditorFromDetails(false);
  };

  /** Screen 05 trigger: closes the details dialog first (single focus trap). */
  const handleOpenEditorFromDetails = (id: string) => {
    ensureEditorDraft(id);
    setEditorId(id);
    setEditorFromDetails(true);
    setDetailsId(null);
  };

  /** Cancel/close keeps the draft (it survives reopening per spec). */
  const handleEditorClose = () => {
    const id = editorId;
    setEditorId(null);
    setEditorProgress(null);
    if (editorFromDetails && id && entries.some((entry) => entry.item.id === id)) {
      setDetailsId(id);
    }
    setEditorFromDetails(false);
  };

  /** "View full metadata details" inside the editor → Screen 05 for the same file. */
  const handleEditorViewDetails = () => {
    const id = editorId;
    setEditorId(null);
    setEditorProgress(null);
    setEditorFromDetails(false);
    if (id) setDetailsId(id);
  };

  const updateEditorDraft = (id: string, update: (draft: EditorDraft) => EditorDraft) => {
    setEditorDrafts((previous) => ({
      ...previous,
      [id]: update(previous[id] ?? blankEditorDraft(readRewriteSettings().mode)),
    }));
  };

  /** Explicit copy action: snapshot profile values into the image draft —
   *  an independent image-specific copy; the sources never stay merged. */
  const handleEditorCopyProfile = (id: string) => {
    updateEditorDraft(id, (draft) => {
      const next = blankEditorDraft(draft.mode);
      let copied = 0;
      for (const field of rewriteFields) {
        const value = field === "keywords"
          ? profile.keywordsList.join(", ")
          : profile[field];
        if (value.trim() !== "") {
          next.values[field] = value;
          copied += 1;
        }
      }
      setAnnouncement(copied > 0
        ? `Copied ${copied} saved-profile value${copied === 1 ? "" : "s"} into this image's form as an independent copy.`
        : "The saved profile has no values to copy yet.");
      return { ...next, source: "custom" };
    });
  };

  /**
   * Apply & create clean copy — reuses the exact verified per-file rewrite
   * pipeline. Guests apply custom values without sign-in (Rule B): the
   * pipeline itself has no auth; only saved-profile REUSE is gated.
   */
  const startEditorRewrite = async (id: string) => {
    const draft = editorDraftsRef.current[id];
    if (!draft) return;
    const plan = editorPlanFor(draft, profile, draft.projectId ? projectDetails[draft.projectId] ?? null : null);
    if (!plan.canApply) {
      setAnnouncement(plan.blockedReason ?? "Nothing to apply yet.");
      return;
    }
    resetExportStatus();
    const token = rewriteGuardRef.current.token();
    setRewritingIds([id]);
    setEditorProgress("Reading bytes…");
    setAnnouncement(`Rewrite started for one file (${plan.mode.replace(/_/g, " ")}).`);
    try {
      const result = await processRewriteFile(id, {
        ...rewriteDepsFor(),
        profile: plan.profile,
        selectedFields: plan.selectedFields,
        mode: plan.mode,
        // Phase 05: a selected project's coordinates ride the SAME verified
        // GPS writer (1e-6° read-back verification); null project coords
        // never touch GPS.
        ...(plan.source === "project" && plan.gps ? { gps: { op: "write" as const, coords: plan.gps } } : {}),
        onStage: (stage) => setEditorProgress(stage === "sniff"
          ? "Reading bytes…"
          : stage === "inspect"
            ? "Inspecting…"
            : "Writing metadata…"),
      });
      if (!rewriteGuardRef.current.isCurrent(token)) return;
      if (!entriesRef.current.some((entry) => entry.item.id === id)) {
        setEditorId((current) => (current === id ? null : current));
        setEditorProgress(null);
        return;
      }
      setRewrites((previous) => ({ ...previous, [id]: result }));
      setExpandedIds((previous) => (previous.includes(id) ? previous : [...previous, id]));
      setEditorProgress(null);
      setAnnouncement(`Rewrite finished for one file: ${result.status.replace(/_/g, " ")}.`);
    } catch {
      if (!rewriteGuardRef.current.isCurrent(token)) return;
      const entry = entriesRef.current.find((candidate) => candidate.item.id === id);
      if (!entry) {
        setEditorId((current) => (current === id ? null : current));
        setEditorProgress(null);
        return;
      }
      const failed: FileRewriteResult = {
        fileId: id,
        inputName: entry.item.name,
        detectedFormat: "unknown",
        inputBytes: entry.source.size,
        before: resultsRef.current[id] ?? emptyInspection(id, entry.item.name, entry.source.size),
        mode: plan.mode,
        requestedFields: [...plan.selectedFields],
        status: "failed",
        changes: [],
        warnings: [],
        errors: ["An unexpected editor rewrite error occurred. No output was created."],
        rewrittenAt: new Date().toISOString(),
      };
      setRewrites((previous) => ({ ...previous, [id]: failed }));
      setEditorProgress(null);
      setAnnouncement("Editor rewrite failed. No output was created.");
    }
    if (rewriteGuardRef.current.isCurrent(token)) {
      setRewritingIds((previous) => previous.filter((candidate) => candidate !== id));
      setEditorProgress(null);
    }
  };

  const handleEditorApply = (payload: EditorPlanPayload) => {
    if (!editorId) return;
    void (async () => {
      // Saved-project applies are premium-gated (Rule 10) with the same
      // fresh policy+entitlement check as every other gated action.
      if (payload.projectId !== null) {
        const access = await checkAccess("saved_project_apply");
        if (!access.allowed) {
          setPremiumNotice(access.reason);
          setAnnouncement(access.reason);
          return;
        }
        const record = projectDetails[payload.projectId] ?? await getProject(user?.uid ?? "", payload.projectId);
        if (!record) {
          setAnnouncement("The selected project is no longer available — pick another project or use custom values (still free).");
          return;
        }
      }
      await startEditorRewrite(editorId);
    })();
  };

  const handleProjectSelect = (projectId: string | null) => {
    if (!editorId) return;
    updateEditorDraft(editorId, (draft) => ({ ...draft, source: projectId ? "project" : "custom", projectId }));
    if (projectId && !projectDetails[projectId] && user) {
      void (async () => {
        try {
          const record = await getProject(user.uid, projectId);
          if (record) {
            setProjectDetails((previous) => ({ ...previous, [projectId]: record }));
          }
        } catch {
          setAnnouncement("The selected project could not be loaded — pick another project or use custom values (still free).");
        }
      })();
    }
  };

  // ---- Screen 09: verified GPS write/remove through the same pipeline ----

  const failedGeoResult = (id: string, op: GeoOperation, errors: string[]): FileRewriteResult => {
    const entry = entriesRef.current.find((candidate) => candidate.item.id === id);
    const draft = editorDraftsRef.current[id] ?? blankEditorDraft(readRewriteSettings().mode);
    return {
      fileId: id,
      inputName: entry?.item.name ?? id,
      detectedFormat: "unknown",
      inputBytes: entry?.source.size ?? 0,
      before: resultsRef.current[id] ?? emptyInspection(id, entry?.item.name ?? id, entry?.source.size ?? 0),
      mode: draft.mode,
      requestedFields: [],
      status: "failed",
      changes: [],
      warnings: [],
      errors,
      rewrittenAt: new Date().toISOString(),
    };
  };

  /** GPS-only rows keep their descriptive text fields untouched (update). */
  const depsWithGps = (id: string, op: GeoOperation, coords: GpsCoordinates | null, mode: RewriteMode) => {
    const directive: GpsEngineDirective | undefined = op === "remove"
      ? { op: "remove" }
      : coords
        ? { op: "write", coords }
        : undefined;
    const draft = editorDraftsRef.current[id] ?? blankEditorDraft(mode);
    const plan = editorPlanFor(draft, profile);
    return {
      ...rewriteDepsFor(),
      profile: plan.profile,
      selectedFields: plan.selectedFields,
      mode: plan.mode,
      ...(directive ? { gps: directive } : {}),
    };
  };

  const startGeoRewrite = async (id: string, op: GeoOperation, coords: GpsCoordinates | null) => {
    const entry = entriesRef.current.find((candidate) => candidate.item.id === id);
    if (!entry || entry.item.detected.mediaKind !== "image") return;
    if (op === "write" && !coords) return;
    resetExportStatus();
    const token = rewriteGuardRef.current.token();
    setRewritingIds([id]);
    setGeoPendingOp(op);
    setEditorProgress(op === "remove" ? "Removing GPS tags…" : "Writing GPS metadata…");
    setAnnouncement(`GPS ${op === "remove" ? "removal" : "write"} started for ${entry.item.name}.`);
    try {
      const draft = editorDraftsRef.current[id] ?? blankEditorDraft(readRewriteSettings().mode);
      const result = await processRewriteFile(id, {
        ...depsWithGps(id, op, coords, draft.mode),
        onStage: (stage) => setEditorProgress(stage === "sniff"
          ? "Reading bytes…"
          : stage === "inspect"
            ? "Inspecting…"
            : op === "remove" ? "Removing GPS tags…" : "Writing GPS metadata…"),
      });
      if (!rewriteGuardRef.current.isCurrent(token)) return;
      if (!entriesRef.current.some((candidate) => candidate.item.id === id)) {
        setEditorId((current) => (current === id ? null : current));
        setEditorProgress(null);
        setGeoPendingOp(null);
        return;
      }
      setRewrites((previous) => ({ ...previous, [id]: result }));
      setGeoLastOp((previous) => ({ ...previous, [id]: op }));
      setExpandedIds((previous) => (previous.includes(id) ? previous : [...previous, id]));
      setEditorProgress(null);
      setAnnouncement(
        op === "remove"
          ? `GPS removal finished for one file: ${result.status.replace(/_/g, " ")}.`
          : `GPS write finished for one file: ${result.status.replace(/_/g, " ")}.`,
      );
    } catch {
      if (!rewriteGuardRef.current.isCurrent(token)) return;
      setRewrites((previous) => ({
        ...previous,
        [id]: failedGeoResult(id, op, ["An unexpected GPS operation error occurred. No output was created."]),
      }));
      setEditorProgress(null);
      setAnnouncement("GPS operation failed. No output was created.");
    }
    if (rewriteGuardRef.current.isCurrent(token)) {
      setRewritingIds((previous) => previous.filter((candidate) => candidate !== id));
      setEditorProgress(null);
      setGeoPendingOp(null);
    }
  };

  const handleGeoApply = (op: GeoOperation, coords: GpsCoordinates | null) => {
    if (!editorId) return;
    void startGeoRewrite(editorId, op, coords);
  };

  /** Bulk geotagging over the EXPLICIT selected-file snapshot (taken now). */
  const handleGeoApplyBulk = async (op: GeoOperation, coords: GpsCoordinates | null) => {
    if (!editorId) return;
    if (op === "write" && !coords) return;
    const snapshot = bulkGeoSnapshot(editorId, selection, entriesRef.current);
    if (snapshot.length === 0) {
      setAnnouncement("No selected images to geotag.");
      return;
    }
    // Policy split (roadmap 06): GPS WRITE on 2+ images is a batch GPS
    // write; pure GPS REMOVAL is a cleaning action covered by the bulk
    // cleaning policy (free by default) — never reclassified as paid writing.
    const policyFeature: FeatureKey = op === "write"
      ? (snapshot.length >= 2 ? "batch_gps_write" : "single_custom_rewrite")
      : (snapshot.length >= 2 ? "bulk_metadata_clean" : "single_metadata_clean");
    const access = await checkAccess(policyFeature);
    if (!access.allowed) {
      setPremiumNotice(access.reason);
      setAnnouncement(access.reason);
      return;
    }
    resetExportStatus();
    const token = rewriteGuardRef.current.token();
    setRewritingIds(snapshot);
    setGeoPendingOp(op === "write" ? "write" : "remove");
    let done = 0;
    let verified = 0;
    let failed = 0;
    for (const id of snapshot) {
      if (!rewriteGuardRef.current.isCurrent(token)) break;
      const entry = entriesRef.current.find((candidate) => candidate.item.id === id);
      if (!entry || entry.item.detected.mediaKind !== "image") {
        done += 1;
        continue;
      }
      setRewriteProgress(`Geotagging ${done + 1}/${snapshot.length}: ${entry.item.name}…`);
      try {
        const draft = editorDraftsRef.current[id] ?? blankEditorDraft(readRewriteSettings().mode);
        const result = await processRewriteFile(id, depsWithGps(id, op, coords, draft.mode));
        if (!rewriteGuardRef.current.isCurrent(token)) break;
        if (!entriesRef.current.some((candidate) => candidate.item.id === id)) {
          done += 1;
          continue;
        }
        setRewrites((previous) => ({ ...previous, [id]: result }));
        setGeoLastOp((previous) => ({ ...previous, [id]: op }));
        if (result.status === "verified_rewritten" || result.status === "partially_rewritten") verified += 1;
        else failed += 1;
      } catch {
        if (!rewriteGuardRef.current.isCurrent(token)) break;
        setRewrites((previous) => ({
          ...previous,
          [id]: failedGeoResult(id, op, ["An unexpected GPS operation error occurred. No output was created."]),
        }));
        failed += 1;
      }
      done += 1;
      setRewriteProgress(`Geotagging ${Math.min(done, snapshot.length)}/${snapshot.length}…`);
    }
    const cancelled = !rewriteGuardRef.current.isCurrent(token);
    setRewritingIds([]);
    setRewriteProgress(null);
    setGeoPendingOp(null);
    if (cancelled) setAnnouncement("Bulk geotagging cancelled. Finished files keep their verified results.");
    else {
      setEditorProgress(null);
      setAnnouncement(`Bulk GPS ${op}: ${done} file${done === 1 ? "" : "s"} processed — ${verified} verified, ${failed} failed/withheld. Verified outputs are downloadable and ZIP-eligible.`);
    }
  };

  /** Runs the existing verified single-file metadata removal pipeline. */
  const handleRemoveFromDetails = (id: string) => {
    void startBatch([id], REMOVE_METADATA_TARGETS, "Metadata removal");
  };

  const applyResult = (run: number, id: string, result: ImageInspectionResult) => {
    if (runRef.current !== run) return; // cancelled run: discard
    if (!entriesRef.current.some((entry) => entry.item.id === id)) return; // removed mid-scan
    setResults((previous) => {
      const next = { ...previous, [id]: result };
      resultsRef.current = next;
      return next;
    });
  };

  const finishIds = (run: number, ids: string[]) => {
    if (runRef.current !== run) return;
    setInspectingIds((previous) => previous.filter((id) => !ids.includes(id)));
  };

  const runInspection = async (run: number, id: string) => {
    const entry = entriesRef.current.find((e) => e.item.id === id);
    if (!entry) return;
    let result: ImageInspectionResult;
    try {
      // Phase 07: audio files take the MP3 inspector — same result shape,
      // audio-honest categories (never EXIF/GPS counts for audio).
      result = entry.item.detected.mediaKind === "audio"
        ? await inspectAudio(id, entry.source, entry.item.name)
        : await inspectImage(id, entry.source, entry.item.name);
    } catch {
      result = {
        ...emptyInspection(id, entry.item.name, entry.source.size),
        warnings: ["Inspection crashed unexpectedly — recorded as failed without affecting the queue."],
      };
    }
    applyResult(run, id, result);
  };

  const inspectIds = async (ids: string[], openDetails = true) => {
    if (ids.length === 0) return;
    const run = runRef.current + 1;
    runRef.current = run;
    setInspectingIds(ids);
    setAnnouncement(`Inspecting ${ids.length} file${ids.length === 1 ? "" : "s"} (max ${INSPECT_CONCURRENCY} at a time).`);
    for (let i = 0; i < ids.length; i += INSPECT_CONCURRENCY) {
      if (runRef.current !== run) break;
      const chunk = ids.slice(i, i + INSPECT_CONCURRENCY);
      await Promise.all(chunk.map((id) => runInspection(run, id)));
      finishIds(run, chunk);
    }
    if (runRef.current === run && ids.length > 0) {
      const firstAlive = ids.find((id) => entriesRef.current.some((e) => e.item.id === id));
      if (firstAlive && openDetails) {
        setExpandedIds((previous) => previous.includes(firstAlive) ? previous : [...previous, firstAlive]);
      }
      setAnnouncement(`Inspection finished for ${ids.length} file${ids.length === 1 ? "" : "s"}.`);
    }
  };

  const handleInspectOne = (id: string) => {
    void inspectIds([id]);
  };

  const handleCancelInspections = () => {
    runRef.current += 1;
    setInspectingIds([]);
    setAnnouncement("Inspections cancelled. Finished files keep their results.");
  };

  const handleCancelCleaning = () => {
    cleanGuardRef.current.cancel();
    setCleaningIds([]);
    setAnnouncement("Cleaning cancelled. Finished files keep their results; nothing half-written is offered.");
  };

  const pipelineDeps = (targets: readonly CleaningTarget[] = cleaningTargets) => ({
    getEntry: (id: string) => entriesRef.current.find((e) => e.item.id === id),
    getInspection: (id: string) => resultsRef.current[id],
    setInspection: (id: string, result: ImageInspectionResult) => {
      setResults((previous) => {
        const next = { ...previous, [id]: result };
        resultsRef.current = next;
        return next;
      });
    },
    policy: {
      mode: PRIVACY_SAFE_DEFAULT.mode,
      targets: [...targets],
    },
  });

  const startBatch = async (
    ids: string[],
    targets: readonly CleaningTarget[] = cleaningTargets,
    label = "Metadata removal",
  ) => {
    // Phase 11: MP3 cleaning rides the same free runner (metadata AND AI
    // removal, single or bulk — bulk cleaning stays free by default).
    const eligible = ids.filter((id) =>
      entriesRef.current.some((entry) => entry.item.id === id && (entry.item.detected.mediaKind === "image" || entry.item.detected.mediaKind === "audio")),
    );
    if (eligible.length === 0) {
      setAnnouncement("Nothing eligible to clean.");
      return;
    }
    if (targets.length === 0) {
      setAnnouncement("Choose at least one metadata type to clean.");
      return;
    }
    resetExportStatus();
    const activeTargets = [...targets];
    setCleaningTargets(activeTargets);
    const token = batchGuardRef.current.token();
    announcedQuartile.current = 0;
    setBatchRunning(true);
    setBatch({ jobId: token, total: eligible.length, done: 0, current: null });
    setAnnouncement(`${label} started for ${eligible.length} file${eligible.length === 1 ? "" : "s"}, one at a time.`);
    await runBatchIds({
      ids: eligible,
      isActive: () => batchGuardRef.current.isCurrent(token),
      isEligible: (id) => batchGuardRef.current.isCurrent(token) && entriesRef.current.some((e) => e.item.id === id),
      process: (id) => processBatchFile(id, {
        ...pipelineDeps(activeTargets),
        onStage: (stage) => {
          const entry = entriesRef.current.find((e) => e.item.id === id);
          setBatch((previous) => previous && previous.jobId === token
            ? { ...previous, current: entry ? `${entry.item.name} (${stage})` : previous.current }
            : previous);
        },
      }),
      onDone: (id, result) => {
        setCleaning((previous) => ({ ...previous, [id]: result }));
        if (eligible.length === 1) {
          setExpandedIds((previous) => previous.includes(id) ? previous : [...previous, id]);
        }
      },
      onError: (id) => {
        const entry = entriesRef.current.find((candidate) => candidate.item.id === id);
        if (!entry) return;
        const failed: FileCleaningResult = {
          fileId: id,
          inputName: entry.item.name,
          detectedFormat: "unknown",
          inputBytes: entry.source.size,
          before: resultsRef.current[id] ?? emptyInspection(id, entry.item.name, entry.source.size),
          policy: { mode: PRIVACY_SAFE_DEFAULT.mode, targets: activeTargets },
          status: "failed",
          changes: [],
          warnings: [],
          errors: ["An unexpected batch error occurred. No output was created for this file."],
          cleanedAt: new Date().toISOString(),
        };
        setCleaning((previous) => ({ ...previous, [id]: failed }));
        if (eligible.length === 1) {
          setExpandedIds((previous) => previous.includes(id) ? previous : [...previous, id]);
        }
      },
      onProgress: (done, total) => {
        if (!batchGuardRef.current.isCurrent(token)) return;
        setBatch((previous) => (previous && previous.jobId === token ? { ...previous, done } : previous));
        const quartile = Math.floor((done / total) * 4);
        if (quartile > announcedQuartile.current) {
          announcedQuartile.current = quartile;
          setAnnouncement(`Batch progress: ${done} of ${total} files processed.`);
        }
      },
      concurrency: 1,
    });
    const cancelled = !batchGuardRef.current.isCurrent(token);
    setBatchRunning(false);
    setBatch((previous) => (previous && previous.jobId === token ? { ...previous, current: null } : previous));
    setAnnouncement(cancelled
      ? "Batch cancelled. Finished files keep their verified results."
      : `${label} finished for ${eligible.length} file${eligible.length === 1 ? "" : "s"}.`);
  };

  const selectedEligibleIds = () => {
    const alive = new Set(entriesRef.current.map((e) => e.item.id));
    // Cleanable kinds: images AND MP3 (audio) — the rewrite path filters to
    // still images again inside startRewriteBatch.
    return selection.filter((id) => alive.has(id) && entriesRef.current.find((e) => e.item.id === id)?.item.detected.mediaKind !== "unknown");
  };

  const handleRemoveMetadata = () => {
    const ids = selectedEligibleIds();
    void (async () => {
      // One file = single-file cleaning: free by contract, zero network.
      if (ids.length >= 2) {
        const access = await checkAccess("bulk_metadata_clean");
        if (!access.allowed) {
          setPremiumNotice(access.reason);
          setAnnouncement(access.reason);
          return;
        }
      }
      await startBatch(ids, REMOVE_METADATA_TARGETS, "Metadata removal");
    })();
  };

  const handleRemoveAiMetadata = () => {
    const ids = selectedEligibleIds();
    void (async () => {
      if (ids.length >= 2) {
        const access = await checkAccess("bulk_ai_metadata_clean");
        if (!access.allowed) {
          setPremiumNotice(access.reason);
          setAnnouncement(access.reason);
          return;
        }
      }
      await startBatch(ids, REMOVE_AI_METADATA_TARGETS, "AI metadata removal");
    })();
  };

  const handleCancelBatch = () => {
    batchGuardRef.current.cancel();
    setBatchRunning(false);
    setAnnouncement("Batch cancelled. Finished files keep their verified results.");
  };

  const handleRetryFailed = () => {
    const ids = Object.entries(cleaning)
      .filter(([, result]) => result.status === "failed" || result.status === "not_verified")
      .map(([id]) => id)
      .filter((id) => entriesRef.current.some((e) => e.item.id === id));
    if (ids.length === 0) {
      setAnnouncement("No failed files to retry.");
      return;
    }
    void startBatch(ids);
  };

  const handleRetryOne = (id: string) => {
    void startBatch([id]);
  };

  const rewriteDepsFor = () => ({
    getEntry: (id: string) => entriesRef.current.find((e) => e.item.id === id),
    getInspection: (id: string) => resultsRef.current[id],
    setInspection: (id: string, result: ImageInspectionResult) => {
      setResults((previous) => {
        const next = { ...previous, [id]: result };
        resultsRef.current = next;
        return next;
      });
    },
    profile,
    selectedFields: rewriteFields,
    mode: rewriteMode,
  });

  const rewriteReady = (id: string): string | null => {
    if (!user) return "Sign in to apply a profile.";
    if (isSuspended) return "This account is suspended from cloud features — anonymous cleaning stays available.";
    const entry = entriesRef.current.find((e) => e.item.id === id);
    // SOL-003: images AND MP3 audio are rewrite-eligible; other kinds are
    // skipped downstream and disclosed, never a hard abort.
    if (!entry || (entry.item.detected.mediaKind !== "image" && entry.item.detected.mediaKind !== "audio")) {
      return "This file type is preview-only and will be skipped (supported files still run).";
    }
    const { profile: valid, errors } = validateProfile(profile as unknown as Record<string, unknown>);
    void valid;
    if (Object.keys(errors).length > 0) return "Fix profile validation errors first.";
    if (rewriteFields.length === 0) return "Check at least one field to apply.";
    return null;
  };

  /** SOL-003/008/009: batch source snapshot — the plan confirmed in the
   *  dialog is the plan executed; mid-run changes never redirect it. */
  const startRewriteBatch = async (
    ids: string[],
    sourceSpec: { source: BatchRewriteSource; projectId: string | null; customDraft: EditorDraft | null } = { source: "profile", projectId: null, customDraft: null },
  ) => {
    const { source: batchSourceSpec, projectId: projectIdSpec, customDraft: customDraftSpec } = sourceSpec;
    const { eligibleIds: eligible, skippedIds } = partitionRewriteIds(entriesRef.current, ids);
    const blocked = eligible.map((id) => rewriteReady(id)).find((reason) => reason !== null);
    if (blocked) {
      setAnnouncement(blocked);
      return;
    }
    if (eligible.length === 0) {
      setAnnouncement("Nothing eligible to rewrite.");
      return;
    }
    if (skippedIds.length > 0) {
      setAnnouncement(`${skippedIds.length} unsupported preview-only file${skippedIds.length === 1 ? " was" : "s were"} skipped; continuing with ${eligible.length} supported file${eligible.length === 1 ? "" : "s"}.`);
    }
    // Two or more files in one run is a batch rewrite (premium by
    // default); a single file stays the free single-file rewrite.
    if (eligible.length >= 2) {
      // SOL-008: ONE combined preflight checks every independent policy key
      // this exact run needs (batch rewrite + saved-project apply + GPS).
      const needsProjectApply = batchSourceSpec === "project" && projectIdSpec !== null;
      const access = await checkAccess("batch_metadata_rewrite");
      if (!access.allowed) {
        setPremiumNotice(access.reason);
        setAnnouncement(access.reason);
        return;
      }
      // Batch project payload (Phase 06): resolve the project NOW and
      // snapshot it for the whole run — mid-run changes never redirect.
      if (projectIdSpec) {
        const record = projectDetails[projectIdSpec] ?? (user ? await getProject(user.uid, projectIdSpec).catch(() => null) : null);
        if (!record) {
          setAnnouncement("The selected project is no longer available — the batch was not started.");
          return;
        }
        batchProjectRef.current = record;
      } else {
        batchProjectRef.current = null;
      }
      if (needsProjectApply) {
        const projectAccess = await checkAccess("saved_project_apply");
        if (!projectAccess.allowed) {
          setPremiumNotice(projectAccess.reason);
          setAnnouncement(projectAccess.reason);
          return;
        }
      }
      // GPS policy applies only when the resolved project actually carries
      // coordinates AND at least one eligible image would receive them.
      const projectRecord = batchProjectRef.current;
      if (projectRecord && projectRecord.latitude !== null && projectRecord.longitude !== null
        && eligible.some((id) => entriesRef.current.find((entry) => entry.item.id === id)?.item.detected.mediaKind === "image")) {
        const gpsAccess = await checkAccess("batch_gps_write");
        if (!gpsAccess.allowed) {
          setPremiumNotice(gpsAccess.reason);
          setAnnouncement(gpsAccess.reason);
          return;
        }
      }
    } else {
      batchProjectRef.current = null;
    }
    resetExportStatus();
    const token = rewriteGuardRef.current.token();
    setRewritingIds(eligible);
    setRewriteProgress(`Rewriting 0/${eligible.length}…`);
    setAnnouncement(`Rewrite started: ${eligible.length} file${eligible.length === 1 ? "" : "s"} (${rewriteMode.replace(/_/g, " ")}).`);
    let done = 0;
    for (const id of eligible) {
      if (!rewriteGuardRef.current.isCurrent(token)) break;
      const entryKind = entriesRef.current.find((e) => e.item.id === id)?.item.detected.mediaKind ?? null;
      if (!entryKind) {
        done += 1;
        continue;
      }
      setRewriteProgress(`Rewriting ${done + 1}/${eligible.length}…`);
      try {
        // Snapshot source payload: every file in this run gets the SAME
        // resolved source (project / profile / custom) — no mid-run redirection.
        const project = batchProjectRef.current;
        // SOL-003: GPS travels with images only; MP3 rows run without it
        // (the MP3 writer independently discloses GPS as unsupported).
        const plan = project
          ? editorPlanFor({ source: "project", values: blankEditorDraft(rewriteMode).values, mode: rewriteMode, projectId: project.projectId }, profile, project)
          : customDraftSpec
            ? editorPlanFor({ ...customDraftSpec, mode: rewriteMode, projectId: null }, profile)
            : editorPlanFor({ source: "profile", values: blankEditorDraft(rewriteMode).values, mode: rewriteMode, projectId: null }, profile);
        const isImage = entryKind === "image";
        const gpsDirective = plan.gps
          ? (isImage ? { op: "write" as const, coords: plan.gps } : null)
          : undefined;
        const result = await processRewriteFile(id, {
          ...rewriteDepsFor(),
          profile: plan.profile,
          selectedFields: plan.selectedFields,
          mode: plan.mode,
          ...(gpsDirective ? { gps: gpsDirective } : {}),
        });
        if (!rewriteGuardRef.current.isCurrent(token)) break;
        if (!entriesRef.current.some((e) => e.item.id === id)) {
          done += 1;
          continue;
        }
        setRewrites((previous) => ({ ...previous, [id]: result }));
        if (eligible.length === 1) {
          setExpandedIds((previous) => previous.includes(id) ? previous : [...previous, id]);
        }
      } catch {
        if (!rewriteGuardRef.current.isCurrent(token)) break;
        const entry = entriesRef.current.find((e) => e.item.id === id);
        if (!entry) {
          done += 1;
          continue;
        }
        // SOL-003: per-file failure isolation — one failing file never
        // aborts the remaining eligible files.
        setRewrites((previous) => ({
          ...previous,
          [id]: {
            fileId: id,
            inputName: entry.item.name,
            detectedFormat: "unknown",
            inputBytes: entry.source.size,
            before: resultsRef.current[id] ?? emptyInspection(id, entry.item.name, entry.source.size),
            mode: rewriteMode,
            requestedFields: [...rewriteFields],
            status: "failed",
            changes: [],
            warnings: [],
            errors: ["An unexpected rewrite error occurred. No output was created."],
            rewrittenAt: new Date().toISOString(),
          },
        }));
      }
      done += 1;
      setRewriteProgress(`Rewriting ${done}/${eligible.length}…`);
    }
    const cancelled = !rewriteGuardRef.current.isCurrent(token);
    setRewritingIds([]);
    setRewriteProgress(null);
    setAnnouncement(cancelled
      ? "Rewrite cancelled. Finished files keep their verified results; cleaned outputs are untouched."
      : `Rewrite finished: ${done} file${done === 1 ? "" : "s"} processed. Cleaned outputs (if any) are preserved separately.`);
  };

  // ---- Phase 06: batch rewrite scope dialog ------------------------------
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [batchSource, setBatchSource] = useState<BatchRewriteSource>("profile");
  const [batchProjectId, setBatchProjectId] = useState<string | null>(null);
  /** SOL-009: one-off custom batch draft — dialog/run-local, never the
   *  saved profile or a project. Preserved while switching sources. */
  const [batchCustomDraft, setBatchCustomDraft] = useState<EditorDraft>(() => blankEditorDraft("update_selected"));
  /** Snapshot of the resolved project for the current batch run. */
  const batchProjectRef = useRef<ProjectRecord | null>(null);

  /** Load one project's full record into the details cache (deduped). */
  const ensureProjectDetails = (projectId: string) => {
    if (!user || projectDetails[projectId]) return;
    void (async () => {
      try {
        const record = await getProject(user.uid, projectId);
        if (record) setProjectDetails((previous) => ({ ...previous, [projectId]: record }));
      } catch {
        setAnnouncement("The selected project could not be loaded.");
      }
    })();
  };

  /** Per-kind counts for the dialog's honest scope summary (SOL-003). */
  const batchSelectionCounts = useMemo(() => {
    const counts = { image: 0, audio: 0, video: 0, other: 0 };
    for (const id of selection) {
      const entry = entries.find((item) => item.item.id === id);
      if (!entry) continue;
      if (entry.item.detected.mediaKind === "image") counts.image += 1;
      else if (entry.item.detected.mediaKind === "audio") counts.audio += 1;
      else if (entry.item.detected.mediaKind === "video") counts.video += 1;
      else counts.other += 1;
    }
    return counts;
  }, [entries, selection]);

  const batchLockedReason = useMemo(() => {
    // SOL-002: while auth restoration is unresolved, show a checking state —
    // never a final denial. The authoritative fresh check re-runs at confirm.
    if (!authReady) return null;
    // Display state from the last-known policy (defaults until fetched).
    const access = resolveFeatureAccess("batch_metadata_rewrite", entitlement, policyState);
    return access.allowed ? null : access.reason;
  }, [authReady, entitlement, policyState]);

  const handleOpenRewrite = () => {
    setActiveTool("metadata_geotag");
    // SOL-002: refresh the display state at the moment the protected action
    // is attempted — a revoke/expiry that happened while the page was open
    // must be visible in the dialog, not just at confirm time.
    void refreshPolicy({ force: true });
    void refreshEntitlement();
    const ids = selectedEligibleIds();
    if (!user) {
      setAnnouncement(ids.length >= 2
        ? "Rewriting two or more files together is a Premium feature. Premium access is granted manually by the site administrator. Rewriting one file stays free — use Edit Metadata on any row."
        : "Sign in on your profile page to apply a saved metadata profile. Guest removal actions remain available here.");
      if (ids.length >= 2) {
        setPremiumNotice("Rewriting two or more files together is a Premium feature. Premium access is granted manually by the site administrator. Rewriting one file stays free — use Edit Metadata on any row.");
      }
      return;
    }
    setBatchDialogOpen(true);
  };

  const handleBatchRewriteConfirm = () => {
    setBatchDialogOpen(false);
    const ids = selectedEligibleIds();
    // Explicit confirmation of scope: snapshot taken NOW. The custom draft
    // (when selected) is snapshotted with it (SOL-009).
    void startRewriteBatch(ids, {
      source: batchSource,
      projectId: batchSource === "project" ? batchProjectId : null,
      customDraft: batchSource === "custom" ? batchCustomDraft : null,
    });
  };

  const handleCancelRewrite = () => {
    rewriteGuardRef.current.cancel();
    setRewritingIds([]);
    setRewriteProgress(null);
    setGeoPendingOp(null);
    setAnnouncement("Rewrite cancelled. Finished files keep their verified results.");
  };

  const handleFiles = (files: File[]) => {
    if (files.length === 0) return;
    resetExportStatus();
    const created = createEntries(files);
    const nextEntries = [...entriesRef.current, ...created];
    entriesRef.current = nextEntries;
    setEntries(nextEntries);
    setSelection((previous) => [
      ...previous,
      ...created.filter((entry) => entry.item.detected.mediaKind === "image" || entry.item.detected.mediaKind === "audio").map((entry) => entry.item.id),
    ]);
    setAnnouncement(
      `${created.length} file${created.length === 1 ? "" : "s"} added. ${nextEntries.length} in queue.`,
    );
    const intakeRun = runRef.current;
    // Byte-honest upgrade: bounded head-slice sniff per new row. Rows stay
    // usable instantly; labels correct themselves without implying support.
    void (async () => {
      const sources = new Map(created.map((entry) => [entry.item.id, entry.source]));
      await mapWithConcurrency([...sources.entries()], 4, async ([id, source]) => {
          let sniff;
          try {
            sniff = await sniffEntryHead(source);
          } catch {
            return;
          }
          if (runRef.current !== intakeRun || !entriesRef.current.some((e) => e.item.id === id)) return;
          const verifiedEntries = applyBinaryVerification(entriesRef.current, id, sniff);
          entriesRef.current = verifiedEntries;
          setEntries(verifiedEntries);
          const verified = verifiedEntries.find((entry) => entry.item.id === id);
          setSelection((previous) => {
            if (verified?.item.detected.mediaKind === "image" || verified?.item.detected.mediaKind === "audio") {
              return previous.includes(id) ? previous : [...previous, id];
            }
            return previous.filter((selected) => selected !== id);
          });
          return undefined;
        }, () => runRef.current === intakeRun);
      if (runRef.current === intakeRun) {
        const pendingIds = entriesRef.current
          .filter((entry) => (entry.item.detected.mediaKind === "image" || entry.item.detected.mediaKind === "audio") && !resultsRef.current[entry.item.id])
          .map((entry) => entry.item.id);
        if (pendingIds.length > 0) void inspectIds(pendingIds, false);
      }
    })();
  };

  const handleRemove = (id: string) => {
    resetExportStatus();
    const target = entriesRef.current.find((entry) => entry.item.id === id);
    const nextEntries = removeEntry(entriesRef.current, id);
    entriesRef.current = nextEntries;
    setEntries(nextEntries);
    setSelection((previous) => previous.filter((selected) => selected !== id));
    setPartialIncluded((previous) => previous.filter((selected) => selected !== id));
    setResults((previous) => {
      if (!(id in previous)) return previous;
      const next = { ...previous };
      delete next[id];
      resultsRef.current = next;
      return next;
    });
    setCleaning((previous) => {
      if (!(id in previous)) return previous;
      const next = { ...previous };
      delete next[id];
      return next;
    });
    setRewrites((previous) => {
      if (!(id in previous)) return previous;
      const next = { ...previous };
      delete next[id];
      return next;
    });
    setExpandedIds((previous) => previous.filter((expanded) => expanded !== id));
    setEditorDrafts((previous) => {
      if (!(id in previous)) return previous;
      const next = { ...previous };
      delete next[id];
      return next;
    });
    setGeoDrafts((previous) => {
      if (!(id in previous)) return previous;
      const next = { ...previous };
      delete next[id];
      return next;
    });
    setGeoLastOp((previous) => {
      if (!(id in previous)) return previous;
      const next = { ...previous };
      delete next[id];
      return next;
    });
    setAnnouncement(
      target
        ? `${target.item.name} removed. ${nextEntries.length} in queue.`
        : "Queue updated.",
    );
  };

  const handleClear = () => {
    runRef.current += 1;
    cleanGuardRef.current.cancel();
    batchGuardRef.current.cancel();
    rewriteGuardRef.current.cancel();
    zipGuardRef.current.cancel();
    reportGuardRef.current.cancel();
    setInspectingIds([]);
    setCleaningIds([]);
    setRewritingIds([]);
    setRewriteProgress(null);
    setBatch(null);
    setBatchRunning(false);
    setZip(idleZipState());
    const cleared = clearEntries();
    entriesRef.current = cleared;
    setEntries(cleared);
    setSelection([]);
    setCleaningTargets(DEFAULT_CLEANING_TARGETS);
    setPartialIncluded([]);
    setIncludeAllPartials(false);
    resultsRef.current = {};
    setResults({});
    setCleaning({});
    setRewrites({});
    setExpandedIds([]);
    setEditorDrafts({});
    setEditorId(null);
    setEditorProgress(null);
    setEditorFromDetails(false);
    setDetailsId(null);
    setGeoPendingOp(null);
    setReportChoices(DEFAULT_REPORT_CHOICES);
    setReportBusy(null);
    setReportProgress(null);
    setReportError(null);
    setZipReportFailed(null);
    setAnnouncement("Queue cleared.");
  };

  const toggleSelect = (id: string) => {
    setSelection((previous) => previous.includes(id)
      ? previous.filter((selected) => selected !== id)
      : [...previous, id]);
  };
  const toggleSelectAll = () => {
    const allIds = entriesRef.current.map((entry) => entry.item.id);
    setSelection((previous) => previous.length === allIds.length ? [] : allIds);
  };
  const handleRemoveSelected = () => {
    const ids = new Set(selection);
    if (ids.size === 0) return;
    resetExportStatus();
    runRef.current += 1;
    const nextEntries = entriesRef.current.filter((entry) => !ids.has(entry.item.id));
    entriesRef.current = nextEntries;
    setEntries(nextEntries);
    setSelection([]);
    setPartialIncluded((previous) => previous.filter((id) => !ids.has(id)));
    setResults((previous) => {
      const next = { ...previous };
      ids.forEach((id) => delete next[id]);
      resultsRef.current = next;
      return next;
    });
    setCleaning((previous) => {
      const next = { ...previous };
      ids.forEach((id) => delete next[id]);
      return next;
    });
    setRewrites((previous) => {
      const next = { ...previous };
      ids.forEach((id) => delete next[id]);
      return next;
    });
    setExpandedIds((previous) => previous.filter((expanded) => !ids.has(expanded)));
    setEditorDrafts((previous) => {
      const next = { ...previous };
      for (const id of ids) delete next[id];
      return next;
    });
    setAnnouncement(`${ids.size} selected file${ids.size === 1 ? "" : "s"} removed.`);
  };
  const togglePartial = (id: string) => {
    resetExportStatus();
    setPartialIncluded((previous) => previous.includes(id)
      ? previous.filter((selected) => selected !== id)
      : [...previous, id]);
  };
  const handleReportChoices = (choices: ReportChoices) => {
    resetExportStatus();
    setReportChoices(choices);
  };

  const inspectionOf = (id: string): InspectionOutcome | "inspecting" | undefined => {
    if (isInspecting(id)) return "inspecting";
    return results[id]?.outcome;
  };
  const cleaningOf = (id: string): CleaningStatus | "cleaning" | undefined => {
    if (cleaningIds.includes(id)) return "cleaning";
    return cleaning[id]?.status;
  };
  const rewriteOf = (id: string): RewriteStatus | "rewriting" | undefined => {
    if (rewritingIds.includes(id)) return "rewriting";
    return rewrites[id]?.status;
  };
  const zipRunning = zip.phase === "archiving";
  const rewriting = rewritingIds.length > 0;
  const busy = inspectingIds.length > 0 || cleaningIds.length > 0 || batchRunning || rewriting || zipRunning || reportBusy !== null;
  const cleanableOf = (id: string) =>
    (entriesRef.current.find((e) => e.item.id === id)?.item.detected.mediaKind === "image" ||
      entriesRef.current.find((e) => e.item.id === id)?.item.detected.mediaKind === "audio") &&
    entries.some((e) => e.item.id === id);
  const partialOptedInOf = (id: string) => includeAllPartials || partialIncluded.includes(id);

  const batchCounts: BatchCounts = emptyBatchCounts();
  for (const entry of entries) {
    const result = cleaning[entry.item.id];
    if (!result) {
      batchCounts.queued += 1;
      continue;
    }
    switch (result.status) {
      case "verified_clean": batchCounts.verified += 1; break;
      case "unchanged_no_target_tags": batchCounts.unchanged += 1; break;
      case "partially_cleaned": batchCounts.partial += 1; break;
      case "failed":
      case "not_verified": batchCounts.failed += 1; break;
      case "unsupported": batchCounts.unsupported += 1; break;
      case "cancelled": batchCounts.cancelled += 1; break;
    }
  }
  const failedIds = Object.entries(cleaning)
    .filter(([, result]) => result.status === "failed" || result.status === "not_verified")
    .map(([id]) => id);

  // ZIP eligibility: verified + unchanged always; partials only when opted in.
  // Failures, unsupported, unverified and videos are never eligible.
  // When a verified rewrite exists it takes precedence for the archive
  // (rewritten bytes); the cleaned output stays separately downloadable.
  const outputFor = (id: string): { blob: Blob; name: string; kind: "cleaned" | "rewritten" } | null => {
    const rewrite = rewrites[id];
    if (rewrite && rewrite.output && rewrite.outputName && isRewriteDownloadable(rewrite.status)) {
      if (rewrite.status === "partially_rewritten" && !partialOptedInOf(id)) return null;
      return { blob: rewrite.output, name: rewrite.outputName, kind: "rewritten" };
    }
    const result = cleaning[id];
    if (!result || !result.output || !result.outputName) return null;
    if (result.status === "verified_clean" || result.status === "unchanged_no_target_tags") return { blob: result.output, name: result.outputName, kind: "cleaned" };
    if (result.status === "partially_cleaned" && partialOptedInOf(id)) return { blob: result.output, name: result.outputName, kind: "cleaned" };
    return null;
  };
  const eligibleEntries = entries.filter((entry) => outputFor(entry.item.id) !== null);
  const partialExcluded = entries.filter((entry) => {
    const rewrite = rewrites[entry.item.id];
    if (rewrite?.status === "partially_rewritten" && !partialOptedInOf(entry.item.id)) return true;
    const result = cleaning[entry.item.id];
    return result?.status === "partially_cleaned" && !partialOptedInOf(entry.item.id) && !rewrite;
  }).length;

  const handleDownloadZip = async (withoutReports = false) => {
    if (eligibleEntries.length === 0 || busy) return;
    const zipToken = zipGuardRef.current.token();
    const isZipActive = () => zipGuardRef.current.isCurrent(zipToken);
    const mapping = buildZipMapping(eligibleEntries.map((entry) => {
      const out = outputFor(entry.item.id);
      if (!out) throw new Error("eligible entry without output name");
      return { fileId: entry.item.id, outputName: out.name };
    }));
    scopeCounter.current += 1;
    const snapshot = buildReportSnapshot({
      entries: entriesRef.current,
      inspections: resultsRef.current,
      cleanings: cleaning,
      rewrites,
      zipMapping: mapping.map((m) => ({ fileId: m.fileId, archivePath: m.archivePath })),
      options: { format: reportChoices.format, detail: reportChoices.detail, includeOriginalValues: reportChoices.includeOriginalValues },
      scopeId: `run-${scopeCounter.current}`,
    });
    const archiveName = zipArchiveName();
    setZip({ phase: "archiving", filesDone: 0, filesTotal: mapping.length, bytesWritten: 0, archiveName });
    setZipReportFailed(null);
    setAnnouncement(`Archiving ${mapping.length} verified outputs into ${archiveName}.`);
    type SaveHandle = {
      createWritable: () => Promise<{
        write: (chunk: Uint8Array) => Promise<void>;
        close: () => Promise<void>;
        abort: () => Promise<void>;
      }>;
    };
    let saveHandle: SaveHandle | null = null;
    try {
      // Request the destination while the download click still carries a
      // browser user-activation token. Report generation may await long
      // enough for that token to expire.
      if (supportsFileSystemAccess()) {
        saveHandle = await (window as unknown as {
          showSaveFilePicker: (options: { suggestedName: string; types?: unknown[] }) => Promise<SaveHandle>;
        }).showSaveFilePicker({ suggestedName: archiveName });
      }
      // Reports (optional): generated from the SAME frozen snapshot so the
      // embedded copies byte-match standalone exports of that snapshot.
      const reportSources: { path: string; data: Uint8Array }[] = [];
      const wantCsv = !withoutReports && (reportChoices.format === "csv" || reportChoices.format === "both");
      const wantPdf = !withoutReports && (reportChoices.format === "pdf" || reportChoices.format === "both");
      if (wantCsv || wantPdf) {
        setReportBusy("zip");
        setReportError(null);
      }
      try {
        if (wantCsv) {
          const csv = await buildSummaryCsv(snapshot, { isCancelled: () => !isZipActive() });
          reportSources.push({ path: "reports/metadata-report.csv", data: new TextEncoder().encode(csv) });
          if (reportChoices.detail === "detailed") {
            const tags = await buildTagsCsv(snapshot, { isCancelled: () => !isZipActive() });
            reportSources.push({ path: "reports/metadata-tags.csv", data: new TextEncoder().encode(tags) });
          }
        }
        if (wantPdf) {
          const pdfLib = await import("pdf-lib");
          if (!isZipActive()) throw new DOMException("cancelled", "AbortError");
          const pdf = await buildReportPdf(pdfLib, snapshot, { isCancelled: () => !isZipActive() });
          reportSources.push({ path: "reports/metadata-report.pdf", data: pdf.bytes });
        }
      } finally {
        setReportBusy(null);
      }
      const estimatedMediaBytes = mapping.reduce((sum, item) => {
        return sum + (outputFor(item.fileId)?.blob.size ?? 0);
      }, 0);
      const estimatedReportBytes = reportSources.reduce((sum, source) => sum + source.data.length, 0);
      const estimated = estimatedMediaBytes + estimatedReportBytes;
      if (estimated > ZIP_SIZE_WARN_BYTES) {
        setAnnouncement(`Large estimated archive (${(estimated / 1048576).toFixed(0)} MB). The in-memory fallback may strain this device; split the batch if saving fails.`);
      }
      // Blob outputs are handed to the ZIP builder lazily; it reads 256 KiB
      // slices instead of materializing the whole cleaned batch here.
      const sources: ZipSource[] = [];
      for (const item of mapping) {
        if (!isZipActive()) throw new DOMException("cancelled", "AbortError");
        const out = outputFor(item.fileId);
        const blob = out?.blob;
        if (!blob) throw new Error(`Output for ${item.fileId} vanished before archiving.`);
        sources.push({ path: item.archivePath, data: blob });
      }
      for (const report of reportSources) sources.push(report);
      const totalEntries = mapping.length + reportSources.length;
      let bytes: Uint8Array;
      if (saveHandle) {
        const writable = await saveHandle.createWritable();
        bytes = await buildZipArchive(sources, {
          sink: writable,
          isCancelled: () => !isZipActive(),
          onProgress: (progress) => {
            setZip((previous) => previous.phase === "archiving"
              ? { ...previous, filesDone: progress.filesDone, filesTotal: progress.filesTotal, bytesWritten: progress.bytesWritten }
              : previous);
          },
        });
        if (!isZipActive()) return;
        setZip({ phase: "ready", filesDone: totalEntries, filesTotal: totalEntries, bytesWritten: estimated, archiveName, archiveBytes: 0, entryCount: totalEntries });
        setAnnouncement(`ZIP saved to disk: ${archiveName} with ${mapping.length} verified files${reportSources.length > 0 ? ` + ${reportSources.length} reports` : ""}.`);
        return;
      }
      bytes = await buildZipArchive(sources, {
        isCancelled: () => !isZipActive(),
        onProgress: (progress) => {
          setZip((previous) => previous.phase === "archiving"
            ? { ...previous, filesDone: progress.filesDone, filesTotal: progress.filesTotal, bytesWritten: progress.bytesWritten }
            : previous);
        },
      });
      if (!isZipActive()) return;
      downloadNamedBlob(bytes, archiveName, "application/zip");
      setZip({ phase: "ready", filesDone: totalEntries, filesTotal: totalEntries, bytesWritten: bytes.length, archiveName, archiveBytes: bytes.length, entryCount: totalEntries });
      setAnnouncement(`ZIP ready: ${archiveName} with ${mapping.length} verified files${reportSources.length > 0 ? ` + ${reportSources.length} reports` : ""}. Download started.`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setZip({ phase: "cancelled", filesDone: 0, filesTotal: mapping.length, bytesWritten: 0, archiveName });
        setAnnouncement("ZIP cancelled. Partial archives are discarded, never offered.");
        return;
      }
      if (error instanceof ZipCancelled) {
        setZip({ phase: "cancelled", filesDone: 0, filesTotal: mapping.length, bytesWritten: 0, archiveName });
        setAnnouncement("ZIP cancelled. Partial archives are discarded, never offered.");
        return;
      }
      const message = error instanceof Error ? error.message.slice(0, 200) : "Unknown archive failure.";
      const reportRelated = /report|CSV|PDF/i.test(message);
      if (reportRelated && (reportChoices.format === "csv" || reportChoices.format === "pdf" || reportChoices.format === "both")) {
        // A selected report failed: no silent ZIP-without-reports. Offer the explicit choice.
        setZipReportFailed(message);
        setZip({ phase: "idle", filesDone: 0, filesTotal: 0, bytesWritten: 0 });
        setAnnouncement(`Report generation failed (${message}). Your cleaned outputs are safe — retry, or export the ZIP without reports.`);
        return;
      }
      setZip({
        phase: "failed", filesDone: 0, filesTotal: mapping.length, bytesWritten: 0, archiveName,
        error: message,
      });
      setAnnouncement("ZIP failed before finalizing. No archive was offered.");
    } finally {
      setReportBusy((current) => current === "zip" ? null : current);
    }
  };

  const handleCancelZip = () => {
    zipGuardRef.current.cancel();
    setReportBusy((current) => current === "zip" ? null : current);
    setZip((current) => current.phase === "archiving"
      ? { phase: "cancelled", filesDone: current.filesDone, filesTotal: current.filesTotal, bytesWritten: current.bytesWritten, archiveName: current.archiveName }
      : current);
    setAnnouncement("ZIP cancelled. Partial archive data is discarded.");
  };

  const currentMappingForReports = () => buildZipMapping(eligibleEntries.map((entry) => {
    const out = outputFor(entry.item.id);
    if (!out) throw new Error("eligible entry without output name");
    return { fileId: entry.item.id, outputName: out.name };
  }));

  const buildSnapshotForExport = (): ReportSnapshot => {
    scopeCounter.current += 1;
    return buildReportSnapshot({
      entries: entriesRef.current,
      inspections: resultsRef.current,
      cleanings: cleaning,
      rewrites,
      zipMapping: currentMappingForReports().map((m) => ({ fileId: m.fileId, archivePath: m.archivePath })),
      options: { format: reportChoices.format, detail: reportChoices.detail, includeOriginalValues: reportChoices.includeOriginalValues },
      scopeId: `run-${scopeCounter.current}`,
    });
  };

  const handleDownloadCsv = async () => {
    if (entriesRef.current.length === 0 || busy) return;
    const token = reportGuardRef.current.token();
    setReportBusy("csv");
    setReportError(null);
    setReportProgress("Building CSV…");
    try {
      const snapshot = buildSnapshotForExport();
      const csv = await buildSummaryCsv(snapshot, {
        onProgress: (progress) => setReportProgress(`Building CSV… ${progress.rowsDone}/${progress.rowsTotal} rows`),
        isCancelled: () => !reportGuardRef.current.isCurrent(token),
      });
      if (!reportGuardRef.current.isCurrent(token)) return;
      downloadNamedBlob(new TextEncoder().encode(csv), reportFileName("csv"), "text/csv;charset=utf-8");
      setReportProgress(`CSV ready: ${snapshot.records.length} files, one row each.`);
      setAnnouncement(`CSV report downloaded for ${snapshot.records.length} files.`);
    } catch (error) {
      if (!reportGuardRef.current.isCurrent(token)) return;
      setReportError(error instanceof Error ? error.message.slice(0, 200) : "CSV generation failed.");
    } finally {
      if (reportGuardRef.current.isCurrent(token)) setReportBusy(null);
    }
  };

  const handleDownloadTags = async () => {
    if (entriesRef.current.length === 0 || busy) return;
    const token = reportGuardRef.current.token();
    setReportBusy("tags");
    setReportError(null);
    setReportProgress("Building tag ledger…");
    try {
      const snapshot = buildSnapshotForExport();
      const csv = await buildTagsCsv(snapshot, {
        onProgress: (progress) => setReportProgress(`Building tag ledger… ${progress.rowsDone}/${progress.rowsTotal} files`),
        isCancelled: () => !reportGuardRef.current.isCurrent(token),
      });
      if (!reportGuardRef.current.isCurrent(token)) return;
      downloadNamedBlob(new TextEncoder().encode(csv), reportFileName("tags"), "text/csv;charset=utf-8");
      setReportProgress("Tag ledger ready.");
      setAnnouncement("Detailed tag ledger CSV downloaded.");
    } catch (error) {
      if (!reportGuardRef.current.isCurrent(token)) return;
      setReportError(error instanceof Error ? error.message.slice(0, 200) : "Tag ledger generation failed.");
    } finally {
      if (reportGuardRef.current.isCurrent(token)) setReportBusy(null);
    }
  };

  const handleDownloadPdf = async () => {
    if (entriesRef.current.length === 0 || busy) return;
    const token = reportGuardRef.current.token();
    setReportBusy("pdf");
    setReportError(null);
    setReportProgress("Building PDF…");
    try {
      const snapshot = buildSnapshotForExport();
      const pdfLib = await import("pdf-lib");
      if (!reportGuardRef.current.isCurrent(token)) return;
      const pdf = await buildReportPdf(pdfLib, snapshot, {
        onProgress: (done, total) => setReportProgress(`Building PDF… ${done}/${total} files`),
        isCancelled: () => !reportGuardRef.current.isCurrent(token),
      });
      if (!reportGuardRef.current.isCurrent(token)) return;
      downloadNamedBlob(pdf.bytes, reportFileName("pdf"), "application/pdf");
      setReportProgress(`PDF ready: ${pdf.pageCount} pages, ${pdf.fileCount} files${pdf.compactUsed ? " (compact mode disclosed inside)" : ""}.`);
      setAnnouncement(`PDF report downloaded: ${pdf.pageCount} pages.`);
    } catch (error) {
      if (!reportGuardRef.current.isCurrent(token)) return;
      setReportError(error instanceof Error ? error.message.slice(0, 200) : "PDF generation failed.");
    } finally {
      if (reportGuardRef.current.isCurrent(token)) setReportBusy(null);
    }
  };

  const handleCancelReport = () => {
    reportGuardRef.current.cancel();
    setReportBusy(null);
    setReportProgress(null);
    setAnnouncement("Report generation cancelled. Cleaned outputs are unaffected.");
  };

  return (
    <>
      <a href="#main-content" className="fixed left-4 top-3 z-[100] -translate-y-20 rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white focus:translate-y-0">
        Skip to main content
      </a>
      <Header uploadLabel={entries.length > 0 ? "Add more files" : undefined} />
      <main id="main-content" className="pb-4">
        {entries.length === 0 ? (
          <BeforeUploadHome
            activeTool={activeTool}
            onToolChange={(tool) => {
              setActiveTool(tool);
              setAnnouncement(tool === "ai_metadata"
                ? "AI Metadata tool selected. Inspection prioritizes qualified AI evidence and Content Credentials."
                : "Metadata & Geotag tool selected. Inspection prioritizes EXIF, GPS, XMP and IPTC.");
            }}
            onFiles={handleFiles}
            rewriteProgress={rewriteProgress}
          />
        ) : (
          <AfterUploadWorkspace
            entries={entries}
            activeTool={activeTool}
            onToolChange={(tool) => {
              setActiveTool(tool);
              setAnnouncement(tool === "ai_metadata"
                ? "AI Metadata tool selected. Inspection prioritizes qualified AI evidence and Content Credentials."
                : "Metadata & Geotag tool selected. Inspection prioritizes EXIF, GPS, XMP and IPTC.");
            }}
            announcement={announcement}
            results={results}
            inspectingIds={inspectingIds}
            inspectionOf={inspectionOf}
            inspectionResultOf={(id) => results[id]}
            cleaningOf={cleaningOf}
            cleaningResultOf={(id) => cleaning[id]}
            rewriteOf={rewriteOf}
            rewriteResultOf={(id) => rewrites[id]}
            outputOf={outputFor}
            inspectingCount={inspectingIds.length}
            processingCount={cleaningIds.length + rewritingIds.length + (batchRunning ? 1 : 0)}
            busy={busy}
            cleanableOf={cleanableOf}
            selectedOf={(id) => selection.includes(id)}
            expandedOf={(id) => expandedIds.includes(id)}
            selectedCount={selection.length}
            selectedCleanableCount={selection.filter((id) => entries.some((entry) => entry.item.id === id && (entry.item.detected.mediaKind === "image" || entry.item.detected.mediaKind === "audio"))).length}
            outputCount={eligibleEntries.length}
            partialOptedInOf={(id) => includeAllPartials || partialIncluded.includes(id)}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
            onToggleExpanded={(id) => setExpandedIds((previous) => previous.includes(id)
              ? previous.filter((expanded) => expanded !== id)
              : [...previous, id])}
            onOpenDetails={(id) => setDetailsId(id)}
            onOpenEditor={handleOpenEditor}
            onFiles={handleFiles}
            onRemoveSelected={handleRemoveSelected}
            onTogglePartial={togglePartial}
            onRetry={handleRetryOne}
            onRemove={handleRemove}
            onClear={handleClear}
            onInspect={handleInspectOne}
            onDownloadNotice={(name) => setAnnouncement(`Download started: ${name}.`)}
            onCancelInspections={handleCancelInspections}
            onCancelProcessing={() => {
              handleCancelCleaning();
              handleCancelBatch();
              handleCancelRewrite();
            }}
            onRemoveMetadata={handleRemoveMetadata}
            onRemoveAiMetadata={handleRemoveAiMetadata}
            onOpenRewrite={handleOpenRewrite}
            premiumNotice={premiumNotice}
            onDismissPremiumNotice={() => setPremiumNotice(null)}
            batchRunning={batchRunning}
            batchDone={batch?.done ?? 0}
            batchTotal={batch?.total ?? 0}
            batchCurrentName={batch?.current ?? null}
            batchCounts={batchCounts}
            zip={zip}
            partialExcluded={partialExcluded}
            includeAllPartials={includeAllPartials}
            reportFailure={zipReportFailed}
            failedCount={failedIds.length}
            onCancelBatch={handleCancelBatch}
            onCancelZip={handleCancelZip}
            onRetryFailed={handleRetryFailed}
            onTogglePartials={() => {
              resetExportStatus();
              setIncludeAllPartials((previous) => !previous);
            }}
            onDownloadZip={() => void handleDownloadZip(false)}
            onDownloadZipBare={() => void handleDownloadZip(true)}
            reportChoices={reportChoices}
            reportGenerating={reportBusy}
            reportProgress={reportProgress}
            reportError={reportError}
            reportDisabled={busy && reportBusy === null}
            onReportChoices={handleReportChoices}
            onDownloadCsv={() => void handleDownloadCsv()}
            onDownloadTags={() => void handleDownloadTags()}
            onDownloadPdf={() => void handleDownloadPdf()}
            onCancelReport={reportBusy === "zip" ? handleCancelZip : handleCancelReport}
            rewriteProgress={rewriteProgress}
          />
        )}
      </main>
      <Footer />
      {/* Screen 05 — image details dialog (portaled to document.body). */}
      <ImageDetailsModal
        entry={detailsEntry}
        navPosition={detailsNavIndex >= 0 ? { index: detailsNavIndex, total: detailsNavList.length } : null}
        inspectionResult={detailsEntry ? results[detailsEntry.item.id] : undefined}
        inspectionState={detailsEntry ? inspectionOf(detailsEntry.item.id) : undefined}
        cleaningState={detailsEntry ? cleaningOf(detailsEntry.item.id) : undefined}
        cleaningResult={detailsEntry ? cleaning[detailsEntry.item.id] : undefined}
        rewriteState={detailsEntry ? rewriteOf(detailsEntry.item.id) : undefined}
        rewriteResult={detailsEntry ? rewrites[detailsEntry.item.id] : undefined}
        downloadOutput={detailsEntry ? outputFor(detailsEntry.item.id) : null}
        activeTool={activeTool}
        busy={busy}
        onStep={(delta) => {
          if (detailsNavIndex === -1) return;
          const next = detailsNavList[detailsNavIndex + delta];
          if (next) setDetailsId(next.item.id);
        }}
        onDownloadNotice={(name) => setAnnouncement(`Download started: ${name}.`)}
        onRemoveForFile={handleRemoveFromDetails}
        onEditForImage={handleOpenEditorFromDetails}
        onClose={() => setDetailsId(null)}
      />
      {/* Screen 06 — single-image edit metadata dialog (portaled). */}
      <EditMetadataModal
        entry={editorEntry}
        draft={editorDraftForOpen}
        inspectionResult={editorEntry ? results[editorEntry.item.id] : undefined}
        inspectionState={editorEntry ? inspectionOf(editorEntry.item.id) : undefined}
        savedProfile={profile}
        signedIn={Boolean(user)}
        result={editorEntry ? rewrites[editorEntry.item.id] : undefined}
        progress={editorProgress}
        busy={editorId ? rewritingIds.includes(editorId) : false}
        onFieldChange={(field, value) => {
          if (editorId) updateEditorDraft(editorId, (draft) => ({ ...draft, values: { ...draft.values, [field]: value } }));
        }}
        onModeChange={(mode) => {
          if (editorId) updateEditorDraft(editorId, (draft) => ({ ...draft, mode }));
        }}
        onSourceChange={(source: EditorSource) => {
          if (editorId) updateEditorDraft(editorId, (draft) => ({ ...draft, source }));
        }}
        projects={projects}
        projectDetails={projectDetails}
        onProjectSelect={handleProjectSelect}
        onSaveDraft={(draft) => {
          if (editorId) setEditorDrafts((previous) => ({ ...previous, [editorId]: draft }));
        }}
        onDiscardDraft={() => {
          if (editorId) updateEditorDraft(editorId, () => blankEditorDraft(readRewriteSettings().mode));
        }}
        onCopyProfileIntoDraft={() => {
          if (editorId) handleEditorCopyProfile(editorId);
        }}
        onApply={handleEditorApply}
        geoDraft={editorEntry ? geoDrafts[editorEntry.item.id] ?? blankGeoDraft() : blankGeoDraft()}
        geoPendingOp={geoPendingOp}
        onGeoDraftChange={(draft) => {
          if (editorId) setGeoDrafts((previous) => ({ ...previous, [editorId]: draft }));
        }}
        geoLastOperation={editorEntry ? geoLastOp[editorEntry.item.id] ?? null : null}
        selectedImageCount={editorEntry ? bulkGeoSnapshot(editorEntry.item.id, selection, entries).length : 0}
        onGeoApply={handleGeoApply}
        onGeoApplyBulk={handleGeoApplyBulk}
        onAnnounce={setAnnouncement}
        onViewDetails={handleEditorViewDetails}
        onDownloadNotice={(name) => setAnnouncement(`Download started: ${name}.`)}
        onClose={handleEditorClose}
      />

      {/* Phase 06: explicit batch-rewrite scope confirmation */}
      <BatchRewriteDialog
        open={batchDialogOpen}
        imageCount={batchSelectionCounts.image}
        audioCount={batchSelectionCounts.audio}
        videoCount={batchSelectionCounts.video}
        otherCount={batchSelectionCounts.other}
        totalBytes={selection.reduce((sum, id) => sum + (entries.find((entry) => entry.item.id === id)?.source.size ?? 0), 0)}
        mode={rewriteMode}
        savedProfile={profile}
        projects={projects}
        projectDetails={projectDetails}
        source={batchSource}
        projectId={batchProjectId}
        customDraft={batchCustomDraft}
        onCustomChange={setBatchCustomDraft}
        accessChecking={!authReady}
        busy={rewritingIds.length > 0}
        lockedReason={batchLockedReason}
        onSourceChange={(source) => {
          setBatchSource(source);
          // Auto-selecting the first project must ALSO load its details —
          // otherwise the scope preview stays empty and confirm stays
          // disabled (SOL-011 e2e caught this).
          if (source === "project" && !batchProjectId && projects.length > 0) {
            const firstId = projects[0].projectId;
            setBatchProjectId(firstId);
            void ensureProjectDetails(firstId);
          }
        }}
        onProjectChange={(projectId) => {
          setBatchProjectId(projectId);
          if (projectId) void ensureProjectDetails(projectId);
        }}
        onConfirm={handleBatchRewriteConfirm}
        onCancel={() => setBatchDialogOpen(false)}
      />
    </>
  );
}
