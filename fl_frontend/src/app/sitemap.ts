import { SITE_URL } from "@/core/brand";
import { DATENSCHUTZ_STAND } from "@/features/meta/constants";

import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  // Only the privacy notice is dated, by the „Stand“ it shows. Any other date is hand-set, `new Date()`
  // making this route dynamic, and true only while someone moves it; a crawler meeting one wrong date
  // trusts none.
  return [
    {
      url: `${SITE_URL}/`,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${SITE_URL}/dashboard/spielsuche`,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/dashboard/spielplan`,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/dashboard/saisontabelle`,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/dashboard/spieler`,
      changeFrequency: "daily",
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/dashboard/teams`,
      changeFrequency: "daily",
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/dashboard/playoffs`,
      changeFrequency: "daily",
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/about`,
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: `${SITE_URL}/organisation`,
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: `${SITE_URL}/kontakt`,
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: `${SITE_URL}/impressum`,
      changeFrequency: "monthly",
      priority: 0.2,
    },
    {
      url: `${SITE_URL}/datenschutz`,
      lastModified: DATENSCHUTZ_STAND,
      changeFrequency: "monthly",
      priority: 0.2,
    },
    // Left out: /bereich, /registrierung and the /bestaetigung pages, which robots.ts disallows, and
    // the /signin pages, which it does not. Every public one of them noindexes itself.
  ];
}
