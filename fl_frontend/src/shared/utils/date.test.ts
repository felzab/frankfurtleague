import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import { getGermanTodayStr, sortByDate } from "./date.ts";

describe("sortByDate", () => {
  it("sorts ascending by the given key", () => {
    const arr = [{ datum: "2026-07-30" }, { datum: "2026-07-28" }, { datum: "2026-07-29" }];
    assert.deepEqual(
      sortByDate({ arr, key: "datum" }).map((x) => x.datum),
      ["2026-07-28", "2026-07-29", "2026-07-30"],
    );
  });

  it("puts null and undefined values last", () => {
    const arr = [{ datum: null }, { datum: "2026-07-29" }, { datum: undefined }, { datum: "2026-07-28" }];
    assert.deepEqual(
      sortByDate({ arr, key: "datum" }).map((x) => x.datum),
      ["2026-07-28", "2026-07-29", null, undefined],
    );
  });

  // The function spreads before sorting; callers rely on that to sort cached query results.
  it("does not mutate the input array", () => {
    const arr = [{ datum: "2026-07-30" }, { datum: "2026-07-28" }];
    const result = sortByDate({ arr, key: "datum" });
    assert.deepEqual(arr[0]?.datum, "2026-07-30");
    assert.notEqual(result, arr);
  });

  it("handles empty and single-element arrays", () => {
    assert.deepEqual(sortByDate({ arr: [] as { datum: string }[], key: "datum" }), []);
    assert.deepEqual(sortByDate({ arr: [{ datum: "2026-07-29" }], key: "datum" }), [{ datum: "2026-07-29" }]);
  });
});

describe("getGermanTodayStr", () => {
  it("returns a zero-padded YYYY-MM-DD string", () => {
    assert.match(getGermanTodayStr(), /^\d{4}-\d{2}-\d{2}$/);
  });

  // The whole point of the Europe/Berlin pin: at 22:30 UTC in summer it is already
  // tomorrow in Berlin, and every match status keys off this string.
  it("uses Berlin time, not UTC, across the day boundary in CEST", (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-07-28T22:30:00Z").getTime() });
    assert.equal(getGermanTodayStr(), "2026-07-29");
    mock.timers.reset();
  });

  it("uses Berlin time across the day boundary in CET", (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-01-14T23:30:00Z").getTime() });
    assert.equal(getGermanTodayStr(), "2026-01-15");
    mock.timers.reset();
  });

  it("does not roll over before midnight Berlin time", (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-07-28T21:30:00Z").getTime() });
    assert.equal(getGermanTodayStr(), "2026-07-28");
    mock.timers.reset();
  });
});
