import fs from "node:fs";
import path from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { createEntries } from "../../components/queue/queue-store";
import type { ImageInspectionResult } from "../../types/inspection";
import type { FileCleaningResult } from "../metadata/clean/types";
import { processBatchFile } from "./batch-pipeline";

/**
 * Scale evidence with genuine metadata-bearing fixtures (no mocks).
 * Full pipeline (sniff→inspect→clean→verify) for 1–100; clean+verify with a
 * shared cached inspection for 500/1000 to keep the suite time-bounded while
 * still executing real binary work per file. Timings are printed for the log.
 */
const FIXTURES = path.join(__dirname, "..", "..", "test-fixtures");
const domParser = new DOMParser();

function fileOf(name: string, alias?: string): File {
  const full = fs.readFileSync(path.join(FIXTURES, name));
  return new File([full], alias ?? `${Date.now()}-${Math.random()}-${name}`, {
    type: "application/octet-stream",
  });
}

async function runBatch(
  names: string[],
  cachedBefore?: ImageInspectionResult,
): Promise<{ results: FileCleaningResult[]; elapsedMs: number }> {
  const files = names.map((name, index) => fileOf(name.split(":")[0] as string, `batch-${index}-${name.split(":")[0]}`));
  const created = createEntries(files);
  const inspections = new Map<string, ImageInspectionResult>();
  if (cachedBefore) {
    for (const entry of created) inspections.set(entry.item.id, cachedBefore);
  }
  const deps = {
    getEntry: (id: string) => created.find((e) => e.item.id === id),
    getInspection: (id: string) => inspections.get(id),
    setInspection: (id: string, result: ImageInspectionResult) => {
      inspections.set(id, result);
    },
    domParser,
  };
  const started = Date.now();
  const results: FileCleaningResult[] = [];
  for (const entry of created) {
    results.push(await processBatchFile(entry.item.id, deps));
  }
  return { results, elapsedMs: Date.now() - started };
}

function mix(count: number): string[] {
  const formats = ["jpeg-exif.jpg", "png-text-exif.png", "webp-exif-xmp.webp", "avif-exif-xmp.avif", "heic-exif-gps.heic"];
  return Array.from({ length: count }, (_, i) => formats[i % formats.length] as string);
}

describe("batch scale (real files, real verification)", () => {
  it("cleans 1 file", async () => {
    const { results, elapsedMs } = await runBatch(["jpeg-exif.jpg"]);
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("verified_clean");
    process.stderr.write(`scale/1: ${elapsedMs}ms\n`);
  });
  it("cleans 20 mixed files", async () => {
    const { results, elapsedMs } = await runBatch(mix(20));
    expect(results).toHaveLength(20);
    expect(results.every((r) => r.status === "verified_clean")).toBe(true);
    process.stderr.write(`scale/20: ${elapsedMs}ms\n`);
  }, 180000);
  it("cleans 50 mixed files", async () => {
    const { results, elapsedMs } = await runBatch(mix(50));
    expect(results).toHaveLength(50);
    expect(results.every((r) => r.status === "verified_clean")).toBe(true);
    process.stderr.write(`scale/50: ${elapsedMs}ms\n`);
  }, 300000);
  it("cleans 100 mixed files", async () => {
    const { results, elapsedMs } = await runBatch(mix(100));
    expect(results).toHaveLength(100);
    expect(results.every((r) => r.status === "verified_clean")).toBe(true);
    process.stderr.write(`scale/100: ${elapsedMs}ms\n`);
  }, 300000);
  it("cleans 500 files (cached inspection, full clean+verify each)", async () => {
    const seed = await runBatch(["jpeg-exif.jpg"]);
    const cached = seed.results[0]?.before;
    if (!cached) throw new Error("expected seed inspection");
    const { results, elapsedMs } = await runBatch(mix(500), cached);
    expect(results).toHaveLength(500);
    expect(results.every((r) => r.status === "verified_clean")).toBe(true);
    process.stderr.write(`scale/500: ${elapsedMs}ms\n`);
  }, 300000);
  it("cleans 1000+ files (cached inspection, full clean+verify each)", async () => {
    const seed = await runBatch(["jpeg-exif.jpg"]);
    const cached = seed.results[0]?.before;
    if (!cached) throw new Error("expected seed inspection");
    const { results, elapsedMs } = await runBatch(mix(1000), cached);
    expect(results).toHaveLength(1000);
    expect(results.every((r) => r.status === "verified_clean")).toBe(true);
    process.stderr.write(`scale/1000: ${elapsedMs}ms\n`);
  }, 300000);
});
