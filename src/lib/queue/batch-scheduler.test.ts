import { describe, expect, it, vi } from "vitest";
import { mapWithConcurrency, runBatchIds } from "./batch-scheduler";

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

describe("mapWithConcurrency", () => {
  it("bounds in-flight intake work and preserves input order", async () => {
    let active = 0;
    let peak = 0;
    const values = await mapWithConcurrency([0, 1, 2, 3, 4, 5], 3, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, value % 2 === 0 ? 2 : 1));
      active -= 1;
      return value * 2;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(values).toEqual([0, 2, 4, 6, 8, 10]);
  });

  it("does not impose a file-count cap", async () => {
    const values = await mapWithConcurrency(Array.from({ length: 1200 }, (_, index) => index), 8, async (value) => value);
    expect(values).toHaveLength(1200);
    expect(values[1199]).toBe(1199);
  });

  it("stops scheduling new intake work after cancellation", async () => {
    let active = true;
    let calls = 0;
    const values = await mapWithConcurrency(Array.from({ length: 100 }, (_, index) => index), 4, async (value) => {
      calls += 1;
      if (value === 3) active = false;
      await new Promise((resolve) => setTimeout(resolve, 1));
      return value;
    }, () => active);
    expect(calls).toBeLessThan(100);
    expect(values.filter((value) => value !== undefined)).toHaveLength(calls);
  });
});
