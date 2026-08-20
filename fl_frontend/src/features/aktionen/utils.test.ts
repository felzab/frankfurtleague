import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatAktionZeitpunkt, labelForCollection } from "./utils.ts";

describe("formatAktionZeitpunkt", () => {
  it("renders a stored UTC instant in German local time", () => {
    assert.deepEqual(formatAktionZeitpunkt("2026-08-20T14:23:05+00:00"), { datum: "20.08.2026", uhrzeit: "16:23" });
  });

  // The offset can carry the write into the next day, which is the whole reason the zone is pinned.
  it("applies the winter offset and the day it moves the instant to", () => {
    assert.deepEqual(formatAktionZeitpunkt("2026-01-05T23:30:00+00:00"), { datum: "06.01.2026", uhrzeit: "00:30" });
  });

  it("passes an unreadable value through instead of throwing", () => {
    assert.deepEqual(formatAktionZeitpunkt("irgendwann"), { datum: "irgendwann", uhrzeit: null });
  });
});

describe("labelForCollection", () => {
  it("names a junction collection in words", () => {
    assert.equal(labelForCollection("saison_teams"), "Team in Saison");
  });

  it("falls back to a name it does not know", () => {
    assert.equal(labelForCollection("pokale"), "pokale");
  });
});
