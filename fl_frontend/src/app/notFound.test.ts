import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { createElement as h } from "react";

import { filesUnder } from "@/core/treeWalk.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";
import { openGraphFor } from "@/shared/utils/metadata.ts";
import { NOT_FOUND_METADATA } from "@/shared/utils/notFoundMetadata.ts";

import type { NextPageProps } from "@/shared/types/types";
import type { Metadata, ResolvedMetadata } from "next";

/* Every read a page's metadata makes answers nothing, which is the miss the crawler cases drive. The
   views are doubled whole: no case renders a page's body. `connection()` is request-only. */
const DOUBLES: [string, string][] = [
  ["/next/server.js", "export const connection = async () => undefined;"],
  [
    "/src/features/bewerbungen/queries.ts",
    "export const getBewerbungFenster = async () => null, getBewerbungSchulen = async () => [], getBewerbungTrikotfarben = async () => [];",
  ],
  ["/src/features/teams/queries.ts", "export const getTeam = async () => null;"],
  ["/src/features/spiele/queries.ts", "export const getSpiele = async () => ({ spiele: [] });"],
  ["/src/features/spieler/queries.ts", "export const getSpieler = async () => ({ spieler: [] });"],
  ["/src/features/saisons/queries.ts", "export const getSaisons = async () => ({ saisons: [] }), getAdminSaisons = getSaisons;"],
];

const VIEW = /\/src\/features\/[a-z]+\/components\/views\/(\w+)\.tsx$/;

registerHooks({
  load(url, context, nextLoad) {
    const doubled = DOUBLES.find(([ending]) => url.endsWith(ending));
    if (doubled !== undefined) return { format: "module", source: doubled[1], shortCircuit: true };

    const view = VIEW.exec(url);
    if (view !== null) return { format: "module", source: `export const ${view[1]!} = () => null;`, shortCircuit: true };

    return nextLoad(url, context);
  },
});

/* Reached with `await import` and never a static import beside the harness
   (`docs/frontend/spec.md` §1.9). */
const { StatusPanel } = await import("@/shared/components/ui/StatusPanel.tsx");
/* Behind the harness too: Next's resolver requires `server-only` as it evaluates, which only the
   harness's resolve hook answers with the empty build. */
const { accumulateMetadata } = await import("next/dist/lib/metadata/resolve-metadata.js");

const APP_DIR = import.meta.dirname;

/** One file name, exactly: `not-found.test.ts` is no boundary, and a suffix test would take it. */
const named = (wanted: string) => (name: string) => name === wanted;

const LAYOUTS = filesUnder(APP_DIR, named("layout.tsx"), 4);
const BOUNDARIES = filesUnder(APP_DIR, named("not-found.tsx"), 2);
const PAGES = filesUnder(APP_DIR, named("page.tsx"), 30);

/**
 * Read off the layouts rather than off the boundaries: a population filtered on the thing this file
 * asserts could never fail, an area with no answer dropping out of the list instead
 * (`docs/_standard/standard.md` PRE-4).
 */
const AREAS = [...new Set(LAYOUTS.map((file) => path.dirname(file)))].filter((dir) => path.dirname(dir) === APP_DIR).sort();

/**
 * A parenthesised name is a route group, so it contributes no url segment and its unmatched
 * addresses are still the root boundary's; a plain name owns a url prefix that nothing else answers.
 */
const isRouteGroup = (dir: string) => path.basename(dir).startsWith("(");

const PREFIXED = AREAS.filter((dir) => !isRouteGroup(dir));
const ROOT_MOUNTED = AREAS.filter(isRouteGroup);

/**
 * The boundaries a 404 meets under the public shell, which carries no `h1`: the root one, and each
 * root-mounted area's. A prefixed area's shell carries the route's `h1` above its boundary.
 */
const UNDER_PUBLIC_SHELL = [path.join(APP_DIR, "not-found.tsx"), ...ROOT_MOUNTED.map((dir) => path.join(dir, "not-found.tsx"))];

/** The url prefix an area occupies, which its own boundary's way out has to stay inside. */
const prefixOf = (dir: string) => `/${path.basename(dir)}`;

const inside = (dir: string) => (file: string) => file.startsWith(dir + path.sep);

/** A segment matching what no sibling route does. Next prefers every static and dynamic sibling. */
const CATCH_ALL = /^\[\.\.\..+\]$/;

/**
 * Read off every page rather than off the areas: a catch-all no area lookup reaches would drop out
 * of the list instead of failing the case below (`docs/_standard/standard.md` PRE-4).
 */
const CATCH_ALLS = PAGES.filter((file) => CATCH_ALL.test(path.basename(path.dirname(file))));

const catchAllsIn = (dir: string) => CATCH_ALLS.filter((file) => path.dirname(path.dirname(file)) === dir);

const SAISON = "2526";

// Under a season, which is the state a boundary inside a shell is served in: the way out is built
// from the query the 404 was answered for.
async function markupOf(boundary: string): Promise<string> {
  const { default: Boundary } = (await import(pathToFileURL(boundary).href)) as { default: () => React.ReactNode };

  return renderTree(underNext(h(Boundary, {}), { search: `saison_id=${SAISON}` }));
}

const MARKUP = new Map(await Promise.all(BOUNDARIES.map(async (file) => [file, await markupOf(file)] as const)));

const hrefsIn = (markup: string) => [...markup.matchAll(/href="([^"]*)"/g)].map((treffer) => treffer[1]!);

/**
 * `StatusPanel`'s own badge and message markup, read off a reference render rather than spelled
 * here, so a restyle of that component moves this file's marks with it instead of failing it.
 */
function marksOf(variant: "page" | "inline"): { badge: string; message: string } {
  const reference = renderTree(
    h(StatusPanel, { variant, badgeLabel: "PROBE-BADGE", heading: "PROBE-HEADING", message: "PROBE-MESSAGE", children: null }),
  );
  const badge = /<span class="([^"]*)">PROBE-BADGE<\/span>/.exec(reference);
  const message = /<p class="([^"]*)">PROBE-MESSAGE<\/p>/.exec(reference);
  // Throw rather than answer "": a mark the reference stopped carrying would leave every case below
  // comparing against the empty string, which every markup contains.
  if (badge === null || message === null) throw new Error(`the ${variant} panel renders no badge or no message to read a mark off`);

  return { badge: badge[1]!, message: message[1]! };
}

describe("the areas a 404 can be met in", () => {
  /* First: a walk that stopped at the segment root would find every area's own layout, miss a
     boundary nested below one, and report that as proof. The two walks share `filesUnder`. */
  it("reaches the segments below the ones it is walking", () => {
    assert.ok(
      LAYOUTS.some((file) => path.dirname(path.dirname(file)) !== APP_DIR),
      "every layout the walk found sits at an area root or above, so it never descended",
    );
  });

  /* One side alone would let every case below pass over an empty list: no prefixed area and the
     catch-all cases assert nothing, no root-mounted one and the root boundary answers for nobody. */
  it("finds an area on each side of the url-segment split", () => {
    assert.ok(PREFIXED.length >= 2, `only ${String(PREFIXED.length)} area(s) own a url prefix, so the catch-all cases run near-empty`);
    assert.ok(ROOT_MOUNTED.length >= 1, "no area is mounted at the root, so nothing is left for the root boundary to answer");
  });
});

describe("where each area's 404 lives", () => {
  /* A boundary placed in a route group answers that group alone: every sibling route falls through
     to the root boundary and loses the shell, which is a gap no area-has-a-boundary count can see. */
  it("gives every area one boundary, at the area root", () => {
    // Root-mounted areas too: Turbopack hands a first-level route group holding no boundary the root
    // file, inside the group's own layout, so that group's 404 wears the shell twice.
    for (const dir of AREAS) {
      assert.deepEqual(
        BOUNDARIES.filter(inside(dir)),
        [path.join(dir, "not-found.tsx")],
        `${path.basename(dir)} is answered by these rather than by one boundary at its root`,
      );
    }
  });

  /* A route group contributes no url segment, so an address no area routes is unmatched, and only
     the root file answers it. */
  it("keeps the root boundary for every address no area routes", () => {
    assert.ok(
      BOUNDARIES.includes(path.join(APP_DIR, "not-found.tsx")),
      "no root boundary stands, so an unmatched address has nothing to land on",
    );
  });

  /* An unmatched address is resolved before any area layout is entered, so a segment that matches
     it is the only thing that can put the area's own shell on its 404. */
  it("matches a mistyped address in every prefixed area", () => {
    for (const dir of PREFIXED) {
      assert.equal(
        catchAllsIn(dir).length,
        1,
        `${prefixOf(dir)} has no one catch-all at its root, so a mistyped address under it is answered by the root boundary`,
      );
    }
  });

  /* A route group contributes no url segment, so a catch-all reached through groups alone is
     mounted at the root however deep it sits (`docs/frontend/spec.md :: I242`). */
  it("puts every catch-all at a prefixed area's root", () => {
    assert.deepEqual(
      CATCH_ALLS.filter((file) => !PREFIXED.includes(path.dirname(path.dirname(file)))),
      [],
      "these catch-alls sit at no prefixed area's root, spending the one real 404 the site still answers",
    );
  });

  /* The hand-off itself, exercised rather than read off the source: a catch-all rendering anything
     at all would serve that page for every mistyped address instead of the area's boundary. */
  it("hands that address to the area's own boundary", async () => {
    for (const dir of PREFIXED) {
      const { default: Route } = (await import(pathToFileURL(catchAllsIn(dir)[0]!).href)) as { default: () => unknown };

      assert.throws(
        () => Route(),
        (error: { digest?: string }) => error.digest === "NEXT_HTTP_ERROR_FALLBACK;404",
        `${prefixOf(dir)}'s catch-all renders rather than answering not-found`,
      );
    }
  });
});

describe("what every 404 is built from", () => {
  /* Read as marks rather than as a structure: hand-rolled markup carries a heading, a paragraph and
     a link like any other, so nothing structural separates one from a panel. */
  it("draws every area's 404 from the one status panel", () => {
    for (const [file, markup] of MARKUP) {
      const marks = marksOf(UNDER_PUBLIC_SHELL.includes(file) ? "page" : "inline");

      assert.ok(
        markup.includes(`class="${marks.badge}"`),
        `${path.relative(APP_DIR, file)} renders no status-panel badge, so it is drawn by hand`,
      );
      assert.ok(markup.includes(`class="${marks.message}"`), `${path.relative(APP_DIR, file)} renders no status-panel message`);
    }
  });

  /* A shell page carries the route's only `h1` (`.claude/rules/frontend.md`), which is what the
     panel's `inline` variant is for; the public shell carries none, so a 404 under it renders
     its own. */
  it("leaves the h1 to the shell wherever one stands above it", () => {
    for (const [file, markup] of MARKUP) {
      if (UNDER_PUBLIC_SHELL.includes(file)) {
        assert.match(markup, /<h1\b/, `${path.relative(APP_DIR, file)} renders no h1, so the page it answers has no heading at all`);
        continue;
      }

      assert.doesNotMatch(markup, /<h1\b/, `${path.relative(APP_DIR, file)} renders a second h1 inside its shell`);
      assert.match(markup, /<h2\b/, `${path.relative(APP_DIR, file)} renders no heading, so the case above passes over an empty panel`);
    }
  });
});

/**
 * Every field a layout sets that a 404 may not keep. Spelled here rather than read off a layout: the
 * root one's `next/font/google` import does not load under this runner, and the claim holds over any.
 */
const LAYOUT_METADATA: Metadata = {
  metadataBase: new URL("https://frankfurtleague.de"),
  description: "Der Spielplan der laufenden Saison.",
  alternates: { canonical: "/dashboard" },
  openGraph: openGraphFor("/dashboard"),
  twitter: { card: "summary_large_image" },
};

/** What a crawler reads for `page` under that layout, merged by Next's own installed resolver. */
const resolvedUnderALayout = (page: Metadata): Promise<ResolvedMetadata> =>
  accumulateMetadata(
    "/probe",
    [
      [LAYOUT_METADATA, null],
      [page, null],
    ],
    Promise.resolve("/probe"),
    { trailingSlash: false, isStaticMetadataRouteFile: false },
  );

/**
 * Every page raising `notFound()` that sets metadata of its own, which is what its 404 is served with. Read off
 * every page rather than listed, so a page added later answers to the same rule.
 */
const RAISING = PAGES.filter((file) => readFileSync(file, "utf8").includes("notFound()"));
const STATIC_ANSWERS = [
  path.join(APP_DIR, "not-found.tsx"),
  ...RAISING.filter((file) => readFileSync(file, "utf8").includes("export const metadata")),
];
const GENERATED_ANSWERS = RAISING.filter((file) => readFileSync(file, "utf8").includes("export async function generateMetadata"));

type GenerateMetadata = (props: NextPageProps<{ saison_id: string; team_id: string }>) => Promise<Metadata>;

/** Every id segment a page reads, well-formed and held by no read, or malformed. */
const MISSES = {
  "an id no read holds": { saison_id: "2099", team_id: "6780e194677bfbfb5ea8396c" },
  "a malformed id": { saison_id: "20266", team_id: "kein-team" },
};

describe("what every 404 tells a crawler", () => {
  /* First: an answer nothing reads would pass the cases below over an empty list. */
  it("finds the root boundary, a catch-all and a page generating its metadata to read", () => {
    assert.ok(STATIC_ANSWERS.length >= 3, `only ${String(STATIC_ANSWERS.length)} static not-found answers were found`);
    assert.ok(GENERATED_ANSWERS.length >= 2, `only ${String(GENERATED_ANSWERS.length)} pages generate the metadata a miss answers with`);
  });

  /* Without a title the tab and a screen reader's page announcement carry the home page's; without the
     resets a matched 404, streamed as a 200 (`docs/frontend/spec.md :: I242`), claims the layout's address. */
  it("answers with the one not-found metadata, on the root boundary and every catch-all", async () => {
    for (const file of STATIC_ANSWERS) {
      const { metadata } = (await import(pathToFileURL(file).href)) as { metadata?: Metadata };

      assert.deepEqual(metadata, NOT_FOUND_METADATA, `${path.relative(APP_DIR, file)} answers not-found with metadata of its own`);
    }
  });

  /* Answered rather than thrown: a `notFound()` from the metadata leaves the tab the layout's title. */
  it("answers with the one not-found metadata wherever a page's generated metadata misses", async () => {
    for (const file of GENERATED_ANSWERS) {
      const { generateMetadata } = (await import(pathToFileURL(file).href)) as { generateMetadata: GenerateMetadata };

      for (const [miss, params] of Object.entries(MISSES)) {
        const metadata = await generateMetadata({ params: Promise.resolve(params), searchParams: Promise.resolve({}) });
        assert.deepEqual(metadata, NOT_FOUND_METADATA, `${path.relative(APP_DIR, file)} answers ${miss} with metadata of its own`);
      }
    }
  });

  /* The resets are Next's to honour, and a reset Next reads as absent would leave every 404 inheriting
     in silence; the layout alone is the control that proves each field is there to lose. */
  it("leaves none of a layout's address, card or description standing once merged", async () => {
    const layoutAlone = await resolvedUnderALayout({});
    assert.ok(
      layoutAlone.alternates?.canonical && layoutAlone.openGraph && layoutAlone.twitter && layoutAlone.description,
      "the layout carries nothing for the 404 to lose",
    );

    const resolved = await resolvedUnderALayout(NOT_FOUND_METADATA);

    assert.equal(resolved.alternates?.canonical ?? null, null, "the 404 claims the layout's canonical");
    assert.equal(resolved.openGraph, null, "the 404 carries the layout's card");
    assert.equal(resolved.twitter, null, "the 404 carries the layout's X card");
    assert.equal(resolved.description, null, "the 404 carries the layout's description");
    assert.equal(resolved.robots?.basic, "noindex", "the 404 may be indexed");
  });
});

describe("where each 404 sends the reader", () => {
  /* The boundaries under the public shell are exempt from both cases below: that area owns no url
     prefix for a way out to stay inside, and the public routes mount no season selector for a link
     to lose. */
  const SHELLED = PREFIXED.map((dir) => {
    const markup = MARKUP.get(path.join(dir, "not-found.tsx"));
    // Throw rather than answer undefined: an area whose boundary has moved would otherwise reach
    // the two cases below as a crash rather than as the placement finding that explains it.
    if (markup === undefined) throw new Error(`${prefixOf(dir)} has no boundary at its root to read a way out off`);

    return [dir, markup] as const;
  });

  /* The root boundary offers the visitor's start page, so a way out leaving the area hands a reader
     back through the front door of a section they were already inside. */
  it("keeps every way out inside its own area", () => {
    for (const [dir, markup] of SHELLED) {
      const hrefs = hrefsIn(markup);

      assert.ok(hrefs.length > 0, `${prefixOf(dir)}'s boundary renders no way out at all`);
      assert.deepEqual(
        hrefs.filter((href) => !href.startsWith(prefixOf(dir))),
        [],
        `these links leave ${prefixOf(dir)}`,
      );
    }
  });

  /* Both shells read the season off the live url, so a way out dropping it returns the whole shell
     to the default season on the way back (`fl_frontend/src/shared/utils/saisonHref.ts`). */
  it("carries the season the 404 was served under", () => {
    for (const [dir, markup] of SHELLED) {
      assert.deepEqual(
        hrefsIn(markup).filter((href) => !href.includes(`saison_id=${SAISON}`)),
        [],
        `these links drop the season ${prefixOf(dir)}'s shell is showing`,
      );
    }
  });
});
