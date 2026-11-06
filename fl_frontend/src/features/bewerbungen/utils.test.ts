import { parseDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";

import { BEWERBUNG_MAX_AGE, BEWERBUNG_MIN_AGE, VERTRETUNG_MIN_AGE } from "./constants.ts";
import { birthDateSpan } from "./utils.ts";

describe("the birthdate window a contact person's date has to fall in", () => {
  /* The endpoint's own rule restated rather than its result quoted, so both bounds are judged
     against what it accepts: whole years, a birthday not yet reached this year not having happened
     (`fl_backend/app/shared/age.py :: whole_years_between`). */
  function wholeYears(born: string, today2: string): number {
    const [bYear = 0, bMonth = 0, bDay = 0] = born.split("-").map(Number);
    const [tYear = 0, tMonth = 0, tDay = 0] = today2.split("-").map(Number);

    return tYear - bYear - (tMonth < bMonth || (tMonth === bMonth && tDay < bDay) ? 1 : 0);
  }

  const nextDay = (tag: string): string => parseDate(tag).add({ days: 1 }).toString();
  const previousDay = (tag: string): string => parseDate(tag).subtract({ days: 1 }).toString();

  /* Bounds and not an age: the picker needs a `minValue` and a `maxValue`, the schema needs a string
     comparison, and one derivation serving both is what stops the two drifting apart. */
  it("spans both bounds off today, and both ends are inclusive", () => {
    expect(birthDateSpan("2026-08-29", BEWERBUNG_MIN_AGE)).toStrictEqual({ earliest: "1905-08-30", latest: "2010-08-29" });
  });

  /* The floor moves with the seat while the ceiling does not, so a derivation that read a constant
     for either would offer one seat a date the endpoint then refuses. */
  it("moves the floor's end with the seat and leaves the ceiling's where it is", () => {
    expect(birthDateSpan("2026-08-29", VERTRETUNG_MIN_AGE)).toStrictEqual({ earliest: "1905-08-30", latest: "2008-08-29" });
  });

  /* A 29 February has no counterpart in a year that is not a leap year, 1903 and 2100 among them, so
     an arithmetic that kept the day would hand the picker a date its own parse refuses. */
  it("clamps a leap day onto the end of February where the target year has none", () => {
    expect(birthDateSpan("2024-02-29", BEWERBUNG_MIN_AGE)).toStrictEqual({ earliest: "1903-03-01", latest: "2008-02-29" });
    expect(birthDateSpan("2116-02-29", BEWERBUNG_MIN_AGE).latest).toBe("2100-02-28");
  });

  /* Both tiers refuse the same set. A band the page turns away and the endpoint accepts is a
     contact person told to correct a date that was right. */
  it("ends both bounds exactly where the endpoint's whole-year count does, at either floor", () => {
    for (const mindestalter of [BEWERBUNG_MIN_AGE, VERTRETUNG_MIN_AGE]) {
      for (const today2 of ["2026-09-04", "2024-02-29", "2027-03-01", "2116-02-29"]) {
        const { earliest, latest } = birthDateSpan(today2, mindestalter);
        const wo = `${today2} at ${String(mindestalter)}`;

        expect(wholeYears(earliest, today2), `${wo}: the earliest date offered is not the oldest accepted`).toBe(BEWERBUNG_MAX_AGE);
        expect(wholeYears(previousDay(earliest), today2), `${wo}: the day before it is accepted too`).toBe(BEWERBUNG_MAX_AGE + 1);
        expect(wholeYears(latest, today2), `${wo}: the latest date offered is not the youngest accepted`).toBe(mindestalter);
        expect(wholeYears(nextDay(latest), today2), `${wo}: the day after it is accepted too`).toBe(mindestalter - 1);
      }
    }
  });
});
