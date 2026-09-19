import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderMarkup, textOf } from "@/shared/testing/renderTest.ts";

import type { Facet, FacetSelection } from "@/shared/utils/facets.ts";

/* Reached with `await import` and never a static import beside the harness: the JSX compile step is
   registered as `renderTest` evaluates, and a static import resolves before that. */
const { FilterPanelBody } = await import("./FilterPanel.tsx");

type Row = { gruppe: string };

/** Options off the one row on hand, beside a group that exists and no row holds. */
const FACETS: readonly Facet<Row>[] = [
  {
    param: "gruppe",
    label: "Gruppe",
    options: [
      { value: "A", label: "Gruppe A" },
      { value: "B", label: "Gruppe B" },
    ],
    known: [{ value: "Z", label: "Gruppe Z" }],
    read: (row) => [row.gruppe],
  },
];

const panel = (selection: FacetSelection): string =>
  renderMarkup(FilterPanelBody<Row>, {
    facets: FACETS,
    items: [{ gruppe: "A" }],
    selection: selection,
    onSelect: () => undefined,
    onClear: () => undefined,
  });

/** Each row of the cell's list, as its key, its state and the words it paints: label then count. */
function rows(html: string): { key: string; isSelected: boolean; isDisabled: boolean; text: string }[] {
  return [...html.matchAll(/<div ([^>]*role="option"[^>]*)>([\s\S]*?)(?=<div [^>]*role="option"|<span data-focus-scope-end)/g)].map((found) => {
    const attrs = found[1] ?? "";

    return {
      key: /data-key="([^"]*)"/.exec(attrs)?.[1] ?? "",
      isSelected: /aria-selected="true"/.test(attrs),
      isDisabled: /aria-disabled="true"/.test(attrs),
      text: textOf(found[2] ?? "", " ")
        .replace(/\s+/g, " ")
        .trim(),
    };
  });
}

describe("a known value the URL names", () => {
  /* The pill's ✕ is one way out and this row is the other: disabled at its zero, the reader could see
     the selection and not undo it here. */
  it("is a picked, pressable row under its own label at zero", () => {
    assert.deepEqual(
      rows(panel({ gruppe: ["Z"] })).find((row) => row.key === "Z"),
      { key: "Z", isSelected: true, isDisabled: false, text: "Gruppe Z 0" },
    );
  });

  /* Paired with the case above: an unpicked zero stays inert, which is `isFacetOptionReachable`'s rule. */
  it("leaves an unpicked option at zero disabled beside it", () => {
    assert.equal(rows(panel({ gruppe: ["Z"] })).find((row) => row.key === "B")?.isDisabled, true);
  });

  it("draws no row once nothing names it", () => {
    assert.deepEqual(
      rows(panel({})).map((row) => row.key),
      ["A", "B"],
    );
  });
});
