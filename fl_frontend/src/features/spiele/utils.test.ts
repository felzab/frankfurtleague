import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Relative import, not the "@/" alias: Node's resolver does not read tsconfig paths.
import { computeErgebnisFor, computeSpielStatus, formatSpielDisplay } from "./utils.ts";

import type { FLSpiel } from "./schemas.ts";

const TODAY = "2026-07-29";

const TEAM_1 = "6890a1b2c3d4e5f607182932";
const TEAM_2 = "6890a1b2c3d4e5f607182933";

function makeSpiel(ergebnis: string | null): FLSpiel {
  return {
    team1: { team_id: TEAM_1, name: "Team A", tore: null, shorthand: "TA" },
    team2: { team_id: TEAM_2, name: "Team B", tore: null, shorthand: "TB" },
    ergebnis,
  } as FLSpiel;
}

describe("computeSpielStatus", () => {
  it("returns 'abgesagt' regardless of date", () => {
    assert.equal(computeSpielStatus({ datum: "2020-01-01", isCanceled: true, today: TODAY }), "abgesagt");
    assert.equal(computeSpielStatus({ datum: "2099-01-01", isCanceled: true, today: TODAY }), "abgesagt");
  });

  // isCanceled must win over a null date, or a cancelled undated match reads as merely unknown.
  it("prefers 'abgesagt' over 'unbekannt' when the date is null", () => {
    assert.equal(computeSpielStatus({ datum: null, isCanceled: true, today: TODAY }), "abgesagt");
  });

  it("returns 'unbekannt' for a null date", () => {
    assert.equal(computeSpielStatus({ datum: null, isCanceled: false, today: TODAY }), "unbekannt");
  });

  it("returns 'ausstehend' for a future date", () => {
    assert.equal(computeSpielStatus({ datum: "2026-07-30", isCanceled: false, today: TODAY }), "ausstehend");
  });

  it("returns 'heute' for today", () => {
    assert.equal(computeSpielStatus({ datum: TODAY, isCanceled: false, today: TODAY }), "heute");
  });

  it("returns 'vergangen' for a past date", () => {
    assert.equal(computeSpielStatus({ datum: "2026-07-28", isCanceled: false, today: TODAY }), "vergangen");
  });

  // The comparison is lexicographic on YYYY-MM-DD, so it is only correct while both operands
  // are zero-padded and same-length. These two cross a month and a year boundary.
  it("compares correctly across month and year boundaries", () => {
    assert.equal(computeSpielStatus({ datum: "2026-08-01", isCanceled: false, today: "2026-07-31" }), "ausstehend");
    assert.equal(computeSpielStatus({ datum: "2025-12-31", isCanceled: false, today: "2026-01-01" }), "vergangen");
  });
});

describe("computeErgebnisFor", () => {
  it("reads the result from the requesting team's side", () => {
    assert.equal(computeErgebnisFor({ spiel: makeSpiel("3:1"), teamId: TEAM_1 }), "W");
    assert.equal(computeErgebnisFor({ spiel: makeSpiel("3:1"), teamId: TEAM_2 }), "L");
  });

  it("is symmetric when the away team wins", () => {
    assert.equal(computeErgebnisFor({ spiel: makeSpiel("1:3"), teamId: TEAM_1 }), "L");
    assert.equal(computeErgebnisFor({ spiel: makeSpiel("1:3"), teamId: TEAM_2 }), "W");
  });

  it("reports a draw for both sides", () => {
    assert.equal(computeErgebnisFor({ spiel: makeSpiel("2:2"), teamId: TEAM_1 }), "D");
    assert.equal(computeErgebnisFor({ spiel: makeSpiel("2:2"), teamId: TEAM_2 }), "D");
  });

  it("handles a goalless draw", () => {
    assert.equal(computeErgebnisFor({ spiel: makeSpiel("0:0"), teamId: TEAM_1 }), "D");
  });

  it("returns '?' for an unplayed match", () => {
    assert.equal(computeErgebnisFor({ spiel: makeSpiel(null), teamId: TEAM_1 }), "?");
  });

  // The defect this extraction closed. The inline version split without a length check, so "3"
  // gave Number(undefined) === NaN, every comparison was false, and the else branch reported a
  // LOSS -- for both teams, since neither side's comparison could ever be true.
  it("returns '?' for a malformed ergebnis instead of silently reporting a loss", () => {
    for (const malformed of ["3", "", ":", "3:", ":1", "1:2:3", "abc", "x:y"]) {
      assert.equal(computeErgebnisFor({ spiel: makeSpiel(malformed), teamId: TEAM_1 }), "?", `expected "?" for ${JSON.stringify(malformed)}`);
      assert.equal(computeErgebnisFor({ spiel: makeSpiel(malformed), teamId: TEAM_2 }), "?", `expected "?" for ${JSON.stringify(malformed)}`);
    }
  });

  // A team id belonging to neither side must be "unknown", not a result. The two-way
  // `teamId === team1.team_id` branch this replaced scored it from team2's point of view, so a
  // stale embedded id rendered a confident red "L" for a team that never played the match.
  it("returns '?' for a teamId that is neither side, rather than scoring it as a loss", () => {
    const unknown = "6890a1b2c3d4e5f607189999";

    assert.equal(computeErgebnisFor({ spiel: makeSpiel("3:1"), teamId: unknown }), "?");
    assert.equal(computeErgebnisFor({ spiel: makeSpiel("1:3"), teamId: unknown }), "?");
    assert.equal(computeErgebnisFor({ spiel: makeSpiel("2:2"), teamId: unknown }), "?");
  });

  // Guards the digit class: the wire format is ASCII, and Number("٢") is NaN.
  it("returns '?' for non-ASCII digits", () => {
    assert.equal(computeErgebnisFor({ spiel: makeSpiel("٢:١"), teamId: TEAM_1 }), "?");
  });
});

describe("formatSpielDisplay", () => {
  const spiel = { datum: "2026-07-28", uhrzeit: "14:00", ergebnis: "3:1" };

  it("derives all three display values", () => {
    assert.deepEqual(formatSpielDisplay(spiel), { datum: "28.07.2026", uhrzeit: "14:00", ergebnis: "3:1" });
  });

  // The drift this replaced: SpielCard rendered "- : -" while the two compact cards rendered
  // "-:-", and both appear on the same screen in some flows.
  it("uses one result placeholder for an unplayed match", () => {
    assert.equal(formatSpielDisplay({ ...spiel, ergebnis: null }).ergebnis, "-:-");
  });

  it("uses the shared placeholders for a missing date and time", () => {
    assert.deepEqual(formatSpielDisplay({ datum: null, uhrzeit: null, ergebnis: null }), {
      datum: "TBD",
      uhrzeit: "--:--",
      ergebnis: "-:-",
    });
  });
});
