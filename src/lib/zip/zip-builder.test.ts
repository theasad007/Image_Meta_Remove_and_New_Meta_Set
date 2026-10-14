import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { buildZipArchive, ZipBuildError, ZipCancelled } from "./zip-builder";

function textData(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("buildZipArchive", () => {
  it("round-trips entries with byte identity and valid CRCs", async () => {
    const sources = [
      { path: "images/a-clean.jpg", data: textData("fake-jpeg-bytes-1") },
      { path: "images/b-clean.png", data: new Blob([textData("fake-png-bytes-2").buffer as ArrayBuffer]) },
    ];
    const progress: Array<[number, number]> = [];
    const bytes = await buildZipArchive(sources, {
      onProgress: (p) => progress.push([p.filesDone, p.filesTotal]),
    });
    expect(bytes.length).toBeGreaterThan(0);
    const extracted = unzipSync(bytes);
    expect(Object.keys(extracted).sort()).toEqual(["images/a-clean.jpg", "images/b-clean.png"]);
    expect(Buffer.from(extracted["images/a-clean.jpg"] as Uint8Array).toString()).toBe("fake-jpeg-bytes-1");
    expect(Buffer.from(extracted["images/b-clean.png"] as Uint8Array).toString()).toBe("fake-png-bytes-2");
    expect(progress[progress.length - 1]).toEqual([2, 2]);
  });
  it("stores without recompression (STORE) and handles empty files", async () => {
    const payload = textData("x".repeat(10000));
    const bytes = await buildZipArchive([{ path: "images/big-clean.jpg", data: payload }]);
    // STORE must not shrink already-compressed-style data below raw size.
    expect(bytes.length).toBeGreaterThanOrEqual(payload.length);
    const empty = await buildZipArchive([{ path: "images/empty-clean.jpg", data: new Uint8Array(0) }]);
    expect(Object.keys(unzipSync(empty))).toEqual(["images/empty-clean.jpg"]);
  });
  it("fails loudly on empty input, never a fake ready", async () => {
    await expect(buildZipArchive([])).rejects.toBeInstanceOf(ZipBuildError);
  });
  it("cancels mid-build and discards partial output", async () => {
    const sources = Array.from({ length: 6 }, (_, i) => ({
      path: `images/f-${i}-clean.jpg`,
      data: textData(`payload-${i}-`.repeat(20000)),
    }));
    let calls = 0;
    await expect(buildZipArchive(sources, {
      isCancelled: () => {
        calls += 1;
        return calls > 2;
      },
    })).rejects.toBeInstanceOf(ZipCancelled);
  });
  it("streams to a File System Access-style sink in order", async () => {
    const written: Uint8Array[] = [];
    let closed = false;
    const sources = [
      { path: "images/a-clean.jpg", data: textData("aaa") },
      { path: "images/b-clean.jpg", data: textData("bbb") },
    ];
    const bytes = await buildZipArchive(sources, {
      sink: {
        write: async (chunk) => {
          written.push(chunk);
        },
        close: async () => {
          closed = true;
        },
      },
    });
    expect(bytes.length).toBe(0);
    expect(closed).toBe(true);
    const total = written.reduce((sum, chunk) => sum + chunk.length, 0);
    const joined = new Uint8Array(total);
    let cursor = 0;
    for (const chunk of written) {
      joined.set(chunk, cursor);
      cursor += chunk.length;
    }
    const extracted = unzipSync(joined);
    expect(Object.keys(extracted).sort()).toEqual(["images/a-clean.jpg", "images/b-clean.jpg"]);
  });
  it("surfaces sink failures as failed, never ready", async () => {
    await expect(buildZipArchive([{ path: "images/a-clean.jpg", data: textData("x") }], {
      sink: {
        write: async () => {
          throw new Error("disk gone");
        },
        close: async () => undefined,
      },
    })).rejects.toBeInstanceOf(ZipBuildError);
  });
});
