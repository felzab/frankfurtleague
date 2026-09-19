import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";
/* No public export carries either context — the bar's `useUrlFilters` reads the first and the region's
   own hooks the second. A Next release that moves either module fails this file at import. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

import { renderTree, textOf } from "@/shared/testing/renderTest.ts";

/* Reached with `await import` and never a static import beside the harness: the JSX compile step is
   registered as `renderTest` evaluates, and a static import resolves before that. */
const { AdminBewerbungenView } = await import("./AdminBewerbungenView.tsx");

const ROUTER = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: "",
};

/** The queue as a read that answered nothing renders it, under the query the page was asked for. */
const leereSchlange = (query: string): string =>
  textOf(
    renderTree(
      h(
        AppRouterContext.Provider,
        { value: ROUTER },
        h(
          SearchParamsContext.Provider,
          { value: new URLSearchParams(query) },
          h(AdminBewerbungenView, {
            bewerbungen: [],
            anzahlJeStatus: { eingereicht: 0, angenommen: 0, abgelehnt: 0 },
            anzahlJeSaisonbezug: { diese_saison: 0, andere_saison: 0 },
            dublettenSchluessel: [],
            richtung: "desc",
          }),
        ),
      ),
    ),
    " ",
  );

const NIE_EINGEGANGEN = "Es sind noch keine Bewerbungen eingegangen.";
const FUER_DIESE_FILTER = "Keine Bewerbungen für diese Filter.";

describe("what an empty triage queue says about itself", () => {
  /* Both facets are off, so the read was the whole archive: the one state in which nothing has arrived. */
  it("says nothing has arrived once both of the read's facets are turned off", () => {
    const gelesen = leereSchlange("saison_id=2627&saisonbezug=&status=");

    assert.ok(gelesen.includes(NIE_EINGEGANGEN), `an empty archive does not say so: ${gelesen}`);
    assert.ok(!gelesen.includes(FUER_DIESE_FILTER), "an empty archive blames a filter nobody set");
  });

  /* A first visit's two default pills, and a decided state picked in the bar, each select a subset the
     server alone read: a season with no open application has not received nothing. */
  it("blames the filters where the defaults or a picked state narrowed the read", () => {
    for (const query of ["saison_id=2627", "saison_id=2627&saisonbezug=&status=angenommen"]) {
      const gelesen = leereSchlange(query);

      assert.ok(gelesen.includes(FUER_DIESE_FILTER), `${query}: the narrowed read's empty answer is not the filter's: ${gelesen}`);
      assert.ok(!gelesen.includes(NIE_EINGEGANGEN), `${query}: a narrowed read claims nothing ever arrived`);
    }
  });
});
