import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { setImmediate as settled } from "node:timers/promises";

import { act, createElement as h } from "react";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { FLSpielberichtAdminResponseSchema } from "@/features/spielberichte/schemas.ts";
import { FLSpielAdminSchema } from "@/features/spiele/schemas.ts";
import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { side, spielFields } from "@/shared/testing/fixtures.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { pickerTrigger } from "@/shared/testing/pickerTrigger.ts";
import { spielberichtReadFixture } from "@/shared/testing/spielberichtFixtures.ts";

import type { FLTeam } from "@/features/teams/schemas.ts";

/** What the save answers it stamped over: no adoption before this one. */
const PRIOR_BERICHT = {
  spiel_id: "68c1f0a2b3c4d5e6f7a8b9e2",
  version: 3,
  uebernommen_am: null,
  uebernommen_von: null,
  uebernommene_version: null,
};

const { calls, answered } = doubleActions({
  modules: ["/src/features/spiele/actions.ts"],
  answer: () => Promise.resolve({ success: true, message: "Spiel gespeichert.", priorPaarungen: [], priorBericht: PRIOR_BERICHT }),
  payloadOf: (args) => args,
});
const { raised } = doubleToasts();

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

const editor = (teams: FLTeam[] = []) =>
  underNext(
    h(AdminEditSpielDataForm, {
      spielData: SCHON_ERGEBNIS,
      teams,
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

const GOETHE = "68c1f0a2b3c4d5e6f7a8b9a1";
const LESSING = "68c1f0a2b3c4d5e6f7a8b9a2";
const SCHILLER = "68c1f0a2b3c4d5e6f7a8b9a3";

const ADRESSE = { strasse: "Am Sportpark", hausnummer: "1", plz: "60435", stadtteil: "Nordend", stadt: "Frankfurt am Main" };

const verein = (id: string, name: string, shorthand: string): FLTeam => ({
  id,
  name,
  gruppe: "A",
  statistik: {
    anzahl_gespielte_spiele: 0,
    siege: 0,
    niederlagen: 0,
    unentschieden: 0,
    tore_geschossen: 0,
    tore_kassiert: 0,
    punkte: 0,
    anzahl_abgesagte_spiele: 0,
  },
  austritt: null,
  shorthand,
  description: "",
  full_name: name,
  website_url: null,
  address: ADRESSE,
  schulform: null,
  inactive_since: null,
});

afterEach(cleanup);

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

    await user.click(screen.getByRole("button", { name: "Vorschlag übernehmen: Spielbericht" }));
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

  /* The undo puts back the result the save adopted onto, so it puts back the adoption too: left standing, the report
     reads adopted on a result the undo took back. */
  it("hands the adoption the save stamped over to its undo", async () => {
    const user = userEvent.setup();
    render(editor());
    await user.click(screen.getByRole("button", { name: "Vorschlag übernehmen: Spielbericht" }));
    await user.click(
      screen.getAllByRole<HTMLButtonElement>("button", { name: "Speichern" }).find((button) => button.type === "submit") ??
        assert.fail("the editor has no save"),
    );
    await act(answered);

    const offer = await waitFor(
      () => raised.find((toast) => toast.options?.actionProps?.onPress !== undefined) ?? assert.fail("the save offered no undo"),
    );
    offer.options?.actionProps?.onPress?.();
    await settled();

    const undo = calls.find(({ action }) => action === "undoAdminSpielEditAction") ?? assert.fail("the offer sent no undo");
    assert.deepEqual((undo.payload as readonly { bericht?: unknown }[])[0]?.bericht, PRIOR_BERICHT, "the undo left the adoption standing");
  });

  /* The goals still hold the proposal, but for another club: the report is about the clubs it was written for, so the
     seed vouches for nothing once a side leaves them, and the backend would stamp nothing either. */
  it("claims no adoption once a side of the draft is no longer the report's club", async () => {
    const user = userEvent.setup();
    const before = calls.length;
    render(
      editor([verein(GOETHE, "Goethe-Gymnasium", "GG"), verein(LESSING, "Lessing-Gymnasium", "LG"), verein(SCHILLER, "Schiller-Schule", "SS")]),
    );
    await user.click(screen.getByRole("button", { name: "Vorschlag übernehmen: Spielbericht" }));
    assert.ok(screen.getByText("Eingesetzt"), "the premise: the seed took");

    await user.click(pickerTrigger("Team 1"));
    await user.click(screen.getByRole("option", { name: "Schiller-Schule" }));
    assert.equal(screen.queryAllByText("Eingesetzt").length, 0, "the panel vouches for a seed on a draft fielding another club");

    await user.click(
      screen.getAllByRole<HTMLButtonElement>("button", { name: "Speichern" }).find((button) => button.type === "submit") ??
        assert.fail("the editor has no save"),
    );
    await act(answered);
    const trotzdem = screen.queryAllByRole("button", { name: "Trotzdem speichern" })[0];
    if (trotzdem !== undefined) {
      await user.click(trotzdem);
      await act(answered);
    }

    assert.deepEqual(
      calls
        .slice(before)
        .filter(({ action }) => action === "patchAdminSpielDataAction")
        .map(({ payload }) => (payload as readonly unknown[])[2]),
      [null],
      "the save named the report's version on a draft the report is not about",
    );
  });
});
