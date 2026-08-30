import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AKTION_HERKUNFT_LABELS, AKTOR_HERKUNFT } from "./constants.ts";
import { FLAktorSchema } from "./schemas.ts";
import { describeAktionDatensatz, formatAktionZeitpunkt, herkunftOfAktor, labelForCollection } from "./utils.ts";

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

/** Every kind the read model accepts, read off the mirror so a kind added there reaches the cases below. */
const AKTOR_KINDS = FLAktorSchema.shape.kind.options;

describe("herkunftOfAktor", () => {
  /* First: a mirror the cut no longer finds would leave every sweep below iterating nothing and passing. */
  it("reads the kinds off the mirror at all", () => {
    assert.deepEqual([...AKTOR_KINDS].sort(), ["admin_session", "public", "system"]);
  });

  /* The binary this replaced filed anything that was not `system` under the signed-in people. A kind
     nobody places would render as a person named by a sentinel and filter as one. */
  it("files every kind the read model accepts under a labelled origin", () => {
    for (const kind of AKTOR_KINDS) {
      const herkunft = herkunftOfAktor({ kind: kind, email: "SENTINEL" });

      assert.equal(herkunft, AKTOR_HERKUNFT[kind], `\`${kind}\` is read as something other than the origin it is filed under`);
      assert.ok(AKTION_HERKUNFT_LABELS[herkunft], `\`${kind}\` is filed under \`${herkunft}\`, which nothing names`);
    }
  });

  /* Its own value and not the people's: nobody signed in for a public submission, and nobody is named
     by the `PUBLIC` its `email` holds. */
  it("keeps a public submission off both of the origins it is not", () => {
    assert.equal(herkunftOfAktor({ kind: "public", email: "PUBLIC" }), "public");
    assert.notEqual(herkunftOfAktor({ kind: "public", email: "PUBLIC" }), herkunftOfAktor({ kind: "admin_session", email: "a@b.de" }));
    assert.notEqual(herkunftOfAktor({ kind: "public", email: "PUBLIC" }), herkunftOfAktor({ kind: "system", email: "SYSTEM" }));
  });

  /* An origin is a category and a label is what a reader sees, so two origins sharing one wording would
     leave the filter offering the same word twice. */
  it("names each origin in its own words", () => {
    const labels = Object.values(AKTION_HERKUNFT_LABELS);

    assert.equal(new Set(labels).size, labels.length, "two origins are offered under one wording");
    for (const label of labels) assert.ok(!/^[A-Z]+$/.test(label), `\`${label}\` is a stored sentinel rather than a wording`);
  });
});
