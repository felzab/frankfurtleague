/**
 * ADMIN · action-required tests
 *
 * Covers the categorisation behind the admin action-required view, including that one match can land
 * in several categories at once and that the label map stays exhaustive over the category union.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ACTION_REQUIRED_LABELS, categorizeActionRequired } from "./utils.ts";

import type { FLSpiel } from "../spiele/schemas.ts";

const TODAY = "2026-07-30";

// A fully-populated match that lands in no category, so each test can knock out one field and be
// unambiguous about which rule it is exercising.
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
  it("returns all seven categories even when nothing needs attention", () => {
    const result = categorizeActionRequired([makeSpiel()], TODAY);

    assert.deepEqual(Object.keys(result), Object.keys(ACTION_REQUIRED_LABELS));
    for (const spiele of Object.values(result)) assert.deepEqual(spiele, []);
  });

  it("flags a past match with no result as ergebnis_pending", () => {
    const result = categorizeActionRequired([makeSpiel({ datum: "2026-07-29", ergebnis: null })], TODAY);
    assert.equal(result.ergebnis_pending.length, 1);
  });

  // Strict <, so a match dated today is not yet overdue. This boundary is the rule most likely to
  // be "tidied" into <=, which would nag admins about matches still being played.
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

  // The *_missing categories are deliberately non-exclusive.
  it("puts one match into several categories when several fields are missing", () => {
    const result = categorizeActionRequired([makeSpiel({ datum: null, uhrzeit: null, ort: null })], TODAY);

    assert.equal(result.datum_missing.length, 1);
    assert.equal(result.uhrzeit_missing.length, 1);
    assert.equal(result.ort_missing.length, 1);
  });

  // is_canceled is exclusive: chasing missing details on a cancelled fixture is noise.
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

  // The FB-12 shape: a knockout side with no team and no source is maintained by nobody, so it must
  // surface here BEFORE the fixture's date makes it an overdue result (ADR-0046).
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

  // An empty side with a source is the ordinary state of a running bracket: the resolution fills it
  // when the feeder match is decided, so nothing needs an admin.
  it("does not flag an empty side that has a source", () => {
    const result = categorizeActionRequired(
      [makeSpiel({ saison_phase: "halbfinale", team1: null, team1_quelle: { type: "spiel", spiel_nr: 25, ausgang: "sieger" } })],
      TODAY,
    );
    assert.deepEqual(result.besetzung_missing, []);
  });

  // A group fixture with an empty side is an unfilled schedule, not an orphaned slot: no group
  // fixture ever carries a source, so the scope is what keeps this category honest.
  it("does not flag a gruppenphase fixture, however empty", () => {
    const result = categorizeActionRequired([makeSpiel({ saison_phase: "gruppenphase", team1: null, team1_quelle: null })], TODAY);
    assert.deepEqual(result.besetzung_missing, []);
  });
});
