import { getFirebaseDb } from "./config";

/**
 * Saved custom-metadata profile (Phase 6).
 *
 * Only explicitly user-edited reusable fields plus bookkeeping are stored
 * at `users/{uid}/profile/main`. Never binary data, filenames, scan
 * history, extracted source metadata, reports, or GPS harvested from
 * uploads. Length/type ceilings here MUST match `firestore.rules`.
 */

import { isProfileEmpty, PROFILE_FIELDS, PROFILE_SCHEMA_VERSION, validateProfile, type MetadataProfile } from "../metadata/rewrite/fields";

export interface StoredProfile extends MetadataProfile {
  schemaVersion: number;
  updatedAt: unknown;
}

function assertUid(uid: string): void {
  if (!uid || uid.length > 128) throw new Error("Invalid user id.");
}

export async function loadProfile(uid: string): Promise<MetadataProfile | null> {
  assertUid(uid);
  const db = await getFirebaseDb();
  const { doc, getDoc } = await import("firebase/firestore");
  const ref = doc(db, "users", uid, "profile", "main");
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) return null;
  const data = snapshot.data() as Record<string, unknown>;
  const { profile, errors } = validateProfile(data);
  if (Object.keys(errors).length > 0) return null;
  return profile;
}

function toStoredFields(profile: MetadataProfile): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const field of PROFILE_FIELDS) {
    fields[field] = field === "keywords" ? profile.keywords : profile[field];
  }
  return fields;
}

export async function saveProfile(uid: string, input: Record<string, unknown>): Promise<MetadataProfile> {
  assertUid(uid);
  const { profile, errors } = validateProfile(input);
  if (Object.keys(errors).length > 0) {
    throw new Error(`Profile has ${Object.keys(errors).length} invalid field(s); fix them before saving.`);
  }
  if (isProfileEmpty(profile)) {
    throw new Error("The profile is empty — fill at least one field before saving.");
  }
  const db = await getFirebaseDb();
  const { doc, setDoc, serverTimestamp } = await import("firebase/firestore");
  const ref = doc(db, "users", uid, "profile", "main");
  await setDoc(ref, {
    ...toStoredFields(profile),
    schemaVersion: PROFILE_SCHEMA_VERSION,
    updatedAt: serverTimestamp(),
  });
  return profile;
}

export async function deleteProfile(uid: string): Promise<void> {
  assertUid(uid);
  const db = await getFirebaseDb();
  const { doc, deleteDoc } = await import("firebase/firestore");
  await deleteDoc(doc(db, "users", uid, "profile", "main"));
}
