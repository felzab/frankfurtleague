import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { FLSpielberichtAdminResponseSchema } from "@/features/spielberichte/schemas.ts";
import { FLSpielAdminSchema } from "@/features/spiele/schemas.ts";
import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { side, spielFields } from "@/shared/testing/fixtures.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { spielberichtReadFixture } from "@/shared/testing/spielberichtFixtures.ts";

const { calls, answered } = doubleActions({
  modules: ["/src/features/spiele/actions.ts"],
  answer: () => Promise.resolve({ success: true, message: "Spiel gespeichert.", priorPaarungen: [] }),
  payloadOf: (args) => args,
});
doubleToasts();

const { AdminEditSpielDataForm } = await import("./AdminEditSpielDataForm.tsx");

/** Typed in as 1:0 before the report came, which proposes the same 1:0: adopting it moves no result field. */
const SCHON_ERGEBNIS = FLSpielAdminSchema.parse(
  spielFields({
    id: "68c1f0a2b3c4d5e6f7a8b9e2",
    spiel_nr: 7,
    saison_id: "2026",
    saison_phase: "gruppenphase",
    team1: side("68c1f0a2b3c4d5e6f7a8b9a1", { name: "Goethe-Gymnasium", shorthand: "GG", tore: 1 }),
    team2: side("68c1f0a2b3c4d5e6f7a8b9a2", { name: "Lessing-Gymnasium", shorthand: "LG", tore: 0 }),
    ergebnis: "1:0",
  }),
);

// Past the first write, so a save sending a constant rather than the version it was seeded from cannot pass.
const VERSION = 3;

const lesen = spielberichtReadFixture({ zustand: "abweichend" });
const SPIELBERICHT = FLSpielberichtAdminResponseSchema.parse({ ...lesen, bericht: { ...lesen.bericht, version: VERSION } });

const editor = () =>
  underNext(
    h(AdminEditSpielDataForm, {
      spielData: SCHON_ERGEBNIS,
      teams: [],
      spielorte: [],
      schiedsrichter: [],
      saisonSpiele: [SCHON_ERGEBNIS],
      numberOfGroups: 2,
      isFinishedSaison: false,
      isActiveSaison: true,
      isSpielSweepOn: false,
      today: "2026-10-18",
      spielbericht: { lesen: SPIELBERICHT, korrigierbar: true },
      categorize: () => new Set<never>(),
      pageHeader: { title: "Spiel 7" },
    }),
    { search: "saison_id=2026" },
  );

describe("adopting a report whose proposal the fixture already holds", () => {
  /* The stamp is the save's only effect here: a seed outside the draft status leaves the save disabled, and the report
     stays filed under „Bericht“ with nothing the administrator can press. */
  it("offers the save, sends the report's version with it, and drops the seed once it lands", async () => {
    const user = userEvent.setup();
    render(editor());
    // The submit itself: while the save is refused, the refusal hint's trigger carries the same name.
    const speichern = () =>
      screen.getAllByRole<HTMLButtonElement>("button", { name: "Speichern" }).find((button) => button.type === "submit") ??
      assert.fail("the editor has no save");
    assert.equal(speichern().disabled, true, "the premise: an untouched editor offers no save");

    await user.click(screen.getByRole("button", { name: "Vorschlag übernehmen" }));
    assert.equal(speichern().disabled, false, "the seed left nothing to save");

    await user.click(speichern());
    await act(answered);

    assert.deepEqual(
      calls.map(({ action, payload }) => [action, (payload as readonly unknown[])[2]]),
      [["patchAdminSpielDataAction", VERSION]],
      "the save did not send the version it adopts",
    );
    assert.equal(screen.queryAllByText("Eingesetzt").length, 0, "the seed outlived the save that sent it");
  });
});
