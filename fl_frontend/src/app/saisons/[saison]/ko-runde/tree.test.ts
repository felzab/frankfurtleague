import { describe, expect, it } from "vitest";

import { treeOf } from "./tree";

import type { FLSaisonPhase, FLSpielplanSpieltag, FLSpielQuelle } from "@/core/generated/client/types";

/** A knockout match fed by `feeders`' winners, or by the semi-finals' losers where `third` says so. */
const spiel = (spiel_nr: number, saison_phase: FLSaisonPhase, feeders: [number, number] | null, third = false) => {
  const quelle = (nr: number): FLSpielQuelle => ({ type: "spiel", spiel_nr: nr, ausgang: third ? "verlierer" : "sieger" });
  return {
    id: `s${String(spiel_nr)}`,
    saison_id: "2027",
    spieltag_id: saison_phase,
    spiel_nr,
    saison_phase,
    datum: null,
    uhrzeit: null,
    ergebnis: null,
    elfmeterschiessen: null,
    sonderereignis: null,
    notiz: null,
    ort: null,
    schiedsrichter: null,
    ansetzung_confirmed: null,
    team1: null,
    team2: null,
    team1_quelle: feeders === null ? null : quelle(feeders[0]),
    team2_quelle: feeders === null ? null : quelle(feeders[1]),
  };
};

const matchday = (saison_phase: FLSaisonPhase, spiele: ReturnType<typeof spiel>[]) =>
  ({
    id: saison_phase,
    saison_id: "2027",
    saison_phase,
    position: 1,
    beginn: null,
    ende: null,
    count_spiele: spiele.length,
    version: 1,
    spiele,
  }) as FLSpielplanSpieltag;

describe("the K.-o.-Baum read from the knockout matchdays", () => {
  // The draw numbers the quarter-finals 1 to 4 but wires them crosswise: 3 and 1 feed the first semi-final, 4 and
  // 2 the second. Drawn in number order, a semi-final would stand under two matches that do not feed it.
  it("orders each round so a match stands under the two its sides' winners come from, the third place apart", () => {
    const tree = treeOf([
      matchday("viertelfinale", [
        spiel(1, "viertelfinale", null),
        spiel(2, "viertelfinale", null),
        spiel(3, "viertelfinale", null),
        spiel(4, "viertelfinale", null),
      ]),
      matchday("halbfinale", [spiel(5, "halbfinale", [3, 1]), spiel(6, "halbfinale", [4, 2])]),
      matchday("finale", [spiel(7, "finale", [5, 6], true), spiel(8, "finale", [5, 6])]),
    ]);
    expect(tree?.rounds.map((round) => round.matches.map((match) => match.id))).toStrictEqual([["s3", "s1", "s4", "s2"], ["s5", "s6"], ["s8"]]);
    expect(tree?.third?.id).toBe("s7");
  });

  it("is none before the draw", () => {
    expect(treeOf([])).toBeNull();
  });
});
