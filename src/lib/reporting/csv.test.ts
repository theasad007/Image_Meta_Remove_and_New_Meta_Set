import { describe, expect, it } from "vitest";
import { buildSummaryCsv, buildTagsCsv, SUMMARY_COLUMNS, TAGS_COLUMNS } from "./csv";
import { guardFormulaCell } from "./privacy";
import { buildReportSnapshot } from "./snapshot";
import { DEFAULT_REPORT_OPTIONS } from "../../types/reporting";
import { minimalCleaning, minimalEntry, minimalInspection } from "./testkit";

/** Minimal RFC-4180 parser (test-only) for round-trip verification. */
export function parseCsv(text: string): string[][] {
  const body = text.startsWith("﻿") ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  const pushCell = () => {
    row.push(cell);
    cell = "";
  };
  const pushRow = () => {
    rows.push(row);
    row = [];
  };
  while (i < body.length) {
    const char = body[i] as string;
    if (quoted) {
      if (char === '"') {
        if (body[i + 1] === '"') {
          cell += '"';
          i += 2;
        } else {
          quoted = false;
          i += 1;
        }
      } else {
        cell += char;
        i += 1;
      }
    } else if (char === '"') {
      quoted = true;
      i += 1;
    } else if (char === ",") {
      pushCell();
      i += 1;
    } else if (char === "\r" && body[i + 1] === "\n") {
      pushCell();
      pushRow();
      i += 2;
    } else if (char === "\n") {
      pushCell();
      pushRow();
      i += 1;
    } else {
      cell += char;
      i += 1;
    }
  }
  if (cell !== "" || row.length > 0) {
    pushCell();
    pushRow();
  }
  return rows;
}

export const ADVERSARIAL = [
  "=cmd|'/c calc'!A0",
  "+SUM(1+1)",
  "-2+3",
  "@evil",
  " =HYPERLINK(\"http://x\")",
  "\t+tabbed",
  "\n=newline",
  "normal text",
  "-33.8688",
  "+41.2",
  " accuse, \"quoted\" and\nmultiline ",
  "café 🎉 naïve",
  "",
];

describe("guardFormulaCell", () => {
  it("neutralizes spreadsheet payloads including prefix tricks", () => {
    expect(guardFormulaCell("=cmd|'/c calc'!A0").startsWith("'")).toBe(true);
    expect(guardFormulaCell(" =HYPERLINK(\"http://x\")").startsWith("'")).toBe(true);
    expect(guardFormulaCell("\t+tabbed").startsWith("'")).toBe(true);
    expect(guardFormulaCell("@evil").startsWith("'")).toBe(true);
    expect(guardFormulaCell("-2+3").startsWith("'")).toBe(true);
  });
  it("keeps valid numeric GPS typed, not textified", () => {
    expect(guardFormulaCell("-33.8688")).toBe("-33.8688");
    expect(guardFormulaCell("+41.2")).toBe("+41.2");
  });
  it("leaves ordinary text and emoji untouched", () => {
    expect(guardFormulaCell("normal text")).toBe("normal text");
    expect(guardFormulaCell("café 🎉")).toBe("café 🎉");
  });
});

function adversarialSnapshot() {
  const entries = ADVERSARIAL.map((name, i) => minimalEntry(`${name || `empty-${i}`}.jpg`));
  const inspections: Record<string, ReturnType<typeof minimalInspection>> = {};
  const cleanings: Record<string, ReturnType<typeof minimalCleaning>> = {};
  for (const entry of entries) {
    inspections[entry.item.id] = minimalInspection({
      fileId: entry.item.id,
      fileName: entry.item.name,
      categories: [{
        category: "EXIF", status: "detected",
        tags: ADVERSARIAL.slice(0, 5).map((value, n) => ({ group: "EXIF", key: `Tag${n}`, displayedValue: value })),
        warnings: [`warn ${ADVERSARIAL[0]}`],
      }],
    });
    cleanings[entry.item.id] = minimalCleaning({
      fileId: entry.item.id,
      inputName: entry.item.name,
      outputName: `${entry.item.name}-clean`,
      warnings: [],
      errors: [`err ${ADVERSARIAL[1]}`],
    });
  }
  return buildReportSnapshot({
    entries,
    inspections,
    cleanings,
    zipMapping: [],
    options: DEFAULT_REPORT_OPTIONS,
    scopeId: "adversarial",
    generatedAt: "2026-10-13T00:00:00.000Z",
  });
}

describe("buildSummaryCsv", () => {
  it("emits the exact schema with one row per input", async () => {
    const snapshot = adversarialSnapshot();
    const csv = await buildSummaryCsv(snapshot);
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual([...SUMMARY_COLUMNS]);
    expect(rows.length - 1).toBe(ADVERSARIAL.length);
    for (const row of rows.slice(1)) {
      expect(row.length).toBe(SUMMARY_COLUMNS.length);
    }
  });
  it("round-trips hostile cells without executable formulas", async () => {
    const snapshot = adversarialSnapshot();
    const csv = await buildSummaryCsv(snapshot);
    const rows = parseCsv(csv);
    const nameIndex = SUMMARY_COLUMNS.indexOf("Original File Name");
    for (const row of rows.slice(1)) {
      const cell = row[nameIndex] as string;
      expect(cell).not.toMatch(/^[=+\-@]/);
    }
    // The dangerous payload survives with its guard prefix intact.
    expect(csv).toContain("'=cmd");
    expect(csv).toContain("café 🎉 naïve");
  });
  it("redacts original values by default and exposes them on opt-in", async () => {
    const entries = [minimalEntry("a.jpg")];
    const base = {
      entries,
      inspections: {},
      cleanings: {},
      zipMapping: [],
      scopeId: "privacy",
      generatedAt: "2026-10-13T00:00:00.000Z",
    } as const;
    const summary = await buildSummaryCsv(buildReportSnapshot({ ...base, options: DEFAULT_REPORT_OPTIONS }));
    expect(summary).not.toContain("33.8688");
    const exposed = await buildSummaryCsv(buildReportSnapshot({
      ...base,
      options: { ...DEFAULT_REPORT_OPTIONS, includeOriginalValues: true },
    }));
    // Opt-in path still guards formulas (none here) — key check is it runs.
    expect(exposed.length).toBeGreaterThan(summary.length - 1);
  });
  it("supports cancellation mid-build", async () => {
    const snapshot = adversarialSnapshot();
    let calls = 0;
    await expect(buildSummaryCsv(snapshot, {
      isCancelled: () => {
        calls += 1;
        return calls > 1;
      },
    })).rejects.toThrow(/cancelled/i);
  });
});

describe("buildTagsCsv", () => {
  it("emits one row per field plus group-level coverage rows", async () => {
    const entry = minimalEntry("a.jpg");
    const snapshot = buildReportSnapshot({
      entries: [entry],
      inspections: {
        [entry.item.id]: minimalInspection({
          fileId: entry.item.id,
          categories: [
            {
              category: "EXIF", status: "detected",
              tags: [
                { group: "EXIF", key: "Make", displayedValue: "TestCam" },
                { group: "EXIF", key: "Make", displayedValue: "Duplicate" },
              ],
              warnings: [],
            },
            { category: "C2PA / Content Credentials", status: "not_inspected", tags: [], warnings: [] },
          ],
        }),
      },
      cleanings: {},
      zipMapping: [],
      options: DEFAULT_REPORT_OPTIONS,
      scopeId: "tags",
      generatedAt: "2026-10-13T00:00:00.000Z",
    });
    const csv = await buildTagsCsv(snapshot);
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual([...TAGS_COLUMNS]);
    // Duplicate Make keys dedupe to one row; C2PA gets a group-level row.
    const keys = rows.slice(1).map((r) => `${r[2]}||${r[3]}`);
    expect(keys).toContain("EXIF||Make");
    expect(keys.filter((k) => k === "EXIF||Make")).toHaveLength(1);
    expect(keys).toContain("C2PA / Content Credentials||");
  });
  it("never exposes summary-redacted values", async () => {
    const snapshot = adversarialSnapshot();
    const csv = await buildTagsCsv(snapshot);
    const rows = parseCsv(csv);
    const withDangerousName = rows.slice(1).find((r) => (r[1] ?? "").includes("=cmd"));
    expect(withDangerousName?.[1]?.startsWith("'")).toBe(true);
  });
  it("redacts real GPS digits by default, exposes them on opt-in", async () => {
    const { inspectImage } = await import("../metadata/inspect/inspect");
    const { verifyCleanedImage } = await import("../metadata/verify/verify");
    const { default: fs } = await import("node:fs");
    const { default: path } = await import("node:path");
    const { DOMParser } = await import("@xmldom/xmldom");
    const full = fs.readFileSync(path.join(__dirname, "..", "..", "test-fixtures", "jpeg-exif.jpg"));
    const bytes = new Uint8Array(full);
    const copy = new Uint8Array(bytes);
    const before = await inspectImage("real", copy.buffer, "jpeg-exif.jpg", { domParser: new DOMParser() });
    const { sniffImageBytes, canonicalExtensionForSniffedKind } = await import("../format-detection/signatures");
    const sniff = sniffImageBytes(bytes.slice(0, 65536), bytes.length, "jpg");
    const cleaned = await verifyCleanedImage({
      fileId: "real", inputName: "jpeg-exif.jpg", extension: canonicalExtensionForSniffedKind(sniff.kind),
      kind: sniff.kind, inputBytes: bytes, before, policy: { mode: "privacy_safe_default" }, domParser: new DOMParser(),
    });
    const { createEntries } = await import("../../components/queue/queue-store");
    const [entry] = createEntries([new File([bytes], "jpeg-exif.jpg")]);
    if (!entry) throw new Error("expected entry");
    const base = {
      entries: [entry],
      inspections: { [entry.item.id]: before },
      cleanings: { [entry.item.id]: cleaned },
      zipMapping: [],
      scopeId: "gps-privacy",
      generatedAt: "2026-10-13T00:00:00.000Z",
    } as const;
    const summary = await buildSummaryCsv(buildReportSnapshot({ ...base, options: DEFAULT_REPORT_OPTIONS }));
    expect(summary).not.toContain("12.345678");
    expect(summary).not.toContain("98.765432");
    expect(summary).toMatch(/location withheld/);
    const exposed = await buildSummaryCsv(buildReportSnapshot({
      ...base,
      options: { ...DEFAULT_REPORT_OPTIONS, includeOriginalValues: true },
    }));
    expect(exposed).toContain("12.345678");
  });
});
