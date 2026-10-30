import { describe, expect, it } from "vitest";

import {
  formatDatum,
  formatDatumLang,
  formatDatumWithWeekday,
  formatErgebnis,
  formatEuro,
  formatInstant,
  formatNumber,
  formatPeriod,
  formatUhrzeit,
} from "./format.ts";

import type { TestContext } from "vitest";

// Every case annotates what the runtime's ICU produced beside what it should be, so a run inside the
// built image under a reporter that prints a passing case's annotations (verbose, junit, tap) shows
// which output its ICU data changed. Spaces other than U+0020 are spelled out.
const sichtbar = (text: string): string =>
  text.replace(/[\u00a0\u2009\u202f]/g, (characters) => `\\u${characters.codePointAt(0)!.toString(16).padStart(4, "0")}`);

async function same(t: TestContext, is: string, soll: string): Promise<void> {
  await t.annotate(`ist ${sichtbar(is)} | soll ${sichtbar(soll)}`);
  expect(is).toBe(soll);
}

describe("formatDatum", () => {
  it("writes a stored calendar day as two-digit day and month", async (t) => {
    await same(t, formatDatum("2026-03-04"), "04.03.2026");
  });

  // Late evening UTC is already the next day in Berlin; the runtime's own zone would print the 24th.
  it("reads an instant on the league's clock", async (t) => {
    await same(t, formatDatum(new Date("2026-10-24T22:30:00Z")), "25.10.2026");
  });
});

describe("formatDatumLang", () => {
  it("names the month, umlaut included", async (t) => {
    await same(t, formatDatumLang("2027-03-14"), "14. März 2027");
  });
});

describe("formatDatumMitWochentag", () => {
  it("leads with the short weekday and drops the year", async (t) => {
    await same(t, formatDatumWithWeekday("2027-03-14"), "So., 14.03.");
  });
});

describe("formatUhrzeit", () => {
  it("pads a stored time and drops its seconds", async (t) => {
    await same(t, formatUhrzeit("9:05:00"), "09:05");
  });

  it("reads an instant in summer time on the league's clock", async (t) => {
    await same(t, formatUhrzeit(new Date("2026-07-01T17:30:00Z")), "19:30");
  });
});

describe("formatZeitpunkt", () => {
  it("joins the long date and the time with „um“", async (t) => {
    await same(t, formatInstant(new Date("2026-10-24T13:30:00Z")), "24. Oktober 2026 um 15:30");
  });

  it("prints an unreadable stored instant as it was stored rather than throw and lose the page or the mail", async (t) => {
    await same(t, formatInstant("kein Zeitpunkt"), "kein Zeitpunkt");
  });
});

describe("formatZeitraum", () => {
  it("parts two days with the locale's dash between thin spaces", async (t) => {
    await same(t, formatPeriod("2025-09-01", "2026-06-30"), "01.09.2025\u2009–\u200930.06.2026");
  });
});

describe("formatZahl and formatEuro", () => {
  it("group thousands with a point and decimals with a comma", async (t) => {
    await same(t, formatNumber(1234.5), "1.234,5");
  });

  it("put the euro sign after a no-break space", async (t) => {
    await same(t, formatEuro(25), "25,00\u00a0€");
  });
});

describe("formatErgebnis", () => {
  it("adds each side's shoot-out goals to its goals", async (t) => {
    await same(t, formatErgebnis({ team1: 2, team2: 2 }, { team1: 4, team2: 3 }), "6:5");
  });
});
