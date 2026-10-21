import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { createElement as h } from "react";

import { cleanup, render, screen } from "@testing-library/react";

import { FLSpielbestaetigungSchema } from "@/features/spielbestaetigungen/schemas.ts";
import { FLSpielSchema } from "@/features/spiele/schemas.ts";
import { side, spielbestaetigungFields, spielFields } from "@/shared/testing/fixtures.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";

import type { FLSpielberichtZustandEintrag } from "@/features/spielberichte/schemas.ts";
import type { FLSpielbestaetigung } from "@/features/spielbestaetigungen/schemas.ts";
import type { SpielbestaetigungFields } from "@/shared/testing/fixtures.ts";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { AdminSpieleActionRequiredView } = await import("./AdminSpieleActionRequiredView.tsx");

/** A group fixture played yesterday with its result stored, the one a report reaches the triage on alone. */
const GESPIELT = FLSpielSchema.parse(spielFields({ datum: "2026-10-17", ergebnis: "3:1" }));

const bericht = (zustand: FLSpielberichtZustandEintrag["zustand"]): FLSpielberichtZustandEintrag => ({
  spiel_id: GESPIELT.id,
  zustand,
  ergebnis_vorschlag: { team1_tore: 3, team2_tore: 1, elfmeterschiessen: null, sonderereignis: null },
});

const triage = (spielberichte: readonly FLSpielberichtZustandEintrag[]) =>
  render(
    underNext(
      h(AdminSpieleActionRequiredView, {
        overviewSpiele: [GESPIELT],
        bracketFaults: [],
        bestaetigungen: [],
        bestaetigungenVollstaendig: true,
        spielberichte,
        today: "2026-10-18",
        isFinishedSaison: false,
      }),
      { search: "saison_id=2026&section=ergebnis_vorschlag" },
    ),
  );

/** The triage over no fixture, so the notice above the tabs is all its confirmation rows change. */
const mitBestaetigungen = (bestaetigungen: readonly FLSpielbestaetigung[] | null, bestaetigungenVollstaendig = true) =>
  render(
    underNext(
      h(AdminSpieleActionRequiredView, {
        overviewSpiele: [],
        bracketFaults: [],
        bestaetigungen,
        bestaetigungenVollstaendig,
        spielberichte: [],
        today: "2026-07-30",
        isFinishedSaison: false,
      }),
      { search: "saison_id=2026" },
    ),
  );

afterEach(cleanup);

describe("the triage's reports", () => {
  /* The fixture already holds a result, so only the report's state files it: a correction after adoption included. */
  it("files a corrected report's fixture under its proposal, its card naming the state and the score", () => {
    triage([bericht("abweichend")]);

    assert.equal(screen.getByRole("tab", { name: /^Bericht/ }).textContent, "Bericht1", "the fixture is not filed under the proposal");
    assert.ok(screen.getByText("Bericht nicht übernommen 3:1"), "the card does not say the result stands on no adopted report");
  });

  /* A correction upstream fielded other clubs since the report: it awaits a new save, and its score belongs to the clubs that left. */
  it("files a report about other teams under the proposal, its card naming no score", () => {
    triage([bericht("teams_geaendert")]);

    assert.equal(screen.getByRole("tab", { name: /^Bericht/ }).textContent, "Bericht1", "the fixture is not filed under the proposal");
    assert.ok(screen.getByText("Bericht zu anderen Teams"), "the card does not say the report is about other teams");
  });

  /* A report on a fixture called off since awaits nobody, as an adopted one does: the triage names the states that wait. */
  for (const zustand of ["uebernommen", "abgesagt"] as const) {
    it(`files nothing and names nothing for a report reading ${zustand}`, () => {
      triage([bericht(zustand)]);

      assert.equal(screen.getByRole("tab", { name: /^Bericht/ }).textContent, "Bericht0");
      assert.equal(
        screen.queryAllByText(/Ergebnis vorgeschlagen|Bericht nicht übernommen/).length,
        0,
        `a ${zustand} report still chips its card`,
      );
    });
  }
});

// Each tab reading zero would say a category is clear, so a failed or cut read is said above them.
describe("the triage's notice about the confirmation rows", () => {
  it("says the rows could not be read, rather than showing their tabs as clear", () => {
    mitBestaetigungen(null);

    screen.getByText("Die Spielbestätigungen ließen sich gerade nicht lesen");
    // The referee's decline is filed off the same rows, so its tab reads a cleared zero too.
    screen.getByText(/Terminvorschlägen, Bestätigungen und „Schiedsrichter hat abgelehnt“ sind deshalb leer/);
  });

  it("says the rows were cut, and which category the cut can leave short", () => {
    mitBestaetigungen([], false);

    screen.getByText("Die Spielbestätigungen sind unvollständig");
    screen.getByText(/von den geschlossenen nur die neuesten\. „Schiedsrichter hat abgelehnt“ kann deshalb Spiele auslassen\./);
  });

  it("says nothing of a whole read", () => {
    mitBestaetigungen([]);

    assert.equal(screen.queryAllByText(/^Die Spielbestätigungen/).length, 0, "a whole read raised the notice");
  });
});

/* The categories hold the fixture whatever the cards say, so a card dropping its note or chip leaves every count right
   and the administrator without the club, the date or the report the card is filed for. */
describe("the notes and chips on the triage's cards", () => {
  // Unplayed and dated after the day, so its rows are about the Ansetzung it holds.
  const ANGESETZT = FLSpielSchema.parse(
    spielFields({
      team1: side("6890a1b2c3d4e5f607182932", { name: "Team A", shorthand: "TA", tore: null }),
      team2: side("6890a1b2c3d4e5f607182933", { name: "Team B", shorthand: "TB", tore: null }),
      datum: "2026-08-05",
      uhrzeit: "18:00:00",
      ort: { spielort_id: "6890a1b2c3d4e5f607182934", name: "Sportplatz Ost", maps_link: "x" },
      schiedsrichter: { schiedsrichter_id: "6890a1b2c3d4e5f607182935", name: "Ref", name_is_public: true },
      ergebnis: null,
    }),
  );
  const ANSETZUNG = {
    datum: "2026-08-05",
    uhrzeit: "18:00:00",
    spielort_id: "6890a1b2c3d4e5f607182934",
    team1_id: "6890a1b2c3d4e5f607182932",
    team2_id: "6890a1b2c3d4e5f607182933",
    stand: "0".repeat(64),
  };
  const zeile = (overrides: Partial<SpielbestaetigungFields> = {}): FLSpielbestaetigung =>
    FLSpielbestaetigungSchema.parse(spielbestaetigungFields({ ansetzung: ANSETZUNG, ...overrides }));
  const VORSCHLAG = {
    art: "abgelehnt",
    am: "2026-07-28",
    von: { art: "kontakt", rolle: "trainer" },
    vorschlag: { datum: "2026-08-07", uhrzeit: "17:00:00" },
    begruendung: null,
  };

  const karten = (
    section: string,
    bestaetigungen: readonly FLSpielbestaetigung[],
    spielberichte: readonly FLSpielberichtZustandEintrag[] = [],
  ) =>
    render(
      underNext(
        h(AdminSpieleActionRequiredView, {
          overviewSpiele: [ANGESETZT],
          bracketFaults: [],
          bestaetigungen,
          bestaetigungenVollstaendig: true,
          spielberichte,
          today: "2026-07-30",
          isFinishedSaison: false,
        }),
        { search: `saison_id=2026&section=${section}` },
      ),
    );

  it("names the proposing club and its date beside a proposal's card", () => {
    karten("vorschlag_offen", [zeile({ antwort: VORSCHLAG })]);

    screen.getByText("Vorschlag von Team A: 07.08.2026 um 17:00 Uhr");
  });

  it("names the silent club and the day it was asked beside an overdue card", () => {
    karten("bestaetigung_ueberfaellig", [zeile({ frist: "2026-07-29", angefragt_am: "2026-07-22" })]);

    screen.getByText("Team A: angefragt am 22.07.2026, keine Antwort");
  });

  it("chips a report's state on the fixture's card under a confirmation's category too", () => {
    karten("vorschlag_offen", [zeile({ antwort: VORSCHLAG })], [{ ...bericht("vorgeschlagen"), spiel_id: ANGESETZT.id }]);

    assert.ok(screen.getAllByText(/^Ergebnis vorgeschlagen/).length > 0, "the proposal's card carries no report chip");
  });
});
