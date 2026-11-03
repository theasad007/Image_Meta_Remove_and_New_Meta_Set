import { describe, expect, it } from "vitest";
import { partitionRewriteIds } from "./rewrite-eligibility";
import type { QueueEntry } from "../../types/media";

function entry(id: string, mediaKind: "image" | "audio" | "video"): QueueEntry {
  return {
    item: {
      id,
      name: `${id}.bin`,
      sanitizedName: `${id}.bin`,
      sizeBytes: 1,
      detected: {
        mediaKind,
        extension: "bin",
        mimeHint: "",
        label: mediaKind,
        supportedForQueue: true,
        detectionMethod: "extension-hint",
        binaryVerified: false,
        isEmpty: false,
        note: "",
      },
      status: "queued",
      addedAt: 0,
    },
    source: new File([new Uint8Array([0])], `${id}.bin`),
  };
}

describe("partitionRewriteIds", () => {
  it("keeps images and MP3 audio while skipping video", () => {
    expect(partitionRewriteIds([entry("image", "image"), entry("audio", "audio"), entry("video", "video")], ["image", "video", "audio"]))
      .toEqual({ eligibleIds: ["image", "audio"], skippedIds: ["video"] });
  });
});
