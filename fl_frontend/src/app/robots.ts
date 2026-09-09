import { SITE_URL } from "@/core/brand";

import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  // The edge blocks AI training and this list declares it, so the two must say the same thing.
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
        // `/bestaetigung` noindexes itself; this turns back a crawler that learnt a link some other
        // way before it fetches one, a fetch being a token spent on nobody.
        disallow: ["/api/", "/admin/", "/bestaetigung"],
      },
      ...aiBots.map((bot) => ({
        userAgent: bot,
        disallow: "/",
      })),
    ],
  };
}
