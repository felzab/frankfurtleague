import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleEveryAction, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { closedControl, isInTheFlow } from "@/shared/testing/closedControl.ts";
import { declaredStatus } from "@/shared/testing/declaredStatus.ts";
import { recordingRouter, underNext } from "@/shared/testing/nextContexts.ts";
import { pressTwice } from "@/shared/testing/twoPress.ts";

import type { TeamFieldPath } from "@/features/teams/teamDraftStatus.ts";
import type { Navigations } from "@/shared/testing/nextContexts.ts";

const { answerWith } = doubleEveryAction();
const { raised } = doubleToasts();

const { FormSaisonSection } = await import("./FormSaisonSection.tsx");
const { DraftStatusProvider } = await import("@/shared/components/ui/DraftStatusContext.tsx");
const { unansweredAction } = await import("@/shared/utils/actionError.ts");

const STATUS = declaredStatus<TeamFieldPath>(["gruppe", "trikot_farbe"]);

const swapTeam = (id: string, name: string, gruppe: "A" | "B") => ({
  id,
  name,
  gruppe,
  gespielteGruppenSpiele: 0,
  gruppenSpieleProSpieltag: {},
  koSpieleProSpieltag: {},
});

/** The club's own season row: entered or not, its group picked or not, its swap locked or open. */
const panel = (over: { isMember: boolean; gruppe: "A" | null; locked: boolean }, router?: ReturnType<typeof recordingRouter>["router"]) =>
  render(
    underNext(
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
      { router },
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

describe("the club's group swap after its answer", () => {
  beforeEach(() => {
    raised.length = 0;
  });

  /** The locked panel with TSV Beta picked as the partner and the swap pressed through. */
  async function swapped(answer: () => Promise<unknown>): Promise<{ seen: Navigations; user: ReturnType<typeof userEvent.setup> }> {
    const user = userEvent.setup();
    const { router, seen } = recordingRouter();
    answerWith(answer);
    panel({ isMember: true, gruppe: "A", locked: true }, router);

    await user.click(screen.getByRole("button", { name: /Tauschen mit/ }));
    await user.click(screen.getByRole("option", { name: /^TSV Beta/ }));
    await pressTwice(user, { resting: "Gruppen tauschen", armed: "Ja, Gruppen tauschen" });
    // The toast is raised inside the transition, so the control still runs when it arrives: the panel is
    // read once it has let go.
    await waitFor(() => {
      assert.equal(raised.length, 1);
      assert.equal(screen.queryAllByRole("button", { name: "Tauscht..." }).length, 0, "the swap is still running");
    });

    return { seen, user };
  }

  /* The swap is its own inverse, so a swap that may have landed, pressed again over the same partner,
     swaps back what it just swapped. */
  it("drops the partner and reads the page again after a swap of unknown outcome", async () => {
    const { seen, user } = await swapped(() => Promise.resolve(unansweredAction()));

    assert.deepEqual(
      raised.map((toast) => [toast.title, toast.options?.outcome]),
      [["Gruppen nicht getauscht", "unknown"]],
    );
    assert.equal(seen.refresh, 1, "the page was not read again");
    // Pressed as the admin would press it again: the control and, once closed, the hint laid over it.
    for (const control of screen.getAllByRole("button", { name: "Gruppen tauschen" })) await user.click(control);
    // `ok` over `===`: a failing `equal` serialises the element, and with it the document, into its message.
    assert.ok(screen.queryByRole("button", { name: "Ja, Gruppen tauschen" }) === null, "a second press armed the same swap again");
    // The hint the press opened, shut, so the control is read where it stands.
    await user.keyboard("{Escape}");
    // Closed on a missing pick, so no second press can swap the same pair back.
    await waitFor(() => closedControl("Gruppen tauschen", "Wähle zuerst ein Team."));
  });

  /* A refusal changed nothing, so the partner it refused is kept for the reader to correct. */
  it("keeps the partner after a refused swap", async () => {
    const { seen } = await swapped(() =>
      Promise.resolve({ success: false, error: "Die Saison wurde inzwischen geändert. Lade die Seite neu." }),
    );

    assert.equal(seen.refresh, 0);
    assert.ok(screen.getByText("SG Alpha steht danach in Gruppe B, TSV Beta in Gruppe A"));
  });
});
