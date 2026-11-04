import type { MetadataRoute } from "next";
import { DOC_ARTICLES } from "@/src/content/guides/content";

const ORIGIN = "https://metacleaner.techpeakssolutions.com";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${ORIGIN}/` },
    { url: `${ORIGIN}/docs/` },
    ...DOC_ARTICLES
      .filter((article) => article.indexable !== false)
      .map((article) => ({ url: `${ORIGIN}/docs/${article.slug}/` })),
  ];
}
