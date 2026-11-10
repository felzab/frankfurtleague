import { describe, expect, it } from "vitest";

import { counted } from "./berichtValues";

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
