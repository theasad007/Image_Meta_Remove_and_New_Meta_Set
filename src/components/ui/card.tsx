import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

/**
 * shadcn/ui-style local Card family. Vendored component code adapted to
 * the Screen-01 palette (hairline `--line` border, soft layered shadow).
 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[1.25rem] border border-[#e3e9f2] bg-white text-[#14213d] shadow-[0_1px_2px_rgba(15,23,42,.04),0_16px_40px_-18px_rgba(39,55,91,.14)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 p-5", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-[15px] font-extrabold tracking-[-0.01em] text-[#16244a]", className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-[13px] leading-6 text-[#5a6b85]", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5 pt-0", className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center p-5 pt-0", className)} {...props} />;
}
