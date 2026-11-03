import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type Variant = "default" | "secondary" | "ghost" | "link";
type Size = "default" | "sm" | "lg" | "icon";

const VARIANTS: Record<Variant, string> = {
  // "default" follows the device-free brand blue used by Screen 01.
  default:
    "bg-[#2d5be9] text-white shadow-[0_10px_24px_rgba(45,91,233,.28)] hover:bg-[#1f4ad6] focus-visible:outline-[#2d5be9]",
  secondary:
    "border border-slate-200 bg-white text-slate-800 shadow-sm hover:bg-slate-50 hover:text-slate-950",
  ghost: "text-slate-700 hover:bg-slate-100 hover:text-slate-950",
  link: "text-[#2d5be9] underline decoration-blue-300 underline-offset-4 hover:text-[#1f4ad6]",
};

const SIZES: Record<Size, string> = {
  default: "h-11 px-5 text-sm",
  sm: "h-9 rounded-full px-4 text-[13px]",
  lg: "h-12 px-6 text-[15px]",
  icon: "h-10 w-10 p-0",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

/**
 * shadcn/ui-style local Button. Vendored component code (no Radix/CLI
 * runtime dependency), tokens adapted to this project's palette so the
 * existing theme is not overwritten.
 */
export function Button({ className, variant = "default", size = "default", type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold outline-offset-2 focus-visible:outline-3 disabled:pointer-events-none disabled:opacity-50 motion-safe:transition-colors",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}
