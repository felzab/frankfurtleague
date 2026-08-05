/**
 * `computeQualifyingTeamIds`, which decides which rows the Saisontabelle marks.
 *
 * Tested because it has to agree with a rule that lives in another language: the backend passes over the
 * same two kinds of team when it seeds a bracket slot (`_may_hold_a_platz`, ADR-0043), and nothing in
 * either toolchain would notice the two drifting apart. A marked row the bracket does not advance is a
 * confidently wrong public page.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Relative import, not the "@/" alias: Node's resolver does not read tsconfig paths.
import { computeQualifyingTeamIds } from "./utils.ts";

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
