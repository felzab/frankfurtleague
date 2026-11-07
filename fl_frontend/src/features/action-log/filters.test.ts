import { afterEach, describe, expect, it, vi } from "vitest";

import { logParams } from "./filters";

afterEach(() => {
  vi.useRealTimers();
});

describe("the read a filter asks", () => {
  /* A category left out of an option's list hides its rows with nothing failing. */
  it("sends every category an option stands for", () => {
    expect(logParams({ type: "spiel" }).type).toStrictEqual(["spieltag", "spiel", "spielbestaetigung", "spielbericht"]);
    expect(logParams({ type: "erasure" }).type).toStrictEqual(["erasure", "retention"]);
  });

  /* 23:30 UTC on 7 November is already the 8th on the league's clock, and the backend's bounds are German days. */
  it("counts a preset from the German day", () => {
    vi.useFakeTimers({ now: new Date("2026-11-07T23:30:00Z") });
    expect(logParams({ time: "7-days" }).from_day).toBe("2026-11-01");
    expect(logParams({ time: "12-months" }).from_day).toBe("2025-11-08");
  });

  it("asks nothing of a filter left on „Alle“", () => {
    expect(logParams({})).toStrictEqual({ by: null, type: null, from_day: null });
  });
});
