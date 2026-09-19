import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { underNext } from "@/shared/testing/nextContexts.ts";
import { renderTree, textOf } from "@/shared/testing/renderTest.ts";

/* Reached with `await import` and never a static import beside the harness: the JSX compile step is
   registered as `renderTest` evaluates, and a static import resolves before that. */
const { AdminBewerbungenView } = await import("./AdminBewerbungenView.tsx");

/** The queue as a read that answered nothing renders it, under the query the page was asked for. */
const emptyQueue = (query: string): string =>
  textOf(
    renderTree(
      underNext(
        h(AdminBewerbungenView, {
          bewerbungen: [],
          anzahlJeStatus: { eingereicht: 0, angenommen: 0, abgelehnt: 0 },
          anzahlJeSaisonbezug: { diese_saison: 0, andere_saison: 0 },
          dublettenSchluessel: [],
          richtung: "desc",
        }),
        { search: query },
      ),
    ),
    " ",
  );

const NEVER_ARRIVED = "Es sind noch keine Bewerbungen eingegangen.";
const FOR_THESE_FILTERS = "Keine Bewerbungen für diese Filter.";

describe("what an empty triage queue says about itself", () => {
  /* Both facets are off, so the read was the whole archive: the one state in which nothing has arrived. */
  it("says nothing has arrived once both of the read's facets are turned off", () => {
    const read = emptyQueue("saison_id=2627&saisonbezug=&status=");

    assert.ok(read.includes(NEVER_ARRIVED), `an empty archive does not say so: ${read}`);
    assert.ok(!read.includes(FOR_THESE_FILTERS), "an empty archive blames a filter nobody set");
  });

  /* A first visit's two default pills, and a decided state picked in the bar, each select a subset the
     server alone read: a season with no open application has not received nothing. */
  it("blames the filters where the defaults or a picked state narrowed the read", () => {
    for (const query of ["saison_id=2627", "saison_id=2627&saisonbezug=&status=angenommen"]) {
      const read = emptyQueue(query);

      assert.ok(read.includes(FOR_THESE_FILTERS), `${query}: the narrowed read's empty answer is not the filter's: ${read}`);
      assert.ok(!read.includes(NEVER_ARRIVED), `${query}: a narrowed read claims nothing ever arrived`);
    }
  });
});
