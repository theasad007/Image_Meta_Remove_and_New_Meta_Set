/**
 * Privacy + output-safety primitives (Phase 5).
 *
 * - Summary mode redacts original metadata VALUES everywhere (keys and
 *   statuses stay — existence is not the sensitive part).
 * - CSV formula defense prefixes risky cells without touching internals.
 * - PDF WinAnsi sanitizing counts replacements for methodology disclosure
 *   (CSV keeps full UTF-8 fidelity, so nothing is lost globally).
 */

export type PrivacyMode = "summary" | "detailed-values";

const NUMERIC_CELL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
/** Leading = + - @ incl. whitespace/control/Unicode-prefix tricks. */
const FORMULA_RISK =
  /^[\s\u0000-\u0020\u00a0\u2000-\u200b\u2028\u2029\ufeff]*[=+\-@]/;

export function isPureNumericCell(text: string): boolean {
  return NUMERIC_CELL.test(text);
}

/**
 * Spreadsheet-safe cell: numbers stay numeric; risky text gets a leading
 * apostrophe (documented). Internal values are never modified — only the
 * exported representation. Control chars and lone surrogates are
 * neutralized; null bytes removed.
 */
export function guardFormulaCell(text: string): string {
  let cleaned = text.replace(/\u0000/g, "");
  cleaned = cleaned.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "�");
  cleaned = cleaned.replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "�");
  if (cleaned !== "" && !isPureNumericCell(cleaned) && FORMULA_RISK.test(cleaned)) {
    return `'${cleaned}`;
  }
  return cleaned;
}

export function redactValue(value: string, mode: PrivacyMode): string {
  if (mode === "detailed-values") return value;
  if (value === "") return "";
  return "[redacted]";
}

/** WinAnsi (cp1252) coverage for PDF standard fonts. */
const WIN_ANSI_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

function isWinAnsi(code: number): boolean {
  if (code >= 0x20 && code <= 0x7e) return true;
  if (code >= 0xa0 && code <= 0xff) {
    return code !== 0x81 && code !== 0x8d && code !== 0x8f && code !== 0x90 && code !== 0x9d;
  }
  return WIN_ANSI_EXTRA.has(code);
}

/**
 * Replace PDF-unencodable characters with `?`, counting replacements so the
 * methodology section discloses them (never silent). Newlines collapse —
 * the PDF layout wraps text itself.
 */
export function sanitizeForPdf(text: string): { text: string; replaced: number } {
  let replaced = 0;
  let out = "";
  for (const char of text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")) {
    const code = char.codePointAt(0) ?? 0;
    if (code > 0xffff) {
      // Astral plane (emoji/CJK-ext): standard fonts cannot encode.
      out += "?";
      replaced += 1;
      continue;
    }
    if (isWinAnsi(code)) {
      out += char;
    } else {
      out += "?";
      replaced += 1;
    }
  }
  return { text: out.replace(/\s+/g, " ").trim(), replaced };
}

/** Truncate with an explicit marker (internal evidence keeps the full text). */
export function truncateExport(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: `${text.slice(0, maxChars)}…[truncated]`, truncated: true };
}
