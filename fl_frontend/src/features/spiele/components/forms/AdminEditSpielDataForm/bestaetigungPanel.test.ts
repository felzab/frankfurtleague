import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { setImmediate as settled } from "node:timers/promises";

import { act, createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { FLSpielbestaetigungSchema } from "@/features/spielbestaetigungen/schemas.ts";
import { FLSpielAdminSchema } from "@/features/spiele/schemas.ts";
import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { side, spielbestaetigungFields, spielFields } from "@/shared/testing/fixtures.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";

import type { SpielbestaetigungenStand } from "@/features/spielbestaetigungen/types.ts";
import type { SpielbestaetigungFields } from "@/shared/testing/fixtures.ts";

/* One answer for every action the editor calls: the dry run reads its two lists off it, and the save its message. */
const { calls, answered } = doubleActions({
  modules: ["/src/features/spiele/actions.ts", "/src/features/spielbestaetigungen/actions.ts"],
  answer: () => Promise.resolve({ success: true, message: "Spiel gespeichert.", priorPaarungen: [], voidedFixtures: [], releasedFixtures: [] }),
});

doubleToasts();

const { AdminEditSpielDataForm } = await import("./AdminEditSpielDataForm.tsx");

const TEAM1 = "6890a1b2c3d4e5f607182932";
const TEAM2 = "6890a1b2c3d4e5f607182933";
const ORT = "6890a1b2c3d4e5f607182934";

/** A dated fixture on a ground with both sides, the one a confirmation row is minted for. */
const ANGESETZT = FLSpielAdminSchema.parse(
  spielFields({
    team1: side(TEAM1, { name: "SG Alpha", shorthand: "SA" }),
    team2: side(TEAM2, { name: "SG Beta", shorthand: "SB" }),
    datum: "2026-11-07",
    uhrzeit: "18:00:00",
    ort: { spielort_id: ORT, name: "Sportplatz Ost", maps_link: "https://maps.example/ost", mietpreis: 0 },
  }),
);
const ANSETZUNG = { datum: "2026-11-07", uhrzeit: "18:00:00", spielort_id: ORT, team1_id: TEAM1, team2_id: TEAM2, stand: "0".repeat(64) };

const zeile = (overrides: Partial<SpielbestaetigungFields> = {}) =>
  FLSpielbestaetigungSchema.parse(
    spielbestaetigungFields({ ansetzung: ANSETZUNG, frist: "2026-10-31", angefragt_am: "2026-10-31", ...overrides }),
  );

/** Team 1's open decline proposing Monday at five. */
const VORSCHLAG = zeile({
  antwort: {
    art: "abgelehnt",
    am: "2026-11-01",
    von: { art: "kontakt", rolle: "trainer" },
    vorschlag: { datum: "2026-11-09", uhrzeit: "17:00:00" },
    begruendung: null,
  },
});

function renderEditor({
  stand = { zeilen: [VORSCHLAG], gelaufenAm: "2026-11-01" },
  isActiveSaison = true,
}: { stand?: SpielbestaetigungenStand | null; isActiveSaison?: boolean } = {}): void {
  render(
    underNext(
      h(AdminEditSpielDataForm, {
        spielData: ANGESETZT,
        teams: [],
        spielorte: [],
        schiedsrichter: [],
        saisonSpiele: [ANGESETZT],
        numberOfGroups: 2,
        isFinishedSaison: false,
        isActiveSaison,
        isSpielSweepOn: true,
        today: "2026-11-02",
        bestaetigungen: stand,
        categorize: () => new Set<never>(),
        pageHeader: { title: "Spiel 1" },
      }),
      { search: "saison_id=2026" },
    ),
  );
}

beforeEach(() => {
  calls.length = 0;
});

describe("a proposal carried into the match editor", () => {
  /* Into the draft's own atoms, never by a remount: a key widened to the proposal would drop every other unsaved
     edit, and Speichern, its dry run and its undo still decide. */
  it("sends the proposed date and hour with the rest of the draft on the next save", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.type(screen.getByRole("textbox", { name: "Notiz zum Spiel" }), "Halle getauscht");
    await user.click(screen.getByRole("button", { name: "Vorschlag übernehmen: SG Alpha" }));
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    await act(async () => settled());
    const confirm = screen.queryByRole("button", { name: "Trotzdem speichern" });
    if (confirm !== null) {
      await user.click(confirm);
      await act(async () => settled());
    }

    const saved = calls.filter((call) => call.action === "patchAdminSpielDataAction").map((call) => call.payload as Record<string, unknown>);
    assert.equal(saved.length, 1, "the draft was never saved, so nothing below is judged");
    assert.deepEqual(
      [saved[0]?.["datum"], saved[0]?.["uhrzeit"], saved[0]?.["notiz"]],
      ["2026-11-09", "17:00:00", "Halle getauscht"],
      "the proposal reached the save without the edit typed before it, or not at all",
    );
    await act(answered);
  });
});

describe("the settle's reason box in the match editor", () => {
  /* The panel sits inside the editor's form, so an Enter its box let through would submit the fixture's save. */
  it("sends nothing on an Enter in the box, though the draft would save", async () => {
    const user = userEvent.setup();
    renderEditor({ stand: { zeilen: [zeile()], gelaufenAm: "2026-11-01" } });

    await user.type(screen.getByRole("textbox", { name: "Notiz zum Spiel" }), "Halle getauscht");
    await user.type(screen.getByRole("textbox", { name: "Begründung für die Zusage: SG Alpha" }), "Am Telefon{Enter}");
    await act(async () => settled());

    assert.deepEqual(
      calls.map((call) => call.action).filter((action) => action !== "previewAdminSpielDataAction"),
      [],
      "an Enter in the reason box sent a write",
    );
    assert.equal(screen.queryAllByRole("button", { name: "Trotzdem speichern" }).length, 0, "an Enter in the reason box asked to save");
  });
});

describe("the confirmations' panel in the match editor", () => {
  it("offers the press on a row about the Ansetzung the fixture holds, and none on one it has left", () => {
    renderEditor({
      stand: {
        zeilen: [VORSCHLAG, zeile({ id: "6890a1b2c3d4e5f607182a09", ansetzung: { ...ANSETZUNG, uhrzeit: "19:00:00" } })],
        gelaufenAm: null,
      },
    });

    assert.equal(screen.getAllByRole("button", { name: /^Vorschlag verwerfen/ }).length, 1);
    assert.equal(screen.queryAllByRole("button", { name: /^Auf Zusage setzen/ }).length, 0, "a row about a former slot is offered a settle");
    assert.ok(screen.getByText(/^Betrifft den früheren Termin 07\.11\.2026 um 19:00 Uhr/));
  });

  it("says in words that no pass has run since, where one was due", () => {
    renderEditor({ stand: { zeilen: [], gelaufenAm: "2026-10-30" } });
    assert.ok(screen.getByText("Letzter Lauf: 30.10.2026. Seitdem wurde nicht mehr angefragt."));
  });

  it("states the last run plainly for a season the pass does not visit", () => {
    renderEditor({ stand: { zeilen: [], gelaufenAm: "2026-10-30" }, isActiveSaison: false });
    assert.ok(screen.getByText("Letzter Lauf: 30.10.2026"));
  });

  it("says a failed read failed, rather than that nobody was asked", () => {
    renderEditor({ stand: null });
    assert.ok(screen.getByText(/^Die Spielbestätigungen ließen sich gerade nicht lesen/));
    assert.equal(screen.queryAllByText(/noch keine Anfrage/).length, 0);
  });
});
