/**
 * `computeQualifyingTeamIds` and `computePlatzByTeamId` — the marker and the printed position.
 *
 * Tested because both have to agree with a rule that lives in another language: the backend passes over
 * the same two kinds of team when it seeds a bracket slot (`_may_hold_a_platz`, ADR-0043), and nothing
 * in either toolchain would notice the sides drifting apart. A marked row the bracket does not advance,
 * or a printed "2" on a row the bracket numbers 3, is a confidently wrong public page.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Relative import, not the "@/" alias: Node's resolver does not read tsconfig paths.
import { computePlatzByTeamId, computeQualifyingTeamIds } from "./utils.ts";

import type { FLTeam } from "./schemas.ts";

const TEAM_ID = (seed: number) => `6890a1b2c3d4e5f6071900${String(seed).padStart(2, "0")}`;

/** One row of a standing, reduced to the three fields this derivation reads. */
const row = (seed: number, { gespielt = 3, disqualified = false } = {}) =>
  ({
    id: TEAM_ID(seed),
    is_disqualified: disqualified,
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
  // The defect this replaced: a raw row index printed "2" on the disqualified row and "3" on the team
  // the bracket's derived label calls "2. der Gruppe A".
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
