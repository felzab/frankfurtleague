import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";
/* `useRouter` reads a context no `next/navigation` export carries, so the panel renders under the one Next keeps it on. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";

import { render } from "@testing-library/react";

import { closedControl, isInTheFlow } from "@/shared/testing/closedControl.ts";
import { nextRouter } from "@/shared/testing/nextContexts.ts";
import { deriveDraftStatus } from "@/shared/utils/draftStatus.ts";

const { FormSaisonSection } = await import("./FormSaisonSection.tsx");
const { DraftStatusProvider } = await import("@/shared/components/ui/DraftStatusContext.tsx");

/** No descriptor for any path, which is the state the panel stands in until a save judges one. */
const STATUS = deriveDraftStatus<null, string>({ descriptors: [], stored: null, draft: null, fieldErrors: {} });

const swapTeam = (id: string, name: string, gruppe: "A" | "B") => ({
  id,
  name,
  gruppe,
  gespielteGruppenSpiele: 0,
  gruppenSpieleProSpieltag: {},
  koSpieleProSpieltag: {},
});

/** The club's own season row: entered or not, its group picked or not, its swap locked or open. */
const panel = (over: { isMember: boolean; gruppe: "A" | null; locked: boolean }) =>
  render(
    h(
      AppRouterContext.Provider,
      { value: nextRouter() },
      h(DraftStatusProvider, {
        status: STATUS,
        children: h(FormSaisonSection, {
          saison: { saisonId: "2027", saisonStatus: over.isMember ? "active" : "future" },
          gruppeLock: { locked: over.locked },
          banners: [],
          gruppeOffer: [
            { gruppe: "A", occupied: 1, capacity: 4 },
            { gruppe: "B", occupied: 1, capacity: 4 },
          ],
          isMember: over.isMember,
          isRetired: false,
          gruppe: over.gruppe,
          onGruppeChange: () => undefined,
          onValidateSelection: () => undefined,
          trikotFarbe: null,
          onTrikotFarbeChange: () => undefined,
          onValidateTrikotSelection: () => undefined,
          swap: { teams: [swapTeam("t1", "SG Alpha", "A"), swapTeam("t2", "TSV Beta", "B")], playedKnockoutSpiele: 0 },
          teamId: "t1",
        }),
      }),
    ),
  );

/* A pick lifts either closure, so a sentence beside the control would leave with it and move the panel under
   the reader (`docs/frontend/spec.md` §1.14). */
describe("the club's season panel, closed until a pick", () => {
  it("names the missing group on the entry's control alone", () => {
    panel({ isMember: false, gruppe: null, locked: false });

    const grund = "Wähle zuerst eine Gruppe.";
    closedControl("In Saison 2027 aufnehmen", grund);
    assert.equal(isInTheFlow(grund), false, "the missing group stands in the flow, which the pick takes it out of");
  });

  it("names the missing partner on the swap's control alone", () => {
    panel({ isMember: true, gruppe: "A", locked: true });

    const grund = "Wähle zuerst ein Team.";
    closedControl("Gruppen tauschen", grund);
    assert.equal(isInTheFlow(grund), false, "the missing partner stands in the flow, which the pick takes it out of");
  });
});
