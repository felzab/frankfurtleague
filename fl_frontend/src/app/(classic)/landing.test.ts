import { describe, expect, it } from "vitest";

import { stateOf } from "./landing.ts";

import type { FLBewerbungWindow, FLLandingSaison, FLPodiumPlace } from "@/core/generated/client/types";

const WINDOW: FLBewerbungWindow = { saison_id: "2027", von: "2026-10-01", bis: "2026-12-31" };

/** A season the read serves, with nothing dated, played or placed unless a case says so. */
const saison = (fields: Partial<FLLandingSaison>): FLLandingSaison => ({
  id: "2027",
  state: "before_start",
  first_kickoff: null,
  recent: [],
  upcoming: [],
  podium: [],
  counts: { count_teams: 0, count_tore: 0, count_spiele: 0, count_spieltage: 0 },
  teams: [],
  ...fields,
});

const place = (platz: number, shorthand: string): FLPodiumPlace => ({
  platz,
  shorthand,
  name: shorthand,
  team_id: platz.toString(16).padStart(24, "0"),
});

describe("the season card before the start", () => {
  it("counts down to the first kick-off at the hour Berlin's clock shows, in winter and in summer", () => {
    const kickoff = (datum: string) =>
      stateOf(
        saison({
          first_kickoff: {
            datum,
            uhrzeit: "14:00",
            spieltag_position: 1,
            team1: { shorthand: "GOE" },
            team2: { shorthand: "HEL" },
          } as FLLandingSaison["first_kickoff"],
        }),
        null,
      );
    expect(kickoff("2027-03-06")).toMatchObject({ kind: "countdown", kickoff: "2027-03-06T13:00:00.000Z" });
    expect(kickoff("2027-06-05")).toMatchObject({ kind: "countdown", kickoff: "2027-06-05T12:00:00.000Z" });
    expect(kickoff("2027-03-06")).toMatchObject({ opening: { home: "GOE", away: "HEL" } });
  });

  it("shows the open window while nothing is dated, and the one sentence while no window is open either", () => {
    expect(stateOf(saison({}), WINDOW)).toStrictEqual({ kind: "window", until: "2026-12-31", apply: "/bewerbung/2027" });
    expect(stateOf(saison({}), null)).toStrictEqual({ kind: "undated" });
  });
});

describe("the season card once the Finale is played", () => {
  it("stands the podium once all four places are in", () => {
    const decided = stateOf(saison({ state: "decided", podium: [place(2, "ELI"), place(1, "LIE"), place(4, "CMS"), place(3, "ERS")] }), null);
    expect(decided).toStrictEqual({
      kind: "decided",
      places: [
        { name: "LIE", kuerzel: "LIE" },
        { name: "ELI", kuerzel: "ELI" },
        { name: "ERS", kuerzel: "ERS" },
        { name: "CMS", kuerzel: "CMS" },
      ],
    });
  });

  // Every season with a K.-o.-Runde has places 1 to 4 (D497): one whose third-place match is unplayed is undecided.
  it("reads as undecided while the third-place match has placed nobody", () => {
    expect(stateOf(saison({ state: "decided", podium: [place(1, "LIE"), place(2, "ELI")] }), null)).toStrictEqual({ kind: "running" });
  });
});
