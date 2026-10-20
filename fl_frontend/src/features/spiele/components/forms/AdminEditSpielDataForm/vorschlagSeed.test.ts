import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { createElement as h } from "react";

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { FLSpielberichtAdminResponseSchema } from "@/features/spielberichte/schemas.ts";
import { FLSpielAdminSchema } from "@/features/spiele/schemas.ts";
import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { side, spielFields } from "@/shared/testing/fixtures.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { spielberichtReadFixture } from "@/shared/testing/spielberichtFixtures.ts";

import type { FLSpielAdmin } from "@/features/spiele/schemas.ts";

doubleActions({
  modules: ["/src/features/spiele/actions.ts"],
  answer: () => Promise.resolve({ success: true, message: "Spiel gespeichert." }),
});
doubleToasts();

const { AdminEditSpielDataForm } = await import("./AdminEditSpielDataForm.tsx");

const GOETHE = "68c1f0a2b3c4d5e6f7a8b9a1";
const LESSING = "68c1f0a2b3c4d5e6f7a8b9a2";

/** A fixture played and still without a result; the report proposes 1:0 for it unless a case proposes otherwise. */
const ohneErgebnis = (fields: Record<string, unknown> = {}): FLSpielAdmin =>
  FLSpielAdminSchema.parse(
    spielFields({
      id: "68c1f0a2b3c4d5e6f7a8b9e2",
      spiel_nr: 7,
      saison_id: "2026",
      saison_phase: "gruppenphase",
      team1: side(GOETHE, { name: "Goethe-Gymnasium", shorthand: "GG", tore: null }),
      team2: side(LESSING, { name: "Lessing-Gymnasium", shorthand: "LG", tore: null }),
      ergebnis: null,
      ...fields,
    }),
  );

const editor = (spielData: FLSpielAdmin = ohneErgebnis(), vorschlag?: Record<string, unknown>) => {
  const gelesen = spielberichtReadFixture();
  const bericht = vorschlag === undefined ? gelesen.bericht : { ...gelesen.bericht, ergebnis_vorschlag: vorschlag };
  return underNext(
    h(AdminEditSpielDataForm, {
      spielData,
      teams: [],
      spielorte: [],
      schiedsrichter: [],
      saisonSpiele: [spielData],
      numberOfGroups: 2,
      isFinishedSaison: false,
      isActiveSaison: true,
      isSpielSweepOn: false,
      today: "2026-10-18",
      spielbericht: { lesen: FLSpielberichtAdminResponseSchema.parse({ ...gelesen, bericht }), korrigierbar: true },
      categorize: () => new Set<never>(),
      pageHeader: { title: "Spiel 7" },
    }),
    { search: "saison_id=2026" },
  );
};

const wert = (name: string): string | undefined => document.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value;

afterEach(cleanup);

describe("carrying a report's proposal into the match editor", () => {
  /* The seed lands in the mounted form's atoms: a remount would drop the note typed before the press, and a seed
     carried in the page's key alone would leave the boxes as they were. */
  it("fills the goal boxes from the proposal, marks them changed, and keeps every edit made before the press", async () => {
    const user = userEvent.setup();
    render(editor());
    await user.type(screen.getByRole("textbox", { name: /Notiz zum Spiel/ }), "Nachholspiel");

    await user.click(screen.getByRole("button", { name: "Vorschlag übernehmen" }));

    assert.equal(screen.getByRole<HTMLInputElement>("textbox", { name: /Goethe-Gymnasium/ }).value, "1");
    assert.equal(screen.getByRole<HTMLInputElement>("textbox", { name: /Lessing-Gymnasium/ }).value, "0");
    assert.equal(
      screen.getByRole<HTMLTextAreaElement>("textbox", { name: /Notiz zum Spiel/ }).value,
      "Nachholspiel",
      "the press remounted the form",
    );
    assert.ok(screen.getByText("Eingesetzt"), "the panel does not say the proposal is in the draft");
    assert.ok(screen.getAllByRole("button", { name: "Geändert" }).length >= 2, "the seeded goals are not marked as changed");
    // The result's own switch is the guard a typed result passes, so a seed leaving it closed leaves the boxes read-only.
    assert.equal(screen.getByRole<HTMLInputElement>("switch", { name: "Spielergebnis eintragen" }).checked, true);
  });

  /* The App Router keeps the discarded tree, so a seed surviving the discard would name a report version on a later,
     unrelated save of the same editor. */
  it("drops the seed with the rest of the draft on a discard", async () => {
    const user = userEvent.setup();
    render(editor());
    await user.click(screen.getByRole("button", { name: "Vorschlag übernehmen" }));

    await user.click(screen.getAllByRole("button", { name: "Abbrechen" })[0] ?? assert.fail("the editor offers no way out"));
    await user.click(screen.getByRole("button", { name: "Verwerfen" }));

    assert.equal(screen.queryAllByText("Eingesetzt").length, 0, "the seed survived the discard");
    assert.equal(screen.getByRole<HTMLInputElement>("textbox", { name: /Goethe-Gymnasium/ }).value, "");
  });

  /* A level knockout keeps its shoot-out, so a seed carrying the goals alone saves a draw the proposal never made. */
  it("carries a knockout's shoot-out with its goals", async () => {
    const user = userEvent.setup();
    render(
      editor(ohneErgebnis({ saison_phase: "viertelfinale" }), {
        team1_tore: 2,
        team2_tore: 2,
        elfmeterschiessen: { team1: 4, team2: 3 },
        sonderereignis: null,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Vorschlag übernehmen" }));

    assert.equal(screen.getByRole<HTMLInputElement>("switch", { name: "Im Elfmeterschießen entschieden" }).checked, true);
    assert.deepEqual([wert("elfmeterschiessen.team1"), wert("elfmeterschiessen.team2")], ["4", "3"]);
  });

  /* A no-show's goals are the season's forfeit, so the seed carries the event and leaves both boxes empty for it. */
  it("carries a no-show as its event, with no goals typed", async () => {
    const user = userEvent.setup();
    render(editor(ohneErgebnis(), { team1_tore: null, team2_tore: null, elfmeterschiessen: null, sonderereignis: "nichtantreten_team2" }));

    await user.click(screen.getByRole("button", { name: "Vorschlag übernehmen" }));

    assert.equal(screen.getByRole<HTMLInputElement>("switch", { name: "Sonderereignis eintragen" }).checked, true);
    assert.ok(screen.getAllByText("Nichtantreten Team 2").length > 0, "the seeded event is not picked");
    assert.equal(screen.getByRole<HTMLInputElement>("textbox", { name: /Goethe-Gymnasium/ }).value, "");
  });

  /* The proposal's goals and events are by side: a draft with a side open has nowhere to carry them, and one fielding
     another club would carry them onto the wrong team. */
  for (const [fall, spielData] of [
    ["a side open", ohneErgebnis({ team2: null })],
    ["another club on a side", ohneErgebnis({ team1: side("68c1f0a2b3c4d5e6f7a8b9a3", { name: "Schiller-Schule", shorthand: "SS" }) })],
  ] as const) {
    it(`offers no press with ${fall}, and says why`, () => {
      render(editor(spielData));

      // The refusal's own trigger shares the press's name, its visible words leading it.
      const press =
        screen
          .getAllByRole<HTMLButtonElement>("button", { name: /^Vorschlag übernehmen/ })
          .find((button) => button.textContent === "Vorschlag übernehmen") ?? assert.fail("the panel renders no press");
      assert.ok(press.disabled, `the press seeds a draft with ${fall}`);
      assert.ok(
        screen.getAllByText(/Im Formular stehen noch nicht beide Teams|Die Teams im Formular sind nicht die des Spielberichts/).length > 0,
        "the closed press names no reason",
      );
    });
  }

  /* The save stamps the report as adopted, so a goal typed over the seed is the administrator's result and must not be
     recorded as the report's. */
  it("drops the adoption once a seeded field is edited by hand", async () => {
    const user = userEvent.setup();
    render(editor());
    await user.click(screen.getByRole("button", { name: "Vorschlag übernehmen" }));

    const tore = screen.getByRole<HTMLInputElement>("textbox", { name: /Goethe-Gymnasium/ });
    await user.clear(tore);
    await user.type(tore, "2");
    await user.tab();

    assert.equal(screen.queryAllByText("Eingesetzt").length, 0, "the draft still claims to hold the report's proposal");
  });
});
