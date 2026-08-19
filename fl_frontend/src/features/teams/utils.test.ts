import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Relative import, not the "@/" alias: Node's resolver does not read tsconfig paths.
import { computePlatzByTeamId, computeQualifyingTeamIds, computeSaisonVerlauf } from "./utils.ts";

import type { FLSaisonPhase } from "../saisons/schemas.ts";
import type { FLSpiel } from "../spiele/schemas.ts";
import type { FLTeam } from "./schemas.ts";

const TEAM_ID = (seed: number) => `6890a1b2c3d4e5f6071900${String(seed).padStart(2, "0")}`;

/**
 * One row of a standing, reduced to the fields this derivation reads. A team is walked past because
 * `disqualifikation` is non-null, never because of what it says.
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
    // Zeroes rank above a negative goal difference, so this row can sit high while its position
    // column shows N/A — and a row with no position cannot be shown holding one.
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
  // A raw row index prints "3" for the team the bracket calls "2. der Gruppe A", so the count has to
  // walk past a disqualification.
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

  // The shared-predicate property: whoever the marker may consider, the numbering numbers.
  it("numbers exactly the rows the marker considers", () => {
    const teams = [row(1), row(2, { disqualified: true }), row(3, { gespielt: 0 }), row(4)];

    const numbered = new Set(computePlatzByTeamId(teams).keys());
    const qualifying = computeQualifyingTeamIds({ teams, qualifiersPerGroup: teams.length });

    assert.deepEqual(numbered, qualifying);
  });
});

const SUBJECT = TEAM_ID(1);
const OPPONENT = TEAM_ID(2);

/** One fixture, reduced to the fields the season's progress is read from. */
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

const verlaufOf = (spiele: FLSpiel[], teamId = SUBJECT) => computeSaisonVerlauf({ spiele, teamId });

describe("computeSaisonVerlauf", () => {
  // Elimination and an undrawn bracket look identical from here — a state waiting fixes.
  it("claims no outcome for a group phase the team has not visibly come through", () => {
    const verlauf = verlaufOf([fixture({ phase: "gruppenphase", ergebnis: "3:1" }), fixture({ phase: "gruppenphase", ergebnis: "0:4" })]);

    assert.deepEqual(verlauf, [{ phase: "gruppenphase", outcome: "unknown" }]);
  });

  it("says nothing about a team with no fixtures at all", () => {
    assert.deepEqual(verlaufOf([]), []);
  });

  it("reports the group phase as come through once a knockout fixture fields the team", () => {
    const verlauf = verlaufOf([fixture({ phase: "gruppenphase", ergebnis: "3:1" }), fixture({ phase: "viertelfinale" })]);

    assert.deepEqual(verlauf, [
      { phase: "gruppenphase", outcome: "advanced" },
      { phase: "viertelfinale", outcome: "pending" },
    ]);
  });

  // An organiser may seed a team into a knockout slot before its group has played anything, and
  // "überstanden" there claims a round that has not happened.
  it("claims no outcome for a group phase with no result, however deep the team is standing", () => {
    const verlauf = verlaufOf([fixture({ phase: "gruppenphase" }), fixture({ phase: "viertelfinale" })]);

    assert.deepEqual(verlauf, [
      { phase: "gruppenphase", outcome: "unknown" },
      { phase: "viertelfinale", outcome: "pending" },
    ]);
  });

  // A group fixture's own result never becomes the round's outcome: come-through turns on a
  // knockout fixture.
  it("claims nothing for a group phase with no round beyond it, whatever its fixtures did", () => {
    const groupOutcomes = new Set(
      [null, "0:4", "2:2"].map((ergebnis) => verlaufOf([fixture({ phase: "gruppenphase", ergebnis })])[0]?.outcome),
    );

    assert.deepEqual(groupOutcomes, new Set(["unknown"]));
  });

  it("orders the rounds as a season plays them, not as the fixtures arrive", () => {
    // The page sorts fixtures by date, so a rescheduled semi-final played before a quarter-final
    // would otherwise show the two rounds out of order.
    const verlauf = verlaufOf([fixture({ phase: "halbfinale", ergebnis: "0:2" }), fixture({ phase: "viertelfinale", ergebnis: "3:1" })]);

    assert.deepEqual(verlauf, [
      { phase: "viertelfinale", outcome: "won" },
      { phase: "halbfinale", outcome: "out" },
    ]);
  });

  it("reads each round's result from the team's own side of the fixture", () => {
    assert.deepEqual(verlaufOf([fixture({ phase: "finale", ergebnis: "0:2", heim: OPPONENT, gast: SUBJECT })]), [
      { phase: "finale", outcome: "won" },
    ]);
  });

  // A knockout finishing level is a draw to every reader but the bracket, so with nothing downstream
  // the page has no winner to name.
  it("claims no winner for a round that finished level and led nowhere yet", () => {
    assert.deepEqual(verlaufOf([fixture({ phase: "halbfinale", ergebnis: "2:2" })]), [{ phase: "halbfinale", outcome: "level" }]);
  });

  // The one case the shoot-out would otherwise be read for: the evidence the tie broke this team's
  // way is where the team stands now.
  it("reports a level round as come through when a later round fields the team", () => {
    const verlauf = verlaufOf([fixture({ phase: "halbfinale", ergebnis: "2:2" }), fixture({ phase: "finale" })]);

    assert.deepEqual(verlauf, [
      { phase: "halbfinale", outcome: "advanced" },
      { phase: "finale", outcome: "pending" },
    ]);
  });

  // A manual pick that did not qualify is warned and never refused, so a beaten team in the next
  // round is a real state.
  it("reports a lost round as come through when a later round fields the team anyway", () => {
    const verlauf = verlaufOf([fixture({ phase: "viertelfinale", ergebnis: "0:2" }), fixture({ phase: "halbfinale" })]);

    assert.deepEqual(verlauf, [
      { phase: "viertelfinale", outcome: "advanced" },
      { phase: "halbfinale", outcome: "pending" },
    ]);
  });

  // The bound on the rule above: a team can be seeded out of an UNPLAYED round, and "überstanden"
  // would then sit beside a card with no score.
  it("claims no outcome for an unplayed round, however deep the team is standing", () => {
    const verlauf = verlaufOf([fixture({ phase: "viertelfinale" }), fixture({ phase: "halbfinale" })]);

    assert.deepEqual(verlauf, [
      { phase: "viertelfinale", outcome: "pending" },
      { phase: "halbfinale", outcome: "pending" },
    ]);
  });

  // A round the season does not play must produce no chip, never one saying the team failed to
  // reach it.
  it("produces no entry for a round the team has no fixture in", () => {
    const verlauf = verlaufOf([fixture({ phase: "gruppenphase", ergebnis: "1:0" }), fixture({ phase: "halbfinale", ergebnis: "1:0" })]);

    assert.deepEqual(verlauf, [
      { phase: "gruppenphase", outcome: "advanced" },
      { phase: "halbfinale", outcome: "won" },
    ]);
  });

  // The guard is what keeps a caller passing the whole season's fixtures from being told the team
  // reached the final.
  it("ignores a knockout fixture the team does not occupy", () => {
    const verlauf = verlaufOf([
      fixture({ phase: "viertelfinale", ergebnis: "1:0" }),
      fixture({ phase: "finale", ergebnis: "4:0", heim: OPPONENT, gast: TEAM_ID(3) }),
    ]);

    assert.deepEqual(verlauf, [{ phase: "viertelfinale", outcome: "won" }]);
  });
});
