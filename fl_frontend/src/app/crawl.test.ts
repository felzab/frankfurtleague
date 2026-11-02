import { describe, expect, it } from "vitest";

import { SITE_URL } from "@/core/brand.ts";
import { ROUTES } from "@/core/routes.ts";

import robots from "./robots.ts";
import sitemap from "./sitemap.ts";

import type { RouteEntry } from "@/core/routes.ts";

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
  it("lists every listed page that no season names, and no other page", () => {
    const listed = ROWS.filter((row) => row.crawl === "index" && row.segments === 0).map((row) => `${SITE_URL}${row.address}`);
    expect(sitemap().map((entry) => entry.url)).toEqual(listed);
  });
});
