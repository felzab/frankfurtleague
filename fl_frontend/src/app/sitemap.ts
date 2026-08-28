import { SITE_URL } from "@/core/brand";

import type { MetadataRoute } from "next";

// A live `new Date()` is a dynamic read under cacheComponents, which would make this a dynamic
// route. Bump it by hand when the page content changes.
const CONTENT_LAST_MODIFIED = new Date("2026-07-01");

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${SITE_URL}/`,
      lastModified: CONTENT_LAST_MODIFIED,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${SITE_URL}/dashboard/spielsuche`,
      lastModified: CONTENT_LAST_MODIFIED,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/dashboard/spielplan`,
      lastModified: CONTENT_LAST_MODIFIED,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/dashboard/saisontabelle`,
      lastModified: CONTENT_LAST_MODIFIED,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/dashboard/spieler`,
      lastModified: CONTENT_LAST_MODIFIED,
      changeFrequency: "daily",
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/dashboard/teams`,
      lastModified: CONTENT_LAST_MODIFIED,
      changeFrequency: "daily",
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/dashboard/playoffs`,
      lastModified: CONTENT_LAST_MODIFIED,
      changeFrequency: "daily",
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/about`,
      lastModified: CONTENT_LAST_MODIFIED,
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: `${SITE_URL}/team`,
      lastModified: CONTENT_LAST_MODIFIED,
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: `${SITE_URL}/kontakt`,
      lastModified: CONTENT_LAST_MODIFIED,
      changeFrequency: "monthly",
      priority: 0.4,
    },
    // /admin and /signin stay out: robots.ts disallows one and the other is noindexed.
  ];
}
