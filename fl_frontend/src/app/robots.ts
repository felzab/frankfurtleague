import { SITE_URL } from "@/core/brand";
import { ROUTES } from "@/core/routes";

import type { RouteEntry } from "@/core/routes";
import type { MetadataRoute } from "next";

/** The first segment of a row's address, which every address the row builds shares. */
function firstSegment(row: RouteEntry): string {
  const path = row.path as (...segments: string[]) => string;
  return `/${path(...Array.from({ length: path.length }, () => "_")).split("/")[1] ?? ""}`;
}

export default function robots(): MetadataRoute.Robots {
  // Turns a crawler back BEFORE the fetch; a page's noindex is read only after one. Each segment stands
  // unslashed, a prefix over the whole segment, so a new page under one takes no rule of its own. The
  // AI-training opt-out is Cloudflare's managed robots.txt, which the edge puts before this file.
  const rows: readonly RouteEntry[] = Object.values(ROUTES);
  const disallowed = new Set(rows.filter((row) => row.crawl === "disallow").map(firstSegment));

  // `/api/` serves handlers rather than pages, so no row names it.
  return {
    sitemap: `${SITE_URL}/sitemap.xml`,
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", ...disallowed] }],
  };
}
