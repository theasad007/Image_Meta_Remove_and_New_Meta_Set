import Image from "next/image";
import Link from "next/link";
import type { DocArticle, DocBlock } from "../../content/guides/content";
import { DOC_ARTICLES } from "../../content/guides/content";

function RenderBlock({ block }: { block: DocBlock }) {
  if (block.type === "paragraph") {
    return <p className="mt-3 text-[15px] leading-7 text-[#465570]">{block.text}</p>;
  }
  if (block.type === "list") {
    return <ul className="mt-3 grid list-disc gap-2 pl-5 text-[14px] leading-6 text-[#465570] marker:text-[#2d5be9]">{block.items.map((item, index) => <li key={index}>{item}</li>)}</ul>;
  }
  if (block.type === "steps") {
    return <ol className="mt-4 grid gap-3">{block.items.map((item, index) => (
      <li key={item.title} className="flex gap-3 rounded-2xl border border-[#e8edf4] bg-white p-3.5 sm:p-4">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#eaf0ff] text-xs font-extrabold text-[#244bc8]" aria-hidden="true">{index + 1}</span>
        <div className="min-w-0"><h3 className="text-sm font-extrabold text-[#16244a]">{item.title}</h3><p className="mt-1 text-[14px] leading-6 text-[#596780]">{item.text}</p></div>
      </li>
    ))}</ol>;
  }
  if (block.type === "table") {
    return <div className="mt-4 overflow-x-auto rounded-2xl border border-[#e2e8f1] bg-white"><table className="w-full min-w-[42rem] border-collapse text-left text-[13px] leading-5"><thead className="bg-[#f3f6fb]"><tr>{block.headers.map((header) => <th key={header} scope="col" className="border-b border-[#e2e8f1] px-3 py-2.5 font-extrabold text-[#253552]">{header}</th>)}</tr></thead><tbody>{block.rows.map((row, index) => <tr key={index} className="align-top even:bg-[#fbfcfe]">{row.map((cell, cellIndex) => <td key={cellIndex} className="border-b border-[#edf1f6] px-3 py-2.5 text-[#4d5b73] last:border-b-0">{cell}</td>)}</tr>)}</tbody></table></div>;
  }
  if (block.type === "callout") {
    const styles = block.tone === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-950"
      : block.tone === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-950"
        : "border-blue-200 bg-blue-50 text-blue-950";
    return <aside className={`mt-4 rounded-2xl border px-4 py-3 ${styles}`} aria-label={block.tone}><h3 className="text-sm font-extrabold">{block.title}</h3><p className="mt-1 text-[13px] leading-6 opacity-90">{block.text}</p></aside>;
  }
  return (
    <figure className="mt-5 overflow-hidden rounded-2xl border border-[#e3e9f2] bg-white shadow-[0_8px_26px_rgba(25,42,75,.055)]">
      <Image src={block.src} alt={block.alt} width={1440} height={1000} sizes="(max-width: 768px) 100vw, 900px" className="h-auto w-full" loading="lazy" />
      <figcaption className="border-t border-[#edf1f6] px-3 py-2.5 text-xs leading-5 text-[#6a778e]">{block.caption}</figcaption>
    </figure>
  );
}

export default function DocsArticle({ article }: { article: DocArticle }) {
  const currentIndex = DOC_ARTICLES.findIndex((item) => item.slug === article.slug);
  const previous = currentIndex > 0 ? DOC_ARTICLES[currentIndex - 1] : null;
  const next = currentIndex >= 0 && currentIndex < DOC_ARTICLES.length - 1 ? DOC_ARTICLES[currentIndex + 1] : null;
  const related = article.related.map((slug) => DOC_ARTICLES.find((item) => item.slug === slug)).filter((item): item is DocArticle => Boolean(item));

  return (
    <article className="min-w-0 rounded-[1.5rem] border border-[#e5ebf3] bg-white px-4 py-5 shadow-[0_8px_30px_rgba(25,42,75,.04)] sm:px-7 sm:py-7">
      <nav aria-label="Breadcrumb" className="text-xs font-semibold text-[#71809a]">
        <ol className="flex flex-wrap items-center gap-2">
          <li><Link href="/docs/" className="hover:text-[#2d5be9]">Docs</Link></li>
          <li aria-hidden="true">/</li>
          <li>{article.category}</li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-[#43536e]">{article.title}</li>
        </ol>
      </nav>
      <div className="mt-6 border-b border-[#edf1f6] pb-5">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#2d5be9]">{article.category}</p>
        <h1 className="mt-2 text-[2rem] font-extrabold leading-tight tracking-[-0.04em] text-[#16244a] sm:text-[2.45rem]">{article.title}</h1>
        <p className="mt-3 max-w-3xl text-[15px] leading-7 text-[#5a6881]">{article.description}</p>
      </div>
      <div className="mt-5 space-y-7">
        {article.sections.map((section) => (
          <section key={section.id} id={section.id} aria-labelledby={`${section.id}-heading`} className="scroll-mt-24">
            <h2 id={`${section.id}-heading`} className="text-xl font-extrabold tracking-[-0.025em] text-[#16244a] sm:text-[1.35rem]">{section.title}</h2>
            {section.blocks.map((block, index) => <RenderBlock block={block} key={`${section.id}-${index}`} />)}
          </section>
        ))}
      </div>

      {related.length > 0 ? (
        <section className="mt-8 border-t border-[#edf1f6] pt-5" aria-labelledby="related-heading">
          <h2 id="related-heading" className="text-sm font-extrabold text-[#16244a]">Related guides</h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">{related.map((item) => <li key={item.slug}><Link href={`/docs/${item.slug}/`} className="flex min-h-12 items-center justify-between gap-2 rounded-xl border border-[#e7ecf4] px-3 py-2.5 text-sm font-bold text-[#2d5be9] hover:border-[#b9caf9] hover:bg-[#f7f9ff] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2d5be9]"><span>{item.title}</span><span aria-hidden="true">→</span></Link></li>)}</ul>
        </section>
      ) : null}

      <nav aria-label="Article navigation" className="mt-7 grid gap-3 border-t border-[#edf1f6] pt-5 sm:grid-cols-2">
        {previous ? <Link href={`/docs/${previous.slug}/`} rel="prev" className="rounded-xl border border-[#e3e9f2] p-3 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-[#2d5be9]"><span className="block text-[10px] font-extrabold uppercase tracking-wider text-[#8290a7]">Previous</span><span className="mt-1 block text-sm font-bold text-[#294bc2]">← {previous.title}</span></Link> : <span />}
        {next ? <Link href={`/docs/${next.slug}/`} rel="next" className="rounded-xl border border-[#e3e9f2] p-3 text-right hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-[#2d5be9]"><span className="block text-[10px] font-extrabold uppercase tracking-wider text-[#8290a7]">Next</span><span className="mt-1 block text-sm font-bold text-[#294bc2]">{next.title} →</span></Link> : null}
      </nav>
    </article>
  );
}
