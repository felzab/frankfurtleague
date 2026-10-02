import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HOLDS_NOTHING } from "./authDoubles.ts";
import { NO_RECORDS, person, SITZ, sitz } from "./subjectFixtures.ts";

describe("the subjects every suite shares", () => {
  it("throws at a write into a shared record, list or seat", () => {
    for (const [what, write] of [
      ["the empty records' seats", () => (NO_RECORDS.sitze as unknown[]).push(SITZ)],
      ["the lookup answer's pupils", () => (HOLDS_NOTHING.spieler as unknown[]).push({ spieler_id: "b".repeat(24) })],
      ["the lookup answer's ban", () => ((HOLDS_NOTHING as { gesperrt: boolean }).gesperrt = true)],
      ["the shared seat", () => ((SITZ as { saison_status: string }).saison_status = "past")],
      ["a built person's seat list", () => (person().subjekt.sitze as unknown[]).push(SITZ)],
    ] as const) {
      assert.throws(write, TypeError, `${what} took the write`);
    }
  });

  /* What a case builds is its own: only what every case shares is frozen. */
  it("hands each case a seat and a person whose own fields it may write", () => {
    const seat = sitz();
    const built = person({ sitze: [seat] });
    seat.rolle = "trainer";
    (built.subjekt.sitze as unknown[]).push(sitz());

    assert.equal(SITZ.rolle, "ansprechperson");
    assert.equal(built.subjekt.sitze.length, 2);
  });
});
