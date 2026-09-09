import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";
/* Neither context has a public export, and each panel reads one. A Next release that moves either
   module fails this file at import rather than quietly. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

import { renderTree } from "@/shared/testing/renderTest.ts";

import type { ReactNode } from "react";

/* Reached with `await import` and never a static import beside the harness: the JSX compile step is
   registered as `renderTest` evaluates, and a static import resolves before that. */
const { Error: ErrorPanel } = await import("./Error.tsx");
const { NotFound } = await import("./NotFound.tsx");
const { StatusPanel } = await import("./StatusPanel.tsx");
const { PublicShell } = await import("../layout/shell/PublicShell.tsx");
const { default: PublicErrorBoundary } = await import("../../../app/(public)/error.tsx");

const router = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: "",
};

/** The opening element's classes. On both panels that element is the box the panel is sized to. */
const rootClasses = (markup: string): string => markup.match(/^<[a-z]+ class="([^"]*)"/)?.[1] ?? "";

/** The `<main>` the shell wraps a public route in, whose floor is the fold the footer sits under. */
const shellMainClasses = (markup: string): string => markup.match(/<main [^>]*class="([^"]*)"/)?.[1] ?? "";

/** The panel's own box under the shell, which is the first element that `<main>` wraps. */
const shelledPanelClasses = (markup: string): string => markup.match(/<main [^>]*>\s*<[a-z]+ class="([^"]*)"/)?.[1] ?? "";

const underRouter = (tree: ReactNode): string =>
  renderTree(h(AppRouterContext.Provider, { value: router }, h(PathnameContext.Provider, { value: "/nirgendwo" }, tree)));

const boundaryProps = { error: new globalThis.Error("kaputt"), reset: () => undefined };

const rootBoundary = underRouter(h(ErrorPanel, boundaryProps));
const publicBoundary = underRouter(h(PublicShell, { serverStatusSlot: null, children: h(PublicErrorBoundary, boundaryProps) }));

const shelled = rootClasses(renderTree(h(AppRouterContext.Provider, { value: router }, h(NotFound, {}))));

const wholeDocument = rootClasses(rootBoundary);

const FLOOR = "min-h-[calc(100dvh-var(--navbar-height)-1px)]";
const VIEWPORT = "min-h-[100dvh]";

describe("the box each full-page status panel is sized to", () => {
  /* The two grounds are one class apart and nothing renders both call sites together, so a shared
     `page` height reads as correct on whichever of the two was opened. */
  it("gives the shelled 404 the shell's floor and the boundary error the whole viewport", () => {
    assert.ok(shelled.includes(FLOOR), `the 404 is sized ${shelled}, so the footer starts above the fold`);
    assert.ok(!shelled.includes(VIEWPORT), `the 404 keeps a whole-viewport floor in ${shelled}, which the navbar then pushes past the fold`);

    assert.ok(wholeDocument.includes(VIEWPORT), `the error boundary is sized ${wholeDocument}, and it has no chrome to subtract`);
    assert.ok(!wholeDocument.includes("min-h-[calc("), `the error boundary subtracts chrome it does not render, in ${wholeDocument}`);
  });

  /* The floor is written out here rather than reached from the shell, so nothing but this case
     stops the two drifting apart when the header's height or its border changes. */
  it("spells the 404's floor exactly as the shell spells its own", () => {
    const main = shellMainClasses(renderTree(h(PublicShell, { serverStatusSlot: null, children: null })));

    assert.ok(main.includes(FLOOR), `the shell's own floor is ${main}, which the 404 no longer matches`);
  });

  /* Every other caller passes no ground at all, so the variant picks one for them: `page` is asked
     for wherever there is no chrome, and `inline` sits in a region already the height it wants. */
  it("leaves a caller that asks for no ground on the one its variant has always had", () => {
    const props = { badgeLabel: "x", heading: "x", message: "x", children: null };
    const page = rootClasses(renderTree(h(StatusPanel, props)));
    const inline = rootClasses(renderTree(h(StatusPanel, { ...props, variant: "inline" as const })));

    assert.ok(page.includes(VIEWPORT), `an unqualified page panel is sized ${page}`);
    assert.ok(inline.includes("min-h-[400px]") && !inline.includes("dvh"), `an inline panel is sized ${inline}`);
  });
});

/** Each mark is a way off the page the shell carries and the panel does not. */
const SHELL_MARKS = ['href="#main-content"', 'id="main-content"', "<footer"];

describe("the chrome each error boundary is served with", () => {
  /* React mounts a boundary on a thrown child alone, so this renders the component the route file
     exports rather than reaching it through the router: what nests it under the shell is its path. */
  it("shells the public boundary and leaves the root one bare", () => {
    for (const mark of SHELL_MARKS) {
      assert.ok(publicBoundary.includes(mark), `the public error page carries no ${mark}, so a visitor is left with the panel's own links`);
      assert.ok(!rootBoundary.includes(mark), `the root boundary renders ${mark}, which is chrome its own failure can be`);
    }

    const panel = shelledPanelClasses(publicBoundary);

    assert.ok(panel.includes(FLOOR), `the public error panel is sized ${panel}, so the footer starts above the fold`);
    assert.ok(
      !panel.includes(VIEWPORT),
      `the public error panel keeps a whole-viewport floor in ${panel}, which the navbar pushes past the fold`,
    );
  });
});
