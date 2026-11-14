import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { treeOf } from "./tree";

import type { FLSaisonPhase, FLSpielplanSpieltag, FLSpielQuelle } from "@/core/generated/client/types";

/** A knockout match fed by `feeders`' winners, or the match for third place, fed by the semi-finals' losers and marked so, where `third` says so. */
const spiel = (spiel_nr: number, saison_phase: FLSaisonPhase, feeders: [number, number] | null, third = false) => {
  const quelle = (nr: number): FLSpielQuelle => ({ type: "spiel", spiel_nr: nr, ausgang: third ? "verlierer" : "sieger" });
  return {
    id: `s${String(spiel_nr)}`,
    saison_id: "2027",
    spieltag_id: saison_phase,
    spiel_nr,
    saison_phase,
    date: null,
    time: null,
    ergebnis: null,
    elfmeterschiessen: null,
    sonderereignis: null,
    note: null,
    spielort: null,
    schiedsrichter: null,
    ansetzung_confirmed: null,
    for_third_place: third,
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
    start: null,
    end: null,
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

  // The harm: a no-show drawn as a played 3:0, so the bracket says a club won on the pitch that never played.
  it("draws what befell a match as the Spielplan's row does: its chip, both sides muted and the absent one struck", () => {
    const side = (team_id: string, name: string, tore: number) => ({ team_id, name, shorthand: name.slice(0, 3), tore, austritt_type: null });
    const forfeit = {
      ...spiel(1, "finale", null),
      team1: side("0000000000000000000000b1", "Birke", 3),
      team2: side("0000000000000000000000b2", "Esche", 0),
      ergebnis: "3:0",
      sonderereignis: "nichtantreten_team2" as const,
    };

    const [card] = treeOf([{ ...matchday("finale", []), count_spiele: 1, spiele: [forfeit] } as FLSpielplanSpieltag])?.rounds[0].matches ?? [];

    expect([card?.chip, card?.muted, card?.absent]).toStrictEqual([
      {
        tone: "danger",
        label: COPY.spielplan.sonderereignis.nichtantretenChip,
        spoken: COPY.spielplan.sonderereignis.nichtantreten({ record: "Esche" }),
      },
      true,
      "team2",
    ]);
  });
});
