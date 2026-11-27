import { afterEach, describe, expect, it, vi } from "vitest";

import { byOf, byOptions, logParams, searchParams } from "./filters";

afterEach(() => {
  vi.useRealTimers();
});

describe("„Wer“", () => {
  /* The option's id stands in the page's URL, which the edge's log, the next page's referer and Cloudflare's log keep. */
  it("names an actor in the URL by nothing of the address, and reads it back", () => {
    const held = ["pia@example.org", "system"];
    const ids = byOptions(held).map(({ id }) => id);

    expect(ids.join()).not.toMatch(/pia|example|@/);
    expect(ids.map((id) => byOf(held, id)).toSorted()).toStrictEqual(held);
  });

  /* Read as an actor, the unfiltered view would list one person's rows while „Wer“ reads „Alle“. */
  it("reads no choice as no actor", () => {
    expect(byOf(["pia@example.org", "system"], null)).toBeNull();
  });
});

describe("the read a filter asks", () => {
  /* A category left out of an option's list hides its rows with nothing failing. */
  it("sends every category an option stands for", () => {
    expect(logParams({ type: "spiel" }).type).toStrictEqual(["spieltag", "spiel", "spielbestaetigung", "spielbericht", "aufstellung"]);
    expect(logParams({ type: "erasure" }).type).toStrictEqual(["erasure", "retention"]);
  });

  /* The store holds „2026“ and the number 1, so a row's own words sent as text would find nothing, the fixture never. */
  it.each([
    ["Saison 2026", { q: null, saison_id: "2026", spiel_nr: null }],
    ["spiel  1", { q: null, saison_id: null, spiel_nr: 1 }],
    ["Saison 2026 · Spiel 1", { q: null, saison_id: "2026", spiel_nr: 1 }],
    ["Adler · saison 2026", { q: "Adler", saison_id: "2026", spiel_nr: null }],
  ])("filters on what a row stores where the search words a season or a fixture as the row does: %s", (typed, sent) => {
    expect(searchParams(typed)).toStrictEqual(sent);
  });

  /* Anything else keeps its match on the team, the season and the label, as typed. */
  it.each(["2026", "Adler (U17)", "Spiel 0", "Spiel eins", "Saison"])("sends any other search whole: %s", (typed) => {
    expect(searchParams(typed)).toStrictEqual({ q: typed, saison_id: null, spiel_nr: null });
  });

  /* 23:30 UTC on 7 November is already the 8th on the league's clock, and the backend's bounds are German days. */
  it("counts a preset from the German day", () => {
    vi.useFakeTimers({ now: new Date("2026-11-07T23:30:00Z") });
    expect(logParams({ time: "7-days" }).from_day).toBe("2026-11-01");
  });
});
