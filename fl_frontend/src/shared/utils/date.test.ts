import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getGermanTodayStr, sortByDate } from "./date.ts";

describe("sortByDate", () => {
  it("sorts ascending by the given key", () => {
    const arr = [{ datum: "2026-07-30" }, { datum: "2026-07-28" }, { datum: "2026-07-29" }];
    expect(sortByDate({ arr, key: "datum" }).map((x) => x.datum)).toStrictEqual(["2026-07-28", "2026-07-29", "2026-07-30"]);
  });

  it("puts null and undefined values last", () => {
    const arr = [{ datum: null }, { datum: "2026-07-29" }, { datum: undefined }, { datum: "2026-07-28" }];
    expect(sortByDate({ arr, key: "datum" }).map((x) => x.datum)).toStrictEqual(["2026-07-28", "2026-07-29", null, undefined]);
  });

  // The function spreads before sorting; callers rely on that to sort cached query results.
  it("does not mutate the input array", () => {
    const arr = [{ datum: "2026-07-30" }, { datum: "2026-07-28" }];
    const result = sortByDate({ arr, key: "datum" });
    expect(arr[0]?.datum).toStrictEqual("2026-07-30");
    expect(result).not.toBe(arr);
  });

  it("handles empty and single-element arrays", () => {
    expect(sortByDate({ arr: [] as { datum: string }[], key: "datum" })).toStrictEqual([]);
    expect(sortByDate({ arr: [{ datum: "2026-07-29" }], key: "datum" })).toStrictEqual([{ datum: "2026-07-29" }]);
  });
});

describe("getGermanTodayStr", () => {
  beforeEach(() => void vi.useFakeTimers({ toFake: ["Date"] }));
  afterEach(() => void vi.useRealTimers());

  it("returns a zero-padded YYYY-MM-DD string", () => {
    expect(getGermanTodayStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // The whole point of the Europe/Berlin pin: at 22:30 UTC in summer it is already
  // tomorrow in Berlin, and every match status keys off this string.
  it("uses Berlin time, not UTC, across the day boundary in CEST", () => {
    vi.setSystemTime(new Date("2026-07-28T22:30:00Z").getTime());
    expect(getGermanTodayStr()).toBe("2026-07-29");
  });

  it("uses Berlin time across the day boundary in CET", () => {
    vi.setSystemTime(new Date("2026-01-14T23:30:00Z").getTime());
    expect(getGermanTodayStr()).toBe("2026-01-15");
  });

  it("does not roll over before midnight Berlin time", () => {
    vi.setSystemTime(new Date("2026-07-28T21:30:00Z").getTime());
    expect(getGermanTodayStr()).toBe("2026-07-28");
  });
});
