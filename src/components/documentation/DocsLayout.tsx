import type { ReactNode } from "react";
import Link from "next/link";
import Header from "../layout/Header";
import Footer from "../layout/Footer";
import DocsNavigation from "./DocsNavigation";

export interface OnThisPageItem {
  id: string;
  title: string;
}

export default function DocsLayout({
  children,
  activeSlug,
  onThisPage = [],
}: {
  children: ReactNode;
  activeSlug?: string;
  onThisPage?: OnThisPageItem[];
}) {
  return (
    <>
      <Header active="docs" />
      <div className="min-h-[70vh] border-b border-[#e8edf4] bg-[#f7f9fc]">
        <div className="mx-auto grid max-w-7xl gap-5 px-4 py-5 sm:px-6 sm:py-7 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8 lg:px-8 xl:grid-cols-[15rem_minmax(0,1fr)_12rem]">
          <aside className="hidden min-w-0 lg:block" aria-label="Documentation navigation">
            <div className="sticky top-24">
              <Link href="/docs/" className="mb-4 inline-flex items-center gap-2 px-2 text-[13px] font-extrabold text-[#16244a] hover:text-[#2d5be9]">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#e6edff] text-[#2d5be9]" aria-hidden="true">
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 3.5A1.5 1.5 0 0 1 5.5 2H17v14H5.5A1.5 1.5 0 0 0 4 17.5v-14Z"/><path d="M4 17.5A1.5 1.5 0 0 1 5.5 16H17M7.5 5.5h6m-6 3h6"/></svg>
                </span>
                Help center
              </Link>
              <DocsNavigation activeSlug={activeSlug} />
            </div>
          </aside>

          <main className="min-w-0">
            <details className="mb-4 rounded-2xl border border-[#e4eaf3] bg-white p-3 lg:hidden" data-testid="docs-mobile-navigation">
              <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between px-1 text-sm font-bold text-[#16244a] [&::-webkit-details-marker]:hidden">
                Browse documentation
                <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 text-slate-500" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m5.5 7.5 4.5 4.5 4.5-4.5" /></svg>
              </summary>
              <div className="mt-3 border-t border-slate-100 pt-3">
                <DocsNavigation activeSlug={activeSlug} />
              </div>
            </details>
            {children}
          </main>

          <aside className="hidden min-w-0 xl:block" aria-label="On this page">
            {onThisPage.length > 0 ? (
              <div className="sticky top-24 rounded-2xl border border-[#e4eaf3] bg-white p-3.5">
                <h2 className="px-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#8793a8]">On this page</h2>
                <nav aria-label="On this page" className="mt-2 grid gap-1">
                  {onThisPage.map((item) => (
                    <a key={item.id} href={`#${item.id}`} className="rounded-md px-1.5 py-1.5 text-[12px] leading-4 text-[#596780] hover:bg-slate-50 hover:text-[#244bc8] focus-visible:outline-2 focus-visible:outline-[#2d5be9]">
                      {item.title}
                    </a>
                  ))}
                </nav>
              </div>
            ) : (
              <div className="sticky top-24 rounded-2xl border border-[#e4eaf3] bg-white p-4">
                <p className="text-xs font-bold text-[#16244a]">Need help finding a guide?</p>
                <p className="mt-1.5 text-xs leading-5 text-[#65728a]">Search the documentation topics in the navigation, or open Troubleshooting for common issues.</p>
                <Link href="/docs/troubleshooting/" className="mt-3 inline-flex text-xs font-bold text-[#2d5be9] underline-offset-2 hover:underline">Troubleshooting</Link>
              </div>
            )}
          </aside>
        </div>
      </div>
      <Footer />
    </>
  );
}
