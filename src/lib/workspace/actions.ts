import type { CleaningTarget } from "../metadata/clean/types";

export type WorkspaceTool = "ai_metadata" | "metadata_geotag";

export type WorkspaceAction =
  | "remove_metadata"
  | "remove_ai_metadata"
  | "remove_and_rewrite";

export const REMOVE_METADATA_TARGETS = [
  "exif_gps",
  "descriptive",
] as const satisfies readonly CleaningTarget[];

export const REMOVE_AI_METADATA_TARGETS = [
  "ai_markers",
] as const satisfies readonly CleaningTarget[];

/**
 * Presentation actions resolve to the existing cleaner targets. Rewrite has
 * no cleaning target and continues through the existing rewrite workflow.
 */
export function cleaningTargetsForAction(
  action: WorkspaceAction,
): readonly CleaningTarget[] | null {
  if (action === "remove_metadata") return REMOVE_METADATA_TARGETS;
  if (action === "remove_ai_metadata") return REMOVE_AI_METADATA_TARGETS;
  return null;
}
