import { expect, test, type Page } from "@playwright/test";
import ExifReader from "exifreader";
import fs from "node:fs";
import { inspectRow, row, upload } from "./helpers";

/**
 * P0 C2PA/OpenAI proof: the SHIPPED browser path (real WASM validator)
 * against the production static export. Fixtures are our own synthetic
 * files signed locally with c2patool 0.27.22 under its built-in TEST
 * identity (see docs/09) — untrusted by design, structurally genuine.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w["showSaveFilePicker"];
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  (page as unknown as { __errors: string[] }).__errors = errors;
  await page.goto("/");
});

async function openC2paSection(page: Page) {
  const panel = page.locator('[data-testid="inspector-panel"]');
  await panel.getByText("C2PA / Content Credentials", { exact: false }).first().click();
  return panel;
}

test("genuine signed JPEG exercises the detected path with honest semantics", async ({ page }) => {
  await upload(page, ["signed-c2pa.jpg"]);
  await inspectRow(page, "signed-c2pa.jpg");
  const panel = await openC2paSection(page);
  // Presence, generator, provenance and signer are reported separately —
  // presence is never equated with a trusted signature.
  await expect(panel).toContainText("Manifest Store");
  await expect(panel).toContainText("Present");
  await expect(panel).toContainText("AI Metadata Remover P0 proof signer");
  await expect(panel).toContainText("Digital Source Type");
  await expect(panel).toContainText("trainedAlgorithmicMedia");
  await expect(panel).toContainText("C2PA Signer");
  await expect(panel).toContainText("detected");
  // Browser-truthful trust semantics: the test-identity credential is
  // untrusted, so exactly 1 failure is reported and presence is never
  // presented as trusted validity.
  await expect(panel).toContainText("Validation State");
  await expect(panel).toContainText("Valid");
  await expect(panel).toContainText("reported 1 failure");
  await expect(panel).toContainText("Do not treat the claim as trusted");
  // Exact failure classes stay visible: an untrusted credential must never
  // read as content tampering.
  await expect(panel).toContainText("signingCredential.untrusted");
  await expect(panel).not.toContainText("claimSignature.mismatch");
  // The C2PA-derived AI indicator fires; the row chip counts real evidence.
  await expect(panel).toContainText("C2PA claim declares an AI-associated digital source type");
  await expect(row(page, "signed-c2pa.jpg")).toContainText("C2PA 9");
  // Two distinct digital-source-type claim values surface (action-level URI
  // plus the provenance assertion's short form) — both are real evidence.
  await expect(row(page, "signed-c2pa.jpg")).toContainText("AI 2");
  await expect(row(page, "signed-c2pa.jpg")).not.toContainText("C2PA 0");
  expect((page as unknown as { __errors: string[] }).__errors).toHaveLength(0);
});

test("tampered manifest stays detected and reports validation failures", async ({ page }) => {
  await upload(page, ["jpeg-c2pa-tampered.jpg"]);
  await inspectRow(page, "jpeg-c2pa-tampered.jpg");
  const panel = await openC2paSection(page);
  await expect(panel).toContainText("detected");
  // Corrupt manifest data must surface as untrusted/failing — never as
  // absent and never as silently valid.
  await expect(panel).toContainText(/reported [23] failures/);
  await expect(panel).toContainText("Do not treat the claim as trusted");
  // Exactly the two expected classes: credential trust + content integrity.
  // (Count tolerance covers SDK-version drift; the codes are the pins.)
  await expect(panel).toContainText("claimSignature.mismatch");
  await expect(panel).toContainText("signingCredential.untrusted");
  await expect(panel).not.toContainText("No embedded C2PA Manifest Store identifier was found");
  expect((page as unknown as { __errors: string[] }).__errors).toHaveLength(0);
});

test("ordinary images and dummy markers report not detected — never fake-detected", async ({ page }) => {
  await upload(page, ["jpeg-exif.jpg", "jpeg-jumbf.jpg"]);
  for (const name of ["jpeg-exif.jpg", "jpeg-jumbf.jpg"]) {
    await inspectRow(page, name);
    const panel = await openC2paSection(page);
    // The dummy APP11 "JUMBF" marker carries no real store UUID and must not
    // preflight-hit; an ordinary photo has no store at all.
    await expect(panel).toContainText("not detected");
    await expect(panel).toContainText("No embedded C2PA Manifest Store identifier was found");
    await page.getByRole("button", { name: "Close" }).click();
  }
  expect((page as unknown as { __errors: string[] }).__errors).toHaveLength(0);
});

test("expired credential reports its own codes, not tampering", async ({ page }) => {
  // Locally signed under an expired test credential (see
  // src/test-fixtures/README.md): the store is genuine and the bytes are
  // intact, but the credential pair must fail openly — the same shape as
  // real-world expired-signer files (e.g. older ChatGPT PNG exports).
  await upload(page, ["expired-cert.jpg"]);
  await inspectRow(page, "expired-cert.jpg");
  const panel = page.locator('[data-testid="inspector-panel"]');
  await panel.getByText("C2PA / Content Credentials", { exact: false }).first().click();
  await expect(panel).toContainText("detected");
  await expect(panel).toContainText("Invalid");
  await expect(panel).toContainText("signingCredential.expired");
  await expect(panel).toContainText("signingCredential.untrusted");
  await expect(panel).toContainText("P0 Expired Test Signer 3");
  await expect(panel).not.toContainText("No embedded C2PA Manifest Store identifier was found");
  expect((page as unknown as { __errors: string[] }).__errors).toHaveLength(0);
});

test("signed PNG validates in-browser via its real caBX chunk", async ({ page }) => {
  await upload(page, ["signed-c2pa.png"]);
  await inspectRow(page, "signed-c2pa.png");
  const pngPanel = page.locator('[data-testid="inspector-panel"]');
  await pngPanel.getByText("C2PA / Content Credentials", { exact: false }).first().click();
  await expect(pngPanel).toContainText("detected");
  await expect(pngPanel).toContainText("Manifest Store");
  await expect(pngPanel).toContainText("AI Metadata Remover P0 proof signer");
  await expect(pngPanel).toContainText("trainedAlgorithmicMedia");
  await expect(pngPanel).toContainText("signingCredential.untrusted");
  await expect(row(page, "signed-c2pa.png")).toContainText("C2PA 9");
  expect((page as unknown as { __errors: string[] }).__errors).toHaveLength(0);
});

test("OpenAI CreatorTool is flagged; caption-only mentions are ignored", async ({ page }) => {
  await upload(page, ["jpeg-openai.jpg", "jpeg-caption-openai.jpg"]);
  await expect(row(page, "jpeg-openai.jpg")).toContainText("OpenAI 1");
  await expect(row(page, "jpeg-caption-openai.jpg")).toContainText("AI 0");
  await inspectRow(page, "jpeg-openai.jpg");
  const panel = page.locator('[data-testid="inspector-panel"]');
  await expect(panel).toContainText('Generator signature "openai" in CreatorTool');
  await expect(panel).toContainText("OpenAI GPT-Image");
  await page.getByRole("button", { name: "Close" }).click();
  await inspectRow(page, "jpeg-caption-openai.jpg");
  await expect(page.locator('[data-testid="inspector-panel"]')).toContainText(
    "No AI-associated metadata indicators found",
  );
  expect((page as unknown as { __errors: string[] }).__errors).toHaveLength(0);
});

test("cleaning a signed file removes the manifest with verification", async ({ page }) => {
  await upload(page, ["signed-c2pa.jpg"]);
  await row(page, "signed-c2pa.jpg").getByRole("button", { name: "Remove metadata" }).click();
  const result = page.locator('[data-testid="before-after-panel"]');
  await result.waitFor();
  // The manifest store is gone: verified removal, not a silent strip.
  await expect(result).toContainText(/verified clean/i);
  await expect(result).toContainText(/C2PA/i);
  // Before side keeps the original evidence (Valid + 1 untrusted-credential
  // failure); after side proves absence through real re-inspection.
  await expect(result).toContainText("reported 1 failure");
  await expect(result).toContainText("not detected");
  // Byte-level proof on the download: no store UUID anywhere, EXIF gone.
  const downloadPromise = page.waitForEvent("download");
  await page.locator('[data-testid="download-cleaned"]').click();
  const download = await downloadPromise;
  const outPath = (await download.path()) as string;
  const bytes = fs.readFileSync(outPath);
  const uuid = Buffer.from([
    0x63, 0x32, 0x70, 0x61, 0x00, 0x11, 0x00, 0x10,
    0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
  ]);
  expect(bytes.includes(uuid)).toBe(false);
  const tags = (await ExifReader.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), {
    expanded: true,
    async: true,
  })) as unknown as Record<string, unknown>;
  expect(Object.keys((tags["exif"] as Record<string, unknown>) ?? {})).toHaveLength(0);
  expect((page as unknown as { __errors: string[] }).__errors).toHaveLength(0);
});

test("bulk ZIP and CSV prove removal across formats", async ({ page }) => {
  await upload(page, ["signed-c2pa.jpg", "webp-c2pa-signed.webp"]);
  await page.locator('[data-testid="batch-clean-all"]').click();
  await expect(page.locator('[data-testid="batch-progress"]')).toContainText(/2 of 2 files processed/, {
    timeout: 180000,
  });
  // ZIP entries carry no manifest store and stay EXIF-clean.
  const zipPromise = page.waitForEvent("download");
  await page.locator('[data-testid="download-zip"]').click();
  const zipDownload = await zipPromise;
  const zipPath = (await zipDownload.path()) as string;
  const { unzipSync } = await import("fflate");
  const entries = unzipSync(new Uint8Array(fs.readFileSync(zipPath)));
  const names = Object.keys(entries);
  expect(names.length).toBe(2);
  const uuid = Buffer.from([
    0x63, 0x32, 0x70, 0x61, 0x00, 0x11, 0x00, 0x10,
    0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
  ]);
  for (const name of names) {
    expect(name.startsWith("images/")).toBe(true);
    const data = Buffer.from(entries[name] as Uint8Array);
    expect(data.includes(uuid), `${name} store bytes`).toBe(false);
  }
  // CSV records the same verified result: C2PA After is not_detected.
  const csvPromise = page.waitForEvent("download");
  await page.locator('[data-testid="download-csv"]').click();
  const csvDownload = await csvPromise;
  const csvPath = (await csvDownload.path()) as string;
  const text = fs.readFileSync(csvPath, "utf-8");
  expect(text).toContain("C2PA After");
  const parseRow = (line: string): string[] => {
    const cells: string[] = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i] as string;
      if (quoted) {
        if (char === '"') {
          if (line[i + 1] === '"') {
            cell += '"';
            i += 1;
          } else quoted = false;
        } else cell += char;
      } else if (char === '"') quoted = true;
      else if (char === ",") {
        cells.push(cell);
        cell = "";
      } else cell += char;
    }
    cells.push(cell);
    return cells;
  };
  const lines = text.replace(/^\uFEFF/, "").split("\n").filter((line) => line.length > 0);
  const header = parseRow(lines[0] ?? "");
  const afterIndex = header.findIndex((cell) => cell.includes("C2PA After"));
  const statusIndex = header.findIndex((cell) => cell.includes("Overall Status"));
  expect(afterIndex).toBeGreaterThan(-1);
  expect(statusIndex).toBeGreaterThan(-1);
  const rows = lines.slice(1).filter((line) => line.includes("signed-c2pa") || line.includes("webp-c2pa-signed"));
  expect(rows).toHaveLength(2);
  for (const line of rows) {
    const cells = parseRow(line);
    expect(cells[afterIndex]).toMatch(/not_detected/);
    expect(cells[statusIndex]).toBe("verified_clean");
  }
  expect((page as unknown as { __errors: string[] }).__errors).toHaveLength(0);
});
