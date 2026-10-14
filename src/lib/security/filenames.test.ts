import { describe, expect, it } from "vitest";
import { sanitizeFileName } from "./filenames";

describe("sanitizeFileName", () => {
  it("keeps ordinary names intact", () => {
    expect(sanitizeFileName("photo-001.jpg")).toBe("photo-001.jpg");
  });
  it("strips path traversal segments", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("a/b\\c.png")).toBe("c.png");
  });
  it("removes control characters", () => {
    expect(sanitizeFileName("a\u0000b.jpg")).toBe("ab.jpg");
  });
  it("falls back for empty or dot-only names", () => {
    expect(sanitizeFileName("")).toBe("file");
    expect(sanitizeFileName("..")).toBe("file");
  });
  it("truncates long names while keeping short extensions", () => {
    const long = `${"a".repeat(200)}.jpg`;
    const result = sanitizeFileName(long);
    expect(result.length).toBeLessThanOrEqual(120);
    expect(result.endsWith(".jpg")).toBe(true);
  });
});
