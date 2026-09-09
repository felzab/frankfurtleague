import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";
/* No public export carries the router context, and the pill's exit reads it. A Next release that
   moves the module fails this file at import rather than quietly. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";

import { renderTree } from "@/shared/testing/renderTest.ts";

/* Reached with `await import` and never a static import beside the harness: the JSX compile step is
   registered as `renderTest` evaluates, and a static import resolves before that. */
const { goBackOrPush } = await import("@/shared/hooks/useEditorExit.ts");
const { BackButton } = await import("./BackButton.tsx");

type Navigation = { back: number; pushed: string[] };

function spyRouter(seen: Navigation) {
  return {
    back: () => void (seen.back += 1),
    forward: () => undefined,
    refresh: () => undefined,
    push: (href: string) => void seen.pushed.push(href),
    replace: () => undefined,
    prefetch: () => undefined,
    bfcacheId: "",
  };
}

/**
 * The press, reproduced at the function the transition wraps: `renderToStaticMarkup` dispatches no
 * event, and the server build of `startTransition` refuses to be called at all.
 */
function pressed(fallbackHref: string, historyLength: number): Navigation {
  const seen: Navigation = { back: 0, pushed: [] };

  // The runner has no DOM, so neither branch of the guard is its default and a length is the whole
  // of what the guard reads.
  Object.defineProperty(globalThis, "window", { value: { history: { length: historyLength } }, configurable: true, writable: true });

  try {
    goBackOrPush(spyRouter(seen), fallbackHref);
  } finally {
    Reflect.deleteProperty(globalThis, "window");
  }

  return seen;
}

const markup = (props: { fallbackHref: string; spacing?: "mb-6" | "-mb-3" }): string =>
  renderTree(h(AppRouterContext.Provider, { value: spyRouter({ back: 0, pushed: [] }) }, h(BackButton, props)));

describe("the exit behind every Zurück pill", () => {
  it("goes back where the tab has a page behind it", () => {
    const seen = pressed("/dashboard/teams", 2);

    assert.equal(seen.back, 1, "a warm entry stopped using the history it has");
    assert.deepEqual(seen.pushed, [], "a warm entry pushed the fallback over the page behind it");
  });

  /* The defect the guard exists for: a tab opened straight onto the page reads 1, so `router.back()`
     has nothing to return to and the control does nothing a reader can see. */
  it("pushes the fallback where a bookmark or a pasted URL is the whole history", () => {
    const seen = pressed("/dashboard/teams", 1);

    assert.deepEqual(seen.pushed, ["/dashboard/teams"], "a cold entry left the reader stranded on the page");
    assert.equal(seen.back, 0, "a cold entry called the no-op anyway");
  });
});

describe("the pill", () => {
  it("is one button carrying the label and the page-chrome recipe", () => {
    const html = markup({ fallbackHref: "/dashboard/teams" });

    assert.match(html, /<span>Zurück<\/span>/, "the label a reader looks for is not the one rendered");
    assert.equal(html.match(/<button/g)?.length, 1, "the pill renders as something other than a single button");
    assert.match(html, /bg-surface[^"]*shadow-sm/, "the pill lost `formButton`'s `nav` intent");
    assert.match(html, /disabled:pointer-events-none/, "the pill carries no styling for the pending state I68 requires");
  });

  it("takes the tightening as a substitution, so one margin reaches the class string", () => {
    assert.match(markup({ fallbackHref: "/dashboard/teams" }), /\bmb-6\b/, "the default spacing left the pill against the content under it");

    const tight = markup({ fallbackHref: "/dashboard/teams", spacing: "-mb-3" });

    assert.match(tight, /-mb-3/, "the tightening never reached the class string");
    assert.doesNotMatch(tight, /\bmb-6\b/, "both margins are emitted, and with no `twMerge` the stylesheet's order decides");
  });
});
