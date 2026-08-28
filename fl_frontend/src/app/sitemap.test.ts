import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { SITE_URL } from "@/core/brand";

import sitemap from "./sitemap.ts";

const APP_DIR = import.meta.dirname;

/**
 * The one public page the list withholds, for a reason no walk of the tree can see. `/admin` is
 * withheld too and needs no entry here: `robots.ts` disallows the whole prefix.
 */
const WITHHELD = ["/signin"];

/** A segment in parentheses organises files and names no path. */
const isRouteGroup = (segment: string): boolean => segment.startsWith("(");

/** A segment filled from data. Listing one would mean reading the API while the sitemap renders. */
const isDynamic = (segment: string): boolean => segment.startsWith("[");

/**
 * Every static route holding a page, read off the tree rather than listed here: a page added tomorrow
 * is compared against the sitemap on the day it lands, without anybody remembering to name it.
 */
function staticRoutes(dir: string, segments: readonly string[] = []): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const own = entries.some((entry) => entry.isFile() && entry.name === "page.tsx") ? [`/${segments.join("/")}`] : [];

  return entries
    .filter((entry) => entry.isDirectory() && !isDynamic(entry.name))
    .flatMap((entry) => staticRoutes(path.join(dir, entry.name), isRouteGroup(entry.name) ? segments : [...segments, entry.name]))
    .concat(own);
}

const PUBLIC_ROUTES = staticRoutes(APP_DIR)
  .filter((route) => !route.startsWith("/admin") && !WITHHELD.includes(route))
  .sort();

const LISTED = sitemap()
  .map((entry) => entry.url)
  .sort();

describe("what the sitemap hands a crawler", () => {
  /* First: a walk that reached nothing would leave the comparison below between two empty lists, in
     which no route is missing and no route is spare. */
  it("finds the app's own public pages before comparing them", () => {
    assert.ok(PUBLIC_ROUTES.includes("/"), "the walk found no homepage, so it reached nothing this list is about");
    assert.ok(PUBLIC_ROUTES.length > 5, `only ${String(PUBLIC_ROUTES.length)} public pages were found under app/`);
  });

  /* Both directions, because each is its own defect: a page missing from the list is a page no crawler
     is sent to, and a URL left standing for a page that is gone is a 404 handed to every crawler that asks. */
  it("names every public page the app serves, and nothing else", () => {
    assert.deepEqual(
      LISTED,
      PUBLIC_ROUTES.map((route) => `${SITE_URL}${route}`),
    );
  });

  /* Absolute and on the site's own origin: a sitemap is fetched from a URL of its own, so a relative
     entry resolves against wherever the crawler found the file rather than against the page it means. */
  it("builds every URL on the origin the brand states", () => {
    for (const entry of sitemap()) {
      assert.ok(entry.url.startsWith(`${SITE_URL}/`), `${entry.url} is not an absolute URL on the site's origin`);
    }
  });

  /* The withheld page keeps its own reason on itself. Dropped there, `/signin` is indexed and linked
     from nowhere in this list, which is the shape that reads as a page nobody meant to publish. */
  it("leaves out the public page that is noindexed, which still says so itself", () => {
    const signin = readFileSync(path.join(APP_DIR, "(public)", "signin", "page.tsx"), "utf8");

    assert.ok(!LISTED.includes(`${SITE_URL}/signin`), "the sitemap sends a crawler to the sign-in page");
    assert.match(signin, /robots: \{ index: false, follow: false \}/, "the sign-in page is withheld here and indexable anyway");
  });
});
