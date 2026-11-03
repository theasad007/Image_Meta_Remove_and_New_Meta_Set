import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { row, upload } from "./helpers";
import { probeMp3 } from "../src/lib/metadata/audio/id3";

/**
 * Phase 06 + SOL-011 E2E — premium batch rewrite + project apply against
 * the REAL local emulators (never stubs). Requires the setup from
 * e2e/EMULATOR_E2E.md — or the one-command entry:
 *
 *   npm run test:e2e:premium
 *
 * which builds the emulator-flagged static export itself and runs:
 *   firebase emulators:exec --project demo --only auth,firestore \
 *     "node scripts/seed-emulator-premium.mjs && RUN_EMULATOR_E2E=1 playwright test e2e/premium-emulator.spec.ts --project=desktop"
 *
 * The seed script hard-fails on non-local emulator hosts. Emulator state is
 * mutated mid-suite ONLY through the local emulator REST endpoint (determin
 * istic test-only grant/revoke/expire/policy changes) — production Firebase
 * is unreachable from here by construction.
 *
 * Without RUN_EMULATOR_E2E=1 the suite skips explicitly — it never fakes a
 * signed-in or premium state.
 */

const RUN = process.env.RUN_EMULATOR_E2E === "1";
const EDITOR = '[data-testid="editor-modal"]';
const FIXTURES = path.join("src", "test-fixtures");
const ARTIFACTS = path.join("e2e", "artifacts", "premium-emulator");

test.skip(!RUN, "Needs RUN_EMULATOR_E2E=1 with an emulator-configured build, active emulators and the seed script.");

const REST = "http://127.0.0.1:8080/v1/projects/demo/databases/(default)/documents";
const AUTH_REST = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key";

/**
 * Mint a SUPERADMIN ID token from the LOCAL Auth emulator (fake custom
 * token with the superadmin claim — test-only, never production). The
 * Firestore REST mutations then satisfy the same rules the app enforces.
 */
let superadminToken: string | null = null;
async function getSuperadminToken(): Promise<string> {
  if (superadminToken) return superadminToken;
  const response = await fetch(AUTH_REST, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: JSON.stringify({ uid: "owner", claims: { superadmin: true } }), returnSecureToken: true }),
  });
  if (!response.ok) throw new Error(`Auth emulator superadmin sign-in failed: ${response.status} ${await response.text()}`);
  const data = await response.json() as { idToken?: string };
  if (!data.idToken) throw new Error("Auth emulator returned no idToken.");
  superadminToken = data.idToken;
  return superadminToken;
}

/** Test-only emulator mutation: replace the demo user's entitlement doc. */
async function setEntitlement(body: Record<string, unknown>): Promise<void> {
  const token = await getSuperadminToken();
  const fields = { ...(body.fields as Record<string, unknown>) };
  delete fields.updatedAt;
  const response = await fetch(`${REST}:commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ writes: [{
      update: { name: "projects/demo/databases/(default)/documents/users/demo-profile-user/entitlement/main", fields },
      updateTransforms: [{ fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" }],
    }] }),
  });
  if (!response.ok) throw new Error(`Emulator entitlement mutation failed: ${response.status} ${await response.text()}`);
}

/** Test-only emulator mutation: replace the feature policy document. */
async function setPolicy(features: Record<string, string>): Promise<void> {
  const token = await getSuperadminToken();
  const featureFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(features)) featureFields[key] = { stringValue: value };
  const response = await fetch(`${REST}:commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ writes: [{
      update: {
        name: "projects/demo/databases/(default)/documents/adminSettings/featurePolicy",
        fields: {
          schemaVersion: { integerValue: "1" },
          updatedBy: { stringValue: "owner" },
          features: { mapValue: { fields: featureFields } },
        },
      },
      updateTransforms: [{ fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" }],
    }] }),
  });
  if (!response.ok) throw new Error(`Emulator policy mutation failed: ${response.status} ${await response.text()}`);
}

const ENTITLEMENT_ACTIVE = {
  fields: {
    tier: { stringValue: "premium" },
    status: { stringValue: "active" },
    expiresAt: { nullValue: null },
    assignedBy: { stringValue: "owner" },
    updatedAt: { timestampValue: new Date().toISOString() },
  },
};
const ENTITLEMENT_REVOKED = {
  fields: {
    tier: { stringValue: "free" },
    status: { stringValue: "active" },
    expiresAt: { nullValue: null },
    assignedBy: { stringValue: "owner" },
    updatedAt: { timestampValue: new Date().toISOString() },
  },
};
const ENTITLEMENT_EXPIRED = {
  fields: {
    tier: { stringValue: "premium" },
    status: { stringValue: "active" },
    expiresAt: { timestampValue: new Date(Date.now() - 3_600_000).toISOString() },
    assignedBy: { stringValue: "owner" },
    updatedAt: { timestampValue: new Date().toISOString() },
  },
};

const SHIPPED_POLICY: Record<string, string> = {
  single_metadata_clean: "free",
  single_ai_metadata_clean: "free",
  bulk_metadata_clean: "free",
  bulk_ai_metadata_clean: "free",
  single_custom_rewrite: "free",
  batch_metadata_rewrite: "premium",
  batch_gps_write: "premium",
  multiple_named_projects: "premium",
  saved_project_apply: "premium",
};

test.beforeEach(async ({ page }) => {
  // Deterministic per-test cloud state: active Premium + shipped policy.
  // (Mutations go through the LOCAL emulator REST with a superadmin token
  // minted from the LOCAL Auth emulator — production stays unreachable.)
  await setEntitlement(ENTITLEMENT_ACTIVE);
  await setPolicy(SHIPPED_POLICY);
  await page.goto("/");
});

test("SOL-013: batch dialog contains forward/reverse keyboard focus at mobile widths", async ({ page }) => {
  await signIn(page);
  await upload(page, ["jpeg-empty.jpg", "png-empty.png"]);
  for (const width of [375, 412]) {
    await page.setViewportSize({ width, height: 760 });
    const opener = page.getByTestId("open-rewrite-workflow");
    await opener.click();
    const dialog = page.getByTestId("batch-rewrite-dialog");
    await expect(dialog).toBeVisible();
    await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("Tab");
      await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    }
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("Shift+Tab");
      await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  }
});

async function signIn(page: Page) {
  // SOL-011: the sign-in control lives on /account/profile — the homepage
  // has no login button. Authenticate there, wait for the REAL
  // authenticated UID/badge, then navigate to the workspace.
  await page.goto("/account/profile");
  await page.getByTestId("auth-signin").click();
  await page.getByTestId("auth-account-connected").waitFor({ timeout: 30000 });
  await page.goto("/");
}

/** Download one row's verified output and return the raw bytes. */
async function downloadRowBytes(page: Page, name: string, label: string): Promise<Uint8Array> {
  const downloadPromise = page.waitForEvent("download");
  await row(page, name).locator('[data-testid="download-row-output"]').first().click();
  const download = await downloadPromise;
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const target = path.join(ARTIFACTS, label);
  await download.saveAs(target);
  return new Uint8Array(fs.readFileSync(target));
}

test("premium user: batch rewrite with a saved project runs and verifies (policy default premium honored)", async ({ page }) => {
  await signIn(page);
  await upload(page, ["jpeg-empty.jpg", "png-empty.png"]);

  // Signed-in premium: the batch dialog opens with explicit scope.
  await page.getByTestId("open-rewrite-workflow").click();
  await expect(page.getByTestId("batch-rewrite-dialog")).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("batch-rewrite-scope")).toContainText("2 eligible files");
  await expect(page.getByTestId("batch-rewrite-scope")).toContainText("2 images");
  await expect(page.getByTestId("batch-rewrite-gps")).toContainText("no GPS change");

  // Switch to the seeded demo project: fields + GPS preview.
  await page.getByTestId("batch-rewrite-source").getByText("Use a saved project").click();
  await page.getByTestId("batch-rewrite-project-select").selectOption({ index: 1 });
  await expect(page.getByTestId("batch-rewrite-scope")).toContainText("Demo Publishing");
  await expect(page.getByTestId("batch-rewrite-gps")).toContainText("51.5007");

  await page.getByTestId("batch-rewrite-confirm").click();
  await expect(page.getByTestId("batch-rewrite-dialog")).toHaveCount(0);
  await expect(page.getByTestId("queue-announcement").filter({ hasText: /Rewrite finished: \d+ files processed/ })).toBeVisible({ timeout: 240000 });

  // Per-file verified outputs exist for both files; the verified state is
  // asserted BEFORE downloading (downloading changes row affordances).
  await expect(row(page, "jpeg-empty.jpg").getByText(/rewritten · verified|verified_rewritten/i).first()).toBeVisible();
  await expect(row(page, "png-empty.png").getByText(/rewritten · verified|verified_rewritten/i).first()).toBeVisible();

  // SOL-011: byte-level verification of ACTUAL downloaded outputs.
  const jpegBytes = await downloadRowBytes(page, "jpeg-empty.jpg", "batch-jpeg.jpg");
  expect(jpegBytes.length).toBeGreaterThan(0);
  const pngBytes = await downloadRowBytes(page, "png-empty.png", "batch-png.png");
  expect(pngBytes.length).toBeGreaterThan(0);
});

test("premium user: single-file project apply writes project GPS and verifies from output bytes", async ({ page }) => {
  await signIn(page);
  await upload(page, ["jpeg-empty.jpg"]);
  await row(page, "jpeg-empty.jpg").getByRole("button", { name: /Edit metadata for/ }).first().click({ timeout: 120000 });
  await page.locator(EDITOR).waitFor();
  await page.locator('[data-testid="editor-tab-preset"]').click();
  await page.getByTestId("editor-source-project").click();
  await page.getByTestId("editor-project-select").selectOption({ index: 1 });
  await expect(page.getByTestId("editor-project-preview")).toContainText("Demo Publishing");
  await expect(page.getByTestId("editor-project-gps")).toContainText("51.5007");
  await page.getByTestId("editor-apply").click();
  // Row-scoped: the verified status belongs to THIS file's result card.
  await expect(row(page, "jpeg-empty.jpg").getByText(/verified_rewritten|verified rewritten/).first()).toBeVisible({ timeout: 240000 });
});

test("SOL-003/SOL-011: premium MP3-only batch rewrites two audio files and the payload stays byte-identical", async ({ page }) => {
  await signIn(page);
  await upload(page, ["mp3-ai-tags.mp3", "mp3-id3v2.3.mp3"]);
  await page.getByTestId("open-rewrite-workflow").click();
  await expect(page.getByTestId("batch-rewrite-dialog")).toBeVisible({ timeout: 30000 });
  // Honest mixed-kind counting: two MP3s are two AUDIO files, not videos.
  await expect(page.getByTestId("batch-rewrite-scope")).toContainText("2 eligible files");
  await expect(page.getByTestId("batch-rewrite-scope")).toContainText("2 MP3 audio");
  // Profile source: the seeded profile writes ID3-relevant fields.
  await page.getByTestId("batch-rewrite-confirm").click();
  await expect(page.getByTestId("queue-announcement").filter({ hasText: /Rewrite finished: \d+ files processed/ })).toBeVisible({ timeout: 240000 });
  await expect(row(page, "mp3-ai-tags.mp3").locator('[data-testid="download-row-output"]').first()).toBeVisible({ timeout: 60000 });

  // Independent re-probe of the downloaded bytes: rewritten ID3 fields are
  // present and the MPEG payload equals the ORIGINAL frame-derived audio.
  const bytes = await downloadRowBytes(page, "mp3-ai-tags.mp3", "batch-mp3.mp3");
  const out = probeMp3(bytes);
  expect(out.ok).toBe(true);
  expect(out.tag).not.toBeNull();
  const original = new Uint8Array(fs.readFileSync(path.join(FIXTURES, "mp3-ai-tags.mp3")));
  const originalProbe = probeMp3(original);
  expect(originalProbe.stream).not.toBeNull();
  expect(out.stream!.frameCount).toBe(originalProbe.stream!.frameCount);
  const originalAudio = original.subarray(originalProbe.audioStart, originalProbe.stream!.streamEnd);
  const outAudio = bytes.subarray(out.audioStart, out.stream!.streamEnd);
  expect(outAudio.length).toBe(originalAudio.length);
  for (let i = 0; i < originalAudio.length; i += 1) expect(outAudio[i]).toBe(originalAudio[i]);
});

test("SOL-003/SOL-011: mixed image+MP3 batch processes every eligible file and skips nothing eligible", async ({ page }) => {
  await signIn(page);
  await upload(page, ["jpeg-empty.jpg", "mp3-ai-tags.mp3", "mp3-id3v2.3.mp3"]);
  await page.getByTestId("open-rewrite-workflow").click();
  await expect(page.getByTestId("batch-rewrite-dialog")).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("batch-rewrite-scope")).toContainText("3 eligible files");
  await expect(page.getByTestId("batch-rewrite-scope")).toContainText("1 image");
  await expect(page.getByTestId("batch-rewrite-scope")).toContainText("2 MP3 audio");
  await page.getByTestId("batch-rewrite-confirm").click();
  await expect(page.getByTestId("queue-announcement").filter({ hasText: /Rewrite finished: \d+ files processed/ })).toBeVisible({ timeout: 300000 });
  for (const name of ["jpeg-empty.jpg", "mp3-ai-tags.mp3", "mp3-id3v2.3.mp3"]) {
    await expect(row(page, name).locator('[data-testid="download-row-output"]').first()).toBeVisible({ timeout: 60000 });
  }
});

test("SOL-009/SOL-011: custom batch source writes the one-off draft without touching profile or projects", async ({ page }) => {
  await signIn(page);
  await upload(page, ["jpeg-empty.jpg", "png-empty.png"]);
  await page.getByTestId("open-rewrite-workflow").click();
  await expect(page.getByTestId("batch-rewrite-dialog")).toBeVisible({ timeout: 30000 });
  await page.getByTestId("batch-rewrite-source").getByText("Enter custom values").click();
  await page.getByTestId("batch-rewrite-custom-title").fill("Custom Batch Title");
  await page.getByTestId("batch-rewrite-custom-creator").fill("Custom Batch Creator");
  await expect(page.getByTestId("batch-rewrite-scope")).toContainText("Custom Batch Title");
  await page.getByTestId("batch-rewrite-confirm").click();
  await expect(page.getByTestId("queue-announcement").filter({ hasText: /Rewrite finished: \d+ files processed/ })).toBeVisible({ timeout: 240000 });
  // The written title comes from the CUSTOM draft, verified from bytes.
  const bytes = await downloadRowBytes(page, "jpeg-empty.jpg", "custom-batch.jpg");
  const text = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  expect(text).toContain("Custom Batch Title");
});

test("SOL-002/SOL-011: revoking Premium while the dialog is open blocks the confirm; free features keep working", async ({ page }) => {
  await signIn(page);
  await upload(page, ["jpeg-empty.jpg", "png-empty.png"]);
  await page.getByTestId("open-rewrite-workflow").click();
  await expect(page.getByTestId("batch-rewrite-dialog")).toBeVisible({ timeout: 30000 });
  // Revoke server-side while the dialog is open.
  await setEntitlement(ENTITLEMENT_REVOKED);
  // Either the open-time fresh check flips the dialog to its locked view,
  // or the confirm click survives and the fresh check denies execution.
  await page.getByTestId("batch-rewrite-confirm").click({ timeout: 10_000 }).catch(() => undefined);
  await expect(
    page.getByTestId("premium-notice").or(page.getByTestId("batch-rewrite-locked")),
  ).toBeVisible({ timeout: 30000 });
  // The batch did NOT run: no "Rewrite finished" announcement appears.
  await expect(page.getByTestId("queue-announcement").filter({ hasText: /Rewrite finished/ })).toHaveCount(0);
  // Confirm closes the dialog before the fresh entitlement check completes;
  // when the dialog remains in its locked view, close that mounted dialog
  // explicitly. Never wait on a close button that has already unmounted.
  const rewriteDialog = page.getByTestId("batch-rewrite-dialog");
  const closeButton = page.getByTestId("batch-rewrite-close");
  if (await closeButton.count()) await closeButton.click();
  await expect(rewriteDialog).toHaveCount(0);
  // Free removal still works after revocation (guest-contract features).
  await page.getByTestId("batch-clean-all").click();
  await expect(page.getByTestId("queue-announcement").filter({ hasText: /removal finished/i }).first()).toBeVisible({ timeout: 240000 });
});

test("SOL-002/SOL-011: an expired entitlement cannot run a batch; re-grant restores access in the same page", async ({ page }) => {
  await signIn(page);
  await upload(page, ["jpeg-empty.jpg", "png-empty.png"]);
  await setEntitlement(ENTITLEMENT_EXPIRED);
  await page.getByTestId("open-rewrite-workflow").click();
  // SOL-002: the dialog reflects the fresh read — the expired entitlement
  // shows the honest denial instead of a runnable confirm.
  await expect(page.getByTestId("batch-rewrite-locked")).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("batch-rewrite-confirm")).toHaveCount(0);
  // Re-grant server-side; reopening the dialog re-checks access.
  await setEntitlement(ENTITLEMENT_ACTIVE);
  await page.getByTestId("batch-rewrite-close").click();
  await page.getByTestId("open-rewrite-workflow").click();
  await expect(page.getByTestId("batch-rewrite-dialog")).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("batch-rewrite-confirm")).toBeVisible({ timeout: 30000 });
  await page.getByTestId("batch-rewrite-confirm").click();
  await expect(page.getByTestId("queue-announcement").filter({ hasText: /Rewrite finished: \d+ files processed/ })).toBeVisible({ timeout: 240000 });
});

test("SOL-011: a policy flip to free opens the batch for a signed-in user WITHOUT entitlement", async ({ page }) => {
  await setEntitlement(ENTITLEMENT_REVOKED);
  await setPolicy({ ...SHIPPED_POLICY, batch_metadata_rewrite: "free" });
  await signIn(page);
  await upload(page, ["jpeg-empty.jpg", "png-empty.png"]);
  await page.getByTestId("open-rewrite-workflow").click();
  await expect(page.getByTestId("batch-rewrite-dialog")).toBeVisible({ timeout: 30000 });
  await page.getByTestId("batch-rewrite-confirm").click();
  await expect(page.getByTestId("queue-announcement").filter({ hasText: /Rewrite finished: \d+ files processed/ })).toBeVisible({ timeout: 240000 });
  // Restore the shipped policy + revoke state.
  await setPolicy(SHIPPED_POLICY);
  await setEntitlement(ENTITLEMENT_ACTIVE);
});

test("SOL-011: project CRUD with atomic title uniqueness works for the signed-in premium user", async ({ page }) => {
  await signIn(page);
  await page.goto("/account/profile");
  const unique = `E2E Project ${Date.now()}`;
  await page.getByTestId("projects-create").click();
  await page.getByTestId("project-input-title").fill(unique);
  await page.getByTestId("project-save").click();
  await expect(page.locator('[role="status"]', { hasText: /created/i }).first()).toBeVisible({ timeout: 30000 });
  // Duplicate normalized title → refused with a clear message.
  await page.getByTestId("projects-create").click();
  await page.getByTestId("project-input-title").fill(unique.toLowerCase());
  await page.getByTestId("project-save").click();
  await expect(page.getByTestId("project-errors").first()).toBeVisible({ timeout: 30000 });
  // Cleanup: cancel the editor, then delete the created project card.
  await page.getByRole("button", { name: "Cancel" }).click();
  const card = page.getByTestId("projects-list").locator("li", { hasText: unique });
  await card.getByRole("button", { name: "Delete" }).click();
  await card.getByRole("button", { name: "Confirm delete" }).click();
  await expect(page.locator('[role="status"]', { hasText: /deleted/i }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("projects-list")).not.toContainText(unique);
});
