import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";
/* No public export carries either context — the bar's `useUrlFilters` reads the first and every hook the
   region narrows by reads the second. A Next release that moves either module fails this file at import. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

import { renderTree } from "@/shared/testing/renderTest.ts";

import type { Facet } from "@/shared/utils/facets.ts";
import type { CrudEmptiness } from "./AdminCrudView.tsx";

/* Reached with `await import` and never a static import beside the harness, which registers the JSX
   compile step as it evaluates (`docs/frontend/spec.md` §1.9). */
const { AdminCrudView } = await import("./AdminCrudView.tsx");

type Row = { id: string; art: string };

const SEARCH_KEYS = ["id"] as const;

/** Narrowed on the server, opening on a default, the shape both the triage queue's facets take. */
const GELESEN: Facet<Row> = {
  param: "stand",
  label: "Stand",
  options: [
    { value: "offen", label: "Offen" },
    { value: "erledigt", label: "Erledigt" },
  ],
  defaultValues: ["offen"],
  narrowsTheRead: true,
  read: (row) => [row.art],
};

/** Narrowed over the rows on hand alone, so it can empty a list but never a read. */
const GEFILTERT: Facet<Row> = {
  param: "art",
  label: "Art",
  options: [
    { value: "offen", label: "Offen" },
    { value: "erledigt", label: "Erledigt" },
  ],
  read: (row) => [row.art],
};

const ROUTER = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: "",
};

/** The value the region hands its table, rendered as the slot's whole markup so nothing else can answer. */
function emptinessOf({
  items,
  facets,
  query = "",
  readNarrowedByRoute,
}: {
  items: Row[];
  facets: readonly Facet<Row>[];
  query?: string;
  readNarrowedByRoute?: boolean;
}): CrudEmptiness {
  const html = renderTree(
    h(
      AppRouterContext.Provider,
      { value: ROUTER },
      h(
        SearchParamsContext.Provider,
        { value: new URLSearchParams(query) },
        h(AdminCrudView<Row>, {
          items: items,
          searchKeys: SEARCH_KEYS,
          facets: facets,
          readNarrowedByRoute: readNarrowedByRoute,
          renderTable: ({ emptiness }) => h("output", null, emptiness),
        }),
      ),
    ),
  );

  const found = /<output>(none|filtered|searched)<\/output>/.exec(html)?.[1];
  assert.ok(found !== undefined, "the region handed its table no emptiness at all");

  return found as CrudEmptiness;
}

describe("an empty read, which no stage on the page emptied", () => {
  /* The floor: every case below turns on something that moves this answer, and a region answering
     "filtered" for every empty read would pass all of them. */
  it("is a resource nothing has reached while nothing narrowed the read", () => {
    assert.equal(emptinessOf({ items: [], facets: [] }), "none");
  });

  /* `?status=angenommen` on the triage queue: the server removed every other row, so the sentence
     that nothing has ever arrived is false exactly where the reader asked for a subset. */
  it("is the filter's where a facet the server narrows on is picked", () => {
    assert.equal(emptinessOf({ items: [], facets: [GELESEN], query: "stand=erledigt" }), "filtered");
  });

  /* The first visit: nobody picked anything, and the pill the default draws is on the bar while the
     read was narrowed to it all the same. */
  it("is the filter's where that facet's default narrowed it with nothing in the URL", () => {
    assert.equal(emptinessOf({ items: [], facets: [GELESEN] }), "filtered");
  });

  /* Non-vacuity for the default: the empty parameter is the facet turned off, and then the read
     really was the whole resource. */
  it("is a resource nothing has reached once that facet is turned off", () => {
    assert.equal(emptinessOf({ items: [], facets: [GELESEN], query: "stand=" }), "none");
  });

  /* A facet over the rows on hand cannot have removed a row the read never served. */
  it("is not blamed on a facet that narrows the rows on hand alone", () => {
    assert.equal(emptinessOf({ items: [], facets: [GEFILTERT], query: "art=erledigt" }), "none");
  });

  /* The change log's one record or one Vorgang, which no facet draws and the server narrows on. */
  it("is the narrowing's where the page narrowed the read on a term the bar does not draw", () => {
    assert.equal(emptinessOf({ items: [], facets: [GEFILTERT], readNarrowedByRoute: true }), "filtered");
  });

  /* Facets narrow before the search, so a typed query does not take the message from the narrowing
     that had already left nothing. */
  it("stays the narrowing's with a query typed as well", () => {
    assert.equal(emptinessOf({ items: [], facets: [GELESEN], query: "stand=erledigt&q=zorbanax" }), "filtered");
  });
});

describe("a read that served rows", () => {
  const ROWS: Row[] = [
    { id: "eins", art: "offen" },
    { id: "zwei", art: "offen" },
  ];

  /* The server's narrowing served these rows, so it is not what emptied the list below them. */
  it("blames the search, never the read's own narrowing, for a query matching none of them", () => {
    assert.equal(emptinessOf({ items: ROWS, facets: [GELESEN], query: "q=zorbanax", readNarrowedByRoute: true }), "searched");
  });

  it("blames the facet that removed every row it served", () => {
    assert.equal(emptinessOf({ items: ROWS, facets: [GEFILTERT], query: "art=erledigt" }), "filtered");
  });
});
