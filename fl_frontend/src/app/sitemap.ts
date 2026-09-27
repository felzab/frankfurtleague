import { SITE_URL } from "@/core/brand";
import { DATENSCHUTZ_STAND } from "@/features/meta/constants";

import type { MetadataRoute } from "next";

/**
 * The day each page's words took effect, for a page holding no league data. Hand-set, since a live
 * `new Date()` is a dynamic read, which would make this a dynamic route; each is tied to its words by
 * `fl_frontend/src/app/sitemapDates.test.ts`.
 */
const WORDING_TOOK_EFFECT = { impressum: "2026-09-24", organisation: "2026-09-24", datenschutz: DATENSCHUTZ_STAND } as const;

export default function sitemap(): MetadataRoute.Sitemap {
  // An entry with no `lastModified` shows league data, whose last change no date set at build time
  // can follow: a crawler trusts a sitemap's dates only while every one of them is true.
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
      lastModified: WORDING_TOOK_EFFECT.organisation,
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
      lastModified: WORDING_TOOK_EFFECT.impressum,
      changeFrequency: "monthly",
      priority: 0.2,
    },
    {
      url: `${SITE_URL}/datenschutz`,
      lastModified: WORDING_TOOK_EFFECT.datenschutz,
      changeFrequency: "monthly",
      priority: 0.2,
    },
    // Left out: /bereich, /registrierung and the /bestaetigung pages, which robots.ts disallows, and
    // the /signin pages, which it does not. Every public one of them noindexes itself.
  ];
}
