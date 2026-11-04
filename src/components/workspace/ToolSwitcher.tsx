"use client";

import { useRef, type KeyboardEvent } from "react";
import type { WorkspaceTool } from "../../lib/workspace/actions";
import { cn } from "../../lib/cn";

const TOOLS: Array<{
  value: WorkspaceTool;
  label: string;
  short: string;
  description: string;
  note: string;
}> = [
  {
    value: "ai_metadata",
    label: "AI Metadata Detector & Remover",
    short: "AI Metadata",
    description: "Inspect declared AI-related metadata and remove supported evidence with verification.",
    note: "Metadata evidence only — not visual AI detection.",
  },
  {
    value: "metadata_geotag",
    label: "Metadata & GeoTag Manager",
    short: "Metadata & GeoTag",
    description: "Review EXIF, GPS, XMP and IPTC; remove metadata or edit supported image fields and GPS coordinates.",
    note: "For a still image, open Edit → Location (GPS) to add, update or remove coordinates.",
  },
];

function ToolIcon({ tool }: { tool: WorkspaceTool }) {
  if (tool === "ai_metadata") {
    return (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden="true">
        <path d="M9.4 4c.4-1.15 2-1.15 2.4 0l1.1 3.6a4.2 4.2 0 0 0 2.8 2.8l3.6 1.1c1.15.4 1.15 2 0 2.4l-3.6 1.1a4.2 4.2 0 0 0-2.8 2.8l-1.1 3.6c-.4 1.15-2 1.15-2.4 0l-1.1-3.6a4.2 4.2 0 0 0-2.8-2.8l-3.6-1.1c-1.15-.4-1.15-2 0-2.4l3.6-1.1a4.2 4.2 0 0 0 2.8-2.8L9.4 4Z" />
        <circle cx="19.4" cy="4.9" r="1.8" />
        <circle cx="20.7" cy="17.4" r="1.35" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s-6.7-5.4-6.7-10.2a6.7 6.7 0 0 1 13.4 0C18.7 15.6 12 21 12 21Z" />
      <circle cx="12" cy="10.6" r="2.5" />
    </svg>
  );
}

/**
 * Screen 01 tool selection. Two large radio-style cards bound to the
 * existing `WorkspaceTool` state. Honest capability notes are kept in
 * the description (metadata evidence ≠ visual AI detection; GPS coordinate
 * editing lives in the image editor) per the product's no-fake-claims rule.
 *
 * Screen 04 reuses the same state, testids and keyboard behavior in a
 * `compact` variant: two horizontally aligned cards with the
 * "Local-only processing" badge to the right, matching the approved
 * after-upload reference. The full variant (Screen 01) is unchanged.
 */
export default function ToolSwitcher({
  activeTool,
  onChange,
  variant = "full",
}: {
  activeTool: WorkspaceTool;
  onChange: (tool: WorkspaceTool) => void;
  variant?: "full" | "compact";
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  const handleKeys = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? TOOLS.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + TOOLS.length) % TOOLS.length;
    const next = TOOLS[nextIndex];
    if (!next) return;
    onChange(next.value);
    buttons.current[nextIndex]?.focus();
  };

  if (variant === "compact") {
    return (
      <section id="tools" aria-labelledby="tool-switcher-heading" className="scroll-mt-24">
        <h2 id="tool-switcher-heading" className="sr-only">Choose a metadata tool</h2>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
          <div role="tablist" aria-label="Metadata tools" className="grid min-w-0 flex-1 gap-3.5 sm:grid-cols-2">
            {TOOLS.map((tool, index) => {
              const selected = activeTool === tool.value;
              return (
                <button
                  key={tool.value}
                  ref={(node) => { buttons.current[index] = node; }}
                  id={`tool-tab-${tool.value}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls="workspace-panel"
                  tabIndex={selected ? 0 : -1}
                  data-testid={`tool-${tool.value}`}
                  onClick={() => onChange(tool.value)}
                  onKeyDown={(event) => handleKeys(event, index)}
                  className={cn(
                    "group flex min-w-0 items-center gap-3.5 rounded-[1.1rem] border p-4 text-left outline-offset-2 motion-safe:transition-colors",
                    selected
                      ? "border-[#5d7ef0] bg-[#f4f7ff] shadow-[0_10px_28px_rgba(45,91,233,.10)]"
                      : "border-[#e6eaf2] bg-white hover:border-slate-300 hover:bg-slate-50/60",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-12 w-12 shrink-0 items-center justify-center rounded-[0.9rem]",
                      tool.value === "ai_metadata" ? "bg-[#e4ecfd] text-[#2d5be9]" : "bg-[#e2f7ef] text-[#0f9a68]",
                    )}
                    aria-hidden="true"
                  >
                    <ToolIcon tool={tool.value} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px] font-extrabold tracking-[-0.01em] text-[#16244a]">{tool.short}</span>
                    <span className="mt-1 block text-[12.5px] leading-[1.5] text-[#5a6b85]">{tool.description}</span>
                    <span className="sr-only">{tool.label}. {tool.note}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <span className="inline-flex shrink-0 items-center justify-center gap-1.5 self-start rounded-full bg-[#e4f6ec] px-3.5 py-2 text-[12.5px] font-bold text-[#0a7a58] shadow-[0_2px_8px_rgba(16,140,100,.08)] xl:self-auto">
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none">
              <rect x="4" y="8.3" width="12" height="8.7" rx="2" stroke="currentColor" strokeWidth="1.7" />
              <path d="M6.7 8V6.5a3.3 3.3 0 0 1 6.6 0V8" stroke="currentColor" strokeLinecap="round" />
            </svg>
            Local-only processing
          </span>
        </div>
      </section>
    );
  }

  return (
    <section id="tools" aria-labelledby="tool-switcher-heading" className="scroll-mt-24">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:gap-8">
        <div className="min-w-0 shrink-0 lg:max-w-[20rem]">
          <p className="section-kicker">Choose a tool</p>
          <h2 id="tool-switcher-heading" className="mt-2 text-[1.7rem] font-extrabold tracking-[-0.03em] text-[#111c3c]">
            One private workspace
          </h2>
          <p className="mt-2 text-[13.5px] leading-6 text-[#5a6b85]">
            Switching tools keeps every file, selection and result in the same workspace.
          </p>
        </div>

        <div role="tablist" aria-label="Metadata tools" className="grid min-w-0 flex-1 gap-4 sm:grid-cols-2">
          {TOOLS.map((tool, index) => {
            const selected = activeTool === tool.value;
            return (
              <button
                key={tool.value}
                ref={(node) => { buttons.current[index] = node; }}
                id={`tool-tab-${tool.value}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="workspace-panel"
                tabIndex={selected ? 0 : -1}
                data-testid={`tool-${tool.value}`}
                onClick={() => onChange(tool.value)}
                onKeyDown={(event) => handleKeys(event, index)}
                className={cn(
                  "group flex min-w-0 items-start gap-3.5 rounded-[1.15rem] border p-4 text-left outline-offset-2 motion-safe:transition-colors",
                  selected
                    ? "border-[#5d7ef0] bg-[#f2f6ff] shadow-[0_10px_28px_rgba(45,91,233,.10)]"
                    : "border-[#e6eaf2] bg-white hover:border-slate-300 hover:bg-slate-50/60",
                )}
              >
                <span
                  className={cn(
                    "flex h-[3.4rem] w-[3.4rem] shrink-0 items-center justify-center rounded-[0.95rem]",
                    tool.value === "ai_metadata" ? "bg-[#e4ecfd] text-[#2d5be9]" : "bg-[#e2f7ef] text-[#0f9a68]",
                  )}
                  aria-hidden="true"
                >
                  <ToolIcon tool={tool.value} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[16.5px] font-extrabold tracking-[-0.01em] text-[#16244a]">{tool.short}</span>
                  <span className="mt-1.5 block text-[13px] leading-[1.55] text-[#5a6b85]">{tool.description}</span>
                  <span className="mt-1.5 block text-[12px] leading-[1.5] font-medium text-[#7484a0]">{tool.note}</span>
                  <span className="sr-only">{tool.label}</span>
                </span>
                <span
                  className={cn(
                    "mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-white shadow-sm motion-safe:transition-colors",
                    selected ? "border-[#d9e2fb] text-[#2d5be9]" : "border-slate-200 text-slate-400",
                  )}
                  aria-hidden="true"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5" />
                  </svg>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
