import type { MetadataRoute } from "next";

// A live `new Date()` is a dynamic read under cacheComponents, which would make this a dynamic
// route. Bump it by hand when the page content changes.
const CONTENT_LAST_MODIFIED = new Date("2026-07-01");

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://frankfurtleague.de";

  return [
    {
      url: `${baseUrl}/`,
      lastModified: CONTENT_LAST_MODIFIED,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${baseUrl}/dashboard/spielsuche`,
      lastModified: CONTENT_LAST_MODIFIED,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/dashboard/spielplan`,
      lastModified: CONTENT_LAST_MODIFIED,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/dashboard/saisontabelle`,
      lastModified: CONTENT_LAST_MODIFIED,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/dashboard/spieler`,
      lastModified: CONTENT_LAST_MODIFIED,
      changeFrequency: "daily",
      priority: 0.7,
    },
    {
      url: `${baseUrl}/dashboard/teams`,
      lastModified: CONTENT_LAST_MODIFIED,
      changeFrequency: "daily",
      priority: 0.7,
    },
    {
      url: `${baseUrl}/dashboard/playoffs`,
      lastModified: CONTENT_LAST_MODIFIED,
      changeFrequency: "daily",
      priority: 0.7,
    },
    {
      url: `${baseUrl}/about`,
      lastModified: CONTENT_LAST_MODIFIED,
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: `${baseUrl}/team`,
      lastModified: CONTENT_LAST_MODIFIED,
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: `${baseUrl}/kontakt`,
      lastModified: CONTENT_LAST_MODIFIED,
      changeFrequency: "monthly",
      priority: 0.4,
    },
    // /admin and /signin stay out: robots.ts disallows one and the other is noindexed.
  ];
}
