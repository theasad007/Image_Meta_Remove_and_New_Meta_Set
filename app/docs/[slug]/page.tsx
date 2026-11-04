import type { Metadata } from "next";
import { notFound } from "next/navigation";
import DocsArticle from "@/src/components/documentation/DocsArticle";
import DocsLayout from "@/src/components/documentation/DocsLayout";
import { DOC_ARTICLES, getDocArticle } from "@/src/content/guides/content";

const ORIGIN = "https://metacleaner.techpeakssolutions.com";

export const dynamicParams = false;

export function generateStaticParams() {
  return DOC_ARTICLES.map((article) => ({ slug: article.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const article = getDocArticle(slug);
  if (!article) return { title: "Guide not found", robots: { index: false, follow: false } };
  const canonical = `/docs/${article.slug}/`;
  return {
    title: article.title,
    description: article.description,
    metadataBase: new URL(ORIGIN),
    alternates: { canonical },
    robots: article.indexable === false ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: {
      title: `${article.title} · Private Metadata Cleaner`,
      description: article.description,
      url: canonical,
      type: "article",
    },
  };
}

export default async function DocumentationArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = getDocArticle(slug);
  if (!article) notFound();
  return (
    <DocsLayout activeSlug={article.slug} onThisPage={article.sections.map(({ id, title }) => ({ id, title }))}>
      <DocsArticle article={article} />
    </DocsLayout>
  );
}
