/**
 * Cancellation tokens for async queue work (inspect/clean runs).
 *
 * A run captures `token()`; before committing any result it checks
 * `isCurrent(token)`. `cancel()` invalidates every outstanding run so stale
 * completions (removed files, cleared queue, user Cancel) are discarded
 * instead of being attached to the wrong row.
 */
export function createRunGuard(): {
  token: () => number;
  isCurrent: (token: number) => boolean;
  cancel: () => void;
} {
  let current = 0;
  return {
    token: () => {
      current += 1;
      return current;
    },
    isCurrent: (token: number) => token === current,
    cancel: () => {
      current += 1;
    },
  };
}
