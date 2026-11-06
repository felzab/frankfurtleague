import { describe, expect, it } from "vitest";

import { formatDate, formatDateWithWeekdayAndYear, formatErgebnis, formatInstant, formatTime } from "./format.ts";

describe("formatDate", () => {
  // Late evening UTC is already the next day in Berlin; the runtime's own zone would print the 24th.
  it("reads an instant on the league's clock", () => {
    expect(formatDate(new Date("2026-10-24T22:30:00Z"))).toBe("25.10.2026");
  });
});

describe("formatDateWithWeekdayAndYear", () => {
  // Late on New Year's Eve UTC it is already the new year in Berlin: its weekday and its year both.
  it("reads an instant on the league's clock, the year included", () => {
    expect(formatDateWithWeekdayAndYear(new Date("2026-12-31T23:30:00Z"))).toBe("Fr., 01.01.2027");
  });
});

describe("formatTime", () => {
  it("reads an instant in summer time on the league's clock", () => {
    expect(formatTime(new Date("2026-07-01T17:30:00Z"))).toBe("19:30");
  });
});

describe("formatInstant", () => {
  it("joins the long date and the time with „um“", () => {
    expect(formatInstant(new Date("2026-10-24T13:30:00Z"))).toBe("24. Oktober 2026 um 15:30");
  });

  it("prints an unreadable stored instant as it was stored rather than throw and lose the page or the mail", () => {
    expect(formatInstant("kein Zeitpunkt")).toBe("kein Zeitpunkt");
  });
});

describe("formatErgebnis", () => {
  it("adds each side's shoot-out goals to its goals", () => {
    expect(formatErgebnis({ team1: 2, team2: 2 }, { team1: 4, team2: 3 })).toBe("6:5");
  });
});
