"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { DOC_ARTICLES, docSearchText } from "../../content/guides/content";

const CATEGORY_ORDER = [
  "Getting started",
  "Inspection",
  "Cleaning",
  "Rewriting",
  "Files and downloads",
  "Account and Premium",
  "Privacy and security",
  "Help",
];

export default function DocsNavigation({ activeSlug }: { activeSlug?: string }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return DOC_ARTICLES;
    return DOC_ARTICLES.filter((article) => docSearchText(article).includes(normalized));
  }, [query]);
  const grouped = useMemo(() => CATEGORY_ORDER.map((category) => ({
    category,
    articles: filtered.filter((article) => article.category === category),
  })).filter((group) => group.articles.length > 0), [filtered]);
  const searchId = useId();

  return (
    <div className="rounded-2xl border border-[#e4eaf3] bg-white p-3 shadow-[0_3px_12px_rgba(25,42,75,.035)] lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
      <label htmlFor={searchId} className="sr-only">Search documentation</label>
      <div className="relative">
        <svg aria-hidden="true" viewBox="0 0 20 20" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" />
        </svg>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search guides"
          autoComplete="off"
          className="min-h-10 w-full rounded-xl border border-[#dfe6f0] bg-white py-2 pl-9 pr-3 text-sm text-[#16244a] outline-none placeholder:text-slate-400 focus-visible:border-[#2d5be9] focus-visible:ring-2 focus-visible:ring-[#2d5be9]/20"
          data-testid="docs-search"
        />
      </div>
      <p className="sr-only" role="status" aria-live="polite" data-testid="docs-search-status">
        {query.trim() ? `${filtered.length} matching guides` : `${DOC_ARTICLES.length} guides`}
      </p>
      <nav aria-label="Documentation pages" className="mt-4 max-h-[calc(100vh-14rem)] space-y-5 overflow-y-auto pr-1">
        {grouped.map((group) => (
          <section key={group.category} aria-label={group.category}>
            <h2 className="px-2 text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#8793a8]">{group.category}</h2>
            <ul className="mt-1.5 grid gap-0.5">
              {group.articles.map((article) => {
                const active = activeSlug === article.slug;
                return (
                  <li key={article.slug}>
                    <Link
                      href={`/docs/${article.slug}/`}
                      aria-current={active ? "page" : undefined}
                      className={`block rounded-lg px-2.5 py-2 text-[13px] font-semibold leading-5 outline-offset-2 transition-colors focus-visible:outline-2 focus-visible:outline-[#2d5be9] ${active ? "bg-[#eaf0ff] text-[#244bc8]" : "text-[#4c5a73] hover:bg-white hover:text-[#16244a]"}`}
                    >
                      {article.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {filtered.length === 0 ? (
          <p className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-600" data-testid="docs-search-empty">
            No guides match that search. Try a file format or feature name.
          </p>
        ) : null}
      </nav>
    </div>
  );
}
