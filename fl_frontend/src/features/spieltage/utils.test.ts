import { spielFields } from "@/test-support/fixtures.ts";
import { describe, expect, it } from "vitest";

// Relative import, not the "@/" alias: Node's resolver does not read tsconfig paths.
import { FLSpieltagWithSpieleSchema } from "./schemas.ts";
import { buildSpieltagPhaseProgress, orderRoundsByWiring, spieltagLabels } from "./utils.ts";

import type { FLSpielQuelle } from "@/core/generated/client/types.ts";
import type { FLSaisonPhase, FLSaisonPhaseSchedule } from "../saisons/schemas.ts";
import type { FLSpiel } from "../spiele/types.ts";
import type { FLSpieltagWithSpiele } from "./schemas.ts";

const sieger = (spielNr: number): FLSpielQuelle => ({ type: "spiel", spiel_nr: spielNr, ausgang: "sieger" });

const SPIEL: FLSpiel = spielFields({
  id: "6890a1b2c3d4e5f607180001",
  spieltag_id: "6890a1b2c3d4e5f607180101",
  team1: null,
  team2: null,
  saison_phase: "viertelfinale",
});

/** Complete and parsed at construction: a drifted field fails where the fixture is built. */
const SPIELTAG: FLSpieltagWithSpiele = FLSpieltagWithSpieleSchema.parse({
  id: "6890a1b2c3d4e5f607180201",
  beginn: null,
  ende: null,
  anzahl_spiele: 0,
  position: 1,
  saison_phase: "viertelfinale",
  saison_id: "2026",
  spiele: [],
} satisfies FLSpieltagWithSpiele);

function makeSpiel(spielNr: number, team1Quelle: FLSpielQuelle | null = null, team2Quelle: FLSpielQuelle | null = null): FLSpiel {
  return { ...SPIEL, spiel_nr: spielNr, team1_quelle: team1Quelle, team2_quelle: team2Quelle };
}

// Keyed on `id`: a matchday carries no name, and the id is what every consumer identifies one by.
function makeRound(id: string, spiele: FLSpiel[]): FLSpieltagWithSpiele {
  return { ...SPIELTAG, id, spiele };
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

    expect(rounds.map(numbers)).toStrictEqual([[25, 27, 26, 28], [29, 30], [31]]);
  });

  // The walk goes last round first: reordering top-down would order a round by edges not yet placed.
  it("orders an earlier round by the already reordered round after it", () => {
    const rounds = orderRoundsByWiring([
      makeRound("Viertelfinale", [makeSpiel(25), makeSpiel(26), makeSpiel(27), makeSpiel(28)]),
      makeRound("Halbfinale", [makeSpiel(29, sieger(25), sieger(26)), makeSpiel(30, sieger(27), sieger(28))]),
      makeRound("Finale", [makeSpiel(31, sieger(30), sieger(29))]),
    ]);

    // The final names 30 first, so 30's feeders lead the quarter-final column.
    expect(rounds.map(numbers)).toStrictEqual([[27, 28, 25, 26], [30, 29], [31]]);
  });

  it("keeps arrival order for matches nothing references, after the referenced ones", () => {
    const rounds = orderRoundsByWiring([
      makeRound("Halbfinale", [makeSpiel(27), makeSpiel(28), makeSpiel(26)]),
      makeRound("Finale", [makeSpiel(31, sieger(26), null)]),
    ]);

    expect(rounds.map(numbers)).toStrictEqual([[26, 27, 28], [31]]);
  });

  // A `gruppe` reference has no earlier match to order and a dangling `spiel_nr` names none, so
  // neither contributes an edge.
  it("ignores gruppe references, nulls and spiel_nrs the previous round does not hold", () => {
    const gruppe: FLSpielQuelle = { type: "gruppe", gruppe: "A", platz: 1 };
    const rounds = orderRoundsByWiring([
      makeRound("Halbfinale", [makeSpiel(29), makeSpiel(30)]),
      makeRound("Finale", [makeSpiel(31, gruppe, sieger(99)), makeSpiel(32, null, sieger(30))]),
    ]);

    expect(rounds.map(numbers)).toStrictEqual([
      [30, 29],
      [31, 32],
    ]);
  });

  // Reachable only by hand-editing two references onto one match.
  it("places a match referenced twice only once", () => {
    const rounds = orderRoundsByWiring([
      makeRound("Halbfinale", [makeSpiel(29), makeSpiel(30)]),
      makeRound("Finale", [makeSpiel(31, sieger(30), sieger(30))]),
    ]);

    expect(rounds.map(numbers)).toStrictEqual([[30, 29], [31]]);
  });

  it("returns a single round, and an empty season, unchanged", () => {
    const single = [makeRound("Finale", [makeSpiel(31)])];

    expect(orderRoundsByWiring(single).map(numbers)).toStrictEqual([[31]]);
    expect(orderRoundsByWiring([])).toStrictEqual([]);
  });
});

// A matchday as `spieltagLabels` reads one: the label needs the phase and the served position, and
// nothing else on the row.
const labelled = (id: string, phase: FLSaisonPhase, position: number) => ({ id, saison_phase: phase, position });

describe("spieltagLabels", () => {
  it("numbers a Gruppenphase matchday by its stored position", () => {
    const labels = spieltagLabels([labelled("a", "gruppenphase", 1), labelled("b", "gruppenphase", 2)]);

    expect(labels.get("a")?.label).toBe("1. Spieltag");
    expect(labels.get("b")?.label).toBe("2. Spieltag");
  });

  // THE POINT OF STORING IT: a number taken from arrival order would rename every matchday in a
  // list handed over backwards.
  it("reads the same label whichever order the list arrives in", () => {
    const forwards = spieltagLabels([labelled("a", "gruppenphase", 1), labelled("b", "gruppenphase", 2)]);
    const backwards = spieltagLabels([labelled("b", "gruppenphase", 2), labelled("a", "gruppenphase", 1)]);

    expect(backwards.get("a")?.label).toBe(forwards.get("a")?.label);
    expect(backwards.get("b")?.label).toBe(forwards.get("b")?.label);
  });

  // The gap is what separates the two candidate ordinals: counted from the row's place in the list
  // this answers 2, where the stored `position` answers 3.
  it("renders the stored number rather than the row's place in the list", () => {
    const labels = spieltagLabels([labelled("a", "gruppenphase", 1), labelled("c", "gruppenphase", 3)]);

    expect(labels.get("c")?.label).toBe("3. Spieltag");
    expect(labels.get("c")?.ordinal).toBe(3);
  });

  // A knockout round is named by its phase, and only needs a number when the phase is split.
  it("numbers a knockout round only where its phase holds more than one matchday", () => {
    const alone = spieltagLabels([labelled("f", "finale", 1)]);
    const split = spieltagLabels([labelled("v1", "viertelfinale", 1), labelled("v2", "viertelfinale", 2)]);

    expect(alone.get("f")?.label).toBe("Finale");
    expect(split.get("v1")?.label).toBe("Viertelfinale (1)");
    expect(split.get("v2")?.label).toBe("Viertelfinale (2)");
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

const makeSpieltag = (phase: FLSaisonPhase) => ({ saison_phase: phase });

const held = (progress: readonly { phase: FLSaisonPhase; angelegt: number; erwartet: number }[], phase: FLSaisonPhase) =>
  progress.find((entry) => entry.phase === phase);

describe("buildSpieltagPhaseProgress", () => {
  it("counts a phase's matchdays against the number the season's rules imply", () => {
    const progress = buildSpieltagPhaseProgress(SCHEDULE_2026, [
      makeSpieltag("gruppenphase"),
      makeSpieltag("gruppenphase"),
      makeSpieltag("finale"),
    ]);

    expect(held(progress, "gruppenphase")).toStrictEqual({ phase: "gruppenphase", angelegt: 2, erwartet: 3 });
    expect(held(progress, "finale")).toStrictEqual({ phase: "finale", angelegt: 1, erwartet: 1 });
  });

  it("reports a phase with no matchday as zero rather than omitting it", () => {
    const progress = buildSpieltagPhaseProgress(SCHEDULE_2026, [makeSpieltag("gruppenphase")]);

    expect(held(progress, "halbfinale")).toStrictEqual({ phase: "halbfinale", angelegt: 0, erwartet: 1 });
  });

  // The endpoint accepts a matchday in a round this bracket does not reach, so the count describes one.
  it("expects none for a phase the season does not play", () => {
    const progress = buildSpieltagPhaseProgress(SCHEDULE_2026, [makeSpieltag("achtelfinale")]);

    expect(held(progress, "achtelfinale")).toStrictEqual({ phase: "achtelfinale", angelegt: 1, erwartet: 0 });
  });

  // Answering with zeroes would tell the page every phase is short.
  it("answers with nothing at all when no schedule was served", () => {
    expect(buildSpieltagPhaseProgress([], [makeSpieltag("gruppenphase")])).toStrictEqual([]);
  });
});
