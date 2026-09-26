import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { setImmediate as settled } from "node:timers/promises";

import { act, createElement as h } from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { FLSpielAdminSchema } from "@/features/spiele/schemas.ts";
import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { side, spielFields } from "@/shared/testing/fixtures.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";

import type { FLSpielAdmin } from "@/features/spiele/schemas.ts";

/* One answer for every action the editor calls: the dry run reads its two lists off it, and the save its message. */
const { calls } = doubleActions({
  modules: ["/src/features/spiele/actions.ts"],
  answer: () => Promise.resolve({ success: true, message: "Spiel gespeichert.", priorPaarungen: [], voidedFixtures: [], releasedFixtures: [] }),
});

doubleToasts();

const { AdminEditSpielDataForm } = await import("./AdminEditSpielDataForm.tsx");

/** A knockout fixture drawn 2:2 and decided on penalties, which is the one a shoot-out record belongs to. */
const DECIDED_ON_PENALTIES: FLSpielAdmin = FLSpielAdminSchema.parse(
  spielFields({
    id: "6890a1b2c3d4e5f607182901",
    spiel_nr: 1,
    saison_id: "2026",
    saison_phase: "achtelfinale",
    team1: side("68c1f0a2b3c4d5e6f7a8b9c1", { name: "SG Alpha", shorthand: "SA", tore: 2 }),
    team2: side("68c1f0a2b3c4d5e6f7a8b9c2", { name: "SG Beta", shorthand: "SB", tore: 2 }),
    ergebnis: "2:2",
    elfmeterschiessen: { team1: 5, team2: 4 },
  }),
);

function renderEditor(): void {
  render(
    underNext(
      h(AdminEditSpielDataForm, {
        spielData: DECIDED_ON_PENALTIES,
        teams: [],
        spielorte: [],
        schiedsrichter: [],
        saisonSpiele: [DECIDED_ON_PENALTIES],
        numberOfGroups: 2,
        isFinishedSaison: false,
        today: "2026-09-14",
        categorize: () => new Set<never>(),
        pageHeader: { title: "Spiel 1" },
      }),
      { search: "saison_id=2026" },
    ),
  );
}

type User = ReturnType<typeof userEvent.setup>;

/** The stored result opened for entry, which stands read-only until its switch is pressed. */
async function openResult(user: User): Promise<void> {
  await user.click(screen.getByRole("switch", { name: "Spielergebnis eintragen" }));
}

/** Whether the panel offers the shoot-out at all. */
const offersShootOut = (): boolean => screen.queryByRole("switch", { name: "Im Elfmeterschießen entschieden" }) !== null;

beforeEach(() => {
  calls.length = 0;
});

describe("the shoot-out the match editor sends", () => {
  /* Retracted in the draft rather than in the toggle's handler: fed straight from its atom, the record
     would reach the payload after its inputs had unmounted, and the write path throws it away. */
  it("sends none once the edited goals stop being level", async () => {
    const user = userEvent.setup();
    renderEditor();
    await openResult(user);

    const goals = screen.getByRole("textbox", { name: "SG Alpha" });
    await user.clear(goals);
    await user.paste("3");
    await act(async () => goals.blur());
    assert.equal(offersShootOut(), false, "an unlevelled result still offers the shoot-out");

    await user.click(screen.getByRole("button", { name: "Speichern" }));
    await act(async () => settled());
    // A save the editor asks to confirm is confirmed, so what is judged is the payload and never the dialog.
    const confirm = screen.queryByRole("button", { name: "Trotzdem speichern" });
    if (confirm !== null) {
      await user.click(confirm);
      await act(async () => settled());
    }

    const saved = calls.filter((call) => call.action === "patchAdminSpielDataAction").map((call) => call.payload as Record<string, unknown>);
    assert.equal(saved.length, 1, "the edited result was never saved, so nothing below is judged");
    assert.equal(saved[0]?.["elfmeterschiessen"], null, "the unlevelled result is sent with the shoot-out it no longer admits");
  });

  /* The defect this pair is here to prevent: a form offering the control on part of the condition
     submits counts the panel never showed and the write path throws away. */
  it("offers the shoot-out on a level result, and withdraws it under a Nichtantreten", async () => {
    const user = userEvent.setup();
    renderEditor();
    await openResult(user);
    assert.equal(offersShootOut(), true, "a level knockout result is offered no shoot-out, so the absence below proves nothing");

    await user.click(screen.getByRole("switch", { name: "Sonderereignis eintragen" }));
    const event = document.querySelector('select[name="sonderereignis"]') ?? assert.fail("the editor mirrors no Sonderereignis picker");
    fireEvent.change(event, { target: { value: "nichtantreten_team1" } });

    assert.equal(offersShootOut(), false, "a Nichtantreten, whose result the server composes, is offered a shoot-out");
  });
});
