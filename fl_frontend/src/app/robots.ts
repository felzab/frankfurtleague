import { SITE_URL } from "@/core/brand";

import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  // Declares the AI-training opt-out the edge enforces. The edge's list sits in a dashboard no
  // file reads, so nothing compares the two (`docs/ops/spec.md :: 1.8`).
  // `Meta-ExternalFetcher` is left off: it is the user-initiated fetch, which documents bypassing
  // this file anyway.
  const aiBots = [
    "Amazonbot",
    "Applebot-Extended",
    "Bytespider",
    "CCBot",
    "ClaudeBot",
    "GPTBot",
    "Google-Extended",
    "meta-externalagent",
    "Meta-ExternalAds",
    "Meta-WebIndexer",
  ];

  return {
    sitemap: `${SITE_URL}/sitemap.xml`,
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Every mailed URL among these carries a live token in its query, `/bestaetigung` standing
        // as the prefix over its whole segment.

        // The disallow is what turns a crawler back BEFORE that fetch; a page's noindex is read only
        // after one.

        // `/bereich` without its slash: a person lands on the segment's own address, which
        // `/bereich/` does not reach.
        disallow: ["/api/", "/bereich", "/bestaetigung", "/signin/bestaetigen", "/registrierung"],
      },
      ...aiBots.map((bot) => ({
        userAgent: bot,
        disallow: "/",
      })),
    ],
  };
}
