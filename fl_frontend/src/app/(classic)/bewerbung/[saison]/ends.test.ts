import { describe, expect, it, vi } from "vitest";

import { SERVER_COPY } from "@/core/serverCopy";

import { endOf } from "./ends";

vi.mock("server-only", () => ({}));

const WORDS = SERVER_COPY.bewerbung.end;

const START = "2026-05-01";

// A school told the wrong end goes away for the wrong reason, and no other page says which it was.
describe("which end stands in the form's place", () => {
  it("shows no end while the server says the window runs", () => {
    expect(endOf({ start: START, state: "running" })).toBeNull();
  });

  it("names the opening day of a window yet to open", () => {
    expect(endOf({ start: START, state: "upcoming" })?.title).toBe(WORDS.opensOn(START));
  });

  it("says nothing of opening on a closed window, a paused one before its start among them", () => {
    expect(endOf({ start: START, state: "closed" })?.title).toBe(WORDS.closed);
  });

  it("says the season is over", () => {
    expect(endOf({ start: START, state: "ended" })?.title).toBe(WORDS.over);
  });

  it("says a season storing no window has no application", () => {
    expect(endOf(null)?.title).toBe(WORDS.none);
  });
});
