"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const ARROW_GAP = 8;
const EDGE_MARGIN = 8;
const MAX_WIDTH = 260;
const MAX_HEIGHT = 400;

/**
 * shadcn/ui-style portal tooltip. Renders into `document.body` through a
 * Portal, positions itself against the trigger with collision-aware
 * flipping/clamping, and closes on Escape, pointer leave, focus loss,
 * scroll and resize. Because the overlay is painted at the document root,
 * it is never trapped by `overflow: hidden` ancestors, table masks or
 * stacking contexts — in-ancestor z-index boosts cannot solve that.
 *
 * Tooltips carry supplementary hints only; every actionable control keeps
 * a visible label or accessible name, so no information is hover-only.
 * Nothing renders until open, so the static export prerender and hydration
 * are unaffected, and the overlay never shifts layout.
 */
export default function Tooltip({
  label,
  children,
  testId = "portal-tooltip",
  zClass = "z-[80]",
}: {
  label: string;
  children: ReactNode;
  testId?: string;
  /** Stacking override for tooltips rendered above the image-details dialog. */
  zClass?: string;
}) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [measured, setMeasured] = useState(false);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(MAX_WIDTH, tooltipRef.current?.offsetWidth ?? MAX_WIDTH);
    const height = Math.min(MAX_HEIGHT, tooltipRef.current?.offsetHeight ?? 40);
    let top = rect.top - height - ARROW_GAP;
    if (top < EDGE_MARGIN) top = rect.bottom + ARROW_GAP;
    if (top + height > window.innerHeight - EDGE_MARGIN) top = Math.max(EDGE_MARGIN, window.innerHeight - height - EDGE_MARGIN);
    let left = rect.left + (rect.width - width) / 2;
    left = Math.min(Math.max(left, EDGE_MARGIN), window.innerWidth - width - EDGE_MARGIN);
    setPos({ top: Math.round(top + window.scrollY), left: Math.round(left + window.scrollX) });
    setMeasured(true);
  }, []);

  const openTip = useCallback(() => {
    setMeasured(false);
    setOpen(true);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onScrollOrResize = () => close();
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, close]);

  return (
    <span
      ref={triggerRef}
      onMouseEnter={openTip}
      onMouseLeave={close}
      onFocus={openTip}
      onBlur={close}
      className="group relative inline-flex min-w-0"
    >
      {children}
      {open ? createPortal(
        <div
          ref={tooltipRef}
          role="tooltip"
          data-testid={testId}
          aria-hidden={false}
          style={{
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            maxWidth: MAX_WIDTH,
            visibility: measured ? "visible" : "hidden",
          }}
          className={`pointer-events-none absolute ${zClass} w-max max-w-[16.25rem] rounded-lg bg-slate-950 px-3 py-2 text-[11px] font-medium leading-4 text-white shadow-[0_12px_28px_rgba(15,23,42,.3)] break-words`}
        >
          {label}
        </div>,
        document.body,
      ) : null}
    </span>
  );
}
