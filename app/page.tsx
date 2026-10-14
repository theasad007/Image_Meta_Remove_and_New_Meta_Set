"use client";

import { useEffect, useRef, useState } from "react";
import BeforeAfterPanel from "../src/components/cleaning/BeforeAfterPanel";
import BatchPanel from "../src/components/batch/BatchPanel";
import Footer from "../src/components/layout/Footer";
import Header from "../src/components/layout/Header";
import Hero from "../src/components/layout/Hero";
import InspectorPanel from "../src/components/inspector/InspectorPanel";
import FuturePanel from "../src/components/panels/FuturePanel";
import FormatsPanel from "../src/components/panels/FormatsPanel";
import QueueList from "../src/components/queue/QueueList";
import {
  applyBinaryVerification,
  clearEntries,
  createEntries,
  removeEntry,
  sniffEntryHead,
} from "../src/components/queue/queue-store";
import UploadPanel from "../src/components/upload/UploadPanel";
import { createRunGuard } from "../src/lib/metadata/verify/run-guard";
import {
  DEFAULT_CLEANING_TARGETS,
  PRIVACY_SAFE_DEFAULT,
  type CleaningTarget,
  type CleaningStatus,
  type FileCleaningResult,
} from "../src/lib/metadata/clean/types";
import { inspectImage } from "../src/lib/metadata/inspect/inspect";
import { processBatchFile } from "../src/lib/queue/batch-pipeline";
import { runBatchIds } from "../src/lib/queue/batch-scheduler";
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
import ReportsPanel from "../src/components/reports/ReportsPanel";
import type { BatchCounts, ZipBuildState } from "../src/types/batch";
import { emptyBatchCounts } from "../src/types/batch";
import type {
  ImageInspectionResult,
  InspectionOutcome,
} from "../src/types/inspection";
import { emptyInspection } from "../src/types/inspection";
import type { QueueEntry } from "../src/types/media";

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
  const [results, setResults] = useState<Record<string, ImageInspectionResult>>({});
  const [inspectingIds, setInspectingIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState<Record<string, FileCleaningResult>>({});
  const [cleaningIds, setCleaningIds] = useState<string[]>([]);
  const [cleanViewId, setCleanViewId] = useState<string | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [cleaningTargets, setCleaningTargets] = useState<CleaningTarget[]>(DEFAULT_CLEANING_TARGETS);
  const [partialIncluded, setPartialIncluded] = useState<string[]>([]);
  const [includeAllPartials, setIncludeAllPartials] = useState(false);
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
  const zipGuardRef = useRef(createRunGuard());
  const resultsRef = useRef<Record<string, ImageInspectionResult>>({});
  const announcedQuartile = useRef(0);
  const resultRegionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    resultsRef.current = results;
  }, [results]);
  useEffect(() => {
    if (!selectedId && !cleanViewId) return;
    const frame = window.requestAnimationFrame(() => {
      resultRegionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      resultRegionRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedId, cleanViewId]);

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
      result = await inspectImage(id, entry.source, entry.item.name);
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
      if (firstAlive && openDetails) setSelectedId(firstAlive);
      setAnnouncement(`Inspection finished for ${ids.length} file${ids.length === 1 ? "" : "s"}.`);
    }
  };

  const handleInspectOne = (id: string) => {
    setCleanViewId(null);
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

  const pipelineDeps = () => ({
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
      targets: cleaningTargets,
    },
  });

  const handleCleanOne = async (id: string) => {
    const entry = entriesRef.current.find((e) => e.item.id === id);
    if (!entry) return;
    if (entry.item.detected.mediaKind !== "image") {
      setAnnouncement(`${entry.item.name} is not a supported still image, so cleaning was not started.`);
      return;
    }
    if (cleaningTargets.length === 0) {
      setAnnouncement("Choose at least one metadata type to clean.");
      return;
    }
    resetExportStatus();
    setSelectedId(null);
    const token = cleanGuardRef.current.token();
    setCleaningIds((previous) => (previous.includes(id) ? previous : [...previous, id]));
    setAnnouncement(`Cleaning ${entry.item.name}: inspecting original, cleaning, verifying output.`);
    try {
      const cleaned = await processBatchFile(id, pipelineDeps());
      if (!cleanGuardRef.current.isCurrent(token)) return;
      if (!entriesRef.current.some((e) => e.item.id === id)) return;
      setCleaning((previous) => ({ ...previous, [id]: cleaned }));
      setCleanViewId(id);
      setAnnouncement(`Cleaning finished for ${entry.item.name}: ${cleaned.status.replace(/_/g, " ")}.`);
    } catch {
      if (!cleanGuardRef.current.isCurrent(token)) return;
      const failed: FileCleaningResult = {
        fileId: id,
        inputName: entry.item.name,
        detectedFormat: "unknown",
        inputBytes: entry.source.size,
        before: resultsRef.current[id] ?? emptyInspection(id, entry.item.name, entry.source.size),
        policy: { mode: PRIVACY_SAFE_DEFAULT.mode, targets: cleaningTargets },
        status: "failed",
        changes: [],
        warnings: [],
        errors: ["An unexpected cleaning error occurred. No output was created."],
        cleanedAt: new Date().toISOString(),
      };
      setCleaning((previous) => ({ ...previous, [id]: failed }));
      setCleanViewId(id);
      setAnnouncement(`Cleaning failed for ${entry.item.name}. No output was created.`);
    } finally {
      setCleaningIds((previous) => previous.filter((active) => active !== id));
    }
  };

  const selectableIds = (list: QueueEntry[]) =>
    list.filter((entry) => entry.item.detected.mediaKind === "image").map((entry) => entry.item.id);

  const startBatch = async (ids: string[]) => {
    const eligible = ids.filter((id) =>
      entriesRef.current.some((entry) => entry.item.id === id && entry.item.detected.mediaKind === "image"),
    );
    if (eligible.length === 0) {
      setAnnouncement("Nothing eligible to clean.");
      return;
    }
    if (cleaningTargets.length === 0) {
      setAnnouncement("Choose at least one metadata type to clean.");
      return;
    }
    resetExportStatus();
    const token = batchGuardRef.current.token();
    announcedQuartile.current = 0;
    setBatchRunning(true);
    setBatch({ jobId: token, total: eligible.length, done: 0, current: null });
    setAnnouncement(`Batch started: ${eligible.length} file${eligible.length === 1 ? "" : "s"}, one at a time.`);
    await runBatchIds({
      ids: eligible,
      isActive: () => batchGuardRef.current.isCurrent(token),
      isEligible: (id) => batchGuardRef.current.isCurrent(token) && entriesRef.current.some((e) => e.item.id === id),
      process: (id) => processBatchFile(id, {
        ...pipelineDeps(),
        onStage: (stage) => {
          const entry = entriesRef.current.find((e) => e.item.id === id);
          setBatch((previous) => previous && previous.jobId === token
            ? { ...previous, current: entry ? `${entry.item.name} (${stage})` : previous.current }
            : previous);
        },
      }),
      onDone: (id, result) => {
        setCleaning((previous) => ({ ...previous, [id]: result }));
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
          policy: { mode: PRIVACY_SAFE_DEFAULT.mode, targets: cleaningTargets },
          status: "failed",
          changes: [],
          warnings: [],
          errors: ["An unexpected batch error occurred. No output was created for this file."],
          cleanedAt: new Date().toISOString(),
        };
        setCleaning((previous) => ({ ...previous, [id]: failed }));
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
      : `Batch finished: ${eligible.length} file${eligible.length === 1 ? "" : "s"} processed.`);
  };

  const handleCleanAll = () => {
    void startBatch(selectableIds(entriesRef.current));
  };

  const handleCleanSelected = () => {
    const alive = new Set(entriesRef.current.map((e) => e.item.id));
    void startBatch(selection.filter((id) => alive.has(id) && entriesRef.current.find((e) => e.item.id === id)?.item.detected.mediaKind === "image"));
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

  const handleFiles = (files: File[]) => {
    if (files.length === 0) return;
    resetExportStatus();
    const created = createEntries(files);
    const nextEntries = [...entriesRef.current, ...created];
    entriesRef.current = nextEntries;
    setEntries(nextEntries);
    setSelection((previous) => [
      ...previous,
      ...created.filter((entry) => entry.item.detected.mediaKind === "image").map((entry) => entry.item.id),
    ]);
    setAnnouncement(
      `${created.length} file${created.length === 1 ? "" : "s"} added. ${nextEntries.length} in queue.`,
    );
    const intakeRun = runRef.current;
    // Byte-honest upgrade: bounded head-slice sniff per new row. Rows stay
    // usable instantly; labels correct themselves without implying support.
    void (async () => {
      const sources = new Map(created.map((entry) => [entry.item.id, entry.source]));
      await Promise.all(
        [...sources.entries()].map(async ([id, source]) => {
          let sniff;
          try {
            sniff = await sniffEntryHead(source);
          } catch {
            return;
          }
          if (!entriesRef.current.some((e) => e.item.id === id)) return;
          const verifiedEntries = applyBinaryVerification(entriesRef.current, id, sniff);
          entriesRef.current = verifiedEntries;
          setEntries(verifiedEntries);
          const verified = verifiedEntries.find((entry) => entry.item.id === id);
          setSelection((previous) => {
            if (verified?.item.detected.mediaKind === "image") {
              return previous.includes(id) ? previous : [...previous, id];
            }
            return previous.filter((selected) => selected !== id);
          });
        }),
      );
      if (runRef.current === intakeRun) {
        const pendingIds = entriesRef.current
          .filter((entry) => entry.item.detected.mediaKind === "image" && !resultsRef.current[entry.item.id])
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
    setSelectedId((previous) => (previous === id ? null : previous));
    setCleanViewId((previous) => (previous === id ? null : previous));
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
    zipGuardRef.current.cancel();
    reportGuardRef.current.cancel();
    setInspectingIds([]);
    setCleaningIds([]);
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
    setSelectedId(null);
    setCleanViewId(null);
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
    setSelectedId((previous) => previous && ids.has(previous) ? null : previous);
    setCleanViewId((previous) => previous && ids.has(previous) ? null : previous);
    setAnnouncement(`${ids.size} selected file${ids.size === 1 ? "" : "s"} removed.`);
  };
  const toggleCleaningTarget = (target: CleaningTarget) => {
    resetExportStatus();
    setCleaningTargets((previous) => previous.includes(target)
      ? previous.filter((item) => item !== target)
      : [...previous, target]);
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
  const hasCleaningResultFor = (id: string) => id in cleaning;
  const zipRunning = zip.phase === "archiving";
  const busy = inspectingIds.length > 0 || cleaningIds.length > 0 || batchRunning || zipRunning || reportBusy !== null;
  const cleanableOf = (id: string) =>
    entriesRef.current.find((e) => e.item.id === id)?.item.detected.mediaKind === "image" &&
    entries.some((e) => e.item.id === id);
  const selectedOf = (id: string) => selection.includes(id);
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
  const eligibleEntries = entries.filter((entry) => {
    const result = cleaning[entry.item.id];
    if (!result || !result.output || !result.outputName) return false;
    if (result.status === "verified_clean" || result.status === "unchanged_no_target_tags") return true;
    if (result.status === "partially_cleaned") return partialOptedInOf(entry.item.id);
    return false;
  });
  const partialExcluded = entries.filter((entry) => {
    const result = cleaning[entry.item.id];
    return result?.status === "partially_cleaned" && !partialOptedInOf(entry.item.id);
  }).length;

  const handleDownloadZip = async (withoutReports = false) => {
    if (eligibleEntries.length === 0 || busy) return;
    const zipToken = zipGuardRef.current.token();
    const isZipActive = () => zipGuardRef.current.isCurrent(zipToken);
    const mapping = buildZipMapping(eligibleEntries.map((entry) => {
      const result = cleaning[entry.item.id];
      if (!result?.outputName) throw new Error("eligible entry without output name");
      return { fileId: entry.item.id, outputName: result.outputName };
    }));
    scopeCounter.current += 1;
    const snapshot = buildReportSnapshot({
      entries: entriesRef.current,
      inspections: resultsRef.current,
      cleanings: cleaning,
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
        return sum + (cleaning[item.fileId]?.output?.size ?? 0);
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
        const result = cleaning[item.fileId];
        const blob = result?.output;
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
        setAnnouncement(`ZIP saved to disk: ${archiveName} with ${mapping.length} images${reportSources.length > 0 ? ` + ${reportSources.length} reports` : ""}.`);
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
      setAnnouncement(`ZIP ready: ${archiveName} with ${mapping.length} verified images${reportSources.length > 0 ? ` + ${reportSources.length} reports` : ""}. Download started.`);
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
    const result = cleaning[entry.item.id];
    if (!result?.outputName) throw new Error("eligible entry without output name");
    return { fileId: entry.item.id, outputName: result.outputName };
  }));

  const buildSnapshotForExport = (): ReportSnapshot => {
    scopeCounter.current += 1;
    return buildReportSnapshot({
      entries: entriesRef.current,
      inspections: resultsRef.current,
      cleanings: cleaning,
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
  const selected = selectedId
    ? entries.find((entry) => entry.item.id === selectedId) ?? null
    : null;
  const selectedResult = selectedId ? results[selectedId] ?? null : null;
  const cleanView = cleanViewId ? cleaning[cleanViewId] ?? null : null;
  const cleanViewAlive = cleanViewId
    ? entries.some((entry) => entry.item.id === cleanViewId)
    : false;

  return (
    <>
      <a href="#main-content" className="fixed left-4 top-3 z-[100] -translate-y-20 rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white focus:translate-y-0">
        Skip to main content
      </a>
      <Header />
      <main id="main-content" className="pb-12">
        <Hero />
        <div id="upload" className="mx-auto max-w-7xl scroll-mt-24 px-4 sm:px-6 lg:px-8">
          <div className="surface-card rounded-[1.75rem] p-4 sm:p-7 lg:p-8">
            <UploadPanel onFiles={handleFiles} />
            <QueueList
              entries={entries}
              announcement={announcement}
              inspectionOf={inspectionOf}
              inspectionResultOf={(id) => results[id]}
              cleaningOf={cleaningOf}
              hasCleaningResultFor={hasCleaningResultFor}
              inspectingCount={inspectingIds.length}
              cleaningCount={cleaningIds.length}
              busy={busy}
              batchRunning={batchRunning}
              cleanableOf={cleanableOf}
              selectedOf={selectedOf}
              selectedCount={selection.length}
              selectedCleanableCount={selection.filter((id) => entries.some((entry) => entry.item.id === id && entry.item.detected.mediaKind === "image")).length}
              eligibleInputs={selectableIds(entries).length}
              cleaningTargets={cleaningTargets}
              partialOptedInOf={(id) => includeAllPartials || partialIncluded.includes(id)}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={toggleSelectAll}
              onToggleCleaningTarget={toggleCleaningTarget}
              onRemoveSelected={handleRemoveSelected}
              onTogglePartial={togglePartial}
              onRetry={handleRetryOne}
              onRemove={handleRemove}
              onClear={handleClear}
              onInspect={handleInspectOne}
              onShow={(id) => {
                setCleanViewId(null);
                setSelectedId(id);
              }}
              onClean={(id) => void handleCleanOne(id)}
              onShowCleaning={(id) => {
                setSelectedId(null);
                setCleanViewId(id);
              }}
              onCleanAll={handleCleanAll}
              onCleanSelected={handleCleanSelected}
              onCancelInspections={handleCancelInspections}
              onCancelCleaning={handleCancelCleaning}
            />
          </div>

          {(selected && selectedResult) || (cleanView && cleanViewAlive) ? (
            <div ref={resultRegionRef} tabIndex={-1} className="scroll-mt-24">
              {selected && selectedResult ? (
                <InspectorPanel result={selectedResult} onClose={() => setSelectedId(null)} />
              ) : null}
              {cleanView && cleanViewAlive ? (
                <BeforeAfterPanel
                  result={cleanView}
                  onClose={() => setCleanViewId(null)}
                  onDownload={(finished) => {
                    setAnnouncement(`Download started: ${finished.outputName ?? finished.inputName}.`);
                  }}
                />
              ) : null}
            </div>
          ) : null}

          {entries.length > 0 ? (
            <>
              <BatchPanel
                disabled={busy && !batchRunning && !zipRunning}
                running={batchRunning}
                done={batch?.done ?? 0}
                total={batch?.total ?? 0}
                currentName={batch?.current ?? null}
                counts={batchCounts}
                zip={zip}
                partialExcluded={partialExcluded}
                includePartials={includeAllPartials}
                zipEligible={eligibleEntries.length}
                onCancel={handleCancelBatch}
                onCancelZip={handleCancelZip}
                onRetryFailed={handleRetryFailed}
                onTogglePartials={() => {
                  resetExportStatus();
                  setIncludeAllPartials((previous) => !previous);
                }}
                onDownloadZip={() => void handleDownloadZip(false)}
                onDownloadZipBare={() => void handleDownloadZip(true)}
                failedCount={failedIds.length}
                reportFailure={zipReportFailed}
              />
              <ReportsPanel
                format={reportChoices.format}
                detail={reportChoices.detail}
                includeOriginalValues={reportChoices.includeOriginalValues}
                generating={reportBusy}
                progress={reportProgress}
                error={reportError}
                fileCount={entries.length}
                disabled={busy && reportBusy === null}
                onChoices={handleReportChoices}
                onDownloadCsv={() => void handleDownloadCsv()}
                onDownloadTags={() => void handleDownloadTags()}
                onDownloadPdf={() => void handleDownloadPdf()}
                onCancel={reportBusy === "zip" ? handleCancelZip : handleCancelReport}
              />
            </>
          ) : null}
        </div>
        <div id="formats" className="mx-auto max-w-7xl scroll-mt-24 px-4 sm:px-6 lg:px-8">
          <FormatsPanel />
        </div>
        <div id="privacy" className="mx-auto max-w-7xl scroll-mt-24 px-4 sm:px-6 lg:px-8">
          <FuturePanel />
        </div>
      </main>
      <Footer />
    </>
  );
}
