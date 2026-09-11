import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";
/* No public export carries either context — `usePageExit` reads the router and `useSaisonHref` the
   query. A Next release that moves either module fails this file at import rather than quietly. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

import { renderTree } from "@/shared/testing/renderTest.ts";

/* Reached with `await import` and never a static import beside the harness: the JSX compile step is
   registered as `renderTest` evaluates, and a static import resolves before that. */
const { AdminSchiedsrichterGeloeschtView } = await import("./AdminSchiedsrichterGeloeschtView.tsx");

/** What `usePageExit` hands the back pill. `bfcacheId` is a value rather than a call. */
const ROUTER = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: "",
};

const view = (): string =>
  renderTree(
    h(
      AppRouterContext.Provider,
      { value: ROUTER },
      h(
        SearchParamsContext.Provider,
        { value: new URLSearchParams("saison_id=2526") },
        h(AdminSchiedsrichterGeloeschtView, { anonymisiertAm: "2026-04-01", inactiveSince: "2026-04-01", defaultPayment: 20 }),
      ),
    ),
  );

/**
 * Read as the first two opening tags rather than searched for anywhere in the markup: a wrapper slipped
 * between them, or either class landing on some inner element, would otherwise pass.
 */
function frame(html: string): [string, string] {
  const inset = html.indexOf(">");
  const wrapper = html.indexOf(">", inset + 1);

  return [html.slice(0, inset + 1), html.slice(inset + 1, wrapper + 1)];
}

function classesOf(tag: string): string[] {
  return (/class="([^"]*)"/.exec(tag)?.[1] ?? "").split(/\s+/);
}

describe("the erased referee's page", () => {
  it("insets its content from both edges at every width", () => {
    const [inset] = frame(view());

    assert.ok(classesOf(inset).includes("p-6"), "the page runs to the viewport's edge on a phone");
    assert.ok(classesOf(inset).includes("sm:p-8"), "the page keeps a phone's inset on a wide screen");
  });

  it("holds its content to the page width, centred", () => {
    const [, wrapper] = frame(view());

    assert.ok(classesOf(wrapper).includes("max-w-page"), "the panel stretches to whatever width the screen has");
    assert.ok(classesOf(wrapper).includes("mx-auto"), "the content sits against the left edge of a wide screen");
  });
});
