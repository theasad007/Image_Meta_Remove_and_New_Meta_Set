import { describe, expect, it } from "vitest";
import { buildReportSnapshot } from "./snapshot";
import { DEFAULT_REPORT_OPTIONS } from "../../types/reporting";
import { minimalCleaning, minimalEntry, minimalInspection, minimalRewrite } from "./testkit";
import { buildSummaryCsv } from "./csv";

/**
 * Phase 6 reporting: rewrites flow through the same frozen snapshot model
 * (no second system). Verified rewritten counts come only from
 * re-observed `rewritten/verified` changes; CSV formula guards cover
 * user-supplied profile values.
 */
describe("rewrite reporting", () => {
  it("prefers rewrite results for operation/output/counts when present", () => {
    const entry = minimalEntry("photo.jpg", 1000);
    const id = entry.item.id;
    const snapshot = buildReportSnapshot({
      entries: [entry],
      inspections: { [id]: minimalInspection({ fileId: id }) },
      cleanings: { [id]: minimalCleaning({ fileId: id }) },
      rewrites: { [id]: minimalRewrite({ fileId: id, mode: "replace_editable" }) },
      zipMapping: [{ fileId: id, archivePath: "images/photo-rewritten.jpg" }],
      options: DEFAULT_REPORT_OPTIONS,
      scopeId: "rewrite-scope",
      generatedAt: "2026-10-14T00:00:00.000Z",
    });
    const record = snapshot.records[0];
    expect(record?.requestedOperation).toBe("rewrite");
    expect(record?.cleaningMode).toBe("replace_editable");
    expect(record?.overallStatus).toBe("verified_rewritten");
    expect(record?.verifiedRewrittenCount).toBe(1);
    expect(record?.outputName).toBe("test-rewritten.jpg");
    expect(record?.archiveIncluded).toBe(true);
    expect(snapshot.totals.verifiedRewritten).toBe(1);
    expect(snapshot.totals.verifiedClean).toBe(0);
  });
  it("keeps cleaning records untouched when no rewrite exists", () => {
    const entry = minimalEntry("clean.jpg", 1000);
    const id = entry.item.id;
    const snapshot = buildReportSnapshot({
      entries: [entry],
      inspections: { [id]: minimalInspection({ fileId: id }) },
      cleanings: { [id]: minimalCleaning({ fileId: id }) },
      zipMapping: [],
      options: DEFAULT_REPORT_OPTIONS,
      scopeId: "clean-scope",
      generatedAt: "2026-10-14T00:00:00.000Z",
    });
    expect(snapshot.records[0]?.requestedOperation).toBe("clean");
    expect(snapshot.records[0]?.verifiedRewrittenCount).toBe(0);
  });
  it("guards formula-injection in filenames and profile-derived cells (CSV)", async () => {
    const entry = minimalEntry("=cmd|' /C calc'!A0.jpg", 1000);
    const id = entry.item.id;
    const { guardFormulaCell } = await import("./privacy");
    // Direct profile-value guard (company/author/keywords flow through the same guard).
    expect(guardFormulaCell("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0");
    expect(guardFormulaCell("@SUM(1+1)")).toBe("'@SUM(1+1)");
    // Pure numbers stay numeric (GPS coordinates are safe without a guard).
    expect(guardFormulaCell("+123")).toBe("+123");
    expect(guardFormulaCell("42")).toBe("42");
    const snapshot = buildReportSnapshot({
      entries: [entry],
      inspections: { [id]: minimalInspection({ fileId: id }) },
      cleanings: {},
      rewrites: {
        [id]: minimalRewrite({
          fileId: id,
          inputName: "=cmd|' /C calc'!A0.jpg",
          changes: [
            { group: "XMP", key: "company", action: "rewritten", before: "", after: "=cmd|' /C calc'!A0", verification: "verified" },
          ],
        }),
      },
      zipMapping: [],
      options: { ...DEFAULT_REPORT_OPTIONS, includeOriginalValues: true, detail: "detailed" },
      scopeId: "evil-scope",
      generatedAt: "2026-10-14T00:00:00.000Z",
    });
    const csv = await buildSummaryCsv(snapshot);
    // Evil filename must never start a CSV cell as a live formula.
    expect(csv).not.toMatch(/,=cmd/);
    expect(csv).toMatch(/'=cmd/);
  });
});
