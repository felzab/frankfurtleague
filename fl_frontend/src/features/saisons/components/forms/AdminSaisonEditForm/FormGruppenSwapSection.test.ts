import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render } from "@testing-library/react";

import { closedControl, isInTheFlow } from "@/shared/testing/closedControl.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";

const { FormGruppenSwapSection } = await import("./FormGruppenSwapSection.tsx");

const team = (id: string, name: string, gruppe: "A" | "B") => ({
  id,
  name,
  gruppe,
  gespielteGruppenSpiele: 0,
  gruppenSpieleProSpieltag: {},
  koSpieleProSpieltag: {},
});

describe("the season's group swap, closed until two teams are picked", () => {
  /* A pick lifts the closure, so a sentence beside the control would leave with it and move the panel under
     the reader (`docs/frontend/spec.md` §1.14). */
  it("names the missing pair on the control alone", () => {
    render(
      underNext(
        h(FormGruppenSwapSection, {
          saisonId: "2027",
          swap: { teams: [team("t1", "SG Alpha", "A"), team("t2", "TSV Beta", "B")], playedKnockoutSpiele: 0 },
          isFinishedSaison: false,
        }),
      ),
    );

    const reason = "Wähle zwei Teams aus zwei verschiedenen Gruppen.";
    closedControl("Gruppen tauschen", reason);
    assert.equal(isInTheFlow(reason), false, "the missing pair stands in the flow, which the pick takes it out of");
  });
});
