import { expect, test, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

/**
 * Screen 08 — Super Admin Dashboard final journeys on the local emulators.
 * Inert unless: (1) the static export was built with
 * NEXT_PUBLIC_FIREBASE_EMULATOR=1, (2) RUN_EMULATOR_E2E=1 while
 * firebase-tools runs `--project demo --only auth,firestore`.
 *
 * Seeding stays inside the emulators. The superadmin claim is set exactly
 * the way the shipped owner CLI (`scripts/bootstrap-superadmin.mjs`) does
 * it — via the Firebase Admin SDK against the local Auth emulator
 * (firebase-admin resolved from a tool install outside the repo, never an
 * app dependency). Directory records are created through the per-user
 * rules path (REST create as its own owner) — identical in kind to
 * production self-registration. Nothing here fabricates processing
 * statistics; those stay "Not collected" in the UI.
 */

const RUN = process.env.RUN_EMULATOR_E2E === "1";
const AUTH_EMULATOR = "http://127.0.0.1:9099";
const FIRESTORE_EMULATOR = "http://127.0.0.1:8080";
const PROJECT = "demo";
const SUPER_UID = "demo-profile-user";
const DIR = "e2e/artifacts/screen-08";

const FIXTURE_USERS = [
  { uid: "admin-fixture-maria", displayName: "Maria Chen", email: "maria.chen@example.com", created: "2026-10-18T09:15:00Z" },
  { uid: "admin-fixture-robert", displayName: "Robert Kim", email: "robert.kim@example.com", created: "2026-10-20T10:00:00Z" },
  { uid: "admin-fixture-ann", displayName: "Ann Okafor", email: "ann.okafor@example.com", created: "2026-10-22T08:30:00Z" },
] as const;

test.skip(!RUN, "Needs RUN_EMULATOR_E2E=1 with an emulator-flagged build and firebase emulators active.");

const execFileAsync = promisify(execFile) as (
  file: string,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string }>;

/** Local firebase-admin tool install (never an app dependency; usually a
 *  global install per docs/10-admin-setup.md, or a tool scratch dir here). */
function adminToolModules(): string {
  return process.env.ADMIN_TOOL_NODE_MODULES ?? "";
}

/** Mirror of the owner-side bootstrap CLI's claim write (emulator only). */
async function setSuperadminClaim(uid: string, value: boolean): Promise<void> {
  const modules = adminToolModules();
  if (!modules) {
    throw new Error(
      "ADMIN_TOOL_NODE_MODULES is not set — point it at a firebase-admin " +
      "node_modules dir (e.g. from `npm install -g firebase-admin`), the " +
      "same tooling the owner CLI uses. Claims are never faked client-side.",
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

interface EmulatorDocField {
  stringValue?: string;
  timestampValue?: string;
}

async function apiCall(
  method: string,
  url: string,
  body?: unknown,
  bearer?: string,
): Promise<unknown> {
  const response = await fetch(url, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 404) {
    throw new Error(`Emulator REST ${method} ${url} -> ${response.status}: ${JSON.stringify(payload).slice(0, 300)}`);
  }
  return payload as Record<string, unknown>;
}

/** Mint an emulator ID token for a uid (fake strict-JSON custom token). */
async function mintIdToken(uid: string): Promise<string> {
  const payload = (await apiCall(
    "POST",
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    { token: JSON.stringify({ uid, claims: {} }), returnSecureToken: true },
  )) as { idToken?: string };
  if (!payload.idToken) throw new Error(`No id token for ${uid}`);
  return payload.idToken;
}

/** Create/update a directory record through the per-user rules path
 *  (self-registration is always `active`; suspensions happen through the
 *  superadmin UI flow below, which is the only legitimate route). */
async function seedDirectoryUser(user: (typeof FIXTURE_USERS)[number]): Promise<void> {
  const token = await mintIdToken(user.uid);
  await apiCall(
    "PATCH",
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT}/databases/(default)/documents/users/${user.uid}`,
    {
      fields: {
        uid: { stringValue: user.uid },
        email: { stringValue: user.email },
        displayName: { stringValue: user.displayName },
        photoURL: { stringValue: "" },
        status: { stringValue: "active" },
        createdAt: { timestampValue: user.created },
        updatedAt: { timestampValue: user.created },
      } satisfies Record<string, EmulatorDocField>,
    },
    token,
  );
}

/** Remove a directory record (per-user owner delete, rules-legal). */
async function deleteDirectoryUser(uid: string): Promise<void> {
  const token = await mintIdToken(uid);
  try {
    await apiCall(
      "DELETE",
      `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT}/databases/(default)/documents/users/${uid}`,
      undefined,
      token,
    );
  } catch {
    // Absent record is fine; seeding below will recreate if a test needs it.
  }
}

/** Deterministic starting state: no claims, empty directory. */
async function resetEmulatorState(): Promise<void> {
  await setSuperadminClaim(SUPER_UID, false);
  await deleteDirectoryUser(SUPER_UID);
  for (const user of FIXTURE_USERS) {
    await deleteDirectoryUser(user.uid);
  }
}

function trackErrors(page: Page): void {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  (page as unknown as { __errors: string[] }).__errors = errors;
}

const errorsOf = async (page: Page): Promise<string[]> => (page as unknown as { __errors: string[] }).__errors;

async function overflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    (document.activeElement as HTMLElement | null)?.blur?.();
    return document.documentElement.scrollWidth - document.documentElement.clientWidth;
  });
}

async function signInSuperadmin(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  await expect(page.getByTestId("admin-welcome")).toBeVisible({ timeout: 30000 });
}

test.beforeEach(async () => {
  await resetEmulatorState();
});

test("gates deny signed-out and non-admin access, then a live claim promotion unlocks the empty dashboard", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  trackErrors(page);
  // 1. Signed-out: same route guard as Screen 08's pre-shell states.
  await page.goto("/admin/");
  await expect(page.getByTestId("admin-denied")).toBeVisible();
  await expect(page.getByTestId("admin-user-list")).toHaveCount(0);

  // 2. Authenticated non-admin: still denied by the claim check.
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  await expect(page.getByTestId("admin-denied").filter({ hasText: "Access denied" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh login status" })).toBeVisible();

  // 3. Owner-side claim write (emulator admin API == production CLI journey).
  await setSuperadminClaim(SUPER_UID, true);
  await page.getByRole("button", { name: "Refresh login status" }).click();
  await expect(page.getByTestId("admin-welcome")).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("Role status refreshed — superadmin claim present.")).toBeVisible();

  // 4. Dashboard shell reachable: sidebar + account dropdown real actions.
  await expect(page.getByTestId("admin-nav-overview")).toBeVisible();
  await expect(page.getByTestId("admin-visit-site")).toBeVisible();
  await page.getByTestId("admin-account-menu-button").click();
  await expect(page.getByTestId("admin-account-signout")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("admin-account-signout")).toHaveCount(0);

  // 5. Overview stays honest: the only real directory record is the
  //    admin's own self-registration (directory deletes do not exist in
  //    the rules — statuses are the honest record of an account).
  await page.getByTestId("admin-account-menu-button").click();
  await page.getByRole("menuitem", { name: "Refresh dashboard data" }).click();
  await expect(page.getByTestId("admin-refreshed")).toContainText(/refreshed \d/, { timeout: 15000 });
  await expect(page.getByTestId("admin-metric-users")).toContainText("1", { timeout: 15000 });
  await expect(page.getByTestId("admin-recent-users")).toContainText("Demo Profile User");

  // Honest empty state of the directory search filter (no fake rows).
  await page.getByTestId("admin-nav-users").click();
  await page.getByLabel("Filter accounts").fill("zzz-no-match");
  await expect(page.getByText("No accounts match this filter.")).toBeVisible();
  await page.getByTestId("admin-nav-overview").click();

  // 6. No invented processing statistics anywhere in the overview.
  await expect(page.getByText("Not collected — processing stays private.")).toHaveCount(2);
  await expect(page.getByText("Files processed platform-wide")).toBeVisible();
  await expect(page.getByText("Per-file activity is not logged")).toBeVisible();
  await expect(page.getByText(/vs last month|growth/i)).toHaveCount(0);

  const overflowPx = await overflow(page);
  expect(overflowPx, "desktop dashboard overflow").toBeLessThanOrEqual(1);
  // Settle the whole overview before a fullPage capture (late data
  // re-renders can out-grow the screenshot's measured height).
  await expect(page.getByTestId("admin-action-site")).toBeVisible();
  await expect(page.getByTestId("admin-refreshed")).toContainText(/refreshed \d/);
  await page.screenshot({ path: `${DIR}/07-admin-empty-states.png`, fullPage: true });

  expect(await errorsOf(page)).toEqual([]);
});

test("real directory data, accurate statuses, users management and honest settings", async ({ page }) => {
  await setSuperadminClaim(SUPER_UID, true);
  for (const user of FIXTURE_USERS) {
    await seedDirectoryUser(user);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  trackErrors(page);
  await page.goto("/admin/");
  await signInSuperadmin(page);

  // Real totals: admin self-registration + 3 seeded fixture records.
  // All fixtures register ACTIVE (self-registration rule); suspensions
  // happen below through the genuine superadmin flow.
  await expect(page.getByTestId("admin-metric-users")).toContainText("4");
  await expect(page.getByTestId("admin-metric-active")).toContainText("4");
  await expect(page.getByTestId("admin-metric-suspended")).toContainText("0");
  await expect(page.getByTestId("admin-recent-users")).toContainText("Maria Chen");
  await expect(page.getByTestId("admin-recent-users")).toContainText("Robert Kim");
  // Settle the entire overview before the fullPage captures (late data
  // re-renders can out-grow the screenshot's measured height).
  await expect(page.getByTestId("admin-action-site")).toBeVisible();
  await expect(page.getByTestId("admin-refreshed")).toContainText(/refreshed \d/);

  // Desktop captures with live (fixture) directory data.
  const overflowWide = await overflow(page);
  expect(overflowWide, "tags 1536/1280 overflow").toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1536, height: 960 });
  await page.screenshot({ path: `${DIR}/01-admin-desktop-1536.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: `${DIR}/02-admin-desktop-1280.png`, fullPage: true });

  // Users tab: full directory + self-suspend guard + suspension flow.
  await page.getByTestId("admin-view-all-users").click();
  await expect(page.getByTestId("admin-users-heading")).toBeVisible();
  await expect(page.getByTestId("admin-counts")).toContainText("4 shown · 4 active · 0 suspended");
  const selfRow = page.locator('[data-testid="admin-user-list"] li', { hasText: "demo-profile-user" });
  await expect(selfRow.getByRole("button", { name: "Suspend" })).toBeDisabled();
  await expect(selfRow.getByRole("button", { name: "Suspend" })).toHaveAttribute("title", /cannot suspend your own owner account/i);

  const suspendRow = async (name: string, reason: string) => {
    const row = page.locator('[data-testid="admin-user-list"] li', { hasText: name });
    await row.getByRole("button", { name: "Suspend" }).click();
    await expect(row.getByText(/Suspend this account's signed-in cloud features/)).toBeVisible();
    await row.getByLabel("Suspension reason").fill(reason);
    await row.getByRole("button", { name: "Confirm suspend" }).click();
    await expect(row.getByText("suspended", { exact: true })).toBeVisible({ timeout: 30000 });
  };
  await suspendRow("Ann Okafor", "E2E suspension check");
  await expect(page.getByTestId("admin-counts")).toContainText("3 active · 1 suspended");
  await suspendRow("Maria Chen", "E2E suspension check");
  await expect(page.getByTestId("admin-counts")).toContainText("2 active · 2 suspended");

  // Overview metric cards follow the real directory status changes.
  await page.getByTestId("admin-nav-overview").click();
  await expect(page.getByTestId("admin-metric-suspended")).toContainText("2", { timeout: 15000 });
  await page.getByTestId("admin-nav-users").click();

  // Real-data Users capture with both statuses visible.
  await expect(page.getByText("Suspending never disables the Firebase Auth user itself.")).toBeVisible();
  await page.screenshot({ path: `${DIR}/06-admin-users-real-data.png`, fullPage: true });

  // Restore path also works (and leaves the emulator tidy).
  const restoreRow = async (name: string) => {
    const row = page.locator('[data-testid="admin-user-list"] li', { hasText: name });
    await row.getByRole("button", { name: "Restore" }).click();
    await row.getByRole("button", { name: "Confirm restore" }).click();
    await expect(row.getByText("active", { exact: true })).toBeVisible({ timeout: 30000 });
  };
  await restoreRow("Maria Chen");
  await restoreRow("Ann Okafor");
  await expect(page.getByTestId("admin-counts")).toContainText("4 active · 0 suspended");

  // Settings tab: honest usage policy editor (unchanged Phase 6A feature).
  await page.getByTestId("admin-nav-settings").click();
  await expect(page.getByTestId("admin-settings-heading")).toBeVisible();
  await expect(page.getByText("Unlimited (default; no caps enabled)")).toBeVisible();
  await page.getByRole("button", { name: "Record future policy values (not enforced)" }).click();
  await expect(page.getByText("Usage-policy values recorded. They are NOT enforced — guest processing stays unlimited (see badges).")).toBeVisible();

  expect(await errorsOf(page)).toEqual([]);
});

test("responsive navigation, drawer, keyboard and hydration hygiene", async ({ page }) => {
  await setSuperadminClaim(SUPER_UID, true);
  for (const user of FIXTURE_USERS) {
    await seedDirectoryUser(user);
  }
  trackErrors(page);

  // Tablet: sidebar hidden behind a menu button; grids stack.
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/admin/");
  await signInSuperadmin(page);
  await expect(page.getByTestId("admin-menu-button")).toBeVisible();
  await expect(page.getByTestId("admin-nav-overview")).not.toBeVisible(); // lg-hidden desktop aside
  const tabletOverflow = await overflow(page);
  expect(tabletOverflow, "tablet overflow").toBeLessThanOrEqual(1);
  // Bottom of the page rendered before the capture (settle re-renders).
  await expect(page.getByTestId("admin-action-site")).toBeVisible();
  await page.screenshot({ path: `${DIR}/03-admin-tablet-768.png`, fullPage: true });

  // Mobile drawer navigation.
  await page.setViewportSize({ width: 412, height: 915 });
  if (process.env.ADMIN_DEBUG_OVERFLOW === "1") {
    const offenders = await page.evaluate(() => {
      const list: string[] = [];
      for (const element of [...document.querySelectorAll("*")]) {
        const box = element as HTMLElement;
        if (box.scrollWidth - box.clientWidth > 4 && box.clientWidth > 0) {
          list.push(`${box.tagName}[testid=${box.dataset?.testid ?? ""}] class=${(box.className ?? "").toString().slice(0, 70)} sw=${box.scrollWidth} cw=${box.clientWidth}`);
        }
      }
      return `TOTAL=${document.documentElement.scrollWidth - document.documentElement.clientWidth}\n${list.slice(0, 24).join("\n")}`;
    });
    throw new Error(`OVERFLOW DEBUG [412]:\n${offenders}`);
  }
  const mobileOverflow = await overflow(page);
  expect(mobileOverflow, "mobile 412 overflow").toBeLessThanOrEqual(1);
  await page.getByTestId("admin-menu-button").click();
  await expect(page.getByTestId("admin-drawer")).toBeVisible();
  await expect(page.getByTestId("admin-drawer").getByTestId("admin-nav-overview")).toBeVisible();
  await expect(page.getByTestId("admin-drawer").getByTestId("admin-nav-unavailable-api")).toBeVisible();
  await expect(page.getByTestId("admin-drawer").getByText("Browser-only app")).toBeVisible();
  await page.screenshot({ path: `${DIR}/08-admin-mobile-sidebar.png`, fullPage: true });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("admin-drawer")).toHaveCount(0);
  await expect(page.getByTestId("admin-action-site")).toBeVisible();
  await page.screenshot({ path: `${DIR}/04-admin-mobile-412.png`, fullPage: true });

  await page.setViewportSize({ width: 375, height: 812 });
  const smallOverflow = await overflow(page);
  expect(smallOverflow, "mobile 375 overflow").toBeLessThanOrEqual(1);
  await expect(page.getByTestId("admin-action-site")).toBeVisible();
  await page.screenshot({ path: `${DIR}/05-admin-mobile-375.png`, fullPage: true });

  // Keyboard: the first sidebar nav item is reachable by Tab and clearly
  // focused (globals.css paints a strong focus ring on :focus-visible).
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload();
  await expect(page.getByTestId("admin-welcome")).toBeVisible({ timeout: 30000 });
  await page.locator("body").click();
  let focused = false;
  for (let index = 0; index < 40; index += 1) {
    await page.keyboard.press("Tab");
    focused = await page.locator('[data-testid="admin-nav-overview"]:focus').count().then((count) => count > 0);
    if (focused) break;
  }
  expect(focused, "sidebar nav item reachable via keyboard").toBe(true);
  await page.getByTestId("admin-account-menu-button").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("admin-account-signout")).toHaveCount(0);

  expect(await errorsOf(page)).toEqual([]);
});
