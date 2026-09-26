import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { createElement as h } from "react";

import { filesUnder } from "@/core/treeWalk.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { answerReadsWith, backendNotFound, callPage, EMPTIEST_ANSWER } from "@/shared/testing/pageHarness.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";
import { NOT_FOUND_METADATA } from "@/shared/utils/notFoundMetadata.ts";

import type { PageProps } from "@/shared/testing/pageHarness.ts";
import type { NextPageProps } from "@/shared/types/types";
import type { Metadata, ResolvedMetadata } from "next";

/* The views and forms are doubled whole: no case renders a page's body. */
const VIEW = /\/src\/features\/[a-z]+\/components\/(?:views|forms)\/(\w+)\.tsx$/;

registerHooks({
  load(url, context, nextLoad) {
    const view = VIEW.exec(url);
    if (view !== null) return { format: "module", source: `export const ${view[1]!} = () => null;`, shortCircuit: true };

    return nextLoad(url, context);
  },
});

/* Reached with `await import` and never a static import beside the harness
   (`docs/frontend/spec.md` §1.9). */
const { StatusPanel } = await import("@/shared/components/ui/StatusPanel.tsx");
const { ShellSaisonQueryProvider } = await import("@/shared/components/layout/shell/ShellSaisonQuery.tsx");
/* Behind the harness too: Next's resolver requires `server-only` as it evaluates, which only
   `renderTest.ts`'s resolve hook answers with the package's empty build. */
const { accumulateMetadata } = await import("next/dist/lib/metadata/resolve-metadata.js");

const APP_DIR = import.meta.dirname;

/** One file name, exactly: `not-found.test.ts` is no boundary, and a suffix test would take it. */
const named = (wanted: string) => (name: string) => name === wanted;

const LAYOUTS = filesUnder(APP_DIR, named("layout.tsx"), 4);
const BOUNDARIES = filesUnder(APP_DIR, named("not-found.tsx"), 2);
const PAGES = filesUnder(APP_DIR, named("page.tsx"), 30);

const LAYOUT_DIRS = [...new Set(LAYOUTS.map((file) => path.dirname(file)))].filter((dir) => dir !== APP_DIR);

// The outermost layout on its branch, at whatever depth: `bereich` holds none, so each word under it
// is an area of its own.
/**
 * Read off the layouts rather than off the boundaries: a population filtered on the thing this file
 * asserts could never fail, an area with no answer dropping out of the list instead
 * (`docs/_standard/standard.md` PRE-4).
 */
const AREAS = LAYOUT_DIRS.filter((dir) => !LAYOUT_DIRS.some((outer) => dir.startsWith(outer + path.sep))).sort();

const segmentsOf = (dir: string) => path.relative(APP_DIR, dir).split(path.sep);

/**
 * A parenthesised name is a route group, so it contributes no url segment and its unmatched
 * addresses are still the root boundary's; a plain name owns a url prefix that nothing else answers.
 */
const isRouteGroup = (segment: string) => segment.startsWith("(");

const isRootMounted = (dir: string) => segmentsOf(dir).every(isRouteGroup);

const PREFIXED = AREAS.filter((dir) => !isRootMounted(dir));
const ROOT_MOUNTED = AREAS.filter(isRootMounted);

/**
 * The boundaries a 404 meets under the public shell, which carries no `h1`: the root one, and each
 * root-mounted area's. A prefixed area's shell carries the route's `h1` above its boundary.
 */
const UNDER_PUBLIC_SHELL = [path.join(APP_DIR, "not-found.tsx"), ...ROOT_MOUNTED.map((dir) => path.join(dir, "not-found.tsx"))];

/** A segment the address fills in: `[team_id]` takes whatever team the reader asked for. */
const DYNAMIC = /^\[(\w+)\]$/;

/** What a dynamic segment is served under, so an area's prefix and its boundary's params agree. */
const probeOf = (name: string) => `probe-${name}`;

const paramsOf = (dir: string): Record<string, string> =>
  Object.fromEntries(segmentsOf(dir).flatMap((segment) => (DYNAMIC.exec(segment) ?? []).slice(1).map((name) => [name, probeOf(name)])));

/** The url segments an area occupies, `[team_id]` standing for whatever one segment the address holds there. */
const patternOf = (dir: string) => segmentsOf(dir).filter((segment) => !isRouteGroup(segment));

/**
 * The url prefix an area occupies, which its own boundary's way out has to stay inside: filled in, as
 * the reader's address is, because a way out holding `[team_id]` literally links nowhere.
 */
const prefixOf = (dir: string) =>
  `/${patternOf(dir)
    .map((segment) => {
      const name = DYNAMIC.exec(segment)?.[1];
      return name === undefined ? segment : probeOf(name);
    })
    .join("/")}`;

/** An address's path, cut into its segments, its query and fragment dropped. */
const pathSegmentsOf = (href: string) => (href.split(/[?#]/)[0] ?? "").split("/").filter(Boolean);

/**
 * The area an address lands in: the deepest whose segments it opens with, so `/bereich/admin` is an
 * area of its own and never the one at `/bereich` around it.
 */
function areaOf(href: string, areas: readonly string[]): string | undefined {
  const segments = pathSegmentsOf(href);
  const staticDepth = (dir: string) => patternOf(dir).filter((segment) => !DYNAMIC.test(segment)).length;

  return (
    areas
      .filter((dir) =>
        patternOf(dir).every((segment, index) => segments[index] !== undefined && (DYNAMIC.test(segment) || segment === segments[index])),
      )
      // A static segment outranks a dynamic one at equal depth, as it does in Next's own matching.
      .sort((one, other) => patternOf(other).length - patternOf(one).length || staticDepth(other) - staticDepth(one))[0]
  );
}

/**
 * The ways out of `dir`'s boundary that leave it: into another area, or onto another team or season
 * than the one its dynamic segments were served under.
 */
function strayWaysOut(dir: string, hrefs: readonly string[], areas: readonly string[]): string[] {
  const served = pathSegmentsOf(prefixOf(dir));

  return hrefs.filter((href) => areaOf(href, areas) !== dir || served.some((segment, index) => pathSegmentsOf(href)[index] !== segment));
}

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

// Under a season, which is the state a boundary inside a shell is served in, and under either answer a
// shell gives to whether that season rides the query: the way out is built from both.
async function markupOf(boundary: string, keepsSaisonQuery: boolean): Promise<string> {
  const { default: Boundary } = (await import(pathToFileURL(boundary).href)) as { default: () => React.ReactNode };

  // Under the params its own area is served with: a boundary inside a dynamic segment builds its way
  // out from them, and with none it has no address to stay inside.
  return renderTree(
    underNext(h(ShellSaisonQueryProvider, { keepsSaisonQuery, children: h(Boundary, {}) }), {
      search: `saison_id=${SAISON}`,
      params: paramsOf(path.dirname(boundary)),
    }),
  );
}

/** Each boundary under a shell keeping its season out of the query, which every case but one reads. */
const MARKUP = new Map(await Promise.all(BOUNDARIES.map(async (file) => [file, await markupOf(file, false)] as const)));
/** The same boundaries under a shell keeping it there. */
const MARKUP_KEEPING = new Map(await Promise.all(BOUNDARIES.map(async (file) => [file, await markupOf(file, true)] as const)));

const hrefsIn = (markup: string) => [...markup.matchAll(/href="([^"]*)"/g)].map((treffer) => treffer[1]!);

/** The season a way out's query names, read off the query alone: a probe segment spells `saison_id` too. */
const saisonQueryOf = (href: string) => new URL(href, "http://probe").searchParams.get("saison_id");

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
    // An area's own layout proves no descent however deep it sits: `bereich` holds none, so its
    // areas' own layouts sit two segments down.
    assert.ok(
      LAYOUT_DIRS.some((dir) => !AREAS.includes(dir)),
      "every layout the walk found is an area's own, so it never descended below one",
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

/** Every field the root layout sets, each of which a 404 under it may not keep. */
const { metadata: LAYOUT_METADATA } = await import("./layout.tsx");

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

type GenerateMetadata = (props: NextPageProps<{ saison_id: string; team_id: string }>) => Promise<Metadata>;

type PageModule = { default: (props: PageProps) => unknown; metadata?: Metadata; generateMetadata?: GenerateMetadata };

/** Every id segment a page reads, well-formed and held by no read, or malformed. */
const MISSES = {
  "an id no read holds": { saison_id: "2099", team_id: "6780e194677bfbfb5ea8396c" },
  "a malformed id": { saison_id: "20266", team_id: "kein-team" },
};

const MISSED = new Set(Object.values(MISSES).flatMap((params) => Object.values(params)));

// A read naming the id the address names finds nothing, as the backend answers a miss; every other
// read finds the emptiest body its schema takes.
answerReadsWith((endpoint, schema, params) => {
  if (![...endpoint.split("/"), ...Object.values(params)].some((part) => MISSED.has(String(part))))
    return EMPTIEST_ANSWER(endpoint, schema, params);

  throw backendNotFound(endpoint);
});

const raisesNotFound = async (Page: PageModule["default"]): Promise<boolean> => {
  for (const params of Object.values(MISSES)) {
    const { thrown } = await callPage(Page, { params: Promise.resolve(params), searchParams: Promise.resolve({}) });
    if (thrown.some((error) => (error as { digest?: unknown } | null)?.digest === "NEXT_HTTP_ERROR_FALLBACK;404")) return true;
  }

  return false;
};

/**
 * Every page answering a miss with a 404 that sets metadata of its own, which is what its 404 is
 * served with: each page loaded and called, so a page added later answers to the same rule.
 */
const RAISING: { file: string; loaded: PageModule }[] = [];
for (const file of PAGES) {
  const loaded = (await import(pathToFileURL(file).href)) as PageModule;
  if ((loaded.metadata !== undefined || loaded.generateMetadata !== undefined) && (await raisesNotFound(loaded.default)))
    RAISING.push({ file, loaded });
}

const STATIC_ANSWERS = [
  path.join(APP_DIR, "not-found.tsx"),
  ...RAISING.filter(({ loaded }) => loaded.metadata !== undefined).map(({ file }) => file),
];
const GENERATED_ANSWERS = RAISING.filter(({ loaded }) => loaded.generateMetadata !== undefined).map(({ file }) => file);

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
  /* The boundaries under the public shell are exempt from the cases below: that area owns no url
     prefix for a way out to stay inside, and the public routes mount no season selector for a link
     to lose. */
  const SHELLED = PREFIXED.map((dir) => {
    const file = path.join(dir, "not-found.tsx");
    const markup = MARKUP.get(file);
    const keeping = MARKUP_KEEPING.get(file);
    // Throw rather than answer undefined: an area whose boundary has moved would otherwise reach
    // the cases below as a crash rather than as the placement finding that explains it.
    if (markup === undefined || keeping === undefined) throw new Error(`${prefixOf(dir)} has no boundary at its root to read a way out off`);

    return { dir, markup, keeping };
  });

  /* The root boundary offers the visitor's start page, so a way out leaving the area hands a reader
     back through the front door of a section they were already inside. */
  it("keeps every way out inside its own area", () => {
    for (const { dir, markup } of SHELLED) {
      const hrefs = hrefsIn(markup);

      assert.ok(hrefs.length > 0, `${prefixOf(dir)}'s boundary renders no way out at all`);
      assert.deepEqual(strayWaysOut(dir, hrefs, AREAS), [], `these links leave ${prefixOf(dir)}`);
    }
  });

  /* The reader above, held against areas the tree need not hold: an outer area's prefix holds every
     area nested in it, and the right team in another season still leaves the served address. */
  it("tells an area from the one around it, and the served season from another", () => {
    const person = path.join(APP_DIR, "bereich", "(persoenlich)");
    const admin = path.join(APP_DIR, "bereich", "admin");
    const team = path.join(APP_DIR, "bereich", "team", "[team_id]", "[saison_id]");
    const areas = [path.join(APP_DIR, "(public)"), person, admin, team];
    const served = prefixOf(team);

    assert.deepEqual(strayWaysOut(person, ["/bereich", "/bereich/admin", "/bereich/adminbereich"], areas), ["/bereich/admin"]);
    assert.deepEqual(strayWaysOut(admin, ["/bereich/admin/teams", "/bereich"], areas), ["/bereich"]);
    assert.deepEqual(strayWaysOut(person, [`${served}/kader`], areas), [`${served}/kader`]);
    assert.deepEqual(strayWaysOut(team, [served, `${served}/kader?x=1`, "/bereich/team/probe-team_id/2425", "/bereich"], areas), [
      "/bereich/team/probe-team_id/2425",
      "/bereich",
    ]);
  });

  /* A shell keeping the season in the query reads it off the live url, so a way out dropping it
     returns the whole shell to the default season on the way back
     (`fl_frontend/src/shared/utils/saisonHref.ts`). */
  it("carries the season the 404 was served under where the shell keeps it in the query", () => {
    for (const { dir, keeping } of SHELLED) {
      assert.deepEqual(
        hrefsIn(keeping).filter((href) => saisonQueryOf(href) !== SAISON),
        [],
        `these links drop the season ${prefixOf(dir)}'s shell is showing`,
      );
    }
  });

  /* A shell whose season is in the path, or which has none, would otherwise put a `?saison_id=` the
     area never reads on every way out of its 404. */
  it("carries no season where the shell keeps none in the query", () => {
    for (const { dir, markup } of SHELLED) {
      assert.deepEqual(
        hrefsIn(markup).filter((href) => saisonQueryOf(href) !== null),
        [],
        `these links carry a season ${prefixOf(dir)}'s shell keeps out of the query`,
      );
    }
  });
});
