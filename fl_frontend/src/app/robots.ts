import { SITE_URL } from "@/core/brand";

import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const aiBots = ["Amazonbot", "Applebot-Extended", "Bytespider", "CCBot", "ClaudeBot", "GPTBot", "meta-externalagent", "Google-Extended"];

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
