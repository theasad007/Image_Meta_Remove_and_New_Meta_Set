import fs from "node:fs";
import path from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { createEntries } from "../../components/queue/queue-store";
import type { ImageInspectionResult } from "../../types/inspection";
import type { FileCleaningResult } from "../metadata/clean/types";
import { processBatchFile } from "./batch-pipeline";

const FIXTURES = path.join(__dirname, "..", "..", "test-fixtures");
const domParser = new DOMParser();

function fileOf(name: string): File {
  const full = fs.readFileSync(path.join(FIXTURES, name));
  return new File([full], name, { type: "application/octet-stream" });
}

function depsFor(files: File[]) {
  const created = createEntries(files);
  const inspections = new Map<string, ImageInspectionResult>();
  return {
    created,
    deps: {
      getEntry: (id: string) => created.find((e) => e.item.id === id),
      getInspection: (id: string) => inspections.get(id),
      setInspection: (id: string, result: ImageInspectionResult) => {
        inspections.set(id, result);
      },
      domParser,
    },
  };
}

describe("processBatchFile", () => {
  it("runs the full pipeline on a mixed five-format batch", async () => {
    const { created, deps } = depsFor([
      fileOf("jpeg-exif.jpg"),
      fileOf("png-text-exif.png"),
      fileOf("webp-exif-xmp.webp"),
      fileOf("avif-exif-xmp.avif"),
      fileOf("heic-exif-gps.heic"),
    ]);
    const outcomes = new Map<string, FileCleaningResult>();
    for (const entry of created) {
      outcomes.set(entry.item.id, await processBatchFile(entry.item.id, deps));
    }
    for (const [, result] of outcomes) {
      expect(result.status).toBe("verified_clean");
      expect(result.output).toBeDefined();
    }
  }, 120000);
  it("keeps per-file truth across rich/free/corrupt/spoof/animated/video/partial inputs", async () => {
    const ftyp = new Uint8Array(24);
    new DataView(ftyp.buffer).setUint32(0, 24);
    ftyp.set([0x66, 0x74, 0x79, 0x70], 4); // ftyp
    ftyp.set([0x69, 0x73, 0x6f, 0x6d], 8); // isom
    const { created, deps } = depsFor([
      fileOf("jpeg-xmp-iptc.jpg"),
      fileOf("jpeg-empty.jpg"),
      fileOf("jpeg-truncated.jpg"),
      fileOf("spoof-jpg-with-png-bytes.jpg"),
      fileOf("webp-animated.webp"),
      fileOf("jpeg-jumbf.jpg"),
    ]);
    const video = new File([ftyp], "clip.mp4", { type: "video/mp4" });
    const [videoEntry] = createEntries([video]);
    if (!videoEntry) throw new Error("expected video entry");
    const all = [...created, videoEntry];
    const byName = new Map(all.map((e) => [e.item.name, e.item.id]));
    const fullDeps = {
      ...deps,
      getEntry: (id: string) => all.find((e) => e.item.id === id),
    };
    const run = async (name: string) =>
      processBatchFile(byName.get(name) as string, fullDeps);
    expect((await run("jpeg-xmp-iptc.jpg")).status).toBe("verified_clean");
    expect((await run("jpeg-empty.jpg")).status).toBe("unchanged_no_target_tags");
    expect((await run("jpeg-truncated.jpg")).status).toBe("failed");
    expect((await run("spoof-jpg-with-png-bytes.jpg")).status).toBe("unchanged_no_target_tags");
    expect((await run("webp-animated.webp")).status).toBe("unsupported");
    expect((await run("jpeg-jumbf.jpg")).status).toBe("partially_cleaned");
    expect((await run("clip.mp4")).status).toBe("unsupported");
  }, 120000);
  it("declines oversized inputs via the byte budget without transforming", async () => {
    const { created, deps } = depsFor([fileOf("jpeg-exif.jpg")]);
    const id = created[0]?.item.id;
    if (!id) throw new Error("expected entry");
    const source = created[0]?.source;
    if (!source) throw new Error("expected source");
    let fullReads = 0;
    const originalArrayBuffer = source.arrayBuffer.bind(source);
    Object.defineProperty(source, "arrayBuffer", {
      configurable: true,
      value: async () => {
        fullReads += 1;
        return originalArrayBuffer();
      },
    });
    const result = await processBatchFile(id, {
      ...deps,
      maxBytes: 10,
    });
    expect(result.status).toBe("failed");
    expect(result.errors.join(" ")).toMatch(/budget/i);
    expect(result.output).toBeUndefined();
    expect(fullReads).toBe(0);
  });
  it("reuses cached inspections instead of re-reading", async () => {
    const { created, deps } = depsFor([fileOf("jpeg-exif.jpg")]);
    const id = created[0]?.item.id;
    if (!id) throw new Error("expected entry");
    const first = await processBatchFile(id, deps);
    expect(first.status).toBe("verified_clean");
    let inspected = 0;
    const second = await processBatchFile(id, {
      ...deps,
      setInspection: () => {
        inspected += 1;
      },
    });
    expect(second.status).toBe("verified_clean");
    expect(inspected).toBe(0);
  });
});
