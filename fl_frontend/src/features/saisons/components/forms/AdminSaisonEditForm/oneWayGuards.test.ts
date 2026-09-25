import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";

import type { ReactNode } from "react";

/** A write nobody has answered yet: a case here that writes has already failed, and a real one needs a session and a backend. */
const { calls } = doubleActions({ modules: ["/src/features/saisons/actions.ts"], answer: () => new Promise<never>(() => undefined) });
doubleToasts();

const { FormSpielplanSection } = await import("./FormSpielplanSection.tsx");
const { FormRolloverSection } = await import("./FormRolloverSection.tsx");

type Panel = {
  name: string;
  /** The panel, handed `guard` where the editor hands it its draft guard. */
  render: (guard: () => boolean) => ReactNode;
  resting: string;
  armed: string;
};

/** Each one-way panel over a season where its press stands open, so only the guard can hold it. */
const PANELS: Panel[] = [
  {
    name: "FormSpielplanSection",
    render: (guard) =>
      h(FormSpielplanSection, {
        saisonId: "2026-27",
        saisonStatus: "future",
        rules: {
          win_points: 3,
          draw_points: 1,
          qualifiers_per_group: 2,
          number_of_groups: 2,
          teams_per_group: 4,
          max_kadergroesse: 18,
          tiebreak_order: "tordifferenz",
          forfeit_ergebnis: { sieger_tore: 3, verlierer_tore: 0 },
          erlaubte_stufen: ["E1", "Q1"],
        },
        startDate: "2026-08-01",
        endDate: "2027-06-30",
        spielplan: null,
        spieltageCount: 0,
        schedule: [
          { phase: "gruppenphase", matchdays: 3, matches_per_matchday: 4 },
          { phase: "halbfinale", matchdays: 1, matches_per_matchday: 2 },
          { phase: "finale", matchdays: 1, matches_per_matchday: 1 },
        ],
        gruppenOccupancy: { A: 4, B: 4 },
        bestand: { spiele: 0, erfasst: 0, angesetzt: 0 },
        hasDrawnSpiele: false,
        onBeforeWrite: guard,
      }),
    resting: "Spielplan anlegen",
    armed: "Ja, Spielplan anlegen",
  },
  {
    name: "FormRolloverSection",
    render: (guard) =>
      h(FormRolloverSection, {
        saisonId: "2026",
        saisonStatus: "future",
        rollover: { outgoingSaisonId: null, offeneSpiele: [], hasUndatierteSpieltage: false },
        hasDrawnSpiele: true,
        onBeforeActivate: guard,
        banners: [],
      }),
    resting: "Auf Saison 2026 umstellen",
    armed: "Ja, auf 2026 umstellen",
  },
];

/* Over the set, not one panel: what this catches is one panel arming itself while its neighbours
   delegate. The order the two guards run in is the hook's own, pinned at
   `shared/hooks/useTwoPressConfirm.test.ts`. */
describe("the season editor's one-way panels", () => {
  for (const panel of PANELS) {
    it(`${panel.name} asks the editor's draft guard before it arms, and stays at rest where the guard refuses`, async () => {
      const user = userEvent.setup();
      const guard = mock.fn(() => false);
      calls.length = 0;
      const { unmount } = render(underNext(panel.render(guard)));

      await user.click(screen.getByRole("button", { name: panel.resting }));

      assert.equal(guard.mock.callCount(), 1, `${panel.name}: the press never asked the guard`);
      assert.ok(screen.queryByRole("button", { name: panel.armed }) === null, `${panel.name}: armed past a guard that refused`);
      assert.deepEqual(calls, [], `${panel.name}: wrote past a guard that refused`);

      // The control: the same press arms once the guard lets it, so the refusal above is the guard's.
      guard.mock.mockImplementation(() => true);
      await user.click(screen.getByRole("button", { name: panel.resting }));
      assert.ok(screen.queryByRole("button", { name: panel.armed }) !== null, `${panel.name}: the press does not arm at all`);
      unmount();
    });
  }
});
