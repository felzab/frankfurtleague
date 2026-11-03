import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";
import { SERVER_COPY } from "@/core/serverCopy";

import { stateOf } from "./landing.ts";

import type { FLLandingKickoff, FLLandingSaison, FLPodiumPlace, FLSpielJoined } from "@/core/generated/client/types";

const START = "2027-02-28T23:00:00Z";

/** A season the read serves, with nothing dated, played or placed unless a case says so. */
const saison = (fields: Partial<FLLandingSaison>): FLLandingSaison => ({
  id: "2027",
  state: "before_start",
  start: START,
  first_kickoff: null,
  recent: [],
  upcoming: [],
  podium: null,
  counts: { count_tore: 0, count_spiele: 0, count_spieltage: 0 },
  teams: [],
  ...fields,
});

const KICKOFF: FLLandingKickoff = {
  datum: "2027-03-06",
  uhrzeit: "14:00",
  spieltag_position: 1,
  team1: { team_id: "0".repeat(24), name: "Goethe", shorthand: "GOE" },
  team2: { team_id: "1".repeat(24), name: "Helmholtz", shorthand: "HEL" },
};

const place = (platz: number, shorthand: string): FLPodiumPlace => ({
  platz,
  team: { team_id: platz.toString(16).padStart(24, "0"), name: shorthand, shorthand },
});

/** An unplayed group match of the season. */
const spiel = (id: string): FLSpielJoined => ({
  id,
  saison_id: "2027",
  saison_phase: "gruppenphase",
  spiel_nr: 2,
  spieltag_id: "2".repeat(24),
  datum: "2027-03-13",
  uhrzeit: "14:00",
  ergebnis: null,
  elfmeterschiessen: null,
  sonderereignis: null,
  ansetzung_confirmed: null,
  for_third_place: false,
  notiz: null,
  ort: null,
  schiedsrichter: null,
  team1: { team_id: "0".repeat(24), name: "Goethe", shorthand: "GOE", tore: null, austritt_type: null },
  team2: { team_id: "1".repeat(24), name: "Helmholtz", shorthand: "HEL", tore: null, austritt_type: null },
  team1_quelle: null,
  team2_quelle: null,
});

describe("the season card before the start", () => {
  // The season's start is the one instant the card counts to (D499), whatever its opening match's day.
  it("counts down to the season's start, and names its opening match once one is dated", () => {
    expect(stateOf(saison({ first_kickoff: KICKOFF }))).toStrictEqual({
      kind: "countdown",
      start: START,
      opening: {
        when: COPY.spielplan.when("2027-03-06", "14:00"),
        spieltag: SERVER_COPY.landing.saison.spieltag(1),
        home: { kuerzel: "GOE" },
        away: { kuerzel: "HEL" },
      },
    });
  });

  it("counts down to the season's start while no match is dated", () => {
    expect(stateOf(saison({}))).toStrictEqual({ kind: "countdown", start: START });
  });

  // D498: an opening side whose slot is empty shows the Spielplan's dashed open plaque.
  it("shows an empty opening side as the open plaque", () => {
    const state = stateOf(saison({ first_kickoff: { ...KICKOFF, team2: null } }));
    expect(state).toMatchObject({ opening: { home: { kuerzel: "GOE" }, away: null } });
  });
});

describe("the season card while it runs", () => {
  it("draws no last result until one exists", () => {
    expect(stateOf(saison({ state: "running", upcoming: [spiel("2")] }))).toStrictEqual({
      kind: "running",
      next: expect.objectContaining({ id: "2" }),
    });
  });
});

describe("the season card once decided", () => {
  it("stands the podium in the order the read serves its places", () => {
    const podium = [place(1, "LIE"), place(2, "ELI"), place(3, "ERS"), place(4, "CMS")] as const;
    expect(stateOf(saison({ state: "decided", podium: [...podium] }))).toStrictEqual({
      kind: "decided",
      places: [
        { name: "LIE", kuerzel: "LIE" },
        { name: "ELI", kuerzel: "ELI" },
        { name: "ERS", kuerzel: "ERS" },
        { name: "CMS", kuerzel: "CMS" },
      ],
    });
  });

  // D499: a place whose club left the season before it was decided is served without a club, and stays a place.
  it("keeps a vacant place in its order, without a club", () => {
    const podium = [place(1, "LIE"), place(2, "ELI"), place(3, "CMS"), { platz: 4, team: null }] as const;
    expect(stateOf(saison({ state: "decided", podium: [...podium] }))).toStrictEqual({
      kind: "decided",
      places: [{ name: "LIE", kuerzel: "LIE" }, { name: "ELI", kuerzel: "ELI" }, { name: "CMS", kuerzel: "CMS" }, null],
    });
  });
});
