import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeAktionDatensatz, formatAktionZeitpunkt, labelForCollection } from "./utils.ts";

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

describe("describeAktionDatensatz", () => {
  it("names a single document by its id", () => {
    assert.deepEqual(describeAktionDatensatz({ document_id: "68c1f0a2b3c4d5e6f7a8b9c0", db_filter: null, modified_count: null }), {
      kind: "dokument",
      id: "68c1f0a2b3c4d5e6f7a8b9c0",
    });
  });

  it("carries a fan-out's filter beside its count", () => {
    assert.deepEqual(describeAktionDatensatz({ document_id: null, db_filter: { saison_id: "2026" }, modified_count: 12 }), {
      kind: "menge",
      filterPaare: [["saison_id", "2026"]],
      betroffen: 12,
    });
  });

  // Every Spielplan draw writes two of these, and the count is the whole of what the row has to say.
  it("keeps a bulk create's count, which carries no id and no filter", () => {
    assert.deepEqual(describeAktionDatensatz({ document_id: null, db_filter: null, modified_count: 42 }), {
      kind: "menge",
      filterPaare: [],
      betroffen: 42,
    });
  });

  it("reports nothing named only where the row names nothing", () => {
    assert.deepEqual(describeAktionDatensatz({ document_id: null, db_filter: null, modified_count: null }), { kind: "ohne" });
  });
});
