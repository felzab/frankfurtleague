import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render } from "@testing-library/react";

import { doubleEveryAction } from "@/shared/testing/actionDoubles.ts";
import { closedControl, isInTheFlow } from "@/shared/testing/closedControl.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";

doubleEveryAction();

const { AdminBewerbungAnnehmenSection } = await import("./AdminBewerbungAnnehmenSection.tsx");

const renderAcceptance = (hindernis: string | null) =>
  render(
    underNext(
      h(AdminBewerbungAnnehmenSection, {
        bewerbungId: "68d0f2a4c1e2b3a4d5e6f708",
        teamName: "SG Alpha",
        createsTeam: false,
        saisonId: "2027",
        saisonStatus: "future",
        gruppeOffer: [{ gruppe: "A", occupied: 1, capacity: 4 }],
        hindernis,
      }),
    ),
  );

describe("the acceptance's closed press", () => {
  /* A pick lifts this closure, so a sentence beside the control would leave with it and move the panel under
     the reader (`docs/frontend/spec.md` §1.14). */
  it("names the missing group on the control alone", () => {
    renderAcceptance(null);

    const reason = "Wähle zuerst eine Gruppe.";
    closedControl("Bewerbung annehmen", reason);
    assert.equal(isInTheFlow(reason), false, "the missing group stands in the flow, which the pick takes it out of");
  });

  /* Nothing on this panel lifts a seat's missing confirmation, so a reader who never points at the control
     has nothing else to learn it from. */
  it("says a standing obstacle in the body as well", () => {
    const obstacle = "Eine Kontaktperson hat ihren Eintrag noch nicht bestätigt.";
    renderAcceptance(obstacle);

    closedControl("Bewerbung annehmen", obstacle);
    assert.ok(isInTheFlow(obstacle), "the standing obstacle is readable only by pointing at the closed control");
  });
});
