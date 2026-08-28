import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { SITE_URL } from "@/core/brand";

import robots from "./robots.ts";

const APP_DIR = import.meta.dirname;

const FILE = robots();

/** One rule or several: the convention takes either shape, and this file writes the second. */
const RULES = [FILE.rules].flat();

/** The rule every crawler arriving without a name of its own reads. */
const EVERYONE = RULES.find((rule) => rule.userAgent === "*");

/** One rule's paths on the same terms, the convention taking a bare string as readily as a list. */
const paths = (value: string | string[] | undefined): string[] => (value === undefined ? [] : [value].flat());

describe("where robots.txt sends a crawler", () => {
  /* The route the file convention serves `app/sitemap.ts` at. Pointed anywhere else, every crawler
     that asks is handed a 404 and falls back to guessing the site from its links. */
  it("points at the sitemap this app actually serves", () => {
    assert.ok(existsSync(path.join(APP_DIR, "sitemap.ts")), "the app serves no sitemap route for this to point at");
    assert.equal(FILE.sitemap, `${SITE_URL}/sitemap.xml`, "the crawl is pointed at a sitemap the app does not serve");
  });
});

describe("what robots.txt keeps out of the crawl", () => {
  /* First: a rule the cut no longer finds would leave every assertion below reading `undefined`. */
  it("addresses the crawlers without a name of their own at all", () => {
    assert.ok(EVERYONE, "no rule addresses `*`, so nothing below is stated to a crawler arriving unnamed");
    assert.equal(EVERYONE.allow, "/", "the public tier is no longer offered to crawlers at all");
  });

  /* Both trees are real, and both are named. `/admin` is behind the session and `/api` answers the
     app's own fetches, so a crawler reaching either spends the budget on pages it may not have. */
  it("names both trees it withholds, and each of them exists", () => {
    for (const segment of ["admin", "api"]) {
      assert.ok(existsSync(path.join(APP_DIR, segment)), `/${segment}/ is withheld and no such tree exists`);
      assert.ok(paths(EVERYONE?.disallow).includes(`/${segment}/`), `/${segment}/ is offered to every crawler`);
    }
  });

  /* The named crawlers are refused whole, which is the only thing naming them achieves: a rule that
     refused part of the site would leave the rest of it training material. */
  it("refuses every crawler it names by name", () => {
    const named = RULES.filter((rule) => rule.userAgent !== "*");

    assert.notEqual(named.length, 0, "no crawler is named at all, so this case reads nothing");
    for (const bot of ["ClaudeBot", "CCBot", "GPTBot", "Google-Extended"]) {
      assert.ok(
        named.some((rule) => rule.userAgent === bot),
        `${bot} is no longer refused`,
      );
    }
    for (const rule of named) {
      assert.equal(rule.disallow, "/", `${String(rule.userAgent)} is named and then left part of the site`);
      assert.equal(rule.allow, undefined, `${String(rule.userAgent)} is refused and allowed in one rule`);
    }
  });
});
