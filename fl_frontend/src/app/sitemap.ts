import type { MetadataRoute } from "next";

// Evaluated once at module load, not per request. `new Date()` here is a dynamic read under
// cacheComponents, which is what made /sitemap.xml the one dynamic page route -- and an
// always-now lastModified tells a crawler nothing, since it can never mean "unchanged".
// Bump this when the corresponding page content actually changes.
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
      url: `${baseUrl}/dashboard/spielhistorie`,
      lastModified: CONTENT_LAST_MODIFIED,
      changeFrequency: "daily",
      priority: 0.7,
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
    {
      url: `${baseUrl}/signin`,
      lastModified: CONTENT_LAST_MODIFIED,
      changeFrequency: "daily",
      priority: 0.7,
    },
    // /admin is deliberately absent: robots.ts:12 disallows it, next.config.ts redirects it, and
    // proxy.ts bounces anonymous visitors to /signin -- it can never yield an indexable page.
  ];
}
