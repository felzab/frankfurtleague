import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";
/* Neither context has a public export, and the boundaries read both. A Next release that moves
   either module fails this file at import rather than quietly. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

import { renderTree } from "@/shared/testing/renderTest.ts";

/* Reached with `await import` and never a static import beside the harness: the JSX compile step is
   registered as `renderTest` evaluates, and a static import resolves before that. */
const { PublicShell } = await import("./shell/PublicShell.tsx");
const { default: PublicLayout } = await import("@/app/(public)/layout.tsx");
const { default: NotfoundPage } = await import("@/app/not-found.tsx");
const { default: PublicNotFound } = await import("@/app/(public)/not-found.tsx");
const { default: PublicErrorBoundary } = await import("@/app/(public)/error.tsx");

const router = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: "",
};

const SHELL = renderTree(h(PublicShell, { serverStatusSlot: null, children: null }));
const PUBLIC_PAGE = renderTree(h(PublicLayout, { children: null }));
const UNMATCHED_URL = renderTree(h(AppRouterContext.Provider, { value: router }, h(NotfoundPage, {})));

/* Each of the group's boundaries as the layout's child, which is where Next mounts one when a public
   route throws. */
const MATCHED_NOT_FOUND = renderTree(h(AppRouterContext.Provider, { value: router }, h(PublicLayout, { children: h(PublicNotFound, {}) })));
const MATCHED_CRASH = renderTree(
  h(
    AppRouterContext.Provider,
    { value: router },
    h(
      PathnameContext.Provider,
      { value: "/bewerbung/abc" },
      h(PublicLayout, { children: h(PublicErrorBoundary, { error: new globalThis.Error("kaputt"), reset: () => undefined }) }),
    ),
  ),
);

/** One element of the shell's own markup, by the tag it opens — the first, where a tag repeats. */
function element(tag: string): string {
  const treffer = new RegExp(`<${tag}\\b[^>]*>`).exec(SHELL);
  // Throw rather than answer "": an element the shell stopped rendering would leave the cases
  // reading it asserting things about the empty string.
  if (treffer === null) throw new Error(`the shell renders no <${tag}>`);

  return treffer[0];
}

const SKIP_LINK = element("a");
const HEADER = element("header");
const MAIN = element("main");
const FOOTER = element("footer");

/** How often markup opens one of the shell's elements, read by that element's exact opening tag. */
const opened = (markup: string, openingTag: string): number => markup.split(openingTag).length - 1;

const klassen = (openingTag: string): string[] => (/\sclass="([^"]*)"/.exec(openingTag)?.[1] ?? "").split(" ");

/** The hrefs of one footer column, in the order that column renders them. */
function spaltenLinks(name: string): string[] {
  const spalte = new RegExp(`<nav aria-label="${name}"[^>]*>([\\s\\S]*?)</nav>`).exec(SHELL);
  // Throw rather than answer an empty list, which every comparison below would pass over.
  if (spalte === null) throw new Error(`the footer renders no column labelled ${name}`);

  return [...spalte[1]!.matchAll(/href="([^"]*)"/g)].map((treffer) => treffer[1]!);
}

describe("where the public shell puts its footer", () => {
  /* A page shorter than the screen would otherwise park the footer at the bottom of the first one,
     where it reads as the end of a page the reader has not started. */
  it("holds the footer off the first screen", () => {
    assert.ok(
      klassen(MAIN).some((token) => token.startsWith("min-h-[calc(100dvh-var(--navbar-height)")),
      `the main region is sized ${MAIN}, so the footer rises into the first screen`,
    );
  });

  /* Every pixel the floor overshoots by is blank the reader scrolls past on a short page, and the
     header's border is outside the token the floor reads: `box-content` puts it there. */
  it("measures that floor against the header's whole box", () => {
    for (const token of ["box-content", "h-(--navbar-height)", "border-b"]) {
      assert.ok(klassen(HEADER).includes(token), `the header is sized ${HEADER}, which no longer wears its border outside its height`);
    }

    assert.ok(
      klassen(MAIN).includes("min-h-[calc(100dvh-var(--navbar-height)-1px)]"),
      `the floor is ${MAIN}, read off the navbar token alone, so it overshoots the first screen by the header's border`,
    );
  });

  /* A height the columns outgrow stops the fill where the separator and the copyright row are still
     being drawn, which is what a reader sees as the footer's bottom half falling off it. */
  it("gives the footer's fill a floor and never a height", () => {
    assert.ok(klassen(FOOTER).includes("lg:min-h-[220px]"), `the footer is sized ${FOOTER}, so its wide-viewport size is not a floor`);
    assert.ok(!klassen(FOOTER).includes("lg:h-[220px]"), `the footer is sized ${FOOTER}, to a height its columns can outgrow`);
  });

  /* A `<footer>` nested in another is invalid, and a screen reader lists the page's contentinfo
     landmark twice, so the second copy reads as a second footer. */
  it("opens one contentinfo landmark", () => {
    assert.equal(opened(SHELL, "<footer"), 1, `the shell opens ${String(opened(SHELL, "<footer"))} footers`);
  });
});

describe("which pages the public shell reaches", () => {
  /* Every public page is a child of this one layout and reaches the shell through nothing else, so
     the assertions above measure a shell no page wears the moment it stops mounting one. */
  it("carries every page in the public route group", () => {
    assert.ok(PUBLIC_PAGE.includes(SKIP_LINK), "the public pages lose their skip link");
    assert.ok(PUBLIC_PAGE.includes(MAIN), "the public pages lose the region the shell gives its footer a floor against");
    assert.ok(PUBLIC_PAGE.includes(FOOTER), "the public pages lose their footer");
  });

  /* The root not-found file sits above the `(public)` route group and is handed none of that group's
     layout, so an unmatched URL carries the shell only while this page renders it. */
  it("carries the page an unmatched URL lands on", () => {
    assert.ok(UNMATCHED_URL.includes(SKIP_LINK), "an unmatched URL meets a page with no skip link");
    assert.ok(UNMATCHED_URL.includes(MAIN), "an unmatched URL meets a page outside the region the shell wraps a page in");
    assert.ok(UNMATCHED_URL.includes(FOOTER), "an unmatched URL meets a page with no footer on it");
  });

  /* A public route's own `notFound()` and crash render inside that layout, so a boundary drawing the
     shell itself stacks a second navbar, main region and footer under the first. */
  it("carries a public route's own 404 and crash inside the one shell", () => {
    for (const [answer, markup] of [
      ["404", MATCHED_NOT_FOUND],
      ["crash", MATCHED_CRASH],
    ] as const) {
      for (const [landmark, openingTag] of [
        ["skip link", SKIP_LINK],
        ["header", HEADER],
        ["main region", MAIN],
        ["footer", FOOTER],
      ] as const) {
        assert.equal(
          opened(markup, openingTag),
          1,
          `a public route's ${answer} renders the shell's ${landmark} ${String(opened(markup, openingTag))} times`,
        );
      }
    }
  });

  /* A reader who mistypes an address and one following a stale link to a season meet one dead end,
     so the two arrivals render one page. */
  it("renders a public route's 404 as the page an unmatched URL lands on", () => {
    assert.equal(MATCHED_NOT_FOUND, UNMATCHED_URL, "a public route's 404 and an unmatched URL render different pages");
  });
});

describe("what the footer offers a reader", () => {
  /* Both columns render through one component, so which links each holds is the whole of what can
     differ between them. */
  it("keeps the legal pages in a column of their own", () => {
    assert.deepEqual(spaltenLinks("Navigation"), ["/about", "/organisation", "/kontakt"]);
    assert.deepEqual(spaltenLinks("Rechtliches"), ["/impressum", "/datenschutz"]);
  });

  /* An untitled column is a list a reader has to identify from its entries, and two `<nav>`s in one
     landmark are told apart by their names alone. */
  it("titles every column it offers", () => {
    for (const titel of ["Navigation", "Rechtliches", "Socials"]) {
      assert.ok(SHELL.includes(`>${titel}</h2>`), `the footer renders no column headed ${titel}`);
    }

    for (const benannt of ["Navigation", "Rechtliches"]) {
      assert.ok(SHELL.includes(`<nav aria-label="${benannt}"`), `the footer's ${benannt} links are a landmark a reader cannot name`);
    }
  });

  /* The shell carries no `h1` and every page it wraps carries one, so a heading here below `h2`
     skips a rung in the outline a screen reader navigates by. */
  it("heads its columns on the rung under the page's own heading", () => {
    const rungs = [...SHELL.matchAll(/<h([1-6])\b/g)].map((treffer) => Number(treffer[1]));

    // First: an empty list passes the rung check below.
    assert.ok(rungs.length > 0, "the shell renders no heading at all, so the rung check reads nothing");
    assert.deepEqual(
      rungs.filter((rung) => rung !== 2),
      [],
      `the shell heads something on these rungs rather than h2: ${rungs.join(", ")}`,
    );
  });
});
