import { doc, type Firestore } from "firebase/firestore";
import { getFirebaseDb, isFirebaseConfigured, readFirebaseConfig } from "./config";
import {
  PROJECT_SCHEMA_VERSION,
  normalizeProjectDraft,
  packKeywords,
  projectTitleKey,
  unpackKeywords,
  validateProjectDraft,
  type ProjectDraft,
  type ProjectRecord,
} from "../projects/project-schema";

/**
 * Premium multi-project storage (Phase 04, SOL-004/005) —
 * `users/{uid}/projects/{projectId}` + atomic title reservations at
 * `users/{uid}/projectTitles/{titleKey}`.
 *
 * Rules contract (firestore.rules):
 * - READ/LIST: owner only (account active).
 * - CREATE/UPDATE: owner + account active + Premium entitlement (or the
 *   `multiple_named_projects` policy opened to free) + strict allowlist
 *   validation. Firestore is authoritative — the client-side Premium
 *   check is only the product gate.
 * - DELETE: owner + account active (a lapsed Premium user keeps read-only
 *   access and may still erase their own data; nothing is auto-deleted).
 * - Title reservations: owner-scoped, created ONLY together with their
 *   project (rules `get()`-check the referenced project), never updated.
 *
 * SOL-005 atomic uniqueness: create/rename/delete run in Firestore
 * TRANSACTIONS that read-then-write the reservation document — two
 * concurrent creates with the same normalized title yield exactly one
 * success (the retrying transaction sees the reservation and fails).
 * Keyword items are stored as ONE packed string (SOL-004 — mirrors the
 * approved profile schema and keeps the rules inside their expression
 * budget); the ProjectRecord shape keeps `keywords` as a list.
 *
 * Stored documents contain metadata presets ONLY — never media,
 * thumbnails, EXIF scans, GPS extracted from files, C2PA data, reports,
 * tokens or payment info (the schema has no fields for them).
 */

// Read-side page bound only.  This is not a security quota: Firestore Rules
// remain authoritative for every direct project/reservation write, and no
// client-controlled counter is presented as server-enforced abuse protection.
const MAX_PROJECT_LIST_READ = 1000;

export interface ProjectSummary {
  projectId: string;
  projectTitle: string;
  clientName: string;
  companyPublisher: string;
  creatorAuthor: string;
  locationName: string;
  hasCoordinates: boolean;
  updatedAt: string | null;
}

function assertUid(uid: string): void {
  if (!uid || uid.length > 128) throw new Error("Invalid user id.");
}

function assertFirebaseReady(): void {
  if (!isFirebaseConfigured(readFirebaseConfig())) {
    throw new Error("Firebase is not configured.");
  }
}

function toSummary(id: string, data: Record<string, unknown>): ProjectSummary {
  return {
    projectId: id,
    projectTitle: typeof data.projectTitle === "string" ? data.projectTitle : "(untitled)",
    clientName: typeof data.clientName === "string" ? data.clientName : "",
    companyPublisher: typeof data.companyPublisher === "string" ? data.companyPublisher : "",
    creatorAuthor: typeof data.creatorAuthor === "string" ? data.creatorAuthor : "",
    locationName: typeof data.locationName === "string" ? data.locationName : "",
    hasCoordinates: typeof data.latitude === "number" && typeof data.longitude === "number",
    updatedAt: typeof data.updatedAt === "object" && data.updatedAt !== null && "toDate" in (data.updatedAt as object)
      ? (data.updatedAt as { toDate: () => Date }).toDate().toISOString()
      : null,
  };
}

function toRecord(id: string, data: Record<string, unknown>): ProjectRecord {
  const draft = {
    projectTitle: typeof data.projectTitle === "string" ? data.projectTitle : "",
    titleKey: typeof data.titleKey === "string" ? data.titleKey : projectTitleKey(typeof data.projectTitle === "string" ? data.projectTitle : ""),
    clientName: typeof data.clientName === "string" ? data.clientName : "",
    companyPublisher: typeof data.companyPublisher === "string" ? data.companyPublisher : "",
    creatorAuthor: typeof data.creatorAuthor === "string" ? data.creatorAuthor : "",
    copyrightNotice: typeof data.copyrightNotice === "string" ? data.copyrightNotice : "",
    rightsOwner: typeof data.rightsOwner === "string" ? data.rightsOwner : "",
    websiteUrl: typeof data.websiteUrl === "string" ? data.websiteUrl : "",
    contactInformation: typeof data.contactInformation === "string" ? data.contactInformation : "",
    imageTitle: typeof data.imageTitle === "string" ? data.imageTitle : "",
    imageDescription: typeof data.imageDescription === "string" ? data.imageDescription : "",
    // SOL-004: keywords are stored packed; accept the legacy array shape
    // defensively when reading (never written anymore).
    keywords: typeof data.keywords === "string"
      ? unpackKeywords(data.keywords)
      : Array.isArray(data.keywords) ? data.keywords.filter((k): k is string => typeof k === "string") : [],
    locationName: typeof data.locationName === "string" ? data.locationName : "",
    latitude: typeof data.latitude === "number" ? data.latitude : null,
    longitude: typeof data.longitude === "number" ? data.longitude : null,
    altitudeMeters: typeof data.altitudeMeters === "number" ? data.altitudeMeters : null,
  };
  return {
    ...draft,
    projectId: id,
    schemaVersion: typeof data.schemaVersion === "number" ? data.schemaVersion : PROJECT_SCHEMA_VERSION,
    createdAt: typeof data.createdAt === "object" && data.createdAt !== null && "toDate" in (data.createdAt as object)
      ? (data.createdAt as { toDate: () => Date }).toDate().toISOString()
      : null,
    updatedAt: typeof data.updatedAt === "object" && data.updatedAt !== null && "toDate" in (data.updatedAt as object)
      ? (data.updatedAt as { toDate: () => Date }).toDate().toISOString()
      : null,
  };
}

/** Owner read: all projects of the caller (newest update first). */
export async function listProjects(uid: string): Promise<ProjectSummary[]> {
  assertUid(uid);
  assertFirebaseReady();
  const db = await getFirebaseDb();
  const { collection, query, orderBy, limit, getDocs } = await import("firebase/firestore");
  const snap = await getDocs(query(
    collection(db, "users", uid, "projects"),
    orderBy("updatedAt", "desc"),
    limit(MAX_PROJECT_LIST_READ),
  ));
  return snap.docs.map((docSnap) => toSummary(docSnap.id, docSnap.data() as Record<string, unknown>));
}

/** Owner read: one full project (null when missing). */
export async function getProject(uid: string, projectId: string): Promise<ProjectRecord | null> {
  assertUid(uid);
  assertFirebaseReady();
  const db = await getFirebaseDb();
  const { doc, getDoc } = await import("firebase/firestore");
  const snap = await getDoc(doc(db, "users", uid, "projects", projectId));
  if (!snap.exists()) return null;
  return toRecord(snap.id, snap.data() as Record<string, unknown>);
}

/** Pure client-side payload builder (rules re-validate everything). */
function buildPayload(draft: ProjectDraft): { payload: Record<string, unknown>; titleKey: string } {
  const normalized = normalizeProjectDraft(draft);
  const candidate = { ...normalized, schemaVersion: PROJECT_SCHEMA_VERSION };
  const { ok, errors } = validateProjectDraft(candidate);
  if (!ok) throw new Error(`Project invalid: ${errors.join("; ")}`);
  // SOL-004: the stored doc carries the PACKED keyword string.
  const { keywords, ...rest } = normalized;
  const titleKey = projectTitleKey(normalized.projectTitle);
  return {
    payload: {
      ...rest,
      titleKey,
      keywords: packKeywords(keywords),
      schemaVersion: PROJECT_SCHEMA_VERSION,
    },
    titleKey: projectTitleKey(normalized.projectTitle),
  };
}

/** The reservation document for one normalized title (SOL-005). */
function reservationRef(db: Firestore, uid: string, titleKey: string) {
  return doc(db, "users", uid, "projectTitles", titleKey);
}

class TitleTakenError extends Error {
  constructor(title: string) {
    super(`A project named "${title}" already exists. Choose a different title.`);
    this.name = "TitleTakenError";
  }
}

/**
 * SOL-005: atomically create the project AND claim its normalized-title
 * reservation in ONE transaction. Two concurrent creates with normalized-
 * equivalent titles yield exactly one success — the loser's transaction
 * re-reads the reservation and throws before any write commits.
 */
export async function createProject(uid: string, draft: ProjectDraft, projectId: string): Promise<string> {
  assertUid(uid);
  assertFirebaseReady();
  const { payload, titleKey } = buildPayload(draft);
  const db = await getFirebaseDb();
  const { doc, runTransaction, serverTimestamp } = await import("firebase/firestore");
  try {
    await runTransaction(db, async (transaction) => {
      const reservation = reservationRef(db, uid, titleKey);
      const existing = await transaction.get(reservation);
      if (existing.exists()) {
        throw new TitleTakenError(String(payload.projectTitle));
      }
      transaction.set(doc(db, "users", uid, "projects", projectId), {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      transaction.set(reservation, { projectId, schemaVersion: PROJECT_SCHEMA_VERSION });
    });
  } catch (error) {
    if (error instanceof TitleTakenError) throw error;
    throw error;
  }
  return projectId;
}

/**
 * SOL-005: atomic rename — when the normalized title changes, the old
 * reservation is released and the new one claimed in the SAME transaction
 * as the project update (no orphan, no double-claim window).
 */
export async function updateProject(uid: string, projectId: string, draft: ProjectDraft): Promise<void> {
  assertUid(uid);
  assertFirebaseReady();
  const { payload, titleKey } = buildPayload(draft);
  const db = await getFirebaseDb();
  const { doc, runTransaction, serverTimestamp } = await import("firebase/firestore");
  await runTransaction(db, async (transaction) => {
    const projectRef = doc(db, "users", uid, "projects", projectId);
    const current = await transaction.get(projectRef);
    if (!current.exists()) {
      throw new Error("The project no longer exists — it may have been deleted in another tab.");
    }
    const currentTitle = (current.data() as Record<string, unknown>).projectTitle;
    const currentKey = typeof currentTitle === "string" ? projectTitleKey(currentTitle) : null;
    if (currentKey !== titleKey) {
      const reservation = reservationRef(db, uid, titleKey);
      const existing = await transaction.get(reservation);
      if (existing.exists() && (existing.data() as Record<string, unknown>).projectId !== projectId) {
        throw new TitleTakenError(String(payload.projectTitle));
      }
      if (currentKey) {
        transaction.delete(reservationRef(db, uid, currentKey));
      }
      transaction.set(reservation, { projectId, schemaVersion: PROJECT_SCHEMA_VERSION });
    }
    transaction.set(projectRef, {
      ...payload,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  });
}

/** Owner delete (kept available regardless of entitlement — data ownership).
 *  The title reservation is released in the same atomic batch. */
export async function deleteProject(uid: string, projectId: string): Promise<void> {
  assertUid(uid);
  assertFirebaseReady();
  const db = await getFirebaseDb();
  const { doc, getDoc, writeBatch } = await import("firebase/firestore");
  const projectRef = doc(db, "users", uid, "projects", projectId);
  const snap = await getDoc(projectRef);
  if (!snap.exists()) return;
  const title = (snap.data() as Record<string, unknown>).projectTitle;
  const batch = writeBatch(db);
  batch.delete(projectRef);
  if (typeof title === "string") {
    batch.delete(reservationRef(db, uid, projectTitleKey(title)));
  }
  await batch.commit();
}

/** Convenience: duplicate with a fresh id and a distinct title. */
export async function duplicateProject(uid: string, source: ProjectRecord, newProjectId: string, newTitle: string): Promise<string> {
  return createProject(uid, { ...source, projectTitle: newTitle }, newProjectId);
}

export function newProjectId(): string {
  return `proj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
