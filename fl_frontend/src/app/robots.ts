/**
 * APP · robots.txt
 *
 * Disallows `/api/` and `/admin/` for every crawler, and disallows the whole site for a named list of
 * AI training crawlers.
 *
 * This is a REQUEST, not a control — robots.txt is honoured voluntarily. The actual protection on
 * `/admin` is the route guard plus the layout's own session check; nothing here is load-bearing for
 * security.
 */

import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const aiBots = ["Amazonbot", "Applebot-Extended", "Bytespider", "CCBot", "ClaudeBot", "GPTBot", "meta-externalagent", "Google-Extended"];

  return {
    sitemap: "https://frankfurtleague.de/sitemap.xml",
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/admin/"],
      },
      ...aiBots.map((bot) => ({
        userAgent: bot,
        disallow: "/",
      })),
    ],
  };
}
