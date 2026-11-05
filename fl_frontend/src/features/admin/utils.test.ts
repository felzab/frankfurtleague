import { side, spielFields } from "@/test-support/fixtures.ts";
import { describe, expect, it } from "vitest";

import { categorizeActionRequired } from "./utils.ts";

import type { FLSpiel } from "../spiele/types.ts";

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
  it("files a complete fixture under no category", () => {
    const result = categorizeActionRequired([makeSpiel()], TODAY);

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
});
