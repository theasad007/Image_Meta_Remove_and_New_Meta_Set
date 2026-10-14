import { describe, expect, it } from "vitest";
import { sniffImageBytes } from "../../lib/format-detection/signatures";
import { applyBinaryVerification, clearEntries, createEntries, removeEntry, sniffEntryHead } from "./queue-store";

function fakeFile(name: string, size: number, type: string): File {
  const bytes = new Uint8Array(size);
  return new File([bytes], name, { type });
}

describe("queue-store", () => {
  it("creates one entry per file without reading bytes", () => {
    const entries = createEntries([
      fakeFile("a.jpg", 10, "image/jpeg"),
      fakeFile("b.heic", 20, "image/heic"),
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.item.status).toBe("queued");
    expect(entries[0]?.source.name).toBe("a.jpg");
  });
  it("assigns unique ids across batches", () => {
    const first = createEntries([fakeFile("a.jpg", 1, "image/jpeg")]);
    const second = createEntries([fakeFile("a.jpg", 1, "image/jpeg")]);
    expect(first[0]?.item.id).not.toBe(second[0]?.item.id);
  });
  it("flags empty and unsupported files instead of crashing", () => {
    const entries = createEntries([
      fakeFile("empty.png", 0, "image/png"),
      fakeFile("notes.txt", 5, "text/plain"),
    ]);
    expect(entries[0]?.item.detected.isEmpty).toBe(true);
    expect(entries[1]?.item.detected.supportedForQueue).toBe(false);
    expect(entries[1]?.item.notice).toMatch(/review only/);
  });
  it("removes a single entry and clears the rest", () => {
    const entries = createEntries([
      fakeFile("a.jpg", 1, "image/jpeg"),
      fakeFile("b.mp4", 2, "video/mp4"),
    ]);
    const id = entries[0]?.item.id ?? "";
    const remaining = removeEntry(entries, id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.item.name).toBe("b.mp4");
    expect(clearEntries()).toHaveLength(0);
  });
  it("supports large batches without a count cap", () => {
    const files = Array.from(
      { length: 120 },
      (_, i) => fakeFile(`img-${i}.avif`, 100, "image/avif"),
    );
    expect(createEntries(files)).toHaveLength(120);
  });
  it("upgrades rows to byte-verified labels with mismatch notices", async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const [entry] = createEntries([new File([pngBytes], "photo.jpg", { type: "image/jpeg" })]);
    if (!entry) throw new Error("expected one entry");
    expect(entry.item.detected.label).toBe("JPEG");
    const sniff = await sniffEntryHead(entry.source);
    const upgraded = applyBinaryVerification([entry], entry.item.id, sniff);
    expect(upgraded[0]?.item.detected.label).toBe("PNG");
    expect(upgraded[0]?.item.detected.detectionMethod).toBe("binary-sniff");
    expect(upgraded[0]?.item.detected.binaryVerified).toBe(true);
    expect(upgraded[0]?.item.notice).toMatch(/bytes take precedence/i);
  });
  it("leaves other rows untouched when upgrading one id", () => {
    const entries = createEntries([
      fakeFile("a.jpg", 10, "image/jpeg"),
      fakeFile("b.jpg", 10, "image/jpeg"),
    ]);
    const head = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]);
    const sniff = sniffImageBytes(head, 10, "jpg");
    const upgraded = applyBinaryVerification(entries, entries[1]?.item.id ?? "", sniff);
    expect(upgraded[0]?.item.detected.binaryVerified).toBe(false);
    expect(upgraded[1]?.item.detected.binaryVerified).toBe(true);
  });
});
