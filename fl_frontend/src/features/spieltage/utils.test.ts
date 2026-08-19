/**
 * SPIELTAGE · derivation tests
 *
 * Covers the bracket ordering and the per-phase matchday count. The case the ordering fixtures
 * reproduce is the 2026 draw as the page received it: quarter-finals sorted by `datum` put matches 25
 * and 28 on one branch while the semi-final between them named 25 and 27 — the wiring and
 * the index-drawn bracket lines disagreed, and only the lines were wrong.
 *
 * The count's cases are its three quiet ones: a retired matchday, a phase the season does not play,
 * and no season at all. Each reads as an ordinary number and each means something different.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Relative import, not the "@/" alias: Node's resolver does not read tsconfig paths.
import { buildSpieltagPhaseProgress, orderRoundsByWiring } from "./utils.ts";

import type { FLSaisonPhase, FLSaisonPhaseSchedule } from "../saisons/schemas.ts";
import type { FLSpiel, FLSpielQuelle } from "../spiele/schemas.ts";
import type { FLSpieltagWithSpiele } from "./schemas.ts";

const sieger = (spielNr: number): FLSpielQuelle => ({ type: "spiel", spiel_nr: spielNr, ausgang: "sieger" });

function makeSpiel(spielNr: number, team1Quelle: FLSpielQuelle | null = null, team2Quelle: FLSpielQuelle | null = null): FLSpiel {
  return { spiel_nr: spielNr, team1_quelle: team1Quelle, team2_quelle: team2Quelle } as FLSpiel;
}

// Keyed on `id` rather than a name: a matchday carries none, and the id is the handle every consumer
// -- including `spieltagLabels` -- identifies one by.
function makeRound(id: string, spiele: FLSpiel[]): FLSpieltagWithSpiele {
  return { id, spiele } as unknown as FLSpieltagWithSpiele;
}

const numbers = (round: FLSpieltagWithSpiele) => round.spiele.map((spiel) => spiel.spiel_nr);

describe("orderRoundsByWiring", () => {
  // The 2026 shape: the semi-finals name 25+27 and 26+28, but the quarter-finals arrive in date
  // order 25, 28, 26, 27 — so the index-paired branches lie until the wiring reorders them.
  it("orders each round so a fixture's two feeders sit adjacent", () => {
    const rounds = orderRoundsByWiring([
      makeRound("Viertelfinale", [makeSpiel(25), makeSpiel(28), makeSpiel(26), makeSpiel(27)]),
      makeRound("Halbfinale", [makeSpiel(29, sieger(25), sieger(27)), makeSpiel(30, sieger(26), sieger(28))]),
      makeRound("Finale", [makeSpiel(31, sieger(29), sieger(30))]),
    ]);

    assert.deepEqual(rounds.map(numbers), [[25, 27, 26, 28], [29, 30], [31]]);
  });

  // The walk goes last round first: the final's order decides the semi-finals' order, which then
  // decides the quarter-finals' — reordering top-down would order a round by edges not yet placed.
  it("orders an earlier round by the already reordered round after it", () => {
    const rounds = orderRoundsByWiring([
      makeRound("Viertelfinale", [makeSpiel(25), makeSpiel(26), makeSpiel(27), makeSpiel(28)]),
      makeRound("Halbfinale", [makeSpiel(29, sieger(25), sieger(26)), makeSpiel(30, sieger(27), sieger(28))]),
      makeRound("Finale", [makeSpiel(31, sieger(30), sieger(29))]),
    ]);

    // The final names 30 first, so 30's feeders lead the quarter-final column.
    assert.deepEqual(rounds.map(numbers), [[27, 28, 25, 26], [30, 29], [31]]);
  });

  it("keeps arrival order for matches nothing references, after the referenced ones", () => {
    const rounds = orderRoundsByWiring([
      makeRound("Halbfinale", [makeSpiel(27), makeSpiel(28), makeSpiel(26)]),
      makeRound("Finale", [makeSpiel(31, sieger(26), null)]),
    ]);

    assert.deepEqual(rounds.map(numbers), [[26, 27, 28], [31]]);
  });

  // A `gruppe` reference has no earlier match to order, and a dangling `spiel_nr` names none — both
  // contribute no edge, exactly as the resolution reads them.
  it("ignores gruppe references, nulls and spiel_nrs the previous round does not hold", () => {
    const gruppe: FLSpielQuelle = { type: "gruppe", gruppe: "A", platz: 1 };
    const rounds = orderRoundsByWiring([
      makeRound("Halbfinale", [makeSpiel(29), makeSpiel(30)]),
      makeRound("Finale", [makeSpiel(31, gruppe, sieger(99)), makeSpiel(32, null, sieger(30))]),
    ]);

    assert.deepEqual(rounds.map(numbers), [
      [30, 29],
      [31, 32],
    ]);
  });

  // Reachable only by hand-editing two references onto one match; the ordering places it once
  // rather than twice, so the column still holds each match exactly once.
  it("places a match referenced twice only once", () => {
    const rounds = orderRoundsByWiring([
      makeRound("Halbfinale", [makeSpiel(29), makeSpiel(30)]),
      makeRound("Finale", [makeSpiel(31, sieger(30), sieger(30))]),
    ]);

    assert.deepEqual(rounds.map(numbers), [[30, 29], [31]]);
  });

  it("returns a single round, and an empty season, unchanged", () => {
    const single = [makeRound("Finale", [makeSpiel(31)])];

    assert.deepEqual(orderRoundsByWiring(single).map(numbers), [[31]]);
    assert.deepEqual(orderRoundsByWiring([]), []);
  });
});

// The 2026 season's own shape: four groups of four give three group matchdays, and eight qualifiers
// play the last three rounds — so `achtelfinale` is absent rather than present with a zero.
const SCHEDULE_2026: FLSaisonPhaseSchedule[] = [
  { phase: "gruppenphase", matchdays: 3, matches_per_matchday: 8 },
  { phase: "viertelfinale", matchdays: 1, matches_per_matchday: 4 },
  { phase: "halbfinale", matchdays: 1, matches_per_matchday: 2 },
  { phase: "finale", matchdays: 1, matches_per_matchday: 1 },
];

const makeSpieltag = (phase: FLSaisonPhase, inactiveSince: string | null = null) => ({
  saison_phase: phase,
  inactive_since: inactiveSince,
});

const held = (progress: readonly { phase: FLSaisonPhase; angelegt: number; erwartet: number }[], phase: FLSaisonPhase) =>
  progress.find((entry) => entry.phase === phase);

describe("buildSpieltagPhaseProgress", () => {
  it("counts a phase's matchdays against the number the season's rules imply", () => {
    const progress = buildSpieltagPhaseProgress(SCHEDULE_2026, [
      makeSpieltag("gruppenphase"),
      makeSpieltag("gruppenphase"),
      makeSpieltag("finale"),
    ]);

    assert.deepEqual(held(progress, "gruppenphase"), { phase: "gruppenphase", angelegt: 2, erwartet: 3 });
    assert.deepEqual(held(progress, "finale"), { phase: "finale", angelegt: 1, erwartet: 1 });
  });

  // The state a phase reaches on its way to complete, and the one the section heading exists to end
  // silently reporting as nothing.
  it("reports a phase with no matchday as zero rather than omitting it", () => {
    const progress = buildSpieltagPhaseProgress(SCHEDULE_2026, [makeSpieltag("gruppenphase")]);

    assert.deepEqual(held(progress, "halbfinale"), { phase: "halbfinale", angelegt: 0, erwartet: 1 });
  });

  // Retiring one is how a mis-dated matchday leaves the schedule, which is why
  // `REQ-DATE-004` reads live matchdays alone — so a retired third matchday leaves the phase short.
  it("does not count a retired matchday", () => {
    const progress = buildSpieltagPhaseProgress(SCHEDULE_2026, [
      makeSpieltag("gruppenphase"),
      makeSpieltag("gruppenphase"),
      makeSpieltag("gruppenphase", "2026-04-01"),
    ]);

    assert.deepEqual(held(progress, "gruppenphase"), { phase: "gruppenphase", angelegt: 2, erwartet: 3 });
  });

  // A phase absent from the schedule expects 0, the same answer `expected_matches` gives. The endpoint
  // accepts a matchday in a round this bracket does not reach, so the count has to describe one.
  it("expects none for a phase the season does not play", () => {
    const progress = buildSpieltagPhaseProgress(SCHEDULE_2026, [makeSpieltag("achtelfinale")]);

    assert.deepEqual(held(progress, "achtelfinale"), { phase: "achtelfinale", angelegt: 1, erwartet: 0 });
  });

  // No season resolved is not a season that plays nothing: answering with zeroes would tell the page
  // every phase is short, which is the one wrong answer available here.
  it("answers with nothing at all when no schedule was served", () => {
    assert.deepEqual(buildSpieltagPhaseProgress([], [makeSpieltag("gruppenphase")]), []);
  });
});
