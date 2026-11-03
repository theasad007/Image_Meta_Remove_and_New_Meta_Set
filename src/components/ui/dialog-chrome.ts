"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/**
 * Shared dialog chrome for the Screen 05 image-details dialog and the
 * Screen 06 edit-metadata dialog: portal focus trap, Escape (portal
 * tooltips consume Escape first), body scroll-lock with scrollbar-width
 * compensation, initial panel focus, and focus restoration to the
 * initiating control when it still exists.
 */

export const DIALOG_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** Tab-cycling handler for the dialog panel (attach via onKeyDown). */
export function useDialogFocusTrap(panelRef: RefObject<HTMLDivElement | null>): (event: ReactKeyboardEvent<HTMLDivElement>) => void {
  return useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = Array.from(panel.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR))
      .filter((focusable) => focusable.getClientRects().length > 0);
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const current = document.activeElement;
    if (event.shiftKey) {
      if (current === first) {
        last.focus();
        event.preventDefault();
      }
    } else if (current === last) {
      first.focus();
      event.preventDefault();
    } else if (!panel.contains(current)) {
      first.focus();
      event.preventDefault();
    }
  }, [panelRef]);
}

/** Escape + scroll lock + focus lifecycle. `openerSelector` may cover
 *  several rendered copies (desktop grid + mobile card); the visible one
 *  regains focus.
 *
 *  `onClose` and `openerSelector` are read through refs so the lifecycle
 *  effect depends only on `open`: re-renders (e.g. every keystroke in a
 *  dialog field) must never re-run the initial `panel.focus()` — that
 *  would steal focus from the element being typed in. */
export function useDialogChrome({
  open,
  onClose,
  panelRef,
  openerSelector,
}: {
  open: boolean;
  onClose: () => void;
  panelRef: RefObject<HTMLDivElement | null>;
  openerSelector: string | null;
}): void {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const openerSelectorRef = useRef(openerSelector);
  useEffect(() => {
    openerSelectorRef.current = openerSelector;
  }, [openerSelector]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousPadding = body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    panel?.focus({ preventScroll: true });

    const onDocumentKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // An open portal tooltip consumes Escape for itself; let it close first.
        if (document.querySelector('[role="tooltip"]')) return;
        event.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onDocumentKey);
    return () => {
      document.removeEventListener("keydown", onDocumentKey);
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPadding;
      const selector = openerSelectorRef.current;
      let opener: HTMLElement | null = null;
      if (selector) {
        opener = Array.from(document.querySelectorAll<HTMLElement>(selector))
          .find((candidate) => candidate.getClientRects().length > 0) ?? null;
      }
      (opener ?? previouslyFocused)?.focus?.();
    };
  }, [open, panelRef]);
}
