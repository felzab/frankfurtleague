import { side, spielbestaetigungFields, spielFields } from "@/test-support/fixtures.ts";
import { assert, describe, expect, it } from "vitest";

import {
  ACTION_REQUIRED_LABELS,
  bestaetigungNotizen,
  buildActionRequiredSections,
  categorizeActionRequired,
  saisonBestaetigungen,
} from "./utils.ts";

import type { FLBracketFault, FLSpielberichtState, FLSpielbestaetigung, FLSpielbestaetigungAntwort } from "@/core/generated/client/types";
import type { FLSpiel } from "../spiele/types.ts";
import type { FLActionUrgency } from "./utils.ts";

const TODAY = "2026-07-30";

const SPIEL: FLSpiel = spielFields({
  team1: side("6890a1b2c3d4e5f607182932", { name: "Team A", shorthand: "TA", tore: 2 }),
  team2: side("6890a1b2c3d4e5f607182933", { name: "Team B", shorthand: "TB", tore: 1 }),
  datum: "2026-07-20",
  uhrzeit: "18:00:00",
  ort: { spielort_id: "6890a1b2c3d4e5f607182934", name: "Sportplatz Ost", maps_link: "x" },
  schiedsrichter: { schiedsrichter_id: "6890a1b2c3d4e5f607182935", name: "Ref", name_is_public: true },
  ergebnis: "2:1",
});

// Lands in no category, so each test knocks out one field and is unambiguous about the rule it
// exercises.
function makeSpiel(overrides: Partial<FLSpiel> = {}): FLSpiel {
  return { ...SPIEL, ...overrides };
}

describe("categorizeActionRequired", () => {
  it("returns every category even when nothing needs attention", () => {
    const result = categorizeActionRequired([makeSpiel()], TODAY);

    expect(Object.keys(result)).toStrictEqual(Object.keys(ACTION_REQUIRED_LABELS));
    for (const spiele of Object.values(result)) expect(spiele).toStrictEqual([]);
  });

  it("flags a past match with no result as ergebnis_pending", () => {
    const result = categorizeActionRequired([makeSpiel({ datum: "2026-07-29", ergebnis: null })], TODAY);
    expect(result.ergebnis_pending.length).toBe(1);
  });

  // Strict <, the boundary most likely to be "tidied" into <=, which would nag about matches still
  // being played.
  it("does not flag a match dated today with no result", () => {
    const result = categorizeActionRequired([makeSpiel({ datum: TODAY, ergebnis: null })], TODAY);
    expect(result.ergebnis_pending).toStrictEqual([]);
  });

  it("flags each missing field in its own category", () => {
    const result = categorizeActionRequired(
      [makeSpiel({ datum: null }), makeSpiel({ uhrzeit: null }), makeSpiel({ ort: null }), makeSpiel({ schiedsrichter: null })],
      TODAY,
    );

    expect(result.datum_missing.length).toBe(1);
    expect(result.uhrzeit_missing.length).toBe(1);
    expect(result.ort_missing.length).toBe(1);
    expect(result.schiedsrichter_missing.length).toBe(1);
  });

  it("puts one match into several categories when several fields are missing", () => {
    const result = categorizeActionRequired([makeSpiel({ datum: null, uhrzeit: null, ort: null })], TODAY);

    expect(result.datum_missing.length).toBe(1);
    expect(result.uhrzeit_missing.length).toBe(1);
    expect(result.ort_missing.length).toBe(1);
  });

  it("reports a fixture that did not happen only as abgesagt, however incomplete it is", () => {
    for (const sonderereignis of ["ausgefallen", "nichtantreten_team1", "nichtantreten_team2", "annulliert"] as const) {
      const result = categorizeActionRequired(
        [makeSpiel({ sonderereignis, datum: null, uhrzeit: null, ort: null, schiedsrichter: null })],
        TODAY,
      );

      expect(result.abgesagt.length, sonderereignis).toBe(1);
      expect(result.datum_missing, sonderereignis).toStrictEqual([]);
      expect(result.uhrzeit_missing, sonderereignis).toStrictEqual([]);
      expect(result.ort_missing, sonderereignis).toStrictEqual([]);
      expect(result.schiedsrichter_missing, sonderereignis).toStrictEqual([]);
    }
  });

  // The one member that does NOT short-circuit: an abandoned fixture happened and may still owe a
  // result, so it stays in the queue. Folding it in is the accidental agreement the boolean forced.
  it("keeps chasing an abandoned fixture rather than filing it under abgesagt", () => {
    const result = categorizeActionRequired(
      [makeSpiel({ sonderereignis: "abgebrochen", datum: "2026-07-29", ergebnis: null, ort: null })],
      TODAY,
    );

    expect(result.abgesagt).toStrictEqual([]);
    expect(result.ergebnis_pending.length).toBe(1);
    expect(result.ort_missing.length).toBe(1);
  });

  it("does not flag a match with no date as ergebnis_pending", () => {
    const result = categorizeActionRequired([makeSpiel({ datum: null, ergebnis: null })], TODAY);

    expect(result.ergebnis_pending).toStrictEqual([]);
    expect(result.datum_missing.length).toBe(1);
  });

  it("returns empty categories for an empty list", () => {
    const result = categorizeActionRequired([], TODAY);
    for (const spiele of Object.values(result)) expect(spiele).toStrictEqual([]);
  });

  it("flags a knockout side with no team and no source as besetzung_missing", () => {
    const result = categorizeActionRequired([makeSpiel({ saison_phase: "halbfinale", team1: null, team1_quelle: null })], TODAY);
    expect(result.besetzung_missing.length).toBe(1);
  });

  it("flags the shape on either side, but one match only once", () => {
    const result = categorizeActionRequired(
      [makeSpiel({ saison_phase: "halbfinale", team1: null, team1_quelle: null, team2: null, team2_quelle: null })],
      TODAY,
    );
    expect(result.besetzung_missing.length).toBe(1);
  });

  it("does not flag an empty side that has a source", () => {
    const result = categorizeActionRequired(
      [makeSpiel({ saison_phase: "halbfinale", team1: null, team1_quelle: { type: "spiel", spiel_nr: 25, ausgang: "sieger" } })],
      TODAY,
    );
    expect(result.besetzung_missing).toStrictEqual([]);
  });

  // No group fixture ever carries a source, so the phase scope is what keeps this category honest.
  it("does not flag a gruppenphase fixture, however empty", () => {
    const result = categorizeActionRequired([makeSpiel({ saison_phase: "gruppenphase", team1: null, team1_quelle: null })], TODAY);
    expect(result.besetzung_missing).toStrictEqual([]);
  });

  // Membership comes from the backend's derivation, so these cases exercise the join and no
  // predicate.
  it("flags a match named by a bracket fault", () => {
    const result = categorizeActionRequired([makeSpiel()], TODAY, [{ reason: "same_team", spiel_id: makeSpiel().id, spiel_nr: 1 }]);
    expect(result.bracket_fault.length).toBe(1);
  });

  it("puts a match into the category once however many faults name it", () => {
    const id = makeSpiel().id;
    const result = categorizeActionRequired([makeSpiel()], TODAY, [
      { reason: "spiel_missing", spiel_id: id, spiel_nr: 1, quelle_spiel_nr: 98 },
      { reason: "reference_cycle", spiel_id: id, spiel_nr: 1, quelle_spiel_nr: 99 },
    ]);

    expect(result.bracket_fault.length).toBe(1);
  });

  it("flags a cancelled match's bracket fault as well as the cancellation", () => {
    const result = categorizeActionRequired([makeSpiel({ sonderereignis: "ausgefallen" })], TODAY, [
      { reason: "same_team", spiel_id: makeSpiel().id, spiel_nr: 1 },
    ]);

    expect(result.abgesagt.length).toBe(1);
    expect(result.bracket_fault.length).toBe(1);
  });

  /* A correction after adoption comes back as `abweichend`, so it asks for a second look as a first report does; an
     adopted one asks nothing, its result standing as the report proposes. */
  it("files a fixture under its report's proposal while the report reads proposed, diverging or about other teams, never once adopted or called off", () => {
    const spiel = makeSpiel({ datum: TODAY, ergebnis: "3:1" });
    const nach = (zustand: FLSpielberichtState) =>
      categorizeActionRequired([spiel], TODAY, [], saisonBestaetigungen([], []), [{ spiel_id: spiel.id, state: zustand }]).ergebnis_vorschlag
        .length;

    expect([nach("vorgeschlagen"), nach("differing"), nach("teams_changed"), nach("adopted"), nach("abgesagt")]).toStrictEqual([1, 1, 1, 0, 0]);
  });

  /* The section's description is what tells a reader why a card stands here, so it names every state the section files:
     one about other teams carries no score to adopt and would otherwise read as filed by mistake. */
  it("describes each report state the proposal section files, the one about other teams included", () => {
    const { desc } = ACTION_REQUIRED_LABELS.ergebnis_vorschlag;

    for (const fall of ["noch nicht übernommen", "seit der Übernahme geändert", "für andere Teams geschrieben"])
      assert.ok(desc.includes(fall), `the description leaves out the report ${fall}`);
  });

  it("leaves the category empty when no fault names a match in the list", () => {
    const result = categorizeActionRequired([makeSpiel()], TODAY, [
      { reason: "same_team", spiel_id: "6890a1b2c3d4e5f607182999", spiel_nr: 29 },
    ]);

    expect(result.bracket_fault).toStrictEqual([]);
  });
});

describe("categorizeActionRequired over the fixture confirmations", () => {
  // Dated after TODAY, unplayed and otherwise SPIEL, so the rows below are about the Ansetzung it holds: a goal count
  // left on a side decides the fixture, which ends every row about it.
  const ANGESETZT = makeSpiel({
    datum: "2026-08-05",
    ergebnis: null,
    team1: SPIEL.team1 && { ...SPIEL.team1, tore: null },
    team2: SPIEL.team2 && { ...SPIEL.team2, tore: null },
  });
  const ANSETZUNG = {
    datum: "2026-08-05",
    uhrzeit: "18:00:00",
    spielort_id: "6890a1b2c3d4e5f607182934",
    team1_id: "6890a1b2c3d4e5f607182932",
    team2_id: "6890a1b2c3d4e5f607182933",
    stand: "0".repeat(64),
  };
  const zeile = (overrides: Partial<FLSpielbestaetigung> = {}): FLSpielbestaetigung =>
    spielbestaetigungFields({ ansetzung: ANSETZUNG, ...overrides });
  const VORSCHLAG: FLSpielbestaetigungAntwort = {
    art: "declined",
    am: "2026-07-28",
    von: { art: "kontakt", rolle: "trainer" },
    vorschlag: { datum: "2026-08-07", uhrzeit: "17:00:00" },
    begruendung: null,
  };

  const kategorien = (zeilen: FLSpielbestaetigung[], spiel: FLSpiel = ANGESETZT, faults: FLBracketFault[] = []): string[] =>
    Object.entries(categorizeActionRequired([spiel], TODAY, faults, saisonBestaetigungen(zeilen, faults)))
      .filter(([, spiele]) => spiele.length > 0)
      .map(([category]) => category);

  it("files a club's decline carrying a proposal under vorschlag_offen", () => {
    expect(kategorien([zeile({ antwort: VORSCHLAG })])).toStrictEqual(["vorschlag_offen"]);
  });

  it("files an unanswered club's row past its deadline under bestaetigung_ueberfaellig", () => {
    expect(kategorien([zeile({ frist: "2026-07-29" })])).toStrictEqual(["bestaetigung_ueberfaellig"]);
  });

  // Strict <: the deadline's own day is still the club's to answer on.
  it("leaves a row due today out of the overdue category", () => {
    assert.ok(!kategorien([zeile({ frist: TODAY, asked_at: "2026-07-27" })]).includes("bestaetigung_ueberfaellig"));
  });

  it("files a row due on the day it was asked, or not yet asked, under bestaetigung_sofort", () => {
    expect(kategorien([zeile({ frist: TODAY, asked_at: TODAY })])).toStrictEqual(["bestaetigung_sofort"]);
    expect(kategorien([zeile({ frist: TODAY, asked_at: null })])).toStrictEqual(["bestaetigung_sofort"]);
  });

  // Asked on an earlier day, the row had its deadline's days: a reminder's business, not the administrator's.
  it("leaves a row asked before its deadline's day out of bestaetigung_sofort", () => {
    expect(kategorien([zeile({ frist: TODAY, asked_at: "2026-07-27" })])).toStrictEqual([]);
  });

  // The next hourly pass closes these, so until then they speak for nothing the fixture holds.
  it("counts no closed row and no row about an Ansetzung the fixture has left", () => {
    const geschlossen = zeile({ antwort: VORSCHLAG, closed: { am: "2026-07-29", grund: "discarded" } });
    const verlegt = zeile({ antwort: VORSCHLAG, ansetzung: { ...ANSETZUNG, uhrzeit: "19:00:00" } });

    expect(kategorien([geschlossen, verlegt, zeile({ ansetzung: { ...ANSETZUNG, datum: "2026-08-04" } })])).toStrictEqual([]);
  });

  // Each a reason `grund_to_end` shuts the row on at the next pass, which `spielbestaetigungen/utils.test.ts` holds row by row.
  it("counts no row the next pass ends: the fixture decided, its day gone, or a club gone by it", () => {
    const ueberfaellig = zeile({ frist: "2026-07-29" });
    const ausgeschieden: FLBracketFault = {
      reason: "departed_occupant",
      spiel_id: ANGESETZT.id,
      spiel_nr: ANGESETZT.spiel_nr,
      side: "team2",
      team_id: ANSETZUNG.team2_id,
      team_name: "Team B",
      austritt_type: "rueckzug",
      ausgeschieden_seit: "2026-08-01",
      spiel_datum: ANGESETZT.datum,
    };
    const gestern = { ...ANSETZUNG, datum: "2026-07-29" };

    expect(kategorien([ueberfaellig], { ...ANGESETZT, team1: ANGESETZT.team1 && { ...ANGESETZT.team1, tore: 1 } })).toStrictEqual([]);
    expect(kategorien([zeile({ ansetzung: gestern, frist: "2026-07-22" })], { ...ANGESETZT, datum: "2026-07-29" })).toStrictEqual([
      "ergebnis_pending",
    ]);
    expect(kategorien([ueberfaellig], ANGESETZT, [ausgeschieden])).toStrictEqual(["bracket_fault"]);
  });

  it("counts no row of another fixture", () => {
    expect(kategorien([zeile({ antwort: VORSCHLAG, spiel_id: "6890a1b2c3d4e5f607182999" })])).toStrictEqual([]);
  });

  // A referee's answer is bound by the match day rather than the row's deadline.
  it("never files a referee's row as overdue", () => {
    const partei = { art: "schiedsrichter" as const, schiedsrichter_id: "6890a1b2c3d4e5f607182935" };

    expect(kategorien([zeile({ party: partei, kontakte: null, frist: "2026-07-20" })])).toStrictEqual([]);
  });

  describe("a referee's own decline", () => {
    const partei = { art: "schiedsrichter" as const, schiedsrichter_id: "6890a1b2c3d4e5f607182935" };
    const ABGELEHNT: FLSpielbestaetigungAntwort = {
      art: "declined",
      am: "2026-07-28",
      von: { art: "schiedsrichter" },
      vorschlag: null,
      begruendung: null,
    };
    const abgelehnt = zeile({
      party: partei,
      kontakte: null,
      antwort: ABGELEHNT,
      closed: { am: "2026-07-28", grund: "schiedsrichter_declined" },
    });
    const OHNE = { ...ANGESETZT, schiedsrichter: null };

    it("files the slot it emptied under schiedsrichter_abgesagt as well as the missing referee", () => {
      expect(kategorien([abgelehnt], OHNE)).toStrictEqual(["schiedsrichter_missing", "schiedsrichter_abgesagt"]);
    });

    // The read serves a fixture's rows newest first: a referee booked since and taken off again left the slot empty.
    it("files it only while it is the fixture's newest referee row", () => {
      const danach = zeile({
        id: "6890a1b2c3d4e5f607182a02",
        party: { ...partei, schiedsrichter_id: "6890a1b2c3d4e5f607182936" },
        kontakte: null,
      });

      expect(kategorien([danach, abgelehnt], OHNE)).toStrictEqual(["schiedsrichter_missing"]);
    });

    it("files nothing once the slot holds a referee again", () => {
      expect(kategorien([abgelehnt])).toStrictEqual([]);
    });
  });

  it("notes each proposal beside its card by the proposing club and the date it proposes", () => {
    expect(
      bestaetigungNotizen("vorschlag_offen", [ANGESETZT], saisonBestaetigungen([zeile({ antwort: VORSCHLAG })], []), TODAY).get(ANGESETZT.id),
    ).toStrictEqual(["Vorschlag von Team A: 07.08.2026 um 17:00 Uhr"]);
  });

  // A row never mailed past its deadline is no club's silence, which is why the request is stamped after its send.
  it("notes an overdue club by the day it was asked, or as never asked", () => {
    const zeilen = [
      zeile({ frist: "2026-07-29", asked_at: "2026-07-22" }),
      zeile({ party: { art: "team", team_id: ANSETZUNG.team2_id }, frist: "2026-07-29", asked_at: null }),
    ];

    expect(
      bestaetigungNotizen("bestaetigung_ueberfaellig", [ANGESETZT], saisonBestaetigungen(zeilen, []), TODAY).get(ANGESETZT.id),
    ).toStrictEqual(["Team A: angefragt am 22.07.2026, keine Antwort", "Team B: Anfrage nicht verschickt"]);
  });

  // The other club's row stays unclosed until the next pass, and noted it would print a silence about a request the
  // move withdrew, on a card the current row keeps in the tab.
  it("notes no club by a row about an Ansetzung the fixture has left", () => {
    const zeilen = [
      zeile({ frist: "2026-07-29", asked_at: "2026-07-22" }),
      zeile({
        party: { art: "team", team_id: ANSETZUNG.team2_id },
        ansetzung: { ...ANSETZUNG, uhrzeit: "19:00:00" },
        frist: "2026-07-29",
        asked_at: "2026-07-22",
      }),
    ];

    expect(
      bestaetigungNotizen("bestaetigung_ueberfaellig", [ANGESETZT], saisonBestaetigungen(zeilen, []), TODAY).get(ANGESETZT.id),
    ).toStrictEqual(["Team A: angefragt am 22.07.2026, keine Antwort"]);
  });

  it("files a called-off fixture's rows only under abgesagt", () => {
    expect(
      kategorien([zeile({ antwort: VORSCHLAG }), zeile({ frist: "2026-07-20" })], { ...ANGESETZT, sonderereignis: "ausgefallen" }),
    ).toStrictEqual(["abgesagt"]);
  });
});

describe("buildActionRequiredSections", () => {
  const build = (spiele: FLSpiel[], bracketFaults: Parameters<typeof categorizeActionRequired>[2] = []) =>
    buildActionRequiredSections({
      spiele,
      today: TODAY,
      bracketFaults: bracketFaults ?? [],
      bestaetigungen: saisonBestaetigungen([], []),
      spielberichte: [],
    });

  it("returns every category, in the label table's order", () => {
    const sections = build([]);

    expect(sections.map((section) => section.category)).toStrictEqual(Object.keys(ACTION_REQUIRED_LABELS));
  });

  /* The site stores a starting line-up too, so „Aufstellung“ here sends an admin at the squad rather than
     at the two sides of the fixture (`docs/glossary.md :: Paarung`). */
  it("names a faulty pairing with the word the glossary fixes for it", () => {
    const { name, desc } = ACTION_REQUIRED_LABELS.bracket_fault;

    expect(name).toMatch(/Paarungen/);
    expect(desc).toMatch(/Paarung/);
    expect(`${name} ${desc}`).not.toMatch(/Aufstellung/);
  });

  // Declaration order is render order and the tabs' order: a category declared out of its urgency renders out of it,
  // and a move within one urgency reorders the tabs as surely as one across.
  it("runs from the blocking categories to the cancellations in the planned order", () => {
    expect(Object.keys(ACTION_REQUIRED_LABELS)).toStrictEqual([
      "bracket_fault",
      "besetzung_missing",
      "vorschlag_offen",
      "bestaetigung_ueberfaellig",
      "bestaetigung_sofort",
      "ergebnis_pending",
      "ergebnis_vorschlag",
      "datum_missing",
      "uhrzeit_missing",
      "ort_missing",
      "schiedsrichter_missing",
      "schiedsrichter_abgesagt",
      "abgesagt",
    ]);
  });

  it("never lets urgency rise down the table", () => {
    const RANG: Record<FLActionUrgency, number> = { blocking: 0, results: 1, details: 2, none: 3 };
    const raenge = Object.values(ACTION_REQUIRED_LABELS).map((label) => RANG[label.urgency]);

    expect(raenge).toStrictEqual([...raenge].sort((a, b) => a - b));
  });

  // The tab strip names a category by its short word alone, so two alike are two tabs a reader cannot tell apart.
  it("gives every category a short word of its own", () => {
    const kurz = Object.values(ACTION_REQUIRED_LABELS).map((label) => label.short);

    expect(kurz.filter((wort, index) => kurz.indexOf(wort) !== index)).toStrictEqual([]);
  });

  it("returns an empty section rather than omitting it", () => {
    const sections = build([makeSpiel({ ort: null })]);

    expect(sections.find((section) => section.category === "ergebnis_pending")?.spiele).toStrictEqual([]);
  });

  it("orders matches by date, earliest first", () => {
    const sections = build([
      makeSpiel({ id: "a", spiel_nr: 3, datum: "2026-07-28", ergebnis: null }),
      makeSpiel({ id: "b", spiel_nr: 1, datum: "2026-07-10", ergebnis: null }),
    ]);

    expect(sections.find((section) => section.category === "ergebnis_pending")?.spiele.map((spiel) => spiel.id)).toStrictEqual(["b", "a"]);
  });

  it("falls back to the match number when dates tie, and sorts dateless matches last", () => {
    const sections = build([
      makeSpiel({ id: "late", spiel_nr: 9, ort: null, datum: null }),
      makeSpiel({ id: "early", spiel_nr: 2, ort: null, datum: null }),
      makeSpiel({ id: "dated", spiel_nr: 7, ort: null, datum: "2026-08-01" }),
    ]);

    expect(sections.find((section) => section.category === "ort_missing")?.spiele.map((spiel) => spiel.id)).toStrictEqual([
      "dated",
      "early",
      "late",
    ]);
  });

  it("does not mutate the categorised arrays it sorts", () => {
    const spiele = [
      makeSpiel({ id: "b", spiel_nr: 2, ort: null, datum: "2026-08-02" }),
      makeSpiel({ id: "a", spiel_nr: 1, ort: null, datum: "2026-08-01" }),
    ];
    build(spiele);

    expect(spiele.map((spiel) => spiel.id)).toStrictEqual(["b", "a"]);
  });
});
