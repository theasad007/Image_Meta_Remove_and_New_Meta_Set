"use client";

import BenefitStrip from "../home/BenefitStrip";
import FormatsPanel from "../panels/FormatsPanel";
import FuturePanel from "../panels/FuturePanel";
import WhyCleanPanel from "../panels/WhyCleanPanel";
import Hero from "../layout/Hero";
import ToolSwitcher from "./ToolSwitcher";
import UploadPanel from "../upload/UploadPanel";
import type { WorkspaceTool } from "../../lib/workspace/actions";

/**
 * Screen 01 — the approved, LOCKED before-upload homepage. The JSX mirrors
 * the previously approved `app/page.tsx` structure one-for-one so the
 * empty-queue render is visually identical: hero, tool switcher, uploader,
 * benefit strip and the SEO sections. This component renders only while
 * the queue is empty; the first added file switches `/` to the Screen 04
 * workspace (AfterUploadWorkspace), and clearing the queue returns here.
 */
export default function BeforeUploadHome({
  activeTool,
  onToolChange,
  onFiles,
  rewriteProgress,
}: {
  activeTool: WorkspaceTool;
  onToolChange: (tool: WorkspaceTool) => void;
  onFiles: (files: File[]) => void;
  rewriteProgress: string | null;
}) {
  return (
    <>
      <Hero />
      <div className="mx-auto max-w-7xl scroll-mt-24 px-4 sm:px-6 lg:px-8">
        <section
          id="workspace-panel"
          aria-labelledby="tool-switcher-heading"
          className="surface-card rounded-[1.75rem] p-4 sm:p-7 lg:p-8"
        >
          <ToolSwitcher
            activeTool={activeTool}
            onChange={onToolChange}
          />
          <UploadPanel onFiles={onFiles} />
          {rewriteProgress ? <p role="status" className="mt-3 rounded-xl bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-900">{rewriteProgress}</p> : null}
        </section>
      </div>
      <div className="mx-auto mt-4 max-w-7xl px-4 sm:px-6 lg:px-8">
        <BenefitStrip />
      </div>
      <WhyCleanPanel />
      <div id="formats" className="mx-auto max-w-7xl scroll-mt-24 px-4 sm:px-6 lg:px-8">
        <FormatsPanel />
      </div>
      <div id="privacy" className="mx-auto max-w-7xl scroll-mt-24 px-4 sm:px-6 lg:px-8">
        <FuturePanel />
      </div>
    </>
  );
}
