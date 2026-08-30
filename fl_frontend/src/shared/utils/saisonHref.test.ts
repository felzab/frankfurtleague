import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { SAISON_PARAM, withSaisonId } from "./saisonHref.ts";

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

/** Every `.ts`/`.tsx` under `src`, tests excluded — the population the sweep below enumerates. */
function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(full);
    if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) return [];
    // Both spellings: a `.test.tsx` was reaching the sweep, where its fixtures read as navigations.
    if (/\.test\.tsx?$/.test(entry.name)) return [];
    return [full];
  });
}

/**
 * Blanks comments so prose naming a route is not read as a link, tracking `/* … *\/` rather than
 * blanking every line that OPENS with `*`: a template literal's own line can open with one, and
 * blanking it hid a real route from the sweep. Whatever stands outside the comment is kept, so a
 * route sharing a line with one is still accounted for — this must never fail open.
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

/**
 * A local holding the season, interpolated at the end of a route. Recognised rather than rewritten:
 * the derivation is checked below, so the NAME alone can never stand in for the parameter.
 */
/* Empty now that every table composes through `withSaisonId`: the two names it held meant `?…` in
   one file and `&…` in its sibling, and widening the sweep to bless them was the wrong repair. */
const NAMED_CARRIERS: readonly string[] = [];

/**
 * Routes that are deliberately season-less, each with the reason it cannot carry one. **An entry here is
 * a decision, not a silence**: the sweep fails on a stale one, so a link that starts carrying the season
 * cannot leave its excuse behind.
 */
const SEASONLESS: Record<string, string> = {
  "app/robots.ts :: /admin/": "a crawler disallow rule, not a link",
  "proxy.ts :: /admin/:path*": "the authorization matcher, not a link",
  "features/admin/components/ui/AdminShell.tsx :: /admin":
    "the sidemenu's link PREFIX; SidemenuNavLinksWithSaisonQuery appends the season to each entry it builds",
  "features/auth/actions.ts :: /admin": "where a magic link lands; no season is in scope at sign-in, so the default is right",
  "shared/components/layout/topnav/TopNav.tsx :: /admin": "the public chrome's way into the admin area; no season is in scope outside it",
};

/**
 * A carrier call standing immediately before the literal, so the literal is its FIRST argument.
 * Whitespace alone may sit between, which is what a formatter puts there.
 */
const CARRIER_CALL = /(?:saisonHref|withSaisonId)\(\s*$/;

/**
 * Whether the route's own query names the parameter, PARSED rather than matched: `not_saison_id=`
 * contains the parameter's spelling without being it, and a substring test blessed it.
 */
function namesSaisonParam(route: string): boolean {
  const fragezeichen = route.indexOf("?");

  return fragezeichen !== -1 && new URLSearchParams(route.slice(fragezeichen + 1)).has(SAISON_PARAM);
}

/** One route literal found in code, with the expression that builds it. */
type Navigation = { file: string; route: string; carries: boolean };

function collectNavigations(): Navigation[] {
  const found: Navigation[] = [];

  for (const full of collectSourceFiles(SRC_DIR)) {
    const file = path.relative(SRC_DIR, full).split(path.sep).join("/");
    const code = stripCommentLines(readFileSync(full, "utf8"));

    /* An optional leading interpolation before the route: `${base}/admin/…` is a navigation that
         anchoring hard at the quote could not see. Nothing else may precede it — `@/features/admin/…`
         is a module specifier, not a link. */
    for (const match of code.matchAll(/["`]((?:\$\{[^}]*\})?\/admin[^"`]*)["`]/g)) {
      const route = match[1] ?? "";
      // Enough to hold a carrier's name, its bracket and a line break with indentation, and no more:
      // the question below is whether the call ENDS here, not whether one appears nearby.
      const window = code.slice(Math.max(0, match.index - 40), match.index);

      const named = NAMED_CARRIERS.find((name) => route.endsWith(`\${${name}}`));
      if (named !== undefined) {
        // The name is not the evidence — the derivation is. A local called `saisonParam` that never
        // reads the parameter would otherwise wave a dropping link straight through.
        assert.match(
          code,
          new RegExp(`const ${named} =[^;]*saison_id`),
          `${file}: a route interpolates \${${named}}, but nothing in the file derives it from saison_id`,
        );
      }

      /* The literal must BE the carrier's first argument, not merely stand near one. `includes` blessed
         any route within reach of a wrapped neighbour, which is what four links in a row look like —
         so an unwrapped fifth added beside them passed the sweep. */
      const carries = named !== undefined || CARRIER_CALL.test(window) || namesSaisonParam(route);

      found.push({ file, route, carries });
    }
  }

  return found;
}

/**
 * The `OPS-94` shape, avoided: this enumerates NAVIGATIONS, then asks each whether it carries the
 * season. Going by `saison_id` finds only the links that already have it — how these stayed invisible.
 */
describe("every admin navigation carries the season", () => {
  const navigations = collectNavigations();

  /* First, because a walk or a pattern that quietly stopped matching would leave every case below
     iterating an empty list and passing. */
  it("swept a whole tree rather than an empty one", () => {
    assert.ok(collectSourceFiles(SRC_DIR).length > 200, `only ${collectSourceFiles(SRC_DIR).length} source files reached the sweep`);
    assert.ok(navigations.length >= 30, `only ${navigations.length} admin routes were found; the pattern has stopped matching`);
    assert.ok(
      navigations.some((nav) => nav.file === "features/spiele/utils.ts"),
      "the match editor's own route is missing from the sweep",
    );
  });

  it("routes every admin link through the season or names why it cannot", () => {
    const dropping = navigations.filter((nav) => !nav.carries && SEASONLESS[`${nav.file} :: ${nav.route}`] === undefined);

    assert.deepEqual(
      dropping.map((nav) => `${nav.file} :: ${nav.route}`),
      [],
      "these admin links drop ?saison_id=, which silently returns the shell to the default season. " +
        "Wrap the path in useSaisonHref()/withSaisonId(), or add it to SEASONLESS with the reason it cannot carry one.",
    );
  });

  /* A relative target resolves against whatever page it fires from, so it names no `/admin` literal
     and the sweep above cannot see it at all. None exists today; this is what keeps that true. */
  it("routes no navigation through a relative path", () => {
    const relativ: string[] = [];

    for (const full of collectSourceFiles(SRC_DIR)) {
      const file = path.relative(SRC_DIR, full).split(path.sep).join("/");

      for (const match of stripCommentLines(readFileSync(full, "utf8")).matchAll(
        /\b(?:router\.(?:push|replace)|redirect)\(\s*["`]([^"`]*)["`]/g,
      )) {
        const ziel = match[1] ?? "";
        /* `${pathname}?…` is the page rewriting its OWN query — absolute, because `pathname` is, and
           season-scoped already for the same reason. Any OTHER interpolation is a target this sweep
           cannot resolve, so it is reported rather than assumed. */
        const absolut = ziel.startsWith("/") || ziel.startsWith("${pathname}") || /^[a-z]+:/.test(ziel);
        if (!absolut) relativ.push(`${file} :: ${ziel}`);
      }
    }

    assert.deepEqual(relativ, [], "these navigations name a relative target, which no sweep over `/admin` literals can check");
  });

  /* An exemption that no longer matches anything is how this list rots into a place to hide a link. */
  it("keeps no exemption for a route that is gone or now carries the season", () => {
    const stale = Object.keys(SEASONLESS).filter((key) => !navigations.some((nav) => `${nav.file} :: ${nav.route}` === key && !nav.carries));

    assert.deepEqual(stale, [], "these SEASONLESS entries match no season-less navigation any more and should be deleted");
  });
});
