import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";
/* `useRouter` reads a context no `next/navigation` export carries, so the panel renders under the one Next keeps it on. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";

import { render } from "@testing-library/react";

import { closedControl, isInTheFlow } from "@/shared/testing/closedControl.ts";

import type { ContextType } from "react";

const { AdminBewerbungAnnehmenSection } = await import("./AdminBewerbungAnnehmenSection.tsx");

/** Every method the panel reaches only after a write, which no case here makes. */
const ROUTER: NonNullable<ContextType<typeof AppRouterContext>> = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: "annehmenSection",
};

const zusage = (hindernis: string | null) =>
  render(
    h(
      AppRouterContext.Provider,
      { value: ROUTER },
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
    zusage(null);

    const grund = "Wähle zuerst eine Gruppe.";
    closedControl("Bewerbung annehmen", grund);
    assert.equal(isInTheFlow(grund), false, "the missing group stands in the flow, which the pick takes it out of");
  });

  /* Nothing on this panel lifts a seat's missing confirmation, so a reader who never points at the control
     has nothing else to learn it from. */
  it("says a standing obstacle in the body as well", () => {
    const hindernis = "Eine Kontaktperson hat ihren Eintrag noch nicht bestätigt.";
    zusage(hindernis);

    closedControl("Bewerbung annehmen", hindernis);
    assert.ok(isInTheFlow(hindernis), "the standing obstacle is readable only by pointing at the closed control");
  });
});
