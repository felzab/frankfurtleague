import { describe, expect, it, vi } from "vitest";

import { SITE_URL } from "@/core/brand.ts";
import { ROUTES } from "@/core/routes.ts";

import robots from "./robots.ts";
import sitemap from "./sitemap.ts";

import type { RouteEntry } from "@/core/routes.ts";

/** The season pages' frame as the sitemap reads it; each case sets the season the site is on. */
const frame = vi.hoisted((): { saisons: never[]; active_saison_id: string | null } => ({ saisons: [], active_saison_id: null }));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("@/features/saisons/queries", () => ({ getSaisonFrame: async () => frame }));

/** Each row with its address, every segment filled, so a prefix test reads it as a crawler would. */
const ROWS = (Object.entries(ROUTES) as [string, RouteEntry][]).map(([key, row]) => {
  const path = row.path as (...segments: string[]) => string;
  return { key, crawl: row.crawl, segments: path.length, address: path(...Array.from({ length: path.length }, () => "x")) };
});

const { rules } = robots();
const PREFIXES = (Array.isArray(rules) ? rules : [rules]).flatMap((rule) =>
  rule.disallow === undefined ? [] : Array.isArray(rule.disallow) ? rule.disallow : [rule.disallow],
);

/** Whether robots.txt turns a crawler back from the address: a rule matches by prefix (RFC 9309). */
const refused = (address: string) => PREFIXES.some((prefix) => address.startsWith(prefix));

describe("robots.txt", () => {
  // A crawler keeps the address it fetched, and a page a mail opens carries its link's token in that address.
  it.each(ROWS.filter((row) => row.crawl === "disallow"))("turns crawlers back from $key", ({ address }) => {
    expect(refused(address)).toBe(true);
  });

  // A refused page's noindex is never read, so a search engine may list its bare address from a link alone.
  it.each(ROWS.filter((row) => row.crawl !== "disallow"))("lets crawlers fetch $key", ({ address }) => {
    expect(refused(address)).toBe(false);
  });
});

describe("the sitemap", () => {
  const fixed = ROWS.filter((row) => row.crawl === "index" && row.segments === 0).map((row) => `${SITE_URL}${row.address}`);

  it("lists every listed page that no season names, and the season pages of the season the site is on", async () => {
    frame.active_saison_id = "2027";
    const urls = (await sitemap()).map((entry) => entry.url);
    expect(urls.filter((url) => !url.includes("/saisons/"))).toEqual(fixed);
    expect(urls.filter((url) => url.includes("/saisons/")).sort()).toEqual(
      [ROUTES.spielplan.path("2027"), ROUTES.kORunde.path("2027"), ROUTES.tabelle.path("2027"), ROUTES.teams.path("2027")]
        .map((address) => `${SITE_URL}${address}`)
        .sort(),
    );
  });

  it("lists no season page while the league has no season", async () => {
    frame.active_saison_id = null;
    expect((await sitemap()).map((entry) => entry.url)).toEqual(fixed);
  });
});
