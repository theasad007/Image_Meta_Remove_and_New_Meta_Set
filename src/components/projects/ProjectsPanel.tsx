"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createProject,
  deleteProject,
  duplicateProject,
  getProject,
  listProjects,
  newProjectId,
  updateProject,
  type ProjectSummary,
} from "../../lib/firebase/projects";
import {
  blankProjectDraft,
  normalizeProjectDraft,
  PROJECT_TEXT_LIMITS,
  validateProjectDraft,
  type ProjectDraft,
} from "../../lib/projects/project-schema";
import { parseKeywords } from "../../lib/metadata/rewrite/fields";
import { useFeaturePolicy } from "../../lib/workspace/use-feature-policy";
import { resolveFeatureAccess } from "../../lib/workspace/policy-state";

/**
 * Profile → My Projects (Phase 04). Premium multi-project CRUD over
 * `users/{uid}/projects/{projectId}` with the existing design language:
 * - Free signed-in users keep their single reusable profile and see an
 *   honest Premium explanation (manual activation; no fake checkout).
 * - Lapsed Premium keeps every stored project visible (read-only per the
 *   Firestore rules) — nothing is ever auto-deleted.
 * - Field validation mirrors the existing profile editor limits; GPS
 *   values are user-typed decimals only (never auto-geocoded).
 * - "Saved" appears only after Firestore accepted the write and a
 *   read-back confirms it.
 */

const TEXT_FIELDS: Array<{ key: keyof ProjectDraft & string; label: string; placeholder: string; multiline?: boolean }> = [
  { key: "companyPublisher", label: "Company / Publisher", placeholder: "e.g. Meridian Press" },
  { key: "creatorAuthor", label: "Creator / Author", placeholder: "e.g. A. Photographer" },
  { key: "copyrightNotice", label: "Copyright Notice", placeholder: "e.g. © 2026 Meridian Press" },
  { key: "rightsOwner", label: "Rights Owner", placeholder: "e.g. Meridian Press" },
  { key: "websiteUrl", label: "Website URL", placeholder: "https://…" },
  { key: "contactInformation", label: "Contact Information", placeholder: "e.g. studio@meridian.example" },
  { key: "imageTitle", label: "Image Title (written into images)", placeholder: "e.g. Harbor noon" },
  { key: "imageDescription", label: "Image Description (written into images)", placeholder: "Describes the picture itself…", multiline: true },
  { key: "locationName", label: "Location Name (descriptive text, not coordinates)", placeholder: "e.g. Habitats of the North Atlantic" },
];

export default function ProjectsPanel({
  uid,
  onNotice,
}: {
  uid: string;
  onNotice: (message: string) => void;
}) {
  const { entitlement, refreshPolicy } = useFeaturePolicy();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProjectDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [keywordsText, setKeywordsText] = useState("");
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  /** Premium state resolved lazily — defaults (premium) until refreshed. */
  const [premiumOpen, setPremiumOpen] = useState<boolean | null>(null);

  const resolvePremium = useCallback(async () => {
    const policy = await refreshPolicy();
    return resolveFeatureAccess("multiple_named_projects", entitlement, policy).allowed;
  }, [entitlement, refreshPolicy]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const allowed = await resolvePremium();
      if (active) setPremiumOpen(allowed);
    })();
    return () => {
      active = false;
    };
  }, [resolvePremium]);

  /** Event-context reload (buttons/handlers). The mount effect below owns
   *  the initial load with an unmount guard. */
  const reload = useCallback(async () => {
    try {
      const rows = await listProjects(uid);
      setProjects(rows);
      setLoadError(null);
    } catch (err) {
      setProjects([]);
      setLoadError(err instanceof Error ? err.message : "Could not load projects.");
    }
  }, [uid]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const rows = await listProjects(uid);
        if (active) {
          setProjects(rows);
          setLoadError(null);
        }
      } catch (err) {
        if (active) {
          setProjects([]);
          setLoadError(err instanceof Error ? err.message : "Could not load projects.");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [uid]);

  const startCreate = () => {
    setEditing(blankProjectDraft());
    setEditingId(null);
    setKeywordsText("");
    setFieldErrors([]);
  };

  const startEdit = async (projectId: string) => {
    const record = await getProject(uid, projectId);
    if (!record) {
      onNotice("That project could not be loaded — it may have been deleted.");
      return;
    }
    setEditing({ ...record });
    setEditingId(projectId);
    setKeywordsText(record.keywords.join(", "));
    setFieldErrors([]);
  };

  const handleSave = async () => {
    if (!editing) return;
    const draft = normalizeProjectDraft({ ...editing, keywords: parseKeywords(keywordsText) });
    const { ok, errors } = validateProjectDraft({ ...draft, schemaVersion: 1 });
    if (!ok) {
      setFieldErrors(errors);
      return;
    }
    if (draft.projectTitle.trim() === "") {
      setFieldErrors(["Project title is required."]);
      return;
    }
    setSaving(true);
    setFieldErrors([]);
    try {
      if (editingId) {
        await updateProject(uid, editingId, draft);
        // Read-back: "Saved" only when Firestore truly has the values.
        const stored = await getProject(uid, editingId);
        if (!stored || stored.projectTitle !== draft.projectTitle) {
          throw new Error("The write was accepted but the read-back differs — re-open the project to verify.");
        }
        onNotice(`Project "${draft.projectTitle}" saved.`);
      } else {
        const id = newProjectId();
        await createProject(uid, draft, id);
        const stored = await getProject(uid, id);
        if (!stored || stored.projectTitle !== draft.projectTitle) {
          throw new Error("The write was accepted but the read-back differs — re-open the project to verify.");
        }
        onNotice(`Project "${draft.projectTitle}" created.`);
      }
      setEditing(null);
      setEditingId(null);
      await reload();
    } catch (err) {
      setFieldErrors([err instanceof Error ? err.message : "Could not save the project."]);
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicate = async (row: ProjectSummary) => {
    const record = await getProject(uid, row.projectId);
    if (!record) return;
    try {
      await duplicateProject(uid, record, newProjectId(), `${record.projectTitle} (copy)`);
      onNotice(`Duplicated as "${record.projectTitle} (copy)".`);
      await reload();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : "Could not duplicate the project.");
    }
  };

  const handleDelete = async (projectId: string) => {
    try {
      await deleteProject(uid, projectId);
      setConfirmDeleteId(null);
      onNotice("Project deleted.");
      await reload();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : "Could not delete the project.");
    }
  };

  const premiumKnown = premiumOpen !== null;
  const canWrite = premiumOpen === true;

  const coordinateSummary = useMemo(() => {
    if (!editing) return "";
    const parts: string[] = [];
    if (editing.latitude !== null) parts.push(`lat ${editing.latitude}`);
    if (editing.longitude !== null) parts.push(`lon ${editing.longitude}`);
    if (editing.altitudeMeters !== null) parts.push(`alt ${editing.altitudeMeters} m`);
    return parts.length > 0 ? parts.join(" · ") : "No coordinates in this project";
  }, [editing]);

  return (
    <section id="projects" aria-labelledby="projects-heading" className="surface-card mt-5 scroll-mt-24 rounded-[1.4rem] p-4 sm:p-6" data-testid="projects-panel">
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#e9f2fe] text-[#2d5be9]">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3.5 7.2c0-1 .8-1.7 1.7-1.7h4l2 2.3h7.6c1 0 1.7.8 1.7 1.7v8.3c0 1-.8 1.7-1.7 1.7H5.2c-1 0-1.7-.8-1.7-1.7V7.2Z" />
          </svg>
        </span>
        <div className="min-w-0">
          <h2 id="projects-heading" data-section-heading tabIndex={-1} className="text-lg font-bold text-[#16244a]">
            My Projects
          </h2>
          <p className="mt-0.5 text-[12.5px] text-[#5a6b85]">
            Named metadata presets for different clients. Project Title names the preset here; the Image
            Title inside it is written into images. Your single reusable profile is unchanged.
          </p>
        </div>
        {premiumKnown ? (
          canWrite ? (
            <span className="rounded-full bg-[#eef2ff] px-2.5 py-1 text-[11px] font-bold text-[#3f4bb8]" data-testid="projects-tier">Premium</span>
          ) : (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-800" data-testid="projects-tier">Premium feature</span>
          )
        ) : null}
        <div className="ml-auto flex gap-2">
          {canWrite ? (
            <button
              type="button"
              className="btn-secondary !min-h-9 !px-3 text-xs"
              data-testid="projects-create"
              onClick={startCreate}
              disabled={editing !== null}
            >
              Create project
            </button>
          ) : null}
          <button type="button" className="btn-secondary !min-h-9 !px-3 text-xs" data-testid="projects-reload" onClick={() => void reload()} disabled={projects === null}>
            Reload
          </button>
        </div>
      </div>

      {!premiumKnown ? (
        <p role="status" className="mt-3 text-xs text-slate-500">Checking access…</p>
      ) : !canWrite ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5" data-testid="projects-premium-lock">
          <p className="text-[12.5px] font-semibold leading-5 text-amber-900">
            Multiple saved projects are a Premium feature. Premium access is granted manually by the site
            administrator — contact the administrator to activate it. Your existing single reusable profile
            stays fully available, and any projects saved earlier remain visible below.
          </p>
        </div>
      ) : null}

      {loadError ? (
        <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-800">{loadError}</p>
      ) : null}

      {/* Editor form */}
      {editing ? (
        <form
          className="mt-4 grid gap-3 rounded-2xl border border-[#c7d7f8] bg-[#f7faff] p-3.5 sm:p-4"
          data-testid="project-editor"
          onSubmit={(event) => { event.preventDefault(); void handleSave(); }}
        >
          <p className="text-[12px] font-bold text-[#16244a]">{editingId ? "Edit project" : "New project"} · {coordinateSummary}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Project Title (names this preset)
              <input
                type="text"
                value={editing.projectTitle}
                maxLength={120}
                onChange={(event) => setEditing({ ...editing, projectTitle: event.target.value })}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal"
                placeholder="e.g. Meridian — Spring Campaign"
                data-testid="project-input-title"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Client Name (optional)
              <input
                type="text"
                value={editing.clientName}
                maxLength={120}
                onChange={(event) => setEditing({ ...editing, clientName: event.target.value })}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal"
                placeholder="e.g. Meridian Press"
              />
            </label>
            {TEXT_FIELDS.map(({ key, label, placeholder, multiline }) => (
              <label key={key} className={`grid gap-1 text-xs font-semibold text-slate-700 ${multiline ? "sm:col-span-2" : ""}`}>
                {label} <span className="font-normal text-slate-400">(≤{PROJECT_TEXT_LIMITS[key as keyof typeof PROJECT_TEXT_LIMITS]} chars)</span>
                {multiline ? (
                  <textarea
                    value={editing[key] as string}
                    maxLength={PROJECT_TEXT_LIMITS[key as keyof typeof PROJECT_TEXT_LIMITS]}
                    onChange={(event) => setEditing({ ...editing, [key]: event.target.value })}
                    className="min-h-20 rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal"
                    placeholder={placeholder}
                  />
                ) : (
                  <input
                    type={key === "websiteUrl" ? "url" : "text"}
                    value={editing[key] as string}
                    maxLength={PROJECT_TEXT_LIMITS[key as keyof typeof PROJECT_TEXT_LIMITS]}
                    onChange={(event) => setEditing({ ...editing, [key]: event.target.value })}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal"
                    placeholder={placeholder}
                  />
                )}
              </label>
            ))}
            <label className="grid gap-1 text-xs font-semibold text-slate-700 sm:col-span-2">
              Keywords / Tags <span className="font-normal text-slate-400">(comma separated · max 30 · each ≤60 chars)</span>
              <input
                type="text"
                value={keywordsText}
                onChange={(event) => setKeywordsText(event.target.value)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal"
                placeholder="harbor, noon, campaign"
                data-testid="project-input-keywords"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Latitude <span className="font-normal text-slate-400">(−90 … 90, blank = none)</span>
              <input
                type="number"
                step="any"
                min={-90}
                max={90}
                value={editing.latitude ?? ""}
                onChange={(event) => setEditing({ ...editing, latitude: event.target.value === "" ? null : Number(event.target.value) })}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal"
                placeholder="51.5007"
                data-testid="project-input-latitude"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Longitude <span className="font-normal text-slate-400">(−180 … 180, blank = none)</span>
              <input
                type="number"
                step="any"
                min={-180}
                max={180}
                value={editing.longitude ?? ""}
                onChange={(event) => setEditing({ ...editing, longitude: event.target.value === "" ? null : Number(event.target.value) })}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal"
                placeholder="-0.1246"
                data-testid="project-input-longitude"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Altitude (m, optional)
              <input
                type="number"
                step="any"
                value={editing.altitudeMeters ?? ""}
                onChange={(event) => setEditing({ ...editing, altitudeMeters: event.target.value === "" ? null : Number(event.target.value) })}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal"
                placeholder="35"
                data-testid="project-input-altitude"
              />
            </label>
          </div>
          {fieldErrors.length > 0 ? (
            <ul className="grid gap-1 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-800" role="alert" data-testid="project-errors">
              {fieldErrors.map((error) => <li key={error}>{error}</li>)}
            </ul>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-primary !min-h-9 !px-3.5 text-xs" disabled={saving} data-testid="project-save">
              {saving ? "Saving…" : editingId ? "Save changes" : "Create project"}
            </button>
            <button type="button" className="btn-secondary !min-h-9 !px-3.5 text-xs" onClick={() => { setEditing(null); setEditingId(null); setFieldErrors([]); }} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {/* List */}
      {projects === null ? (
        <p role="status" className="mt-4 text-xs text-slate-500">Loading projects…</p>
      ) : projects.length === 0 ? (
        <p className="mt-4 text-xs text-slate-500" data-testid="projects-empty">
          No projects yet. {canWrite ? "Create your first project to save a reusable set of client metadata." : ""}
        </p>
      ) : (
        <ul className="mt-4 grid gap-2 md:grid-cols-2" data-testid="projects-list">
          {projects.map((row) => (
            <li key={row.projectId} className="grid gap-1.5 rounded-xl border border-slate-200 p-3 text-xs" data-testid={`project-card-${row.projectId}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-bold text-[#16244a]">{row.projectTitle}</span>
                {row.hasCoordinates ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-bold text-emerald-800">GPS set</span> : null}
              </div>
              {row.clientName ? <p className="text-slate-500">Client: {row.clientName}</p> : null}
              <p className="text-slate-500">
                {[row.companyPublisher, row.creatorAuthor].filter(Boolean).join(" · ") || "No company/creator set"}
                {row.locationName ? ` · ${row.locationName}` : ""}
              </p>
              {row.updatedAt ? <p className="text-[10.5px] text-slate-400">Updated {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(row.updatedAt))}</p> : null}
              <div className="mt-1 flex flex-wrap gap-2">
                <button type="button" className="btn-secondary !min-h-7 !px-2 text-[11px]" disabled={!canWrite} onClick={() => void startEdit(row.projectId)} data-testid={`project-edit-${row.projectId}`}>
                  Edit
                </button>
                <button type="button" className="btn-secondary !min-h-7 !px-2 text-[11px]" disabled={!canWrite} onClick={() => void handleDuplicate(row)}>
                  Duplicate
                </button>
                {confirmDeleteId === row.projectId ? (
                  <>
                    <button type="button" className="rounded-md border border-red-200 bg-white px-2 text-[11px] font-bold text-red-700" data-testid={`project-delete-confirm-${row.projectId}`} onClick={() => void handleDelete(row.projectId)}>
                      Confirm delete
                    </button>
                    <button type="button" className="btn-secondary !min-h-7 !px-2 text-[11px]" onClick={() => setConfirmDeleteId(null)}>
                      Keep
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn-secondary !min-h-7 !px-2 text-[11px] !text-red-700" onClick={() => setConfirmDeleteId(row.projectId)} data-testid={`project-delete-${row.projectId}`}>
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
