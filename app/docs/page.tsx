import type { Metadata } from "next";
import Link from "next/link";
import DocsLayout from "@/src/components/documentation/DocsLayout";
import { DOC_ARTICLES } from "@/src/content/guides/content";

const ORIGIN = "https://metacleaner.techpeakssolutions.com";

export const metadata: Metadata = {
  title: "Documentation",
  description: "Step-by-step guides for inspecting, cleaning, rewriting, and reporting metadata with Private Metadata Cleaner.",
  metadataBase: new URL(ORIGIN),
  alternates: { canonical: "/docs/" },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Private Metadata Cleaner documentation",
    description: "User guides, supported formats, privacy details, and troubleshooting.",
    url: "/docs/",
    type: "website",
  },
};

const FEATURED = ["quick-start", "supported-formats", "clean-metadata", "rewrite-metadata", "downloads-reports"];

export default function DocumentationHome() {
  const featured = FEATURED.map((slug) => DOC_ARTICLES.find((article) => article.slug === slug)).filter((item) => item !== undefined);
  const groups = Array.from(new Set(DOC_ARTICLES.filter((article) => article.indexable !== false).map((article) => article.category)))
    .map((category) => ({ category, articles: DOC_ARTICLES.filter((article) => article.category === category && article.indexable !== false) }));

  return (
    <DocsLayout>
      <div className="space-y-5">
        <section className="overflow-hidden rounded-[1.5rem] border border-[#dce5f6] bg-[radial-gradient(ellipse_at_top_right,_rgba(71,117,247,.15),_transparent_44%),linear-gradient(135deg,#ffffff_0%,#f6f8ff_100%)] px-5 py-6 shadow-[0_8px_30px_rgba(25,42,75,.04)] sm:px-8 sm:py-9">
          <div className="max-w-3xl">
            <p className="inline-flex rounded-full border border-[#d6e1fb] bg-white/80 px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.11em] text-[#3157d5]">Help center</p>
            <h1 className="mt-4 text-[2.25rem] font-extrabold leading-[1.08] tracking-[-0.045em] text-[#16244a] sm:text-[3rem]">Private Metadata Cleaner docs</h1>
            <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[#586780]">Follow practical guides for your files, from the first metadata check through a verified clean copy, rewrite, download, or report.</p>
            <div className="mt-5 flex flex-wrap gap-2.5">
              <Link href="/docs/quick-start/" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#2d5be9] px-4 text-sm font-extrabold text-white shadow-[0_8px_18px_rgba(45,91,233,.22)] hover:bg-[#244fda] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#2d5be9]">Start with Quick start</Link>
              <Link href="/docs/supported-formats/" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[#d9e1ee] bg-white px-4 text-sm font-bold text-[#30405f] hover:bg-slate-50 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#2d5be9]">Check file support</Link>
            </div>
          </div>
        </section>

        <section aria-labelledby="featured-guides-heading">
          <div className="flex flex-wrap items-end justify-between gap-2 px-1">
            <div><p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#2d5be9]">Popular guides</p><h2 id="featured-guides-heading" className="mt-1 text-lg font-extrabold text-[#16244a]">Choose a task</h2></div>
            <p className="text-xs text-[#71809a]">Search all guides from the navigation.</p>
          </div>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">{featured.map((article, index) => (
            <li key={article.slug}>
              <Link href={`/docs/${article.slug}/`} className="group flex h-full min-h-28 items-start gap-3 rounded-2xl border border-[#e4eaf3] bg-white p-4 shadow-[0_3px_12px_rgba(25,42,75,.025)] hover:-translate-y-0.5 hover:border-[#c5d3fa] hover:shadow-[0_10px_24px_rgba(25,42,75,.06)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#2d5be9] motion-safe:transition-all">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#eaf0ff] text-sm font-extrabold text-[#2d5be9]" aria-hidden="true">0{index + 1}</span>
                <span className="min-w-0"><span className="block text-sm font-extrabold text-[#16244a] group-hover:text-[#244bc8]">{article.title}</span><span className="mt-1.5 block text-[13px] leading-5 text-[#64718a]">{article.description}</span></span>
              </Link>
            </li>
          ))}</ul>
        </section>

        <section className="rounded-[1.5rem] border border-[#e4eaf3] bg-white p-4 sm:p-6" aria-labelledby="all-guides-heading">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#2d5be9]">Browse by topic</p><h2 id="all-guides-heading" className="mt-1 text-lg font-extrabold text-[#16244a]">All guides</h2></div><span className="rounded-full bg-[#f1f4fa] px-2.5 py-1 text-xs font-bold text-[#64718a]">{DOC_ARTICLES.filter((article) => article.indexable !== false).length} user guides</span></div>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">{groups.map((group) => (
            <section key={group.category} aria-label={group.category}>
              <h3 className="border-b border-[#edf1f6] pb-2 text-[11px] font-extrabold uppercase tracking-[0.1em] text-[#7b889e]">{group.category}</h3>
              <ul className="mt-2 grid gap-1">{group.articles.map((article) => (
                <li key={article.slug}><Link href={`/docs/${article.slug}/`} className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-[13px] font-semibold text-[#45546e] hover:bg-[#f5f7fc] hover:text-[#244bc8] focus-visible:outline-2 focus-visible:outline-[#2d5be9]"><span>{article.title}</span><span aria-hidden="true" className="text-slate-400">→</span></Link></li>
              ))}</ul>
            </section>
          ))}</div>
        </section>
        <p className="px-1 text-xs leading-5 text-[#7b879a]">Guides describe current verified behavior. If a structure or operation is unsupported, the app should show that limitation instead of claiming success.</p>
      </div>
    </DocsLayout>
  );
}
