import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ACTION_REQUIRED_LABELS, buildActionRequiredSections, categorizeActionRequired } from "./utils.ts";

import type { FLSpiel } from "../spiele/schemas.ts";

const TODAY = "2026-07-30";

// Lands in no category, so each test knocks out one field and is unambiguous about the rule it
// exercises.
function makeSpiel(overrides: Partial<FLSpiel> = {}): FLSpiel {
  return {
    id: "6890a1b2c3d4e5f607182930",
    spieltag_id: "6890a1b2c3d4e5f607182931",
    team1: { team_id: "6890a1b2c3d4e5f607182932", name: "Team A", tore: 2, shorthand: "TA" },
    team2: { team_id: "6890a1b2c3d4e5f607182933", name: "Team B", tore: 1, shorthand: "TB" },
    team1_quelle: null,
    team2_quelle: null,
    datum: "2026-07-20",
    uhrzeit: "18:00:00",
    ort: { spielort_id: "6890a1b2c3d4e5f607182934", name: "Sportplatz Ost", maps_link: "x", mietpreis: 50 },
    schiedsrichter: { schiedsrichter_id: "6890a1b2c3d4e5f607182935", name: "Ref", payment: 20 },
    ergebnis: "2:1",
    spiel_nr: 1,
    is_canceled: false,
    saison_phase: "gruppenphase",
    ...overrides,
  } as FLSpiel;
}

describe("categorizeActionRequired", () => {
  it("returns all eight categories even when nothing needs attention", () => {
    const result = categorizeActionRequired([makeSpiel()], TODAY);

    assert.deepEqual(Object.keys(result), Object.keys(ACTION_REQUIRED_LABELS));
    for (const spiele of Object.values(result)) assert.deepEqual(spiele, []);
  });

  it("flags a past match with no result as ergebnis_pending", () => {
    const result = categorizeActionRequired([makeSpiel({ datum: "2026-07-29", ergebnis: null })], TODAY);
    assert.equal(result.ergebnis_pending.length, 1);
  });

  // Strict <, the boundary most likely to be "tidied" into <=, which would nag about matches still
  // being played.
  it("does not flag a match dated today with no result", () => {
    const result = categorizeActionRequired([makeSpiel({ datum: TODAY, ergebnis: null })], TODAY);
    assert.deepEqual(result.ergebnis_pending, []);
  });

  it("flags each missing field in its own category", () => {
    const result = categorizeActionRequired(
      [makeSpiel({ datum: null }), makeSpiel({ uhrzeit: null }), makeSpiel({ ort: null }), makeSpiel({ schiedsrichter: null })],
      TODAY,
    );

    assert.equal(result.datum_missing.length, 1);
    assert.equal(result.uhrzeit_missing.length, 1);
    assert.equal(result.ort_missing.length, 1);
    assert.equal(result.schiedsrichter_missing.length, 1);
  });

  it("puts one match into several categories when several fields are missing", () => {
    const result = categorizeActionRequired([makeSpiel({ datum: null, uhrzeit: null, ort: null })], TODAY);

    assert.equal(result.datum_missing.length, 1);
    assert.equal(result.uhrzeit_missing.length, 1);
    assert.equal(result.ort_missing.length, 1);
  });

  it("reports a cancelled match only as cancelled, however incomplete it is", () => {
    const result = categorizeActionRequired(
      [makeSpiel({ is_canceled: true, datum: null, uhrzeit: null, ort: null, schiedsrichter: null })],
      TODAY,
    );

    assert.equal(result.is_canceled.length, 1);
    assert.deepEqual(result.datum_missing, []);
    assert.deepEqual(result.uhrzeit_missing, []);
    assert.deepEqual(result.ort_missing, []);
    assert.deepEqual(result.schiedsrichter_missing, []);
  });

  it("does not flag a match with no date as ergebnis_pending", () => {
    const result = categorizeActionRequired([makeSpiel({ datum: null, ergebnis: null })], TODAY);

    assert.deepEqual(result.ergebnis_pending, []);
    assert.equal(result.datum_missing.length, 1);
  });

  it("returns empty categories for an empty list", () => {
    const result = categorizeActionRequired([], TODAY);
    for (const spiele of Object.values(result)) assert.deepEqual(spiele, []);
  });

  it("flags a knockout side with no team and no source as besetzung_missing", () => {
    const result = categorizeActionRequired([makeSpiel({ saison_phase: "halbfinale", team1: null, team1_quelle: null })], TODAY);
    assert.equal(result.besetzung_missing.length, 1);
  });

  it("flags the shape on either side, but one match only once", () => {
    const result = categorizeActionRequired(
      [makeSpiel({ saison_phase: "halbfinale", team1: null, team1_quelle: null, team2: null, team2_quelle: null })],
      TODAY,
    );
    assert.equal(result.besetzung_missing.length, 1);
  });

  it("does not flag an empty side that has a source", () => {
    const result = categorizeActionRequired(
      [makeSpiel({ saison_phase: "halbfinale", team1: null, team1_quelle: { type: "spiel", spiel_nr: 25, ausgang: "sieger" } })],
      TODAY,
    );
    assert.deepEqual(result.besetzung_missing, []);
  });

  // No group fixture ever carries a source, so the phase scope is what keeps this category honest.
  it("does not flag a gruppenphase fixture, however empty", () => {
    const result = categorizeActionRequired([makeSpiel({ saison_phase: "gruppenphase", team1: null, team1_quelle: null })], TODAY);
    assert.deepEqual(result.besetzung_missing, []);
  });

  // Membership comes from the backend's derivation, so these cases exercise the join and no
  // predicate.
  it("flags a match named by a bracket fault", () => {
    const result = categorizeActionRequired([makeSpiel()], TODAY, [{ reason: "same_team", spiel_id: makeSpiel().id, spiel_nr: 1 }]);
    assert.equal(result.bracket_fault.length, 1);
  });

  it("puts a match into the category once however many faults name it", () => {
    const id = makeSpiel().id;
    const result = categorizeActionRequired([makeSpiel()], TODAY, [
      { reason: "spiel_missing", spiel_id: id, spiel_nr: 1, quelle_spiel_nr: 98 },
      { reason: "reference_cycle", spiel_id: id, spiel_nr: 1, quelle_spiel_nr: 99 },
    ]);

    assert.equal(result.bracket_fault.length, 1);
  });

  it("flags a cancelled match's bracket fault as well as the cancellation", () => {
    const result = categorizeActionRequired([makeSpiel({ is_canceled: true })], TODAY, [
      { reason: "same_team", spiel_id: makeSpiel().id, spiel_nr: 1 },
    ]);

    assert.equal(result.is_canceled.length, 1);
    assert.equal(result.bracket_fault.length, 1);
  });

  it("leaves the category empty when no fault names a match in the list", () => {
    const result = categorizeActionRequired([makeSpiel()], TODAY, [
      { reason: "same_team", spiel_id: "6890a1b2c3d4e5f607182999", spiel_nr: 29 },
    ]);

    assert.deepEqual(result.bracket_fault, []);
  });
});

describe("buildActionRequiredSections", () => {
  const build = (spiele: FLSpiel[], bracketFaults: Parameters<typeof categorizeActionRequired>[2] = []) =>
    buildActionRequiredSections({ spiele, today: TODAY, bracketFaults: bracketFaults ?? [] });

  it("returns every category, in the label table's order", () => {
    const sections = build([]);

    assert.deepEqual(
      sections.map((section) => section.category),
      Object.keys(ACTION_REQUIRED_LABELS),
    );
  });

  it("leads with the blocking categories and ends with the cancellations", () => {
    const order = Object.keys(ACTION_REQUIRED_LABELS);

    assert.deepEqual(order.slice(0, 3), ["bracket_fault", "besetzung_missing", "ergebnis_pending"]);
    assert.equal(order.at(-1), "is_canceled");
  });

  it("returns an empty section rather than omitting it", () => {
    const sections = build([makeSpiel({ ort: null })]);

    assert.deepEqual(sections.find((section) => section.category === "ergebnis_pending")?.spiele, []);
  });

  it("orders matches by date, earliest first", () => {
    const sections = build([
      makeSpiel({ id: "a", spiel_nr: 3, datum: "2026-07-28", ergebnis: null }),
      makeSpiel({ id: "b", spiel_nr: 1, datum: "2026-07-10", ergebnis: null }),
    ]);

    assert.deepEqual(
      sections.find((section) => section.category === "ergebnis_pending")?.spiele.map((spiel) => spiel.id),
      ["b", "a"],
    );
  });

  it("falls back to the match number when dates tie, and sorts dateless matches last", () => {
    const sections = build([
      makeSpiel({ id: "late", spiel_nr: 9, ort: null, datum: null }),
      makeSpiel({ id: "early", spiel_nr: 2, ort: null, datum: null }),
      makeSpiel({ id: "dated", spiel_nr: 7, ort: null, datum: "2026-08-01" }),
    ]);

    assert.deepEqual(
      sections.find((section) => section.category === "ort_missing")?.spiele.map((spiel) => spiel.id),
      ["dated", "early", "late"],
    );
  });

  it("does not mutate the categorised arrays it sorts", () => {
    const spiele = [
      makeSpiel({ id: "b", spiel_nr: 2, ort: null, datum: "2026-08-02" }),
      makeSpiel({ id: "a", spiel_nr: 1, ort: null, datum: "2026-08-01" }),
    ];
    build(spiele);

    assert.deepEqual(
      spiele.map((spiel) => spiel.id),
      ["b", "a"],
    );
  });
});
