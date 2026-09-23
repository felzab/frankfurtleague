import { SITE_URL } from "@/core/brand";

import type { MetadataRoute } from "next";

// A live `new Date()` is a dynamic read under cacheComponents, which would make this a dynamic
// route. Any change to a public page's content moves it, since a stale date tells a crawler
// there is nothing new to fetch.
const CONTENT_LAST_MODIFIED = new Date("2026-09-23");

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
      url: `${SITE_URL}/organisation`,
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
    {
      url: `${SITE_URL}/impressum`,
      lastModified: CONTENT_LAST_MODIFIED,
      changeFrequency: "monthly",
      priority: 0.2,
    },
    {
      url: `${SITE_URL}/datenschutz`,
      lastModified: CONTENT_LAST_MODIFIED,
      changeFrequency: "monthly",
      priority: 0.2,
    },
    // /admin, /registrierung and the /bestaetigung and /signin pages stay out: robots.ts disallows
    // each of them, and every one noindexes itself as well.
  ];
}
