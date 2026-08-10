/**
 * APP · sitemap
 *
 * Lists only public, crawlable routes. Admin routes and `/signin` are deliberately absent, each for
 * the reason recorded at the foot of the list below.
 */

import type { MetadataRoute } from "next";

// Evaluated once at module load: `new Date()` here is a dynamic read under cacheComponents, which
// makes /sitemap.xml a dynamic route — and an always-now lastModified tells a crawler nothing. Bump
// it by hand when the page content changes.
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
    // /admin and /signin are deliberately absent: `fl_frontend/src/app/robots.ts :: robots` disallows
    // the first and noindexes the second, so neither can yield an indexable page and an entry would
    // only spend crawl budget.
  ];
}
