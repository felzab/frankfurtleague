import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { createElement as h } from "react";
/* No public export carries any of the three, and each boundary reads one. A Next release that moves
   a module fails this file at import rather than quietly. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

import { filesUnder } from "@/core/treeWalk.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";

import type { ReactNode } from "react";

/* Reached with `await import` and never a static import beside the harness
   (`docs/frontend/spec.md` §1.9). */
const { StatusPanel } = await import("@/shared/components/ui/StatusPanel.tsx");
const { ctaButton } = await import("@/shared/components/ui/formButtons.ts");

const APP_DIR = import.meta.dirname;

/** One file name, exactly: a suffix test would take `not-found.test.ts`, which is no boundary. */
const named = (wanted: string) => (name: string) => name === wanted;

const isBoundary = (name: string) => name === "error.tsx" || name === "not-found.tsx";

/**
 * Read off the layouts rather than off the boundaries, so an area that answers one of the two
 * states and not the other drops into the first case below instead of out of the population
 * (`docs/_standard/standard.md` PRE-4).
 */
const LAYOUTS = filesUnder(APP_DIR, named("layout.tsx"), 4);
const BOUNDARIES = filesUnder(APP_DIR, isBoundary, 6);

/** Every segment a reader can be standing inside: the root, and each layout's own directory. */
const AREAS = [...new Set([APP_DIR, ...LAYOUTS.map((file) => path.dirname(file))])].sort();

const shown = (file: string) => path.relative(APP_DIR, file).split(path.sep).join("/");

/**
 * What Next resolves for a segment inside `dir`: the nearest boundary of that name at or above it.
 * A route group holds no boundary of its own and inherits the root's, which is a pairing rather
 * than a gap.
 */
function nearest(dir: string, name: string): string | null {
  for (let at = dir; ; at = path.dirname(at)) {
    if (BOUNDARIES.includes(path.join(at, name))) return path.join(at, name);
    if (at === APP_DIR) return null;
  }
}

/** The two answers one area gives: the crash it renders, and the address it cannot resolve. */
const PAIRS = AREAS.map((dir) => ({ dir, crash: nearest(dir, "error.tsx"), missing: nearest(dir, "not-found.tsx") }));

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

/** A digest, so the boundary renders the line it carries one on and reports nothing a second time. */
const CRASH = Object.assign(new globalThis.Error("kaputt"), { digest: "PROBE-DIGEST" });

type Boundary = (props: { error: Error & { digest?: string }; reset: () => void }) => ReactNode;

/* Under a season and a route, which is the state either boundary is served in: a way out is built
   from the query and the path the answer was rendered for. */
async function markupOf(file: string): Promise<string> {
  const { default: Render } = (await import(pathToFileURL(file).href)) as { default: Boundary };

  return renderTree(
    h(
      AppRouterContext.Provider,
      { value: ROUTER },
      h(
        PathnameContext.Provider,
        { value: "/nirgendwo" },
        h(
          SearchParamsContext.Provider,
          { value: new URLSearchParams(`saison_id=${SAISON}`) },
          /* A not-found boundary takes the crash props and ignores them, so one reader reaches
             both kinds. */
          h(Render, { error: CRASH, reset: () => undefined }),
        ),
      ),
    ),
  );
}

const MARKUP = new Map(await Promise.all(BOUNDARIES.map(async (file) => [file, await markupOf(file)] as const)));

/** The markup an area answers with, which every case below reads rather than the file's source. */
function answerOf(file: string | null): string {
  const markup = file === null ? undefined : MARKUP.get(file);
  // Throw rather than answer "": a boundary this reader never rendered would leave every case
  // comparing against the empty string, which matches nothing and fails as if the copy were wrong.
  if (markup === undefined) throw new Error(`${String(file)} is not among the boundaries this sweep rendered`);

  return markup;
}

const VARIANTS = ["page", "inline"] as const;
const INTENTS = ["primary", "outline"] as const;
const HOVERS = ["aria", "css"] as const;

const classesOf = (recipe: string) => recipe.split(" ").filter(Boolean);

/**
 * `StatusPanel`'s own message markup, read off a reference render rather than spelled here, so a
 * restyle of that component moves this file's marks with it instead of failing it.
 */
function messageMarkOf(variant: (typeof VARIANTS)[number]): string {
  const reference = renderTree(h(StatusPanel, { variant, badgeLabel: "PROBE", heading: "PROBE", message: "PROBE-MESSAGE", children: null }));
  // The message rather than the badge: the badge's own label carries no variant arm to tell the two
  // panels apart.
  const message = /<p class="([^"]*)">PROBE-MESSAGE<\/p>/.exec(reference);
  if (message === null) throw new Error(`the ${variant} panel renders no message to read a mark off`);

  return message[1]!;
}

const MESSAGE_MARK = new Map(VARIANTS.map((variant) => [variant, messageMarkOf(variant)]));

/** Every arm of the recipe a way out is dressed in, each held as the classes it emits. */
const RECIPES = INTENTS.flatMap((intent) => HOVERS.map((hover) => ({ intent, hover, classes: classesOf(ctaButton({ intent, hover })) })));

/** What every arm shares, which is what says an element is a way out at all rather than a link. */
const SHARED = RECIPES.reduce<string[]>(
  (held, recipe) => held.filter((klasse) => recipe.classes.includes(klasse)),
  classesOf(ctaButton({ intent: "primary", hover: "aria" })),
);

type WayOut = { host: string; intent: string; hover: string };

/**
 * Every way out one answer renders, each as the host it sits on and the arm it wears.
 */
function waysOutOf(markup: string): WayOut[] {
  return [...markup.matchAll(/<(a|button)\b([^>]*)>/g)].flatMap(([, host, attributes]) => {
    // Read off the emitted classes rather than off the call site, a literal spelling those classes
    // being a way out a source-text reader would miss.
    const classes = classesOf(/\bclass="([^"]*)"/.exec(attributes ?? "")?.[1] ?? "");
    if (!SHARED.every((klasse) => classes.includes(klasse))) return [];

    const worn = RECIPES.filter((recipe) => recipe.classes.every((klasse) => classes.includes(klasse)));
    assert.equal(worn.length, 1, `a way out wears ${String(worn.length)} of the recipe's arms, so nothing below can name the one it is`);

    return [{ host: host!, intent: worn[0]!.intent, hover: worn[0]!.hover }];
  });
}

/** The hover a host can actually report, which is the whole of what decides the arm (`ctaButton`). */
const HOVER_FOR_HOST: Record<string, string> = { a: "css", button: "aria" };

describe("the population this pairing is read over", () => {
  /* One side alone would let every case below pass over an empty list: no second pair and the
     comparison is one answer against itself, no way out and it is two empty lists. */
  it("holds more than one area, each answering with a way out", () => {
    assert.ok(PAIRS.length >= 2, `only ${String(PAIRS.length)} area(s) stand, so a pairing compares an answer against itself`);

    for (const [file, markup] of MARKUP) {
      assert.notEqual(waysOutOf(markup).length, 0, `${shown(file)} renders no way out, so its half of the pairing is an empty list`);
    }
  });

  /* Four arms that render alike would make every comparison below true by construction, which is
     how a retokenised recipe turns this whole file green and silent. */
  it("dresses the four arms of the recipe differently enough to tell apart", () => {
    for (const recipe of RECIPES) {
      const twins = RECIPES.filter((other) => other !== recipe && recipe.classes.every((klasse) => other.classes.includes(klasse)));

      assert.deepEqual(twins, [], `ctaButton's ${recipe.intent}/${recipe.hover} arm renders inside another, so the two cannot be told apart`);
    }

    assert.notEqual(SHARED.length, 0, "the four arms share no class, so nothing in a markup can be recognised as a way out");
  });
});

describe("what each area answers a crash and a missing page with", () => {
  /* An area with one of the two falls back to the root boundary for the other, which hands a reader
     inside a shell the visitor's chrome for one of the two states and not the other. */
  it("gives every area both answers", () => {
    for (const { dir, crash, missing } of PAIRS) {
      assert.ok(crash !== null, `${shown(dir)} resolves no error boundary, so a crash there reaches the browser bare`);
      assert.ok(missing !== null, `${shown(dir)} resolves no not-found boundary`);
    }
  });

  /* Read as marks rather than as a structure: hand-rolled markup carries a badge, a heading and a
     link like any other, so nothing structural separates one from a panel. */
  it("draws both from the one status panel, at the one variant", () => {
    assert.notEqual(
      MESSAGE_MARK.get("page"),
      MESSAGE_MARK.get("inline"),
      "the two panels render the same message mark, so this case cannot tell a page answer from an inline one",
    );

    for (const { dir, crash, missing } of PAIRS) {
      const variantOf = (file: string | null) => VARIANTS.filter((variant) => answerOf(file).includes(`class="${MESSAGE_MARK.get(variant)!}"`));

      assert.deepEqual(
        variantOf(crash),
        variantOf(missing),
        `${shown(dir)} answers its crash and its missing page with different panels, so the two read as two designs`,
      );
      assert.equal(variantOf(crash).length, 1, `${shown(dir)}'s answers are drawn by hand rather than from the status panel`);
    }
  });

  /* The pairing itself. A reader who meets a broken route and a missing page in one area meets the
     same object twice, and the grade of its way out is the loudest thing about it. */
  it("offers the same kind of way out on both", () => {
    for (const { dir, crash, missing } of PAIRS) {
      const graded = (file: string | null) =>
        waysOutOf(answerOf(file))
          .map((way) => way.intent)
          .sort();

      assert.deepEqual(
        graded(crash),
        graded(missing),
        `${shown(dir)} grades the way out of a crash and of a missing page differently, so one of the two ranks itself above the other`,
      );
    }
  });
});

describe("the hover each way out is dressed for", () => {
  /* react-aria's `useHover` discards a touch pointer and writes no attribute for one, so a `css`
     arm on a `Button` latches after a tap and an `aria` arm on a link never paints at all. */
  it("takes the arm its own host can report", () => {
    for (const [file, markup] of MARKUP) {
      for (const way of waysOutOf(markup)) {
        assert.equal(
          way.hover,
          HOVER_FOR_HOST[way.host],
          `${shown(file)} dresses a <${way.host}> way out in the ${way.hover} arm, which that element cannot report`,
        );
      }
    }
  });
});
