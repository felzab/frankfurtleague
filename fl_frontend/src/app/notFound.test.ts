import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { createElement as h } from "react";
/* No public export carries either context, so a Next release that moves either module fails this
   file at import rather than quietly. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

import { filesUnder } from "@/core/treeWalk.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";

/* Reached with `await import` and never a static import beside the harness
   (`docs/frontend/spec.md` §1.9). */
const { StatusPanel } = await import("@/shared/components/ui/StatusPanel.tsx");

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

/** The url prefix an area occupies, which its own boundary's way out has to stay inside. */
const prefixOf = (dir: string) => `/${path.basename(dir)}`;

const inside = (dir: string) => (file: string) => file.startsWith(dir + path.sep);

/** A segment matching what no sibling route does. Next prefers every static and dynamic sibling. */
const CATCH_ALL = /^\[\.\.\..+\]$/;

const catchAllsIn = (dir: string) =>
  PAGES.filter((file) => path.dirname(path.dirname(file)) === dir && CATCH_ALL.test(path.basename(path.dirname(file))));

/** What `Link` reads off `useRouter`. `bfcacheId` is a value rather than a call. */
const ROUTER = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: "",
};

const SAISON = "2526";

// Under a season, which is the state a boundary inside a shell is served in: the way out is built
// from the query the 404 was answered for.
async function markupOf(boundary: string): Promise<string> {
  const { default: Boundary } = (await import(pathToFileURL(boundary).href)) as { default: () => React.ReactNode };

  return renderTree(
    h(
      AppRouterContext.Provider,
      { value: ROUTER },
      h(SearchParamsContext.Provider, { value: new URLSearchParams(`saison_id=${SAISON}`) }, h(Boundary, {})),
    ),
  );
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
  it("gives every prefixed area one boundary, at the area root", () => {
    for (const dir of PREFIXED) {
      assert.deepEqual(
        BOUNDARIES.filter(inside(dir)),
        [path.join(dir, "not-found.tsx")],
        `${prefixOf(dir)} is answered by these, so some of it resolves past the area's own boundary`,
      );
    }
  });

  /* A route group contributes no url segment, so an address it does not route is unmatched rather
     than its own, and the root boundary is already wearing that area's shell. */
  it("leaves a root-mounted area to the root boundary", () => {
    assert.ok(
      BOUNDARIES.includes(path.join(APP_DIR, "not-found.tsx")),
      "no root boundary stands, so an unmatched address has nothing to land on",
    );

    for (const dir of ROOT_MOUNTED) {
      assert.deepEqual(
        BOUNDARIES.filter(inside(dir)),
        [],
        `${path.basename(dir)} carries a boundary of its own, which only a matched route could reach`,
      );
    }
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

  /* Adding one to a root-mounted area would make its unmatched addresses match, which is what
     turns the routing layer's own 404 into a streamed 200 (`docs/frontend/spec.md :: I232`). */
  it("adds none to a root-mounted area", () => {
    for (const dir of ROOT_MOUNTED) {
      assert.deepEqual(
        catchAllsIn(dir),
        [],
        `${path.basename(dir)} routes what nothing else does, spending the one real 404 the site still answers`,
      );
    }
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
      const marks = marksOf(file === path.join(APP_DIR, "not-found.tsx") ? "page" : "inline");

      assert.ok(
        markup.includes(`class="${marks.badge}"`),
        `${path.relative(APP_DIR, file)} renders no status-panel badge, so it is drawn by hand`,
      );
      assert.ok(markup.includes(`class="${marks.message}"`), `${path.relative(APP_DIR, file)} renders no status-panel message`);
    }
  });

  /* A shell page carries the route's only `h1` (`.claude/rules/frontend.md`), which is what the
     panel's `inline` variant is for; the root boundary wears no shell and renders its own. */
  it("leaves the h1 to the shell wherever one stands above it", () => {
    for (const [file, markup] of MARKUP) {
      if (file === path.join(APP_DIR, "not-found.tsx")) {
        assert.match(markup, /<h1\b/, "the root boundary renders no h1, so the page it answers has no heading at all");
        continue;
      }

      assert.doesNotMatch(markup, /<h1\b/, `${path.relative(APP_DIR, file)} renders a second h1 inside its shell`);
      assert.match(markup, /<h2\b/, `${path.relative(APP_DIR, file)} renders no heading, so the case above passes over an empty panel`);
    }
  });
});

describe("where each 404 sends the reader", () => {
  /* The root boundary is exempt from both cases below: it renders the public shell, whose footer
     links are the shell's own rather than the 404's, and the public routes mount no season
     selector for a link to lose. */
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
