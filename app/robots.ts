import type { MetadataRoute } from "next";

const ORIGIN = "https://metacleaner.techpeakssolutions.com";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/account/profile/", "/admin/"] }],
    sitemap: `${ORIGIN}/sitemap.xml`,
  };
}
