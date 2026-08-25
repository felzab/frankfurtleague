import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Relative import, not the "@/" alias: Node's resolver does not read tsconfig paths.
import { computePlatzByTeamId, computeQualifyingTeamIds, computeSaisonVerlauf, describeReplacementUmfang } from "./utils.ts";

import type { FLSaisonPhase } from "../saisons/schemas.ts";
import type { FLSpiel } from "../spiele/schemas.ts";
import type { FLGruppenTeam } from "./schemas.ts";

const TEAM_ID = (seed: number) => `6890a1b2c3d4e5f6071900${String(seed).padStart(2, "0")}`;

/**
 * One row of a standing, reduced to the fields this derivation reads. A team is walked past because
 * `austritt_type` is non-null, never because of which route out of the season it names.
 */
const row = (seed: number, { gespielt = 3, ausstehend = 0, disqualified = false } = {}) =>
  ({
    id: TEAM_ID(seed),
    austritt_type: disqualified ? "disqualifikation" : null,
    statistik: { anzahl_gespielte_spiele: gespielt },
    anzahl_ausstehende_spiele: ausstehend,
  }) as FLGruppenTeam;

const marked = (teams: FLGruppenTeam[], qualifiersPerGroup = 2) => [...computeQualifyingTeamIds({ teams, qualifiersPerGroup })];

describe("computeQualifyingTeamIds", () => {
  it("marks the first teams in the order the backend ranked them", () => {
    assert.deepEqual(marked([row(1), row(2), row(3), row(4)]), [TEAM_ID(1), TEAM_ID(2)]);
  });

  it("passes over a disqualified team and gives the place to the team below", () => {
    assert.deepEqual(marked([row(1, { disqualified: true }), row(2), row(3)]), [TEAM_ID(2), TEAM_ID(3)]);
  });

  it("marks a team whose first fixture is still to come", () => {
    // It will have a counting match, so the backend seeds it — and a marker that passed over it
    // would highlight a different club than the bracket names.
    assert.deepEqual(marked([row(1, { gespielt: 0, ausstehend: 3 }), row(2), row(3)]), [TEAM_ID(1), TEAM_ID(2)]);
  });

  it("passes over a team with nothing played and nothing left", () => {
    // Zeroes rank above a negative goal difference, so this row can sit high while it has earned
    // nothing and can earn nothing.
    assert.deepEqual(marked([row(1, { gespielt: 0 }), row(2), row(3)]), [TEAM_ID(2), TEAM_ID(3)]);
  });

  it("marks fewer than the count when the group cannot fill it", () => {
    assert.deepEqual(marked([row(1), row(2, { disqualified: true })]), [TEAM_ID(1)]);
  });

  it("marks the leaders in a group whose matches have not started", () => {
    // A drawn group is a league table from day one: every club is on a placing, so the cutoff falls
    // where the ranking put it rather than nowhere.
    const drawn = [row(1, { gespielt: 0, ausstehend: 3 }), row(2, { gespielt: 0, ausstehend: 3 }), row(3, { gespielt: 0, ausstehend: 3 })];

    assert.deepEqual(marked(drawn), [TEAM_ID(1), TEAM_ID(2)]);
  });

  it("marks nobody in a group with no fixtures drawn at all", () => {
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

  // The `N/A` the cell still has to reach: nothing earned and nothing left to earn it with.
  it("gives a row with nothing played and nothing left no ordinal", () => {
    const platz = computePlatzByTeamId([row(1), row(2, { gespielt: 0 })]);

    assert.equal(platz.get(TEAM_ID(2)), undefined);
    assert.equal(platz.size, 1);
  });

  // The backend numbers a club yet to play, so a cell that skips it prints `N/A` on that row and 2
  // on the row the bracket calls 3.
  it("numbers a row whose first fixture is still to come, and moves the row below it down", () => {
    const platz = computePlatzByTeamId([row(1), row(2, { gespielt: 0, ausstehend: 2 }), row(3)]);

    assert.equal(platz.get(TEAM_ID(2)), 2);
    assert.equal(platz.get(TEAM_ID(3)), 3);
  });

  it("numbers every club in a group that has yet to kick off", () => {
    const drawn = [row(1, { gespielt: 0, ausstehend: 3 }), row(2, { gespielt: 0, ausstehend: 3 })];

    assert.deepEqual([...computePlatzByTeamId(drawn).values()], [1, 2]);
  });

  // The shared-predicate property: whoever the marker may consider, the numbering numbers.
  it("numbers exactly the rows the marker considers", () => {
    const teams = [row(1), row(2, { disqualified: true }), row(3, { gespielt: 0 }), row(4, { gespielt: 0, ausstehend: 1 })];

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

const umfang = (fannedOutToSpiele: number, retiredSquadRows: number) => describeReplacementUmfang({ fannedOutToSpiele, retiredSquadRows });

describe("describeReplacementUmfang", () => {
  it("reports the fixtures with their own zero and their own singular", () => {
    assert.match(umfang(0, 0), /^Für das ausscheidende Team war noch kein Spiel angesetzt\./);
    assert.match(umfang(1, 0), /^Ein angesetztes Spiel wurde übernommen\./);
    assert.match(umfang(7, 0), /^7 angesetzte Spiele wurden übernommen\./);
  });

  it("reports the squad rows with their own singular", () => {
    assert.match(umfang(0, 1), /Ein Kadereintrag des ausscheidenden Teams wurde ausgetragen\./);
    assert.match(umfang(0, 4), /4 Kadereinträge des ausscheidenden Teams wurden ausgetragen\./);
  });

  /* `retired_squad_rows` counts the LIVE rows this write stamped, so zero is a fact about the squad
     at that moment and never about the club's history: one whose players were all ausgetragen first
     reports zero too. */
  it("says the squad stood empty at zero, never that the club had no players", () => {
    assert.match(umfang(0, 0), /Im Kader des ausscheidenden Teams stand kein Spieler\./);
    assert.doesNotMatch(umfang(0, 0), /hatte das ausscheidende Team keine/);
  });

  /* AUSTRAGEN is what happens to a squad row, STILLLEGEN to the person across the league. The
     endpoint stamps `saison_spieler` and touches no `spieler` document, so the second word reports
     pupils out of every pick list there is. */
  it("never calls a squad row's retirement a Stilllegung", () => {
    for (const report of [umfang(0, 0), umfang(2, 1), umfang(2, 9)]) {
      assert.doesNotMatch(report, /stillgelegt|Stilllegen/, "the report retires the people rather than their squad entries");
      assert.doesNotMatch(report, /Spieler wurde/, "the report writes about people where the write moved entries");
    }
  });

  /* Final on a running season: reviving the row needs its own club back in the season
     (`REQ-SQUAD-001`), and `REQ-ENTER-001` admits a club only to a `future` one. */
  it("says a retired entry stays out, and says it only where it retired one", () => {
    for (const report of [umfang(0, 1), umfang(3, 9)]) {
      assert.match(report, /Reaktivieren lässt sich ein solcher Eintrag erst/);
      assert.match(report, /nur in eine geplante Saison/);
    }

    assert.doesNotMatch(umfang(3, 0), /Reaktivieren/, "nothing was retired and the report warns about it anyway");
  });

  /* It lands in a toast with no figures beside it, so each half has to stand as a sentence. */
  it("writes whole sentences, with nothing left dangling", () => {
    for (const report of [umfang(0, 0), umfang(1, 1), umfang(12, 3)]) {
      assert.match(report, /^[A-ZÄÖÜ0-9]/, "the report opens lower-case");
      assert.match(report, /\.$/, "the report does not end in a full stop");
      assert.doesNotMatch(report, /dafür|diesen Platz/, "the report leans on a word with no antecedent");
    }
  });
});
