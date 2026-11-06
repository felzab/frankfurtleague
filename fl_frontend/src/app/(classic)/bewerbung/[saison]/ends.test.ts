import { describe, expect, it, vi } from "vitest";

import { SERVER_COPY } from "@/core/serverCopy";

import { endOf } from "./ends";

import type { FLBewerbungFormResponse } from "@/core/generated/client/types";

vi.mock("server-only", () => ({}));

const WORDS = SERVER_COPY.bewerbung.end;

const window = (over: Partial<NonNullable<FLBewerbungFormResponse["window"]>> = {}) => ({
  start: "2026-05-01",
  end: "2026-07-31",
  running: false,
  saison_ended: false,
  ...over,
});

// A school told the wrong end goes away for the wrong reason, and no other page says which it was.
describe("which end stands in the form's place", () => {
  it("shows no end while the server says the window runs, whatever the day here", () => {
    expect(endOf(window({ running: true }), "2099-01-01")).toBeNull();
  });

  it("says the season is over ahead of any date, an ended season never reopening", () => {
    expect(endOf(window({ saison_ended: true }), "2026-04-30")?.title).toBe(WORDS.over);
  });

  it("names the opening day before the window", () => {
    expect(endOf(window(), "2026-04-30")?.title).toBe(WORDS.opensOn("2026-05-01"));
  });

  it("says closed inside the dates, as a pause, and past them", () => {
    expect(endOf(window(), "2026-06-01")?.title).toBe(WORDS.closed);
    expect(endOf(window(), "2026-08-01")?.title).toBe(WORDS.closed);
  });

  it("says a season storing no window has no application", () => {
    expect(endOf(null, "2026-06-01")?.title).toBe(WORDS.none);
  });
});
