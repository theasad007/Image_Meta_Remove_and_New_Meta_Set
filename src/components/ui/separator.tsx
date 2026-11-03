import type { HTMLAttributes } from "react";
import { cn } from "../../lib/ui/cn";

/** Local shadcn/ui-style hairline separator. */
export default function Separator({
  className,
  orientation = "horizontal",
  ...props
}: HTMLAttributes<HTMLDivElement> & { orientation?: "horizontal" | "vertical" }) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        "bg-[#e6ecf4]",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
      {...props}
    />
  );
}
