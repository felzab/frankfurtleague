import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";

import { withSaisonId } from "./saisonHref.ts";

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..");

describe("withSaisonId", () => {
  it("leaves a path alone where no season is in force", () => {
    assert.equal(withSaisonId("/admin/teams", null), "/admin/teams");
    assert.equal(withSaisonId("/admin/teams", undefined), "/admin/teams");
  });

  it("appends the season to a bare path", () => {
    assert.equal(withSaisonId("/admin/teams", "9999"), "/admin/teams?saison_id=9999");
  });

  it("amends a query rather than replacing it", () => {
    assert.equal(withSaisonId("/admin/spielsuche?team=abc", "9999"), "/admin/spielsuche?team=abc&saison_id=9999");
  });

  /* The subject's own season outranks the shell's: the club editor links at one stored membership, and
     overwriting it with whatever the selector showed would open a different season's row. */
  it("keeps a season the path already names", () => {
    assert.equal(withSaisonId("/admin/kontakte/abc?saison_id=2026", "9999"), "/admin/kontakte/abc?saison_id=2026");
  });

  it("encodes a season that would otherwise alter the query", () => {
    assert.equal(withSaisonId("/admin/teams", "a&b=c"), "/admin/teams?saison_id=a%26b%3Dc");
  });
});

// `isTestFile` decides both spellings: a `.test.tsx` was reaching the sweep, where its fixtures read
// as navigations.
/** Every `.ts`/`.tsx` under `src`, tests excluded — the population the sweep below enumerates. */
const SOURCE_FILES = filesUnder(SRC_DIR, (name) => (name.endsWith(".ts") || name.endsWith(".tsx")) && !isTestFile(name), 350);

/**
 * Blanks comments so prose naming a route is not read as a link. Tracks the delimiters rather than
 * blanking lines that OPEN with `*`, as a template literal's own line can, and keeps whatever stands
 * outside a comment: this sweep must never fail open.
 */
function stripCommentLines(source: string): string {
  let imBlock = false;

  return source
    .split("\n")
    .map((line) => {
      if (imBlock) {
        const schluss = line.indexOf("*/");
        if (schluss === -1) return "";
        imBlock = false;
        return line.slice(schluss + 2);
      }

      if (line.trimStart().startsWith("//")) return "";

      const beginn = line.indexOf("/*");
      if (beginn === -1) return line;

      const schluss = line.indexOf("*/", beginn + 2);
      if (schluss === -1) {
        imBlock = true;
        return line.slice(0, beginn);
      }

      return line.slice(0, beginn) + line.slice(schluss + 2);
    })
    .join("\n");
}

describe("every admin navigation carries the season", () => {
  /* A relative target resolves against whatever page it fires from, so it names no `/admin` literal
     and the sweep above cannot see it at all. None exists today; this is what keeps that true. */
  it("routes no navigation through a relative path", () => {
    const relative: string[] = [];

    for (const full of SOURCE_FILES) {
      const file = path.relative(SRC_DIR, full).split(path.sep).join("/");

      for (const match of stripCommentLines(readFileSync(full, "utf8")).matchAll(
        /\b(?:router\.(?:push|replace)|redirect)\(\s*["`]([^"`]*)["`]/g,
      )) {
        const target = match[1] ?? "";
        /* `${pathname}?…` is the page rewriting its OWN query — absolute, because `pathname` is, and
           season-scoped already for the same reason. Any OTHER interpolation is a target this sweep
           cannot resolve, so it is reported rather than assumed. */
        const isAbsolute = target.startsWith("/") || target.startsWith("${pathname}") || /^[a-z]+:/.test(target);
        if (!isAbsolute) relative.push(`${file} :: ${target}`);
      }
    }

    assert.deepEqual(relative, [], "these navigations name a relative target, which no sweep over `/admin` literals can check");
  });
});
