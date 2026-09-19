import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { describeSpieltageCount } from "@/features/saisons/utils.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { renderMarkup, renderTree, textOf } from "@/shared/testing/renderTest.ts";

import type { AdminSpieltagRow } from "@/features/spieltage/types.ts";
import type { SpieltagPhaseProgress } from "@/features/spieltage/utils.ts";

/* Reached with `await import` and never a static import beside the harness, which registers the JSX
   compile step as it evaluates (`docs/frontend/spec.md` §1.9). */
const { AdminSpieltageList } = await import("./AdminSpieltageList.tsx");
const { AdminCrudFallback } = await import("@/shared/components/ui/AdminCrudFallback.tsx");

const SPIELTAG: AdminSpieltagRow = {
  id: "6890a1b2c3d4e5f607190041",
  label: "1. Spieltag",
  beginn: "2026-09-19",
  ende: "2026-09-20",
  anzahl_spiele: 4,
  saison_phase: "gruppenphase",
  saison_id: "2627",
  position: 1,
};

const list = (phaseProgress?: readonly SpieltagPhaseProgress[]): string =>
  renderTree(
    underNext(h(AdminSpieltageList, { filteredSpieltage: [SPIELTAG], emptiness: "none" as const, saisonId: "2627", phaseProgress }), {
      search: "saison_id=2627",
    }),
  );

/** The tags of the elements directly inside the element opening at `at`, counted over every open and close. */
function childrenAt(html: string, at: number): string[] {
  const step = /<(\/?)([a-z][\w-]*)[^>]*?(\/?)>/g;
  step.lastIndex = at;

  const children: string[] = [];
  let depth = 0;
  for (let found = step.exec(html); found !== null; found = step.exec(html)) {
    const [, closing, tag, selfClosing] = found;
    if (closing === "/") {
      depth -= 1;
      if (depth === 0) return children;
      continue;
    }
    if (depth === 1) children.push(tag!);
    if (selfClosing !== "/") depth += 1;
  }

  return assert.fail(`the element opening at ${String(at)} never closes`);
}

/* The row is a column below `md`, so every box it stacks costs a height and a `gap-y-3`: a placeholder
   box the row does not draw is how far every row below it jumps when the hold releases. */
describe("the placeholder a matchday row is held under", () => {
  it("stacks as many boxes as the row it stands in for", () => {
    const html = list();
    const row = html.indexOf("<li");
    assert.ok(row >= 0, "the list renders no row, and this case proves nothing");

    const placeholder = renderMarkup(AdminCrudFallback, { shape: "sections", hasFacets: true });
    const card = placeholder.search(/<div class="[^"]*\brounded-2xl\b/);
    assert.ok(card >= 0, "the placeholder draws no card, and this case proves nothing");

    assert.equal(
      childrenAt(placeholder, card).length,
      childrenAt(html, row).length,
      `the placeholder row holds ${childrenAt(placeholder, card).join(", ")}`,
    );
  });
});

/* „1 Spieltag“ beside „ein Spieltag“ is one rule spelled two ways, and the heading is where a reader meets
   both: the count on the heading and the count in an armed readout describe the same population. */
describe("a phase heading's matchday count", () => {
  it("states it in the phrase the season's own counts are stated in, whether or not a progress figure stands beside it", () => {
    for (const [what, html] of [
      ["with no progress figure", list()],
      ["with the phase complete", list([{ phase: "gruppenphase", angelegt: 1, erwartet: 1 }])],
    ] as const) {
      assert.ok(textOf(html, " ").includes(describeSpieltageCount(1)), `${what}: the heading counts its matchdays some other way`);
    }
  });
});
