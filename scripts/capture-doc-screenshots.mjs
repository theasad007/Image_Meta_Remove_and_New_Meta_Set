import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { chromium } from "@playwright/test";

const root = process.cwd();
const port = Number(process.env.DOCS_SCREENSHOT_PORT ?? 8132);
const baseUrl = `http://127.0.0.1:${port}`;
const fixture = (name) => path.join(root, "src", "test-fixtures", name);
const output = path.join(root, "public", "help-screenshots");
const executable = process.env.DOCS_CHROME_EXECUTABLE
  ?? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  ?? ["/opt/google/chrome/chrome", "/usr/bin/chromium", "/usr/bin/google-chrome", chromium.executablePath()].find((candidate) => existsSync(candidate));

if (!executable || !existsSync(executable)) {
  throw new Error("Install Chrome or Chromium, then set DOCS_CHROME_EXECUTABLE to its executable path.");
}

await fs.mkdir(output, { recursive: true });
const server = spawn("python3", ["-m", "http.server", String(port), "--directory", path.join(root, "out")], { stdio: "ignore" });
const chrome = spawn(executable, [
  "--no-sandbox", "--disable-setuid-sandbox", "--no-zygote", "--disable-dev-shm-usage",
  "--headless", "--remote-debugging-port=0", "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
let browser;

try {
  let serverReady = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) { serverReady = true; break; }
    } catch { /* The static server is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!serverReady) throw new Error("The static export did not start on the screenshot port.");

  const lines = readline.createInterface({ input: chrome.stderr });
  let wsUrl;
  for await (const line of lines) {
    const match = line.match(/DevTools listening on (ws:\/\/[^\s]+)/);
    if (match) { wsUrl = match[1]; break; }
  }
  if (!wsUrl) throw new Error("Chrome did not expose a local DevTools endpoint.");
  browser = await chromium.connectOverCDP(wsUrl);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(120_000);

  async function openWorkspace() {
    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
    await page.locator('[data-testid="file-input"]').waitFor();
  }

  async function screenshot(name) {
    await page.screenshot({ path: path.join(output, name), type: "jpeg", quality: 80 });
    process.stdout.write(`Captured ${name}\n`);
  }

  await openWorkspace();
  await page.locator("#tools").scrollIntoViewIfNeeded();
  await screenshot("workspace.jpg");

  await openWorkspace();
  await page.locator('[data-testid="file-input"]').setInputFiles(fixture("jpeg-gps-sw.jpg"));
  const gpsRow = page.locator('[data-testid="queue-item"]', { hasText: "jpeg-gps-sw.jpg" }).first();
  await gpsRow.waitFor();
  await gpsRow.getByRole("button", { name: "View details" }).click();
  await page.getByTestId("details-modal").waitFor();
  await screenshot("inspector.jpg");
  await page.getByTestId("details-close").click();
  await gpsRow.getByRole("button", { name: /Edit metadata for/ }).first().click();
  await page.getByTestId("editor-modal").waitFor();
  await screenshot("editor.jpg");
  await page.locator('[data-testid="editor-tab-location"]').click();
  await page.getByTestId("geotag-editor").waitFor();
  await page.getByTestId("geotag-input-latitude").fill("-34.6037");
  await page.getByTestId("geotag-input-longitude").fill("-58.3816");
  await page.getByTestId("geotag-preview").waitFor();
  await screenshot("gps-editor.jpg");

  await openWorkspace();
  await page.locator('[data-testid="file-input"]').setInputFiles(fixture("jpeg-xmp-iptc.jpg"));
  await page.locator('[data-testid="queue-item"]', { hasText: "jpeg-xmp-iptc.jpg" }).waitFor();
  await page.locator('[data-testid="batch-clean-all"]').click();
  await page.locator('[data-testid="batch-progress"]').filter({ hasText: "1 of 1 files processed" }).waitFor();
  const result = page.locator('[data-testid="before-after-panel"]');
  await result.waitFor();
  await result.scrollIntoViewIfNeeded();
  await screenshot("clean-result.jpg");

  await openWorkspace();
  await page.locator('[data-testid="file-input"]').setInputFiles([fixture("jpeg-openai.jpg"), fixture("png-text-exif.png")]);
  await page.locator('[data-testid="queue-item"]', { hasText: "jpeg-openai.jpg" }).waitFor();
  await page.locator('[data-testid="queue-item"]', { hasText: "png-text-exif.png" }).waitFor();
  await page.locator('[data-testid="batch-clean-all"]').click();
  await page.locator('[data-testid="batch-progress"]').filter({ hasText: "2 of 2 files processed" }).waitFor();
  await page.getByTestId("download-zip").scrollIntoViewIfNeeded();
  await screenshot("batch-outputs.jpg");
  await page.getByTestId("report-options-toggle").click();
  await page.getByRole("heading", { name: "Audit reports" }).scrollIntoViewIfNeeded();
  await screenshot("reports.jpg");
} finally {
  await browser?.close().catch(() => undefined);
  chrome.kill();
  server.kill();
}
