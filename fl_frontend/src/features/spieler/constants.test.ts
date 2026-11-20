import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy/shared";

import { byShirtNumber, publicPupilRow } from "./constants";

import type { FLSpielerPublic } from "@/core/generated/client/types";

// The harm: a hand-edited number that is not digits read as NaN, which leaves the comparator inconsistent and the row
// at a place no two lists agree on, the stored line-up's order among them.
describe("the shirt-number order", () => {
  it("puts a number that is not digits with the rows wearing none, after the numbered ones", () => {
    const rows = ["10", "7a", null, "7", "007"].map((nummer) => ({ nummer }));

    expect(rows.toSorted(byShirtNumber).map(({ nummer }) => nummer)).toStrictEqual(["7", "007", "10", "7a", null]);
  });
});

const pupil = (first_name: string | null, rolle: FLSpielerPublic["rolle"]): FLSpielerPublic => ({
  first_name,
  last_name: first_name === null ? null : "B.",
  nummer: "11",
  position: "Abwehr",
  rolle,
});

describe("a public pupil's role mark", () => {
  const { rolleMark } = COPY.shared;
  const { rolleOption } = COPY.kader;

  // The harm: a captain's letters swapped with the Co-Kapitän's, or a mark naming the wrong role to a screen reader.
  it("sets the captain's and the Co-Kapitän's mark after the name, each named by its role", () => {
    expect([pupil("Lea", "kapitaen"), pupil("Finn", "co_kapitaen"), pupil("Ida", null)].map((each) => publicPupilRow(each).mark)).toStrictEqual(
      [
        { label: rolleMark.kapitaen, spoken: rolleOption.kapitaen },
        { label: rolleMark.co_kapitaen, spoken: rolleOption.co_kapitaen },
        undefined,
      ],
    );
  });

  // The harm: a mark beside „anonym“ says who the nameless pupil is, which the privacy notice promises it never does.
  // The read serves no role there; the row holds the rule too, so a role reaching it beside a withheld name shows none.
  it("draws no mark beside a withheld name", () => {
    const row = publicPupilRow(pupil(null, "kapitaen"));

    expect(row.name).toBe(COPY.shared.anonymous);
    expect(row).not.toHaveProperty("mark");
  });
});
