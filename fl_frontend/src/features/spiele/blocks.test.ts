import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";
import { SERVER_COPY } from "@/core/serverCopy";

import { ereignisOf, matchdayOf, matchRowOf, outcomeFor, popupFactsOf } from "./blocks";

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
  datum: "2027-03-13",
  uhrzeit: "14:00",
  ergebnis: tore === null ? null : `${String(tore[0])}:${String(tore[1])}`,
  elfmeterschiessen: null,
  sonderereignis,
  ansetzung_confirmed: null,
  for_third_place: false,
  notiz: null,
  ort: null,
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

  it("scores nothing for a match without a result, a called-off one among them", () => {
    expect(outcomeFor(spiel(null), GOETHE)).toBe("none");
    expect(outcomeFor(spiel(null, "ausgefallen"), GOETHE)).toBe("none");
  });

  // A forfeit's score and an abandoned match's entered result count, as the Tabelle counts them.
  it("scores a forfeit and an abandoned match by the result entered", () => {
    expect(outcomeFor(spiel([3, 0], "nichtantreten_team2"), GOETHE)).toBe("won");
    expect(outcomeFor(spiel([0, 3], "abgebrochen"), GOETHE)).toBe("lost");
  });
});

describe("a match as a row", () => {
  it("opens the match's page and carries a shoot-out's goals beside the match's own", () => {
    const row = matchRowOf({ ...spiel([1, 1]), elfmeterschiessen: { team1: 4, team2: 3 } });
    expect(row.href).toBe(`/saisons/2027/spiele/${"2".repeat(24)}`);
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
    expect(ereignisOf(spiel([0, 3], "nichtantreten_team1"))).toStrictEqual({
      title: sonderereignis.nichtAngetreten({ record: "Goethe" }),
      text: sonderereignis.consequence.nichtAngetreten({ record: "Helmholtz" }),
    });
    expect(ereignisOf(spiel([3, 0], "nichtantreten_team2"))).toStrictEqual({
      title: sonderereignis.nichtAngetreten({ record: "Helmholtz" }),
      text: sonderereignis.consequence.nichtAngetreten({ record: "Goethe" }),
    });
  });

  it("says whether an abandoned match is scored by whether a result is entered", () => {
    const { consequence } = COPY.spielplan.sonderereignis;
    expect(ereignisOf(spiel(null, "abgebrochen"))?.text).toBe(consequence.abgebrochenOpen);
    expect(ereignisOf(spiel([2, 1], "abgebrochen"))?.text).toBe(consequence.abgebrochenScored);
  });

  it("is nothing for a match simply played", () => {
    expect(ereignisOf(spiel([2, 1]))).toBeNull();
  });
});

describe("the pop-up's facts", () => {
  const booked: FLSpielJoined = {
    ...spiel(null),
    ort: { spielort_id: "4".repeat(24), name: "Sportplatz Ahornweg", maps_link: "Sportplatz Ahornweg, Ahornweg 2" },
    schiedsrichter: { name: "Anna A.", name_is_public: true },
  };
  const { fact } = COPY.spielplan;

  it("leave out every value the match does not hold", () => {
    expect(popupFactsOf({ ...booked, datum: null, uhrzeit: null, ort: null, schiedsrichter: null })).toStrictEqual([]);
    expect(popupFactsOf(booked).map((each) => each.label)).toStrictEqual([fact.datum, fact.uhrzeit, fact.spielort, fact.schiedsrichter]);
  });

  it("hold no referee whose name the public read withholds", () => {
    const labels = popupFactsOf({ ...booked, schiedsrichter: { name: null, name_is_public: false } }).map((each) => each.label);
    expect(labels).not.toContain(fact.schiedsrichter);
  });

  it("link the venue to its map on another site", () => {
    expect(popupFactsOf(booked).find((each) => each.label === fact.spielort)?.elsewhere).toStrictEqual({
      href: "https://www.google.com/maps/search/?api=1&query=Sportplatz%20Ahornweg%2C%20Ahornweg%202",
      label: { record: "Sportplatz Ahornweg" },
    });
  });
});

// The labels themselves are `spieltagLabel`'s (`features/spieltage/utils.test.ts`); this holds what `matchdayOf` adds.
describe("what a match's matchday is called", () => {
  // Position and count differ, so the two read the other way round would name the round alone.
  it("hands the matchday's position and its phase's count on as the Spielplan's tabs read them", () => {
    expect(matchdayOf({ saison_phase: "viertelfinale", for_third_place: false }, { spieltag_position: 1, count_spieltage_in_phase: 2 })).toBe(
      COPY.shared.knockoutRound(COPY.shared.phase.viertelfinale, 1),
    );
  });

  it("names the match for third place by its own name", () => {
    expect(matchdayOf({ saison_phase: "finale", for_third_place: true }, { spieltag_position: 1, count_spieltage_in_phase: 1 })).toBe(
      SERVER_COPY.season.thirdPlace,
    );
  });
});
