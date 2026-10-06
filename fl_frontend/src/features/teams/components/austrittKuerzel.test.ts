import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { underNext } from "@/shared/testing/nextContexts.ts";

import type { FLGruppenTeam } from "@/features/teams/schemas.ts";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { SaisontabelleView } = await import("./views/SaisontabelleView.tsx");

const AUSGESCHIEDEN: FLGruppenTeam = {
  id: "6780e194677bfbfb5ea8396d",
  name: "Mainufer Beispiel",
  shorthand: "QM",
  statistik: {
    anzahl_gespielte_spiele: 3,
    siege: 1,
    niederlagen: 1,
    unentschieden: 1,
    tore_geschossen: 4,
    tore_kassiert: 4,
    punkte: 4,
    anzahl_abgesagte_spiele: 0,
  },
  austritt_type: "disqualifikation",
  anzahl_ausstehende_spiele: 0,
};

describe("a club's Austritt badge", () => {
  /* An `aria-label` on a span with no role is one a screen reader may skip, leaving the two letters alone: the state
     is text the reader is read, and the letters stay on screen for the eye. */
  it("is read as the whole state, on the table's trigger and in the club's popover alike", async () => {
    const { container } = render(
      underNext(
        h(SaisontabelleView, { gruppenData: { A: [AUSGESCHIEDEN] }, qualifiersPerGroup: 1, saisonId: undefined, isFinishedSaison: false }),
      ),
    );

    assert.equal(container.querySelectorAll("[aria-label='Disqualifiziert']").length, 0, "the state rides on an aria-label again");
    const [trigger] = screen.getAllByRole("button", { name: /Mainufer Beispiel/ });
    assert.ok(trigger, "the table names no club, so nothing below compares anything");
    assert.match(trigger.textContent, /DQ/, "the letters left the screen");
    assert.match(within(trigger).getByText("Disqualifiziert").className, /\bsr-only\b/, "the state is not read on the trigger");
    assert.equal(within(trigger).getByText("DQ").getAttribute("aria-hidden"), "true", "the letters are read beside the state");

    await userEvent.setup().click(trigger);
    const heading = screen.getByRole("heading", { name: /Mainufer Beispiel/ });
    assert.match(within(heading).getByText("Disqualifiziert").className, /\bsr-only\b/, "the popover's heading reads the letters alone");
  });
});
