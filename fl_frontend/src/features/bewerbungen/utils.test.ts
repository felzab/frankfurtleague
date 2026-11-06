import { parseDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";

import { BEWERBUNG_MAX_ALTER, BEWERBUNG_MIN_ALTER, VERTRETUNG_MIN_ALTER } from "./constants.ts";
import { geburtsdatumSpanne } from "./utils.ts";

describe("the birthdate window a contact person's date has to fall in", () => {
  /* The endpoint's own rule restated rather than its result quoted, so both bounds are judged
     against what it accepts: whole years, a birthday not yet reached this year not having happened
     (`fl_backend/app/shared/age.py :: whole_years_between`). */
  function wholeYears(geboren: string, today2: string): number {
    const [gJahr = 0, gMonat = 0, gTag = 0] = geboren.split("-").map(Number);
    const [hJahr = 0, hMonat = 0, hTag = 0] = today2.split("-").map(Number);

    return hJahr - gJahr - (hMonat < gMonat || (hMonat === gMonat && hTag < gTag) ? 1 : 0);
  }

  const nextDay = (tag: string): string => parseDate(tag).add({ days: 1 }).toString();
  const previousDay = (tag: string): string => parseDate(tag).subtract({ days: 1 }).toString();

  /* Bounds and not an age: the picker needs a `minValue` and a `maxValue`, the schema needs a string
     comparison, and one derivation serving both is what stops the two drifting apart. */
  it("spans both bounds off today, and both ends are inclusive", () => {
    expect(geburtsdatumSpanne("2026-08-29", BEWERBUNG_MIN_ALTER)).toStrictEqual({ frueheste: "1905-08-30", spaeteste: "2010-08-29" });
  });

  /* The floor moves with the seat while the ceiling does not, so a derivation that read a constant
     for either would offer one seat a date the endpoint then refuses. */
  it("moves the floor's end with the seat and leaves the ceiling's where it is", () => {
    expect(geburtsdatumSpanne("2026-08-29", VERTRETUNG_MIN_ALTER)).toStrictEqual({ frueheste: "1905-08-30", spaeteste: "2008-08-29" });
  });

  /* A 29 February has no counterpart in a year that is not a leap year, 1903 and 2100 among them, so
     an arithmetic that kept the day would hand the picker a date its own parse refuses. */
  it("clamps a leap day onto the end of February where the target year has none", () => {
    expect(geburtsdatumSpanne("2024-02-29", BEWERBUNG_MIN_ALTER)).toStrictEqual({ frueheste: "1903-03-01", spaeteste: "2008-02-29" });
    expect(geburtsdatumSpanne("2116-02-29", BEWERBUNG_MIN_ALTER).spaeteste).toBe("2100-02-28");
  });

  /* Both tiers refuse the same set. A band the page turns away and the endpoint accepts is a
     contact person told to correct a date that was right. */
  it("ends both bounds exactly where the endpoint's whole-year count does, at either floor", () => {
    for (const mindestalter of [BEWERBUNG_MIN_ALTER, VERTRETUNG_MIN_ALTER]) {
      for (const today2 of ["2026-09-04", "2024-02-29", "2027-03-01", "2116-02-29"]) {
        const { frueheste, spaeteste } = geburtsdatumSpanne(today2, mindestalter);
        const wo = `${today2} at ${String(mindestalter)}`;

        expect(wholeYears(frueheste, today2), `${wo}: the earliest date offered is not the oldest accepted`).toBe(BEWERBUNG_MAX_ALTER);
        expect(wholeYears(previousDay(frueheste), today2), `${wo}: the day before it is accepted too`).toBe(BEWERBUNG_MAX_ALTER + 1);
        expect(wholeYears(spaeteste, today2), `${wo}: the latest date offered is not the youngest accepted`).toBe(mindestalter);
        expect(wholeYears(nextDay(spaeteste), today2), `${wo}: the day after it is accepted too`).toBe(mindestalter - 1);
      }
    }
  });
});
