/**
 * Bounded batch scheduler (Phase 4).
 *
 * Sequential by default (concurrency 1); at most 2 workers when explicitly
 * requested. Never `Promise.all` over the whole queue: each file is
 * processed, committed (or discarded when stale), and released before the
 * next begins. Cancellation tokens refuse stale commits. Progress counts
 * come from completed work only.
 */

export interface BatchRunOptions<T> {
  ids: string[];
  /** Return false to stop scheduling further files. */
  isActive: () => boolean;
  /** True while a given id is still eligible for result commits. */
  isEligible: (id: string) => boolean;
  process: (id: string) => Promise<T>;
  onDone: (id: string, result: T) => void;
  /** Unexpected processor exceptions become explicit per-file failures. */
  onError?: (id: string, error: unknown) => void;
  onProgress?: (done: number, total: number) => void;
  /** 1 (default) or 2. Anything else is clamped. */
  concurrency?: number;
}

export interface BatchRunOutcome {
  processed: number;
  cancelled: boolean;
}

export async function runBatchIds<T>(options: BatchRunOptions<T>): Promise<BatchRunOutcome> {
  const { ids, isActive, isEligible, process, onDone, onProgress } = options;
  const concurrency = Math.max(1, Math.min(2, options.concurrency ?? 1));
  let processed = 0;
  let cancelled = false;
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      if (!isActive()) {
        cancelled = true;
        return;
      }
      const index = cursor;
      cursor += 1;
      if (index >= ids.length) return;
      const id = ids[index] as string;
      if (!isEligible(id)) {
        processed += 1;
        onProgress?.(processed, ids.length);
        continue;
      }
      let result: T;
      try {
        result = await process(id);
      } catch (error) {
        // process fns should not throw (engines return results), but a
        // throwing processor must never break the batch or disappear.
        options.onError?.(id, error);
        processed += 1;
        onProgress?.(processed, ids.length);
        continue;
      }
      if (isActive() && isEligible(id)) {
        onDone(id, result);
      }
      processed += 1;
      onProgress?.(processed, ids.length);
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, ids.length); i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
  if (!isActive()) cancelled = true;
  return { processed, cancelled };
}
