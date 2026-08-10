/**
 * TEAMS · the qualifying marker, the printed position and the season's progress, tested
 *
 * `computeQualifyingTeamIds` and `computePlatzByTeamId` have to agree with a rule that lives in
 * another language: the backend passes over the same two kinds of team when it seeds a bracket
 * slot (`_may_hold_a_platz`, ADR-0035), and nothing in either toolchain notices the sides
 * drifting apart. A marked row the bracket does not advance is a confidently wrong public page, and
 * so is a milestone naming a round the team did not reach.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Relative import, not the "@/" alias: Node's resolver does not read tsconfig paths.
import { computePlatzByTeamId, computeQualifyingTeamIds, computeSaisonVerlauf } from "./utils.ts";

import type { FLSaisonPhase } from "../saisons/schemas.ts";
import type { FLSpiel } from "../spiele/schemas.ts";
import type { FLTeam } from "./schemas.ts";

const TEAM_ID = (seed: number) => `6890a1b2c3d4e5f6071900${String(seed).padStart(2, "0")}`;

/**
 * One row of a standing, reduced to the three fields this derivation reads.
 *
 * The record's contents do not reach the subject here: a team is walked past because
 * `disqualifikation` is non-null, never because of what it says (ADR-0047).
 */
const row = (seed: number, { gespielt = 3, disqualified = false } = {}) =>
  ({
    id: TEAM_ID(seed),
    disqualifikation: disqualified ? { grund: "Nicht angetreten zum Spieltag", datum: "2026-03-14" } : null,
    statistik: { anzahl_gespielte_spiele: gespielt },
  }) as FLTeam;

const marked = (teams: FLTeam[], qualifiersPerGroup = 2) => [...computeQualifyingTeamIds({ teams, qualifiersPerGroup })];

describe("computeQualifyingTeamIds", () => {
  it("marks the first teams in the order the backend ranked them", () => {
    assert.deepEqual(marked([row(1), row(2), row(3), row(4)]), [TEAM_ID(1), TEAM_ID(2)]);
  });

  it("passes over a disqualified team and gives the place to the team below", () => {
    assert.deepEqual(marked([row(1, { disqualified: true }), row(2), row(3)]), [TEAM_ID(2), TEAM_ID(3)]);
  });

  it("passes over a team that has played nothing", () => {
    // Zeroes rank above a negative goal difference, so this row can sit high in the table while the
    // position column shows N/A. A row with no position cannot be shown holding one.
    assert.deepEqual(marked([row(1, { gespielt: 0 }), row(2), row(3)]), [TEAM_ID(2), TEAM_ID(3)]);
  });

  it("marks fewer than the count when the group cannot fill it", () => {
    assert.deepEqual(marked([row(1), row(2, { disqualified: true })]), [TEAM_ID(1)]);
  });

  it("marks nobody in a group whose matches have not started", () => {
    // The case the legend is hidden for: a highlight nobody can see needs no explanation under it.
    assert.deepEqual(marked([row(1, { gespielt: 0 }), row(2, { gespielt: 0 })]), []);
  });

  it("takes the count from the season rather than assuming two", () => {
    assert.deepEqual(marked([row(1), row(2), row(3), row(4)], 3), [TEAM_ID(1), TEAM_ID(2), TEAM_ID(3)]);
  });
});

describe("computePlatzByTeamId", () => {
  // A raw row index prints "2" on the disqualified row and "3" on the team the bracket's derived
  // label calls "2. der Gruppe A", so the count has to walk past a disqualification.
  it("numbers past a disqualified row, matching the backend's platz", () => {
    const platz = computePlatzByTeamId([row(1), row(2, { disqualified: true }), row(3)]);

    assert.equal(platz.get(TEAM_ID(1)), 1);
    assert.equal(platz.get(TEAM_ID(2)), undefined);
    assert.equal(platz.get(TEAM_ID(3)), 2);
  });

  it("gives a row that has played nothing no ordinal", () => {
    const platz = computePlatzByTeamId([row(1), row(2, { gespielt: 0 })]);

    assert.equal(platz.get(TEAM_ID(2)), undefined);
    assert.equal(platz.size, 1);
  });

  // The shared-predicate property, which is the whole reason both derivations live in this file:
  // whoever the marker may consider, the numbering numbers — and nobody else.
  it("numbers exactly the rows the marker considers", () => {
    const teams = [row(1), row(2, { disqualified: true }), row(3, { gespielt: 0 }), row(4)];

    const numbered = new Set(computePlatzByTeamId(teams).keys());
    const qualifying = computeQualifyingTeamIds({ teams, qualifiersPerGroup: teams.length });

    assert.deepEqual(numbered, qualifying);
  });
});

const SUBJECT = TEAM_ID(1);
const OPPONENT = TEAM_ID(2);

/** One fixture, reduced to the four fields the season's progress is read from. */
const fixture = ({
  phase,
  ergebnis = null,
  heim = SUBJECT,
  gast = OPPONENT,
}: {
  phase: FLSaisonPhase;
  ergebnis?: string | null;
  heim?: string;
  gast?: string;
}) =>
  ({
    saison_phase: phase,
    ergebnis,
    team1: { team_id: heim },
    team2: { team_id: gast },
  }) as FLSpiel;

describe("computeSaisonVerlauf", () => {
  it("answers null for a team whose season never left the group phase", () => {
    assert.equal(computeSaisonVerlauf({ spiele: [fixture({ phase: "gruppenphase", ergebnis: "3:1" })], teamId: SUBJECT }), null);
  });

  it("answers null for a team with no fixtures at all", () => {
    assert.equal(computeSaisonVerlauf({ spiele: [], teamId: SUBJECT }), null);
  });

  it("takes the furthest round rather than the last fixture in the array", () => {
    // Deliberately out of bracket order: the fixtures arrive sorted by date on the page, and a
    // rescheduled semi-final played before a quarter-final would otherwise decide the answer.
    const verlauf = computeSaisonVerlauf({
      spiele: [fixture({ phase: "halbfinale", ergebnis: "0:2" }), fixture({ phase: "viertelfinale", ergebnis: "3:1" })],
      teamId: SUBJECT,
    });

    assert.deepEqual(verlauf, { deepestPhase: "halbfinale", outcome: "L" });
  });

  it("reads the result from the team's own side of the fixture", () => {
    const verlauf = computeSaisonVerlauf({
      spiele: [fixture({ phase: "finale", ergebnis: "0:2", heim: OPPONENT, gast: SUBJECT })],
      teamId: SUBJECT,
    });

    assert.deepEqual(verlauf, { deepestPhase: "finale", outcome: "W" });
  });

  it("reports the round with no outcome while it is unplayed", () => {
    const verlauf = computeSaisonVerlauf({ spiele: [fixture({ phase: "finale" })], teamId: SUBJECT });

    assert.deepEqual(verlauf, { deepestPhase: "finale", outcome: null });
  });

  // A knockout finishing level is a draw to every reader but the bracket (ADR-0036), so the page has
  // no winner to name — and inventing one from the shoot-out is exactly what that decision refuses.
  it("claims neither a win nor a loss for a round that finished level", () => {
    const verlauf = computeSaisonVerlauf({ spiele: [fixture({ phase: "halbfinale", ergebnis: "2:2" })], teamId: SUBJECT });

    assert.deepEqual(verlauf, { deepestPhase: "halbfinale", outcome: null });
  });

  // The fetch filters on both sides, so this shape cannot arrive today — the guard is what keeps a
  // later caller passing the whole season's fixtures from being told the team reached the final.
  it("ignores a knockout fixture the team does not occupy", () => {
    const verlauf = computeSaisonVerlauf({
      spiele: [
        fixture({ phase: "viertelfinale", ergebnis: "1:0" }),
        fixture({ phase: "finale", ergebnis: "4:0", heim: OPPONENT, gast: TEAM_ID(3) }),
      ],
      teamId: SUBJECT,
    });

    assert.deepEqual(verlauf, { deepestPhase: "viertelfinale", outcome: "W" });
  });
});
