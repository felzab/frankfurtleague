import { connection } from "next/server";

import { SITE_URL } from "@/core/brand";
import { addressOf, ROUTES, segmentCount } from "@/core/routes";
import { DATENSCHUTZ_AS_OF } from "@/features/meta/constants";
import { getSaisonFrame } from "@/features/saisons/queries";

import type { RouteEntry } from "@/core/routes";
import type { MetadataRoute } from "next";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // The season the site is on, read at request time from the season pages' own cached frame, so the image's build
  // reaches no backend and a flood of requests costs one backend read per cache lifetime.
  await connection();
  const { active_saison_id: active } = await getSaisonFrame();
  return listed(active === null ? [] : [active]);
}

/**
 * Every page `ROUTES` lists: a row with no segment once, a row under one season once per season passed. A
 * page named by its record is reached through its season's pages, so no record is read for it. No
 * `changeFrequency` or `priority`, which would be guesses, and a date only where the page shows one: a crawler
 * meeting one wrong date trusts none.
 */
function listed(saisons: readonly string[]): MetadataRoute.Sitemap {
  const rows: readonly RouteEntry[] = Object.values(ROUTES);
  return rows
    .filter((row) => row.crawl === "index")
    .flatMap((row) => {
      // A row taking a single segment takes the season.
      const segments = segmentCount(row);
      if (segments === 0) return [addressOf(row, "")];
      return segments === 1 ? saisons.map((saison) => addressOf(row, saison)) : [];
    })
    .map((address) => ({
      url: `${SITE_URL}${address}`,
      ...(address === ROUTES.privacyNotice.path() ? { lastModified: DATENSCHUTZ_AS_OF } : {}),
    }));
}
