import { defineConfig, devices } from "@playwright/test";

/**
 * Phase 3 E2E: real Chromium (installed Google Chrome channel — no external
 * downloads) against the production static export served over plain HTTP.
 * Flow: `npm run build && npm run test:e2e`. No fixture bytes leave the
 * machine; the suite additionally asserts that from request logs.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 120000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e/report" }]],
  use: {
    baseURL: "http://127.0.0.1:8130",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "python3 -m http.server 8130 --directory out",
    port: 8130,
    reuseExistingServer: true,
    timeout: 30000,
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { channel: "chrome", args: ["--no-sandbox"] },
      },
    },
    {
      name: "mobile",
      testMatch: /mobile|a11y/,
      use: {
        ...devices["Pixel 7"],
        launchOptions: { channel: "chrome", args: ["--no-sandbox"] },
      },
    },
    {
      name: "firefox",
      testMatch: /journey|reports/,
      use: { browserName: "firefox" },
    },
  ],
});
