import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";
import { SERVER_COPY } from "@/core/serverCopy";

import { stateOf } from "./landing.ts";

import type { FLLandingDecided, FLLandingOpeningSpiel, FLLandingSide, FLSpielJoined } from "@/core/generated/client/types";

const START = "2027-02-28T23:00:00Z";

/** What the read serves of a season in every state, with nothing counted and no school entered. */
const FACTS = { id: "2027", start: START, counts: { count_tore: 0, count_spiele: 0, count_spieltage: 0 }, teams: [] };

const OPENING_SPIEL: FLLandingOpeningSpiel = {
  datum: "2027-03-06",
  uhrzeit: "14:00",
  spieltag_position: 1,
  team1: { name: "Goethe", shorthand: "GOE" },
  team2: { name: "Helmholtz", shorthand: "HEL" },
};

const club = (shorthand: string): FLLandingSide => ({ name: shorthand, shorthand });

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

const decided = (podium: FLLandingDecided["podium"]): FLLandingDecided => ({ ...FACTS, state: "decided", podium });

describe("the season card before the start", () => {
  // The season's start is the one instant the card counts to, whatever its opening match's day.
  it("counts down to the season's start, and names its opening match once one is dated", () => {
    expect(stateOf({ ...FACTS, state: "before_start", opening_spiel: OPENING_SPIEL })).toStrictEqual({
      kind: "countdown",
      start: START,
      opening: {
        when: COPY.spielplan.when("2027-03-06", "14:00"),
        spieltag: SERVER_COPY.landing.saison.spieltag(1),
        home: { record: "GOE" },
        away: { record: "HEL" },
      },
    });
  });

  it("counts down to the season's start while no match is dated", () => {
    expect(stateOf({ ...FACTS, state: "before_start", opening_spiel: null })).toStrictEqual({ kind: "countdown", start: START });
  });

  // An opening side whose slot is empty shows the Spielplan's dashed open plaque.
  it("shows an empty opening side as the open plaque", () => {
    const state = stateOf({ ...FACTS, state: "before_start", opening_spiel: { ...OPENING_SPIEL, team2: null } });
    expect(state).toMatchObject({ opening: { home: { record: "GOE" }, away: null } });
  });
});

describe("the season card while it runs", () => {
  it("draws no last result until one exists", () => {
    const state = stateOf({ ...FACTS, state: "running", recent: [], upcoming: [spiel("2")] });
    expect(state).toHaveProperty("kind", "running");
    expect(state).toHaveProperty("next.id", "2");
    expect(state).not.toHaveProperty("last");
  });
});

describe("the season card once decided", () => {
  it("stands the podium in the order the read serves its places", () => {
    expect(stateOf(decided([club("LIE"), club("ELI"), club("ERS"), club("CMS")]))).toStrictEqual({
      kind: "decided",
      places: [
        { name: { record: "LIE" }, plaque: { record: "LIE" } },
        { name: { record: "ELI" }, plaque: { record: "ELI" } },
        { name: { record: "ERS" }, plaque: { record: "ERS" } },
        { name: { record: "CMS" }, plaque: { record: "CMS" } },
      ],
    });
  });

  // A place whose club left the season before it was decided is served without a club, and stays a place.
  it("keeps a vacant place in its order, without a club", () => {
    expect(stateOf(decided([club("LIE"), club("ELI"), club("CMS"), null]))).toStrictEqual({
      kind: "decided",
      places: [
        { name: { record: "LIE" }, plaque: { record: "LIE" } },
        { name: { record: "ELI" }, plaque: { record: "ELI" } },
        { name: { record: "CMS" }, plaque: { record: "CMS" } },
        null,
      ],
    });
  });
});
