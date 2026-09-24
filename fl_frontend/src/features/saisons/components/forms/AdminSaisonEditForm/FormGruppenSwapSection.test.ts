import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleEveryAction, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { closedControl, isInTheFlow } from "@/shared/testing/closedControl.ts";
import { recordingRouter, underNext } from "@/shared/testing/nextContexts.ts";
import { pressTwice } from "@/shared/testing/twoPress.ts";

import type { Navigations } from "@/shared/testing/nextContexts.ts";

const { answerWith } = doubleEveryAction();
const { raised } = doubleToasts();

const { FormGruppenSwapSection } = await import("./FormGruppenSwapSection.tsx");
const { unansweredAction } = await import("@/shared/utils/actionError.ts");

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

describe("the season's group swap after its answer", () => {
  beforeEach(() => {
    raised.length = 0;
  });

  /** The panel over two swappable clubs, with SG Alpha and TSV Beta picked and the swap pressed through. */
  async function swapped(answer: () => Promise<unknown>): Promise<Navigations> {
    const user = userEvent.setup();
    const { router, seen } = recordingRouter();
    answerWith(answer);
    render(
      underNext(
        h(FormGruppenSwapSection, {
          saisonId: "2027",
          swap: { teams: [team("t1", "SG Alpha", "A"), team("t2", "TSV Beta", "B")], playedKnockoutSpiele: 0 },
          isFinishedSaison: false,
        }),
        { router },
      ),
    );

    await user.click(screen.getByRole("button", { name: /^Team/ }));
    await user.click(screen.getByRole("option", { name: /^SG Alpha/ }));
    await user.click(screen.getByRole("button", { name: /^Tauscht Gruppen mit/ }));
    await user.click(screen.getByRole("option", { name: /^TSV Beta/ }));
    await pressTwice(user, { resting: "Gruppen tauschen", armed: "Ja, Gruppen tauschen" });
    await waitFor(() => assert.equal(raised.length, 1));

    return seen;
  }

  /* The swap is its own inverse, so a swap that may have landed, pressed again over the same pair,
     swaps back what it just swapped. */
  it("drops the pair and reads the page again after a swap of unknown outcome", async () => {
    const seen = await swapped(() => Promise.resolve(unansweredAction()));

    assert.deepEqual(
      raised.map((toast) => [toast.title, toast.options?.outcome]),
      [["Gruppen nicht getauscht", "unknown"]],
    );
    assert.equal(seen.refresh, 1, "the page was not read again");
    // Closed on a missing pick, so no second press can swap the same pair back.
    await waitFor(() => closedControl("Gruppen tauschen", "Wähle zwei Teams aus zwei verschiedenen Gruppen."));
  });

  /* A refusal changed nothing, so the pair it refused is kept for the reader to correct. */
  it("keeps the pair after a refused swap", async () => {
    const seen = await swapped(() => Promise.resolve({ success: false, error: "Die Saison wurde inzwischen geändert. Lade die Seite neu." }));

    assert.equal(seen.refresh, 0);
    assert.ok(screen.getByText("SG Alpha steht danach in Gruppe B, TSV Beta in Gruppe A"));
  });
});
