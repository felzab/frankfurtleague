import { describe, expect, it } from "vitest";

import { adoptsBerichtOf, NO_SONDEREREIGNIS } from "./spielValues";

import type { Proposal, SpielValues } from "./spielValues";

const STORED: SpielValues = {
  team1: "64b000000000000000000003",
  team2: "64b000000000000000000004",
  datum: null,
  uhrzeit: null,
  spielort: null,
  mietpreis: "",
  schiedsrichter: null,
  honorar: "",
  hasResult: false,
  tore1: "",
  tore2: "",
  shootOut1: "",
  shootOut2: "",
  sonderereignis: NO_SONDEREREIGNIS,
  notiz: "",
};

/** The referee's report proposing 3:1, at its second version. */
const PROPOSAL: Proposal = { version: 2, values: { sonderereignis: NO_SONDEREREIGNIS, hasResult: true, tore1: "3", tore2: "1" } };

const ADOPTED = { ...STORED, hasResult: true, tore1: "3", tore2: "1" };

// The harm: a report stamped adopted with a result other than the one stored, so the Übersicht drops a report
// nobody took over, and nothing on the screen says so.
describe("the report a match save stamps adopted", () => {
  it("is the proposal's version once „Übernehmen“ was pressed and the saved values hold its proposal", () => {
    expect(adoptsBerichtOf(PROPOSAL, true, ADOPTED)).toBe(2);
  });

  it("is none where a goal changed after „Übernehmen“", () => {
    expect(adoptsBerichtOf(PROPOSAL, true, { ...ADOPTED, tore2: "2" })).toBeNull();
  });

  it("is none where the result matches the proposal but „Übernehmen“ was never pressed", () => {
    expect(adoptsBerichtOf(PROPOSAL, false, ADOPTED)).toBeNull();
  });
});
