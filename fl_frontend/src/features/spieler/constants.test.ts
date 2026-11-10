import { describe, expect, it } from "vitest";

import { byShirtNumber } from "./constants";

// The harm: a hand-edited number that is not digits read as NaN, which leaves the comparator inconsistent and the row
// at a place no two lists agree on, the stored line-up's order among them.
describe("the shirt-number order", () => {
  it("puts a number that is not digits with the rows wearing none, after the numbered ones", () => {
    const rows = ["10", "7a", null, "7", "007"].map((nummer) => ({ nummer }));

    expect(rows.toSorted(byShirtNumber).map(({ nummer }) => nummer)).toStrictEqual(["7", "007", "10", "7a", null]);
  });
});
