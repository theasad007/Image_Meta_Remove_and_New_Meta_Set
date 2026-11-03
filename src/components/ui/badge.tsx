import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type Variant = "blue" | "green" | "purple" | "neutral";

const VARIANTS: Record<Variant, string> = {
  blue: "bg-[#e9f2fe] text-[#2d5be9]",
  green: "bg-[#e1f5ea] text-[#128a56]",
  purple: "bg-[#f3eefe] text-[#7d2be0]",
  neutral: "bg-slate-100 text-slate-700",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
}

/**
 * shadcn/ui-style local Badge (soft "chip" styling used across Screen 01).
 */
export function Badge({ className, variant = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}
