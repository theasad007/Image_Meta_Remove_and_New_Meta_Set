import type { QueueEntry } from "../../types/media";

/** Rewrite supports still images and MP3 audio; preview-only containers stay
 * in the queue so a mixed selection never blocks eligible files. */
export function partitionRewriteIds(
  entries: readonly QueueEntry[],
  ids: readonly string[],
): { eligibleIds: string[]; skippedIds: string[] } {
  const byId = new Map(entries.map((entry) => [entry.item.id, entry]));
  const eligibleIds: string[] = [];
  const skippedIds: string[] = [];
  for (const id of ids) {
    const kind = byId.get(id)?.item.detected.mediaKind;
    if (kind === "image" || kind === "audio") eligibleIds.push(id);
    else skippedIds.push(id);
  }
  return { eligibleIds, skippedIds };
}
