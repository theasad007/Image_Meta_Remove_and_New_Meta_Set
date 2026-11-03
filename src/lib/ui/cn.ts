/**
 * Tiny class joiner for the local shadcn/ui-style components
 * (project intentionally avoids extra runtime dependencies).
 */
export function cn(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter(Boolean).join(" ");
}
