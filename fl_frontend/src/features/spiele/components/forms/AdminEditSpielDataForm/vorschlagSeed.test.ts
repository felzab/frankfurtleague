import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { FLSpielberichtAdminResponseSchema } from "@/features/spielberichte/schemas.ts";
import { FLSpielAdminSchema } from "@/features/spiele/schemas.ts";
import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { side, spielFields } from "@/shared/testing/fixtures.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { spielberichtReadFixture } from "@/shared/testing/spielberichtFixtures.ts";

doubleActions({
  modules: ["/src/features/spiele/actions.ts"],
  answer: () => Promise.resolve({ success: true, message: "Spiel gespeichert." }),
});
doubleToasts();

const { AdminEditSpielDataForm } = await import("./AdminEditSpielDataForm.tsx");

/** A group fixture played and still without a result, which the report proposes 1:0 for. */
const OHNE_ERGEBNIS = FLSpielAdminSchema.parse(
  spielFields({
    id: "68c1f0a2b3c4d5e6f7a8b9e2",
    spiel_nr: 7,
    saison_id: "2026",
    saison_phase: "gruppenphase",
    team1: side("68c1f0a2b3c4d5e6f7a8b9a1", { name: "Goethe-Gymnasium", shorthand: "GG", tore: null }),
    team2: side("68c1f0a2b3c4d5e6f7a8b9a2", { name: "Lessing-Gymnasium", shorthand: "LG", tore: null }),
    ergebnis: null,
  }),
);

const editor = () =>
  underNext(
    h(AdminEditSpielDataForm, {
      spielData: OHNE_ERGEBNIS,
      teams: [],
      spielorte: [],
      schiedsrichter: [],
      saisonSpiele: [OHNE_ERGEBNIS],
      numberOfGroups: 2,
      isFinishedSaison: false,
      isActiveSaison: true,
      isSpielSweepOn: false,
      today: "2026-10-18",
      spielbericht: FLSpielberichtAdminResponseSchema.parse(spielberichtReadFixture()),
      categorize: () => new Set<never>(),
      pageHeader: { title: "Spiel 7" },
    }),
    { search: "saison_id=2026" },
  );

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
});
