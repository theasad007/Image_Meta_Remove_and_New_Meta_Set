import { describe, expect, it } from "vitest";
import { buildZipMapping, sanitizeZipPath, zipArchiveName } from "./zip-names";

describe("sanitizeZipPath", () => {
  it("rebuilds paths under images/ from stems only", () => {
    expect(sanitizeZipPath("photo-clean", "jpg")).toBe("images/photo-clean.jpg");
    expect(sanitizeZipPath("../../etc/passwd", "jpg")).toBe("images/etc_passwd.jpg");
  });
  it("neutralizes separators, blanks and control characters", () => {
    expect(sanitizeZipPath("a/b\\c", "png")).toBe("images/a_b_c.png");
    expect(sanitizeZipPath("   ", "webp")).toBe("images/file.webp");
    expect(sanitizeZipPath("a\u0000b", "avif")).toBe("images/ab.avif");
  });
  it("falls back for empty extensions and caps length", () => {
    expect(sanitizeZipPath("photo", "")).toBe("images/photo.bin");
    const long = sanitizeZipPath("x".repeat(500), "heic");
    expect(long.length).toBeLessThanOrEqual("images/".length + 100 + ".heic".length);
    expect(long.startsWith("images/")).toBe(true);
  });
});

describe("buildZipMapping", () => {
  it("dedupes collisions deterministically, case-insensitively", () => {
    const mapping = buildZipMapping([
      { fileId: "1", outputName: "Photo-clean.JPG" },
      { fileId: "2", outputName: "photo-clean.jpg" },
      { fileId: "3", outputName: "photo-clean.jpg" },
      { fileId: "4", outputName: "photo-clean.png" },
    ]);
    const paths = mapping.map((m) => m.archivePath);
    expect(new Set(paths).size).toBe(4);
    expect(paths[0]).toBe("images/photo-clean.jpg");
    expect(paths[1]).toBe("images/photo-clean-2.jpg");
    expect(paths[2]).toBe("images/photo-clean-3.jpg");
    expect(paths[3]).toBe("images/photo-clean.png");
    // Stable across runs.
    const again = buildZipMapping([
      { fileId: "1", outputName: "Photo-clean.JPG" },
      { fileId: "2", outputName: "photo-clean.jpg" },
      { fileId: "3", outputName: "photo-clean.jpg" },
      { fileId: "4", outputName: "photo-clean.png" },
    ]);
    expect(again.map((m) => m.archivePath)).toEqual(paths);
  });
  it("handles unicode, emoji and hostile names without traversal", () => {
    const mapping = buildZipMapping([
      { fileId: "1", outputName: "café 🎉-clean.png" },
      { fileId: "2", outputName: "..\\..\\evil-clean.jpg" },
      { fileId: "3", outputName: "/abs/path-clean.webp" },
    ]);
    for (const entry of mapping) {
      expect(entry.archivePath.startsWith("images/")).toBe(true);
      expect(entry.archivePath).not.toContain("..");
      expect(entry.archivePath.slice("images/".length)).not.toContain("/");
    }
    expect(new Set(mapping.map((m) => m.archivePath)).size).toBe(3);
  });
});

describe("zipArchiveName", () => {
  it("produces a deterministic dated name", () => {
    expect(zipArchiveName(new Date(2026, 9, 13))).toBe("metadata-cleaned-2026-10-13.zip");
  });
});
