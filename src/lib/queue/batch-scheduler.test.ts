import { describe, expect, it, vi } from "vitest";
import { runBatchIds } from "./batch-scheduler";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("runBatchIds", () => {
  it("processes sequentially in order with honest progress", async () => {
    const order: string[] = [];
    const progress: Array<[number, number]> = [];
    const outcome = await runBatchIds({
      ids: ["a", "b", "c"],
      isActive: () => true,
      isEligible: () => true,
      process: async (id) => {
        order.push(id);
        return id.toUpperCase();
      },
      onDone: () => undefined,
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(order).toEqual(["a", "b", "c"]);
    expect(progress).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(outcome).toEqual({ processed: 3, cancelled: false });
  });
  it("never exceeds the concurrency bound even with slow files", async () => {
    let active = 0;
    let peak = 0;
    const gates = new Map<string, () => void>();
    const process = (id: string) => {
      active += 1;
      peak = Math.max(peak, active);
      const gate = deferred<string>();
      gates.set(id, () => {
        active -= 1;
        gate.resolve(id);
      });
      return gate.promise;
    };
    const run = runBatchIds({
      ids: ["a", "b", "c", "d"],
      isActive: () => true,
      isEligible: () => true,
      process,
      onDone: () => undefined,
      concurrency: 2,
    });
    // Release in waves; peak concurrency must stay ≤ 2.
    for (let wave = 0; wave < 4; wave += 1) {
      await new Promise((r) => setTimeout(r, 10));
      for (const release of [...gates.values()]) release();
      gates.clear();
    }
    await run;
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThanOrEqual(1);
  });
  it("clamps concurrency to a maximum of 2", async () => {
    let active = 0;
    let peak = 0;
    await runBatchIds({
      ids: ["a", "b", "c"],
      isActive: () => true,
      isEligible: () => true,
      process: async (id) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
        return id;
      },
      onDone: () => undefined,
      concurrency: 99,
    });
    expect(peak).toBeLessThanOrEqual(2);
  });
  it("stops scheduling after cancellation and reports it", async () => {
    let calls = 0;
    let live = true;
    const done: string[] = [];
    const outcome = await runBatchIds({
      ids: ["a", "b", "c", "d"],
      isActive: () => live,
      isEligible: () => true,
      process: async (id) => {
        calls += 1;
        if (id === "b") live = false;
        return id;
      },
      onDone: (id) => done.push(id),
    });
    expect(outcome.cancelled).toBe(true);
    expect(calls).toBeLessThan(4);
    expect(done.length).toBeLessThanOrEqual(calls);
  });
  it("skips ineligible ids without committing results", async () => {
    const done: string[] = [];
    const outcome = await runBatchIds({
      ids: ["gone", "here"],
      isActive: () => true,
      isEligible: (id) => id !== "gone",
      process: async (id) => id,
      onDone: (id) => done.push(id),
    });
    expect(done).toEqual(["here"]);
    expect(outcome).toEqual({ processed: 2, cancelled: false });
  });
  it("survives a throwing processor without breaking the batch", async () => {
    const done: string[] = [];
    const failed: string[] = [];
    const outcome = await runBatchIds({
      ids: ["boom", "fine"],
      isActive: () => true,
      isEligible: () => true,
      process: async (id) => {
        if (id === "boom") throw new Error("poison");
        return id;
      },
      onDone: (id) => done.push(id),
      onError: (id) => failed.push(id),
    });
    expect(done).toEqual(["fine"]);
    expect(failed).toEqual(["boom"]);
    expect(outcome.processed).toBe(2);
  });
  it("does not commit results after a mid-flight cancel", async () => {
    const gate = deferred<string>();
    let live = true;
    const done: string[] = [];
    const run = runBatchIds({
      ids: ["slow"],
      isActive: () => live,
      isEligible: () => live,
      process: () => gate.promise,
      onDone: (id) => done.push(id),
    });
    live = false;
    gate.resolve("slow");
    await run;
    expect(done).toHaveLength(0);
  });
  it("uses fake timers cleanly (sanity that progress is event-driven)", async () => {
    vi.useFakeTimers();
    try {
      const seen: number[] = [];
      const run = runBatchIds({
        ids: ["a"],
        isActive: () => true,
        isEligible: () => true,
        process: async () => "a",
        onDone: () => undefined,
        onProgress: (done) => seen.push(done),
      });
      await run;
      expect(seen).toEqual([1]);
    } finally {
      vi.useRealTimers();
    }
  });
});
