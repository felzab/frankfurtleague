import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { createElement as h } from "react";

import { fireEvent, render, screen } from "@testing-library/react";

import { underNext } from "@/shared/testing/nextContexts.ts";

import type { Facet } from "@/shared/utils/facets.ts";

const { useUrlFilters } = await import("./useUrlFilters.ts");

type Row = { status: string };

/** Narrowed over the rows on hand, so a pick writes the history alone and the URL can be read back. */
const FACETS: readonly Facet<Row>[] = [
  {
    param: "status",
    label: "Status",
    options: [{ value: "aktiv", label: "Aktiv" }],
    read: (row) => [row.status],
  },
];

function Probe() {
  const { setFacet } = useUrlFilters(FACETS);

  return h("button", { type: "button", onClick: () => setFacet("status", ["aktiv"]) }, "Aktiv wählen");
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("the URL a facet's pick writes", () => {
  /* A bookmark can still hold a search query, and a pick copying the whole query would write the typed
     name into a fresh history entry (`docs/frontend/spec.md :: I680`). */
  it("leaves an old search query behind and keeps every other parameter", () => {
    window.history.replaceState(null, "", "/liste?q=Lena&saison_id=2526");
    render(underNext(h(Probe), { search: window.location.search, pathname: "/liste" }));

    fireEvent.click(screen.getByRole("button", { name: "Aktiv wählen" }));

    assert.equal(window.location.search, "?saison_id=2526&status=aktiv");
  });
});
