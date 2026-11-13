import { describe, expect, it } from "vitest";

import { counted, NO_SONDEREREIGNIS, valuesOf, wholeOnFirstSave } from "./berichtValues";

import type { FLSonderereignis, FLSpielberichtSchiedsrichterResponse } from "@/core/generated/client/types";

const SPIEL_ID = "64b000000000000000000001";

// The harm: the form shows a score the write would not propose, and the referee saves a result they never read.
describe("the score counted from the goals entered", () => {
  it("credits a goal to its row's side and an own goal to the other side, as the write counts them", () => {
    expect(
      counted([
        { side: "team1", eigentor: false },
        { side: "team1", eigentor: false },
        { side: "team2", eigentor: false },
        // Scored by a pupil of team 2 into their own goal: a goal for team 1.
        { side: "team2", eigentor: true },
      ]),
    ).toStrictEqual({ team1: 3, team2: 1 });
  });

  it("counts a row whose side is not chosen for neither side", () => {
    expect(
      counted([
        { side: null, eigentor: false },
        { side: null, eigentor: true },
        { side: "team2", eigentor: false },
      ]),
    ).toStrictEqual({ team1: 0, team2: 1 });
  });
});

/** A played fixture the league holds `sonderereignis` for, with no report stored yet. */
const unreported = (
  sonderereignis: FLSonderereignis,
): Pick<FLSpielberichtSchiedsrichterResponse, "bericht" | "kader" | "sides_changed" | "spiel"> => ({
  spiel: {
    spiel_id: SPIEL_ID,
    saison_id: "2027",
    saison_phase: "gruppenphase",
    date: "2026-10-27",
    time: "15:00:00",
    team1: { team_id: "64b000000000000000000002", name: "Birke", shorthand: "BIR" },
    team2: { team_id: "64b000000000000000000003", name: "Weide", shorthand: "WEI" },
    spielort: null,
    sonderereignis,
  },
  kader: { team1: [], team2: [] },
  bericht: null,
  sides_changed: [],
});

// The harm: the page shows the league's no-show while the save stores „Keines“, and the match editor then offers that
// report's 0:0 over the no-show, which nothing on the referee's page showed them.
describe("a first report on a match the league gave an event", () => {
  it("opens at the league's no-show and sends it with the report, though the referee left it untouched", () => {
    const opened = valuesOf(unreported("nichtantreten_team2"));

    expect(opened.sonderereignis).toBe("nichtantreten_team2");
    expect(wholeOnFirstSave(opened, { id: SPIEL_ID, version: null, changes: { remarks: "Weide nicht erschienen" } }).changes).toStrictEqual({
      ...opened,
      remarks: "Weide nicht erschienen",
    });
  });

  it.each(["ausgefallen", "annulliert"] as const)("opens at no event on a match %s, which the report cannot state", (sonderereignis) => {
    expect(valuesOf(unreported(sonderereignis)).sonderereignis).toBe(NO_SONDEREREIGNIS);
  });
});
