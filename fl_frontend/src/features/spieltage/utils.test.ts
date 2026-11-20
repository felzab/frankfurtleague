import { describe, expect, it } from "vitest";

import { byKickOff } from "./utils";

describe("byKickOff", () => {
  // The made-up league dates every match, so a missing day or time sorting first would pass every look.
  it("puts an untimed match after its day's timed ones, and an undated one last", () => {
    const matches = [
      { spiel_nr: 1, date: null, time: null },
      { spiel_nr: 2, date: "2027-05-02", time: null },
      { spiel_nr: 3, date: "2027-05-02", time: "10:00" },
      { spiel_nr: 4, date: "2027-05-01", time: "18:00" },
      { spiel_nr: 5, date: "2027-05-02", time: "10:00" },
    ];

    expect(matches.toSorted(byKickOff).map((match) => match.spiel_nr)).toEqual([4, 3, 5, 2, 1]);
  });
});
