import type { ReportSnapshot } from "../../types/reporting";
import { sanitizeForPdf, truncateExport } from "./privacy";

/**
 * Browser PDF reporting on pdf-lib (MIT), lazy-loaded by the caller via
 * dynamic import so the landing bundle never pays for it (Phase 5).
 *
 * A4 pages, standard Helvetica family (no remote fonts, nothing bundled):
 * characters outside WinAnsi are shown as `?` and COUNTED — the
 * methodology section discloses the count and points at the UTF-8 CSV for
 * exact values. Creation/modification dates equal the snapshot timestamp,
 * so identical snapshots produce identical bytes (ZIP-vs-standalone proof).
 */

export interface PdfBuildOptions {
  onProgress?: (done: number, total: number) => void;
  isCancelled?: () => boolean;
}

export interface PdfBuildResult {
  bytes: Uint8Array;
  pageCount: number;
  fileCount: number;
  compactUsed: boolean;
  unrepresentableGlyphs: number;
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 44;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const COMPACT_THRESHOLD = 120;

type PdfLib = typeof import("pdf-lib");

interface FlowContext {
  doc: import("pdf-lib").PDFDocument;
  font: import("pdf-lib").PDFFont;
  bold: import("pdf-lib").PDFFont;
  gray: import("pdf-lib").RGB;
  page: import("pdf-lib").PDFPage;
  pages: import("pdf-lib").PDFPage[];
  cursorY: number;
  glyphReplacements: number;
  isCancelled?: () => boolean;
}

function text(ctx: FlowContext, value: string): { text: string } {
  const sanitized = sanitizeForPdf(value);
  ctx.glyphReplacements += sanitized.replaced;
  return { text: sanitized.text };
}

function ensureSpace(ctx: FlowContext, needed: number): void {
  if (ctx.cursorY - needed < MARGIN) {
    newPage(ctx);
  }
}

function newPage(ctx: FlowContext): void {
  ctx.page = ctx.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  ctx.pages.push(ctx.page);
  ctx.cursorY = PAGE_HEIGHT - MARGIN;
}

function wrapLines(value: string, font: import("pdf-lib").PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of value.split("\n")) {
    const words = paragraph.split(" ").filter((w) => w !== "");
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const candidate = current === "" ? word : `${current} ${word}`;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || current === "") {
        // Hard-split pathological single words exceeding the width.
        if (font.widthOfTextAtSize(candidate, size) > maxWidth && current === "") {
          let rest = word;
          while (rest !== "" && font.widthOfTextAtSize(rest, size) > maxWidth) {
            let cut = rest.length - 1;
            while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut -= 1;
            lines.push(rest.slice(0, cut));
            rest = rest.slice(cut);
          }
          current = rest;
        } else {
          current = candidate;
        }
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current !== "") lines.push(current);
  }
  return lines;
}

function paragraph(ctx: FlowContext, value: string, size = 9, gap = 5, bold = false): void {
  const safe = text(ctx, value).text;
  const font = bold ? ctx.bold : ctx.font;
  const lines = wrapLines(safe, font, size, CONTENT_WIDTH);
  const height = lines.length * (size + 2);
  ensureSpace(ctx, height + gap);
  for (const line of lines) {
    ctx.cursorY -= size + 2;
    ctx.page.drawText(line, { x: MARGIN, y: ctx.cursorY, size, font });
  }
  ctx.cursorY -= gap;
}

function heading(ctx: FlowContext, value: string, size = 13): void {
  ctx.cursorY -= 4;
  paragraph(ctx, value, size, 6, true);
}

async function drawTable(
  ctx: FlowContext,
  headers: string[],
  rows: string[][],
  columnFractions: number[],
  fontSize = 8,
): Promise<void> {
  const widths = columnFractions.map((fraction) => fraction * CONTENT_WIDTH);
  const headerLines = headers.map((header, i) => wrapLines(text(ctx, header).text, ctx.bold, fontSize, (widths[i] ?? 50) - 6));
  const headerHeight = Math.max(...headerLines.map((lines) => lines.length)) * (fontSize + 2) + 8;
  const drawHeader = () => {
    ensureSpace(ctx, headerHeight);
    const top = ctx.cursorY;
    ctx.page.drawRectangle({
      x: MARGIN, y: top - headerHeight, width: CONTENT_WIDTH, height: headerHeight,
      color: ctx.gray,
    });
    let x = MARGIN;
    headerLines.forEach((lines, i) => {
      let y = top - 4;
      for (const line of lines) {
        y -= fontSize + 2;
        ctx.page.drawText(line, { x: x + 3, y, size: fontSize, font: ctx.bold });
      }
      x += widths[i] ?? 50;
    });
    ctx.cursorY = top - headerHeight;
  };
  drawHeader();
  let drawn = 0;
  for (const row of rows) {
    const cellLines = row.map((cell, i) => wrapLines(text(ctx, cell).text, ctx.font, fontSize, (widths[i] ?? 50) - 6));
    const rowHeight = Math.max(1, ...cellLines.map((lines) => lines.length)) * (fontSize + 2) + 6;
    if (ctx.cursorY - rowHeight < MARGIN) {
      drawHeader();
    }
    const top = ctx.cursorY;
    let x = MARGIN;
    cellLines.forEach((lines, i) => {
      let y = top - 3;
      for (const line of lines) {
        y -= fontSize + 2;
        ctx.page.drawText(line, { x: x + 3, y, size: fontSize, font: ctx.font });
      }
      x += widths[i] ?? 50;
    });
    ctx.cursorY = top - rowHeight;
    drawn += 1;
    if (drawn % 100 === 0) {
      if (ctx.isCancelled?.()) throw new Error("PDF generation cancelled.");
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  ctx.cursorY -= 6;
}

async function checkCancelled(options: PdfBuildOptions): Promise<void> {
  if (options.isCancelled?.()) throw new Error("PDF generation cancelled.");
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

export async function buildReportPdf(
  pdfLib: PdfLib,
  snapshot: ReportSnapshot,
  options: PdfBuildOptions = {},
): Promise<PdfBuildResult> {
  const { PDFDocument, StandardFonts, rgb } = pdfLib;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const gray = rgb(0.93, 0.93, 0.93);
  const ctx: FlowContext = {
    doc, font, bold, gray,
    page: doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    pages: [], cursorY: PAGE_HEIGHT - MARGIN, glyphReplacements: 0,
    isCancelled: options.isCancelled,
  };
  ctx.pages.push(ctx.page);

  const totals = snapshot.totals;
  const compactUsed = snapshot.records.length > COMPACT_THRESHOLD || snapshot.privacy.detail === "summary";
  const when = snapshot.generatedAt;

  // Cover.
  heading(ctx, "Metadata Processing Report", 17);
  paragraph(ctx, "Local browser report — generated on-device, never uploaded.", 10);
  paragraph(ctx, `Generated: ${when} · Scope: ${snapshot.scopeId} · Operation: ${snapshot.operation} · Policy: ${snapshot.policy || "n/a"}`, 9);
  paragraph(ctx, `Files submitted: ${totals.files} · Verified in supported scope: ${totals.verifiedClean} · Unchanged/no-op: ${totals.unchanged} · Partial: ${totals.partial} · Unsupported: ${totals.unsupported} · Failed: ${totals.failed} · Cancelled: ${totals.cancelled} · Not processed: ${totals.notProcessed}`, 9);
  paragraph(ctx, `Bytes in: ${totals.bytesIn} · Bytes out (verified outputs): ${totals.bytesOut} · In ZIP: ${totals.archiveIncluded} · Excluded: ${totals.archiveExcluded}`, 9);
  paragraph(ctx, "Assurance boundary: removal is verified only within the supported inspection/removal scope. This report is not proof of AI invisibility, C2PA absence, or AI authorship.", 9, 5, true);
  paragraph(ctx, `Presentation: ${compactUsed ? `compact (one row per file; ${snapshot.records.length} files exceed the ${COMPACT_THRESHOLD}-file full-detail threshold or summary mode selected)` : "full per-file detail"} · Privacy: ${snapshot.privacy.includeOriginalValues ? "original values INCLUDED by explicit opt-in" : "original values redacted (summary default)"}.`, 9);
  options.onProgress?.(0, snapshot.records.length);
  await checkCancelled(options);

  // Overview.
  heading(ctx, "Batch overview", 13);
  const formatDist = new Map<string, number>();
  const statusDist = new Map<string, number>();
  const presence = { exif: 0, xmp: 0, iptc: 0, gps: 0, ai: 0 };
  let warnings = 0;
  for (const record of snapshot.records) {
    formatDist.set(record.actualFormat, (formatDist.get(record.actualFormat) ?? 0) + 1);
    statusDist.set(record.overallStatus, (statusDist.get(record.overallStatus) ?? 0) + 1);
    const before = (name: string) => record.categoriesBefore.find((c) => c.category === name || c.category.startsWith(name));
    if (before("EXIF")?.status === "detected") presence.exif += 1;
    if (before("XMP")?.status === "detected") presence.xmp += 1;
    if (before("IPTC")?.status === "detected") presence.iptc += 1;
    if (before("GPS")?.status === "detected") presence.gps += 1;
    if (!record.aiIndicatorsBefore.startsWith("none")) presence.ai += 1;
    warnings += record.warnings.length + record.errors.length;
  }
  await drawTable(ctx, ["Slice", "Value"],
    [
      ...[...formatDist.entries()].map(([k, v]) => [`Format: ${k}`, String(v)]),
      ...[...statusDist.entries()].map(([k, v]) => [`Status: ${k}`, String(v)]),
      ["EXIF detected (before)", String(presence.exif)],
      ["XMP detected (before)", String(presence.xmp)],
      ["IPTC detected (before)", String(presence.iptc)],
      ["GPS detected (before)", String(presence.gps)],
      ["Files with AI indicators (before)", String(presence.ai)],
      ["C2PA", "browser validator result recorded per file"],
      ["Warnings + errors recorded", String(warnings)],
    ], [0.62, 0.38]);
  await checkCancelled(options);

  // Per-file coverage.
  heading(ctx, "Per-file coverage", 13);
  if (compactUsed) {
    const rows = snapshot.records.map((record) => [
      String(record.index),
      record.fileName,
      `${record.actualFormat} · ${record.originalBytes}B→${record.outputBytes === "" ? "—" : `${record.outputBytes}B`}`,
      record.overallStatus,
      `R${record.verifiedRemovedCount}/K${record.retainedCount}/U${record.unverifiedCount}`,
      record.archiveIncluded ? record.archivePath : `excluded: ${record.archiveExclusionReason.slice(0, 60)}`,
    ]);
    await drawTable(ctx, ["#", "File", "Format · bytes", "Status", "R/K/U", "ZIP"], rows, [0.06, 0.3, 0.2, 0.14, 0.1, 0.2], 7);
  } else {
    let done = 0;
    for (const record of snapshot.records) {
      if (options.isCancelled?.()) throw new Error("PDF generation cancelled.");
      ensureSpace(ctx, 90);
      paragraph(ctx, `${record.index}. ${record.fileName}`, 10, 2, true);
      paragraph(ctx, `Format: ${record.actualFormat} (${record.mediaType}) · Bytes: ${record.originalBytes} → ${record.outputBytes === "" ? "no output" : record.outputBytes} · Status: ${record.overallStatus} · Verification: ${record.verificationStatus} (${record.verificationMethod})`, 8, 2);
      const beforeLine = record.categoriesBefore.map((c) => `${c.category}:${c.status}(${c.tagCount})`).join(" · ");
      const afterLine = record.categoriesAfter.length > 0
        ? record.categoriesAfter.map((c) => `${c.category}:${c.status}(${c.tagCount})`).join(" · ")
        : "no output inspection";
      paragraph(ctx, `Before — ${beforeLine || "nothing inspected"}`, 8, 1);
      paragraph(ctx, `After — ${afterLine}`, 8, 1);
      paragraph(ctx, `Removed verified: ${record.verifiedRemovedCount} · Retained: ${record.retainedCount} · Unverified/unsupported: ${record.unverifiedCount} · Rewritten: ${record.verifiedRewrittenCount} (n/a until Phase 6) · GPS: ${record.gpsBefore} → ${record.gpsAfter} · AI: ${record.aiIndicatorsBefore} · C2PA: ${record.c2paState}`, 8, 1);
      if (record.archiveIncluded) {
        paragraph(ctx, `In ZIP: ${record.archivePath}`, 8, 1);
      } else {
        paragraph(ctx, `Excluded from ZIP: ${record.archiveExclusionReason}`, 8, 1);
      }
      for (const warning of record.warnings.slice(0, 4)) {
        paragraph(ctx, `Warning: ${warning}`, 8, 1);
      }
      for (const error of record.errors.slice(0, 4)) {
        paragraph(ctx, `Error: ${error}`, 8, 1);
      }
      done += 1;
      if (done % 25 === 0) {
        options.onProgress?.(done, snapshot.records.length);
        await checkCancelled(options);
      }
    }
  }
  options.onProgress?.(snapshot.records.length, snapshot.records.length);
  await checkCancelled(options);

  // Appendix: tag transitions (detailed, bounded).
  if (snapshot.privacy.detail === "detailed" && !compactUsed) {
    heading(ctx, "Appendix — field transitions (bounded sample)", 13);
    let shown = 0;
    for (const record of snapshot.records) {
      if (shown >= 400 || options.isCancelled?.()) break;
      const interesting = record.changes.filter((c) => c.action === "removed" || c.action.startsWith("retained"));
      if (interesting.length === 0) continue;
      paragraph(ctx, `${record.fileName}`, 9, 1, true);
      for (const change of interesting.slice(0, 12)) {
        const { text } = truncateExport(`${change.group} · ${change.key}: ${change.action} (${change.verification})`, 160);
        paragraph(ctx, text, 8, 0);
        shown += 1;
      }
    }
    if (shown >= 400) {
      paragraph(ctx, "Appendix capped at 400 transitions; the complete ledger is in metadata-tags.csv when selected.", 8);
    }
  }

  // Methodology + privacy.
  heading(ctx, "Methodology & limitations", 13);
  for (const line of [
    "Inspector: format byte-sniffing + ExifReader reads (EXIF/GPS/XMP/IPTC/PNG/WebP/ISOBMFF groups); cleaner: lossless segment/chunk/item rebuilds; verifier: signature + structure + re-inspection + payload fingerprint per file.",
    "'Removed' means observed before and confirmed absent after; 'retained (technical)' covers orientation/ICC/color/display structures; 'retained (unsupported)' covers unassessed APPn/chunks/uuid/JUMBF; 'not detected' requires completed inspection; 'not inspected' (C2PA/video paths) is never absence.",
    "C2PA / Content Credentials: browser validation status is recorded when available; standard metadata cleaning does not silently remove a signed manifest, and removing XMP never proves manifest removal.",
    "No guarantee about invisible watermarks, off-file provenance registries, platform AI labels, or image-content AI signals. Cleaning never claims AI-origin verdicts.",
    "Browser capacity: 64 MB/file inspection/cleaning budget; ZIP archives past 4 GiB are refused (no Zip64); batch size is device-limited, never paywalled.",
    `PDF text: ${ctx.glyphReplacements} character(s) outside the PDF standard-font encoding shown as '?' (exact values remain in metadata-report.csv, UTF-8).`,
  ]) {
    paragraph(ctx, line, 8, 2);
  }
  heading(ctx, "Privacy note", 13);
  paragraph(ctx, snapshot.privacy.includeOriginalValues
    ? "This PDF INCLUDES original metadata values by explicit opt-in: it may expose GPS coordinates, names, dates, serials, or prompt text. Handle and share accordingly."
    : "This PDF redacts original metadata values (summary default): only field names, statuses and counts appear. Filenames themselves are listed.", 8);
  paragraph(ctx, "All processing ran locally in the browser; nothing was uploaded. No source EXIF/creator/prompt data was copied into PDF document properties.", 8);

  // Footers with page numbers (second pass).
  const total = ctx.pages.length;
  ctx.pages.forEach((page, index) => {
    page.drawText(`AI Metadata Remover & Manager · local browser report · page ${index + 1} of ${total}`, {
      x: MARGIN, y: 24, size: 7, font,
    });
  });

  doc.setTitle("Metadata Processing Report");
  doc.setProducer("AI Metadata Remover & Manager (local browser report)");
  const stamp = new Date(snapshot.generatedAt);
  doc.setCreationDate(Number.isNaN(stamp.getTime()) ? new Date(0) : stamp);
  doc.setModificationDate(Number.isNaN(stamp.getTime()) ? new Date(0) : stamp);
  const bytes = await doc.save({ useObjectStreams: false });
  return {
    bytes: new Uint8Array(bytes),
    pageCount: total,
    fileCount: snapshot.records.length,
    compactUsed,
    unrepresentableGlyphs: ctx.glyphReplacements,
  };
}
