import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { withSaisonId } from "./saisonHref";

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
    if (entry.name.endsWith(".test.ts")) return [];
    return [full];
  });
}

/**
 * Blanks whole-line comments so prose naming a route is not read as a link. Conservative on purpose: a
 * TRAILING comment is left in place, so its route still has to be accounted for below rather than
 * slipping through — the sweep must never fail open.
 */
const stripCommentLines = (source: string): string =>
  source
    .split("\n")
    .map((line) => (line.trimStart().startsWith("//") || line.trimStart().startsWith("*") || line.trimStart().startsWith("/*") ? "" : line))
    .join("\n");

/**
 * A local holding the season, interpolated at the end of a route. Recognised rather than rewritten:
 * the derivation is checked below, so the NAME alone can never stand in for the parameter.
 */
const NAMED_CARRIERS = ["saisonParam", "saisonQuery"] as const;

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

/** One route literal found in code, with the expression that builds it. */
type Navigation = { file: string; route: string; carries: boolean };

function collectNavigations(): Navigation[] {
  const found: Navigation[] = [];

  for (const full of collectSourceFiles(SRC_DIR)) {
    const file = path.relative(SRC_DIR, full).split(path.sep).join("/");
    const code = stripCommentLines(readFileSync(full, "utf8"));

    for (const match of code.matchAll(/["`](\/admin[^"`]*)["`]/g)) {
      const route = match[1] ?? "";
      // The 90 characters ahead of the literal: enough to hold the call wrapping it.
      const window = code.slice(Math.max(0, match.index - 90), match.index);

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

      const carries = named !== undefined || window.includes("saisonHref(") || window.includes("withSaisonId(") || route.includes("saison_id=");

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

  /* An exemption that no longer matches anything is how this list rots into a place to hide a link. */
  it("keeps no exemption for a route that is gone or now carries the season", () => {
    const stale = Object.keys(SEASONLESS).filter((key) => !navigations.some((nav) => `${nav.file} :: ${nav.route}` === key && !nav.carries));

    assert.deepEqual(stale, [], "these SEASONLESS entries match no season-less navigation any more and should be deleted");
  });
});
