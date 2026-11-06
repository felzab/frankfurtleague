import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { eventOf, matchRowOf, outcomeFor } from "./blocks";

import type { FLSonderereignis, FLSpielJoined } from "@/core/generated/client/types";

const GOETHE = "0".repeat(24);
const HELMHOLTZ = "1".repeat(24);

/** A group match between Goethe and Helmholtz, with the goals and the event a case gives it. */
const spiel = (tore: readonly [number, number] | null, sonderereignis: FLSonderereignis | null = null): FLSpielJoined => ({
  id: "2".repeat(24),
  saison_id: "2027",
  saison_phase: "gruppenphase",
  spiel_nr: 1,
  spieltag_id: "3".repeat(24),
  date: "2027-03-13",
  time: "14:00",
  ergebnis: tore === null ? null : `${String(tore[0])}:${String(tore[1])}`,
  elfmeterschiessen: null,
  sonderereignis,
  ansetzung_confirmed: null,
  for_third_place: false,
  note: null,
  spielort: null,
  schiedsrichter: null,
  team1: { team_id: GOETHE, name: "Goethe", shorthand: "GOE", tore: tore?.[0] ?? null, austritt_type: null },
  team2: { team_id: HELMHOLTZ, name: "Helmholtz", shorthand: "HEL", tore: tore?.[1] ?? null, austritt_type: null },
  team1_quelle: null,
  team2_quelle: null,
});

describe("how a match went for one of its clubs", () => {
  // The club page colours each match's point by it: a side read backwards would paint a loss in the win's green
  // with the score beside it the only line saying otherwise, and nothing failing.
  it("reads the goals from the club's own side, whichever the fixture lists first", () => {
    expect([outcomeFor(spiel([2, 1]), GOETHE), outcomeFor(spiel([2, 1]), HELMHOLTZ)]).toStrictEqual(["won", "lost"]);
    expect([outcomeFor(spiel([0, 3]), GOETHE), outcomeFor(spiel([0, 3]), HELMHOLTZ)]).toStrictEqual(["lost", "won"]);
    expect(outcomeFor(spiel([1, 1]), HELMHOLTZ)).toBe("drawn");
  });
});

describe("a match as a row", () => {
  it("carries a shoot-out's goals beside the match's own", () => {
    const row = matchRowOf({ ...spiel([1, 1]), elfmeterschiessen: { team1: 4, team2: 3 } });
    expect(row.result).toStrictEqual({ tore: { team1: 1, team2: 1 }, elfmeterschiessen: { team1: 4, team2: 3 } });
  });

  // A row with a result draws its figures; one drawn for an unplayed match would read 0:0.
  it("carries no result until one is entered", () => {
    expect(matchRowOf(spiel(null)).result).toBeUndefined();
  });

  // Each of the three sources: a winner's slot worded as a loser's names the other club of that match.
  it("names a side the draw has not settled by its source, short in the plaque", () => {
    const row = matchRowOf({
      ...spiel(null),
      team1: null,
      team2: null,
      team1_quelle: { type: "gruppe", gruppe: "A", platz: 1 },
      team2_quelle: { type: "spiel", spiel_nr: 25, ausgang: "verlierer" },
    });
    const winners = matchRowOf({ ...spiel(null), team1: null, team1_quelle: { type: "spiel", spiel_nr: 26, ausgang: "sieger" } });
    const { quelle } = COPY.spielplan;
    expect(row.team1).toStrictEqual({ name: quelle.gruppe("A", 1), plaque: { quelle: quelle.gruppeShort("A", 1) } });
    expect(row.team2).toStrictEqual({ name: quelle.verlierer(25), plaque: { quelle: quelle.verliererShort(25) } });
    expect(winners.team1).toStrictEqual({ name: quelle.sieger(26), plaque: { quelle: quelle.siegerShort(26) } });
  });
});

describe("what befell a match", () => {
  // Read backwards, the pop-up and the match page would publish that the wrong school failed to turn up.
  it("names the side that did not turn up, and gives the match to the side that did", () => {
    const { sonderereignis } = COPY.spielplan;
    expect(eventOf(spiel([0, 3], "nichtantreten_team1"))).toStrictEqual({
      title: sonderereignis.nichtAngetreten({ record: "Goethe" }),
      text: sonderereignis.consequence.nichtAngetreten({ record: "Helmholtz" }),
    });
    expect(eventOf(spiel([3, 0], "nichtantreten_team2"))).toStrictEqual({
      title: sonderereignis.nichtAngetreten({ record: "Helmholtz" }),
      text: sonderereignis.consequence.nichtAngetreten({ record: "Goethe" }),
    });
  });

  // The strike alone says which school stayed away on every public list: read backwards it names the wrong school
  // with nothing failing.
  it("strikes the side that did not turn up in a list's row", () => {
    const first = matchRowOf(spiel([0, 3], "nichtantreten_team1"));
    const second = matchRowOf(spiel([3, 0], "nichtantreten_team2"));
    expect(first.absent).toBe("team1");
    expect(second.absent).toBe("team2");
  });
});
