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
        disallow: ["/api/", "/admin/"],
      },
      ...aiBots.map((bot) => ({
        userAgent: bot,
        disallow: "/",
      })),
    ],
  };
}
