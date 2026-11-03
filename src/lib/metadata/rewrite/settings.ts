import { PROFILE_FIELDS, type ProfileField } from "./fields";
import type { RewriteMode } from "./rewrite";

export const REWRITE_SETTINGS_KEY = "private-metadata-cleaner:rewrite-settings";
export const DEFAULT_REWRITE_MODE: RewriteMode = "replace_editable";
export const DEFAULT_REWRITE_FIELDS: readonly ProfileField[] = PROFILE_FIELDS;

export interface RewriteSettings {
  mode: RewriteMode;
  fields: readonly ProfileField[];
}

export function readRewriteSettings(): RewriteSettings {
  if (typeof window === "undefined") return { mode: DEFAULT_REWRITE_MODE, fields: DEFAULT_REWRITE_FIELDS };
  try {
    const raw = window.localStorage.getItem(REWRITE_SETTINGS_KEY);
    if (!raw) return { mode: DEFAULT_REWRITE_MODE, fields: DEFAULT_REWRITE_FIELDS };
    const parsed = JSON.parse(raw) as { mode?: unknown; fields?: unknown };
    const mode: RewriteMode = parsed.mode === "update_selected" ? "update_selected" : DEFAULT_REWRITE_MODE;
    const fields = Array.isArray(parsed.fields)
      ? parsed.fields.filter((field): field is ProfileField => typeof field === "string" && PROFILE_FIELDS.includes(field as ProfileField))
      : [];
    return { mode, fields: fields.length > 0 ? fields : DEFAULT_REWRITE_FIELDS };
  } catch {
    return { mode: DEFAULT_REWRITE_MODE, fields: DEFAULT_REWRITE_FIELDS };
  }
}

export function writeRewriteSettings(settings: RewriteSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(REWRITE_SETTINGS_KEY, JSON.stringify({ mode: settings.mode, fields: settings.fields }));
  } catch {
    // Settings are a convenience; an unavailable local store must not block
    // the browser-only cleaning and rewrite engines.
  }
}
