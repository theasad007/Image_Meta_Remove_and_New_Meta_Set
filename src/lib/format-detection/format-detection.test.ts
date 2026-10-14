import { describe, expect, it } from "vitest";
import {
  classifyFile,
  getExtension,
  isNativelyPreviewable,
  previewFallbackReason,
} from "./format-detection";

describe("getExtension", () => {
  it("lowercases image extensions", () => {
    expect(getExtension("PHOTO.JPG")).toBe("jpg");
    expect(getExtension("shot.AvIf")).toBe("avif");
  });
  it("returns empty for missing or trailing dots", () => {
    expect(getExtension("noextension")).toBe("");
    expect(getExtension(".hidden")).toBe("");
    expect(getExtension("file.")).toBe("");
  });
  it("strips directory prefixes", () => {
    expect(getExtension("C:\\fakepath\\pic.heic")).toBe("heic");
  });
});

describe("classifyFile", () => {
  it("classifies every required image extension", () => {
    for (const ext of ["jpg", "jpeg", "png", "webp", "avif", "heic", "heif"]) {
      const result = classifyFile(`photo.${ext}`, "", 1024);
      expect(result.mediaKind).toBe("image");
      expect(result.supportedForQueue).toBe(true);
      expect(result.detectionMethod).toBe("extension-hint");
      expect(result.binaryVerified).toBe(false);
    }
  });
  it("classifies every required video extension", () => {
    for (const ext of ["mp4", "mov", "webm"]) {
      const result = classifyFile(`clip.${ext}`, "", 2048);
      expect(result.mediaKind).toBe("video");
      expect(result.supportedForQueue).toBe(true);
      expect(result.binaryVerified).toBe(false);
    }
  });
  it("marks unknown extensions without claiming support", () => {
    const result = classifyFile("notes.txt", "text/plain", 10);
    expect(result.mediaKind).toBe("unknown");
    expect(result.supportedForQueue).toBe(false);
    expect(result.label).toBe("Unknown");
  });
  it("flags zero-byte files explicitly", () => {
    const result = classifyFile("empty.jpg", "image/jpeg", 0);
    expect(result.isEmpty).toBe(true);
    expect(result.mediaKind).toBe("image");
  });
  it("treats MIME as a hint and keeps extension authority", () => {
    const result = classifyFile("photo.png", "application/octet-stream", 42);
    expect(result.extension).toBe("png");
    expect(result.mimeHint).toBe("application/octet-stream");
  });
});

describe("preview policy", () => {
  it("allows native preview for decodable stills", () => {
    for (const ext of ["jpg", "png", "webp", "avif"]) {
      expect(
        isNativelyPreviewable(classifyFile(`a.${ext}`, "", 100)),
      ).toBe(true);
    }
  });
  it("withholds preview for HEIC/HEIF, MOV, unknown, and empty files", () => {
    for (const name of ["a.heic", "a.heif", "a.mov", "a.txt", "a.jpg"]) {
      const size = name === "a.jpg" ? 0 : 100;
      expect(isNativelyPreviewable(classifyFile(name, "", size))).toBe(false);
    }
  });
  it("explains fallback without calling files corrupt", () => {
    const reason = previewFallbackReason(classifyFile("a.heic", "", 100));
    expect(reason).toMatch(/queued/i);
    expect(reason).not.toMatch(/corrupt|unsupported for metadata/i);
  });
});
