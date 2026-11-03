import { describe, expect, it } from "vitest";
import {
  cleaningTargetsForAction,
  REMOVE_AI_METADATA_TARGETS,
  REMOVE_METADATA_TARGETS,
} from "./actions";

describe("workspace action mapping", () => {
  it("maps general removal to the existing EXIF/GPS and descriptive scopes", () => {
    expect(REMOVE_METADATA_TARGETS).toEqual(["exif_gps", "descriptive"]);
    expect(cleaningTargetsForAction("remove_metadata")).toEqual([
      "exif_gps",
      "descriptive",
    ]);
  });

  it("maps AI removal only to the existing AI marker scope", () => {
    expect(REMOVE_AI_METADATA_TARGETS).toEqual(["ai_markers"]);
    expect(cleaningTargetsForAction("remove_ai_metadata")).toEqual([
      "ai_markers",
    ]);
  });

  it("does not disguise rewrite as a cleaner action", () => {
    expect(cleaningTargetsForAction("remove_and_rewrite")).toBeNull();
  });
});
