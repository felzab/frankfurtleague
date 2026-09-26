import "@/shared/testing/pageHarness.ts";

import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { SITE_URL } from "@/core/brand";

import sitemap from "./sitemap.ts";

import type { Metadata } from "next";

/** Each page's view and form, doubled whole: the withheld pages are loaded for their metadata alone. */
const COMPONENT = /\/src\/features\/[a-z]+\/components\/(?:views|forms)\/(\w+)\.tsx$/;

registerHooks({
  load(url, context, nextLoad) {
    const component = COMPONENT.exec(url);
    if (component !== null) return { format: "module", source: `export const ${component[1]!} = () => null;`, shortCircuit: true };

    return nextLoad(url, context);
  },
});

const APP_DIR = import.meta.dirname;

/**
 * The public pages the list withholds, each for a reason no walk of the tree can see. `/bereich` is
 * withheld too and needs no entry here: `robots.ts` disallows the whole prefix.
 */
const WITHHELD = [
  "/signin",
  "/signin/weiter",
  "/signin/bestaetigen",
  "/signin/passkey",
  "/bestaetigung/kontakt",
  "/bestaetigung/schiedsrichter",
  "/registrierung",
  "/bestaetigung/spieler",
];

/** A segment in parentheses organises files and names no path. */
const isRouteGroup = (segment: string): boolean => segment.startsWith("(");

/** A segment filled from data. Listing one would mean reading the API while the sitemap renders. */
const isDynamic = (segment: string): boolean => segment.startsWith("[");

/**
 * Every static route holding a page, read off the tree rather than listed here: a page added tomorrow
 * is compared against the sitemap on the day it lands, without anybody remembering to name it.
 */
function staticRoutes(dir: string, segments: readonly string[] = []): { route: string; file: string }[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  // The file travels with the route it serves: a route group names no path segment, so neither of
  // the two can be rebuilt from the other.
  const own = entries.some((entry) => entry.isFile() && entry.name === "page.tsx")
    ? [{ route: `/${segments.join("/")}`, file: path.join(dir, "page.tsx") }]
    : [];

  return entries
    .filter((entry) => entry.isDirectory() && !isDynamic(entry.name))
    .flatMap((entry) => staticRoutes(path.join(dir, entry.name), isRouteGroup(entry.name) ? segments : [...segments, entry.name]))
    .concat(own);
}

const FOUND = staticRoutes(APP_DIR);

const PUBLIC_ROUTES = FOUND.map((page) => page.route)
  .filter((route) => !route.startsWith("/bereich/") && !WITHHELD.includes(route))
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

  /* A withheld page keeps its own reason on itself. Dropped there, it is indexed and linked from
     nowhere in this list, which is the shape that reads as a page nobody meant to publish. */
  it("leaves out every public page that is noindexed, each of which still says so itself", async () => {
    for (const route of WITHHELD) {
      const withheld = FOUND.find((page) => page.route === route);

      assert.ok(withheld, `${route} is withheld from the sitemap and no page under app/ serves it`);
      assert.ok(!LISTED.includes(`${SITE_URL}${route}`), `the sitemap sends a crawler to ${route}`);

      const { metadata } = (await import(pathToFileURL(withheld.file).href)) as { metadata?: Metadata };
      assert.deepEqual(metadata?.robots, { index: false, follow: false }, `${route} is withheld here and indexable anyway`);
    }
  });
});
