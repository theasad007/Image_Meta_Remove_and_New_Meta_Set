import { expect, test, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

/**
 * Screen 08 directory corrections (final technical pass): pagination
 * end-of-list detection and the genuinely-most-recent registrations
 * card. Inert unless (1) the static export was built with
 * NEXT_PUBLIC_FIREBASE_EMULATOR=1 and (2) RUN_EMULATOR_E2E=1 while the
 * Auth (9099) + Firestore (8080) emulators run.
 *
 * Every list/total/order assertion here is a REAL Firestore emulator
 * query made through the running app (listAccountPage peek-1 cursor,
 * getCountFromServer totals, createdAt-descending recent query). Records
 * are seeded through the rules-legal per-user path (REST create as each
 * account's own owner), exactly like production self-registration; the
 * superadmin claim is written through the same Admin SDK route as the
 * owner CLI. Between tests the Firestore emulator's own wipe endpoint
 * clears documents (emulator control plane — never reachable across the
 * network in production, never used to fake data into a test).
 *
 * Determinism note (observed during development): sign-in
 * self-registers the admin record asynchronously and the static page
 * reads the directory one-shot (no realtime listeners), so every test
 * first seeds, then signs in, then waits for the admin's own record and
 * explicitly reloads before asserting. This mirrors the documented
 * behavior: dashboard figures are refreshed on demand, never streamed.
 */

const RUN = process.env.RUN_EMULATOR_E2E === "1";
const AUTH_EMULATOR = "http://127.0.0.1:9099";
const FIRESTORE_EMULATOR = "http://127.0.0.1:8080";
const PROJECT = "demo";
const SUPER_UID = "demo-profile-user";
const FIXTURE_PREFIX = "pag-fixture";

test.skip(!RUN, "Needs RUN_EMULATOR_E2E=1 with an emulator-flagged build and firebase emulators active.");

const execFileAsync = promisify(execFile) as (
  file: string,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string }>;

function adminToolModules(): string {
  return process.env.ADMIN_TOOL_NODE_MODULES ?? "";
}

async function setSuperadminClaim(uid: string, value: boolean): Promise<void> {
  const modules = adminToolModules();
  if (!modules) {
    throw new Error(
      "ADMIN_TOOL_NODE_MODULES is not set — point it at a firebase-admin " +
      "node_modules dir (the same tooling the owner CLI uses). Claims are " +
      "never faked client-side.",
    );
  }
  const runner = process.env.ADMIN_TOOL_RUNNER ?? "";
  const { stdout } = await execFileAsync("node", [runner, value ? "set" : "clear", uid], {
    env: { ...process.env, NODE_PATH: modules },
  });
  const parsed = JSON.parse(stdout.trim()) as { claims: Record<string, unknown> };
  const ok = value
    ? parsed.claims.superadmin === true
    : parsed.claims.superadmin !== true;
  if (!ok) throw new Error(`Claim write did not stick for ${uid}: ${stdout.trim()}`);
}

async function apiCall(method: string, url: string, body?: unknown, bearer?: string): Promise<unknown> {
  const response = await fetch(url, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Emulator REST ${method} ${url} -> ${response.status}: ${JSON.stringify(payload).slice(0, 300)}`);
  }
  return payload;
}

async function mintIdToken(uid: string): Promise<string> {
  const payload = (await apiCall(
    "POST",
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    { token: JSON.stringify({ uid, claims: {} }), returnSecureToken: true },
  )) as { idToken?: string };
  if (!payload.idToken) throw new Error(`No id token for ${uid}`);
  return payload.idToken;
}

/** Clean slate on the Firestore emulator control plane (every document). */
async function wipeAllDocuments(): Promise<void> {
  const response = await fetch(
    `${FIRESTORE_EMULATOR}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    throw new Error(`Emulator wipe -> ${response.status}: ${await response.text().catch(() => "")}`);
  }
}

async function resetEmulatorState(): Promise<void> {
  await wipeAllDocuments();
  await setSuperadminClaim(SUPER_UID, false);
}

/** N rules-legal directory records (each its own owner via REST create). */
async function seedDirectoryUsers(count: number, clockOffsetSeconds = 0): Promise<string[]> {
  const created: string[] = [];
  for (let index = 1; index <= count; index += 1) {
    const uid = `${FIXTURE_PREFIX}-${String(index).padStart(5, "0")}`;
    const seconds = 1767225600 + index * 172800 + clockOffsetSeconds; // 2026-01-01 + 2 days per record
    const iso = new Date(seconds * 1000).toISOString();
    const token = await mintIdToken(uid);
    await apiCall(
      "PATCH",
      `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT}/databases/(default)/documents/users/${uid}`,
      {
        fields: {
          uid: { stringValue: uid },
          email: { stringValue: `${uid}@example.com` },
          displayName: { stringValue: `Pag User ${String(index).padStart(5, "0")}` },
          photoURL: { stringValue: "" },
          status: { stringValue: "active" },
          createdAt: { timestampValue: iso },
          updatedAt: { timestampValue: iso },
        },
      },
      token,
    );
    created.push(uid);
  }
  return created;
}

function trackErrors(page: Page): void {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  (page as unknown as { __errors: string[] }).__errors = errors;
}

const errorsOf = async (page: Page): Promise<string[]> => (page as unknown as { __errors: string[] }).__errors;

async function signInSuperadmin(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  await expect(page.getByTestId("admin-welcome")).toBeVisible({ timeout: 30000 });
}

async function openUsersTab(page: Page): Promise<void> {
  await page.getByTestId("admin-nav-users").click();
  await expect(page.getByTestId("admin-users-heading")).toBeVisible();
}

const loadMore = (page: Page) => page.getByTestId("admin-load-more");
const rowOf = (page: Page, uidFragment: string) =>
  page.locator('[data-testid="admin-user-list"] li', { hasText: uidFragment });

/** Sign in, wait for the async self-registration to become queryable, and
 *  reload the one-shot list so subsequent assertions are deterministic. */
async function signInAndRegisterAdmin(page: Page): Promise<void> {
  await signInSuperadmin(page);
  await openUsersTab(page);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await rowOf(page, "demo-profile-user").count()) {
      await page.getByRole("button", { name: "Reload list" }).click();
      break;
    }
    await page.getByRole("button", { name: "Reload list" }).click();
    await page.waitForTimeout(400);
  }
  await expect(rowOf(page, "demo-profile-user")).toBeVisible();
}

async function expectCounts(page: Page, shown: number, active: number, suspended: number, truncated: boolean): Promise<void> {
  await expect(page.getByTestId("admin-counts")).toHaveText(
    `${shown} shown · ${active} active · ${suspended} suspended${truncated ? " · more pages available" : ""}`,
  );
}

/** Metric cards live on the Overview tab. Totals are fetched on demand
 *  (initial load, status changes, the account-menu refresh) — a static
 *  page has no realtime listeners, so re-check via the app's own
 *  "Refresh dashboard data" affordance before asserting the value. */
async function expectMetricUsersTotal(page: Page, total: string): Promise<void> {
  await page.getByTestId("admin-account-menu-button").click();
  await page.getByRole("menuitem", { name: "Refresh dashboard data" }).click();
  await page.getByTestId("admin-nav-overview").click();
  await expect(page.getByTestId("admin-metric-users")).toContainText(total, { timeout: 15000 });
}

async function suspend(page: Page, uidFragment: string, reason: string): Promise<void> {
  const row = rowOf(page, uidFragment);
  await row.getByRole("button", { name: "Suspend" }).click();
  await row.getByLabel("Suspension reason").fill(reason);
  await row.getByRole("button", { name: "Confirm suspend" }).click();
  await expect(row.getByText("suspended", { exact: true })).toBeVisible({ timeout: 30000 });
}

async function restore(page: Page, uidFragment: string): Promise<void> {
  const row = rowOf(page, uidFragment);
  await row.getByRole("button", { name: "Restore" }).click();
  await row.getByRole("button", { name: "Confirm restore" }).click();
  await expect(row.getByText("active", { exact: true })).toBeVisible({ timeout: 30000 });
}

test.beforeEach(async () => {
  await resetEmulatorState();
});

test.afterAll(async () => {
  // Leave a tidy emulator for any later spec file (fresh registrations).
  await wipeAllDocuments();
  await setSuperadminClaim(SUPER_UID, false);
});

test("exactly one full page never advertises Load more (peek end detection)", async ({ page }) => {
  await setSuperadminClaim(SUPER_UID, true);
  await seedDirectoryUsers(49);
  await page.setViewportSize({ width: 1280, height: 900 });
  trackErrors(page);
  await page.goto("/admin/");
  await signInAndRegisterAdmin(page); // 49 fixtures + self-registered admin = 50
  await expectCounts(page, 50, 50, 0, false);
  await expect(loadMore(page)).toHaveCount(0);

  // Filtering by status or text narrows the visible list only; counts keep
  // reporting the loaded directory pages (approved Screen 08 semantics).
  await page.getByLabel("Filter accounts").fill("00001");
  await expect(page.locator('[data-testid="admin-user-list"] li')).toHaveCount(1);
  await expect(page.getByText("No accounts match this filter.")).toHaveCount(0);
  await page.getByLabel("Filter accounts").fill("zzz-no-match");
  await expect(page.locator('[data-testid="admin-user-list"] li')).toHaveCount(0);
  await expect(page.getByText("No accounts match this filter.")).toBeVisible();
  await expect(loadMore(page)).toHaveCount(0);
  await page.getByLabel("Filter accounts").fill("");
  await expectCounts(page, 50, 50, 0, false);
  await expect(page.locator('[data-testid="admin-user-list"] li')).toHaveCount(50);
  expect(await errorsOf(page)).toEqual([]);
});

test("one full page plus one record: Load more reveals the boundary record once, then disappears", async ({ page }) => {
  await setSuperadminClaim(SUPER_UID, true);
  await seedDirectoryUsers(50);
  await page.setViewportSize({ width: 1280, height: 900 });
  trackErrors(page);
  await page.goto("/admin/");
  await signInAndRegisterAdmin(page); // total 51
  await expectCounts(page, 50, 50, 0, true);
  await expect(loadMore(page)).toBeVisible();

  await loadMore(page).click();
  await expectCounts(page, 51, 51, 0, false);
  await expect(loadMore(page)).toHaveCount(0);

  // The 51st record loaded exactly once — never duplicated or leaked twice
  // across pages (a leaked peek record would make this filter show 2).
  await page.getByLabel("Filter accounts").fill("00050");
  await expect(page.locator('[data-testid="admin-user-list"] li')).toHaveCount(1);
  await page.getByLabel("Filter accounts").fill("00001");
  await expect(page.locator('[data-testid="admin-user-list"] li')).toHaveCount(1);
  await page.getByLabel("Filter accounts").fill("");
  await expectCounts(page, 51, 51, 0, false);
  await expect(page.locator('[data-testid="admin-user-list"] li')).toHaveCount(51);
  await expectMetricUsersTotal(page, "51");
  expect(await errorsOf(page)).toEqual([]);
});

test("three-page journey with final incomplete page; statuses stay consistent, totals re-check on overview", async ({ page }) => {
  await setSuperadminClaim(SUPER_UID, true);
  await seedDirectoryUsers(120);
  await page.setViewportSize({ width: 1280, height: 900 });
  trackErrors(page);
  await page.goto("/admin/");
  await signInAndRegisterAdmin(page); // total 121 → 50 + 50 + 21
  await expectCounts(page, 50, 50, 0, true);

  await loadMore(page).click();
  await expectCounts(page, 100, 100, 0, true);

  // A suspension while more pages exist updates only that row's status —
  // the cursor (document id) keeps landing on the same position after it.
  await suspend(page, "pag-fixture-00002", "Pagination mid-journey check");
  await expectCounts(page, 100, 99, 1, true);

  // "Refresh dashboard data" re-contacts the directory and resets the
  // loaded pages to page 1 — pagination continues from there undamaged.
  await expectMetricUsersTotal(page, "121");
  await page.getByTestId("admin-nav-users").click();
  await loadMore(page).click();
  await expectCounts(page, 100, 99, 1, true);
  await loadMore(page).click();
  await expectCounts(page, 121, 120, 1, false);
  await expect(loadMore(page)).toHaveCount(0);

  // Second boundary: last fixture 00120 loaded exactly once (row of the
  // final incomplete page); 00121 genuinely does not exist. Counts keep
  // describing the loaded pages even while the list is filtered.
  await page.getByLabel("Filter accounts").fill("00121");
  await expect(page.locator('[data-testid="admin-user-list"] li')).toHaveCount(0);
  await expect(page.getByText("No accounts match this filter.")).toBeVisible();
  await expectCounts(page, 121, 120, 1, false);
  await page.getByLabel("Filter accounts").fill("00120");
  await expect(page.locator('[data-testid="admin-user-list"] li')).toHaveCount(1);
  await page.getByLabel("Filter accounts").fill("");
  await expect(page.locator('[data-testid="admin-user-list"] li')).toHaveCount(121);

  await restore(page, "pag-fixture-00002");
  await expectCounts(page, 121, 121, 0, false);

  // Reload list keeps one consistent, de-duplicated page 1 after statuses.
  await page.getByRole("button", { name: "Reload list" }).click();
  await expectCounts(page, 50, 50, 0, true);
  await page.getByLabel("Filter accounts").fill("pag-fixture-00002");
  await expect(page.locator('[data-testid="admin-user-list"] li')).toHaveCount(1);
  await page.getByLabel("Filter accounts").fill("");
  expect(await errorsOf(page)).toEqual([]);
});

test("final page exactly full: Load more disappears without an extra empty page", async ({ page }) => {
  await setSuperadminClaim(SUPER_UID, true);
  await seedDirectoryUsers(149);
  await page.setViewportSize({ width: 1280, height: 900 });
  trackErrors(page);
  await page.goto("/admin/");
  await signInAndRegisterAdmin(page); // total 150 → 50 + 50 + 50, no page 4
  await expectCounts(page, 50, 50, 0, true);

  await loadMore(page).click();
  await expectCounts(page, 100, 100, 0, true);
  await loadMore(page).click();
  await expectCounts(page, 150, 150, 0, false);
  await expect(loadMore(page)).toHaveCount(0);

  // Boundary record of the exactly-full last page loaded exactly once; a
  // non-existent uid yields the honest empty state while counts stay put.
  await page.getByLabel("Filter accounts").fill("00149");
  await expect(page.locator('[data-testid="admin-user-list"] li')).toHaveCount(1);
  await page.getByLabel("Filter accounts").fill("09999");
  await expect(page.locator('[data-testid="admin-user-list"] li')).toHaveCount(0);
  await page.getByLabel("Filter accounts").fill("");
  await expectCounts(page, 150, 150, 0, false);
  await expect(page.locator('[data-testid="admin-user-list"] li')).toHaveCount(150);

  // Status changes through the real UI sync metric cards, never counts.
  // The account-menu refresh resets loaded pages; click through both pages
  // again afterwards to prove the pagination still reaches the boundary.
  await suspend(page, "pag-fixture-00001", "Reload consistency check");
  await expectCounts(page, 150, 149, 1, false);
  await expectMetricUsersTotal(page, "150");
  await page.getByTestId("admin-nav-users").click();
  await loadMore(page).click();
  await expectCounts(page, 100, 99, 1, true);
  await loadMore(page).click();
  await expectCounts(page, 150, 149, 1, false);
  await expect(loadMore(page)).toHaveCount(0);
  await restore(page, "pag-fixture-00001");
  await expectCounts(page, 150, 150, 0, false);
  expect(await errorsOf(page)).toEqual([]);
});

test("recent-users card lists genuinely newest registrations across the whole directory", async ({ page }) => {
  await setSuperadminClaim(SUPER_UID, true);
  await seedDirectoryUsers(10);
  await page.setViewportSize({ width: 1280, height: 900 });
  trackErrors(page);
  await page.goto("/admin/");
  await signInSuperadmin(page);
  await expect(page.getByTestId("admin-recent-users")).toBeVisible();

  const card = page.locator('[data-testid="admin-recent-users"]');
  // The five NEWEST records only (fixture 10 is the newest registration;
  // the admin's self-registration lands last, i.e. newest overall).
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if ((await card.locator("tbody tr").count()) === 5) break;
    await page.getByTestId("admin-account-menu-button").click();
    await page.getByRole("menuitem", { name: "Refresh dashboard data" }).click();
    await page.waitForTimeout(600);
  }
  await expect(card.locator("tbody tr")).toHaveCount(5);
  const names = card.locator("tbody tr");
  await expect(names.nth(0)).toContainText("Demo Profile User");
  await expect(names.nth(1)).toContainText("Pag User 00010");
  await expect(names.nth(2)).toContainText("Pag User 00009");
  await expect(names.nth(3)).toContainText("Pag User 00008");
  await expect(names.nth(4)).toContainText("Pag User 00007");
  for (const older of ["Pag User 00006", "Pag User 00005", "Pag User 00001"]) {
    await expect(card).not.toContainText(older);
  }
  expect(await errorsOf(page)).toEqual([]);
});
