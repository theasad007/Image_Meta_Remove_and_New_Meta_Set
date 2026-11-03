/**
 * Tiny class-name joiner for the vendored shadcn/ui-style primitives in
 * `src/components/ui/`. The upstream shadcn helper pulls in `clsx` +
 * `tailwind-merge`; to honor the "no unnecessary dependencies" rule for a
 * static-export build this local version filters falsy values and joins.
 * It covers every usage in this codebase — variant objects are written as
 * plain literals, never merged dynamically.
 */
export type ClassValue = string | number | false | null | undefined;

export function cn(...values: ClassValue[]): string {
  let out = "";
  for (const value of values) {
    if (!value) continue;
    if (out) out += " ";
    out += String(value);
  }
  return out;
}
