import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getGermanTodayStr } from "./date.ts";

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
