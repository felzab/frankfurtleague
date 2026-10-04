import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MEDIEN_MIN_ALTER } from "@/features/registrierungen/constants.ts";
import { refusedOn } from "@/shared/testing/publishedRefusals.ts";

import {
  EINTRAG_WEG,
  mapEigeneEinwilligungRefusal,
  mapEinwilligungWahlRefusal,
  MEDIEN_ZU_JUNG,
  SEITE_VERALTET,
  ZUSTIMMEN_MORGEN,
} from "./einwilligung.ts";

/** One of the four writes the mapper serves; the status is stated, so each code is put at two. */
const PUPIL_WRITE = "PATCH /spieler/selbst/einwilligung";

describe("the consent writes' one mapper", () => {
  /* Read by its code at any status: a rule the backend moves to another status keeps its words. */
  for (const status of [409, 422]) {
    it(`words a stale wording, a stale choice and a media consent below the floor at ${String(status)}`, () => {
      assert.deepEqual(mapEinwilligungWahlRefusal(refusedOn(PUPIL_WRITE, "REQ-EINWILLIGUNG-001", status)), { error: SEITE_VERALTET });
      assert.deepEqual(mapEinwilligungWahlRefusal(refusedOn(PUPIL_WRITE, "REQ-EINWILLIGUNG-003", status)), { error: SEITE_VERALTET });
      assert.deepEqual(mapEinwilligungWahlRefusal(refusedOn(PUPIL_WRITE, "REQ-EINWILLIGUNG-002", status)), { error: MEDIEN_ZU_JUNG });
    });
  }

  /* Ahead of the person spine's ceiling sentence, which promises nothing about a withdrawal: here a
     withdrawal is never counted, and the page says so. */
  for (const status of [429, 409]) {
    it(`words a grant past the day's ceiling at ${String(status)}, for every consent write`, () => {
      const refusal = refusedOn(PUPIL_WRITE, "REQ-DROSSELUNG-001", status);
      assert.deepEqual(mapEinwilligungWahlRefusal(refusal), { error: ZUSTIMMEN_MORGEN });
      assert.deepEqual(mapEigeneEinwilligungRefusal(refusal), { error: ZUSTIMMEN_MORGEN });
    });
  }

  it("names the floor the backend refuses at", () => {
    assert.ok(MEDIEN_ZU_JUNG.includes(`ab ${String(MEDIEN_MIN_ALTER)} Jahren`), MEDIEN_ZU_JUNG);
  });

  /* A lost seat and a barred address are the person spine's, which words them once for every
     person write; answering them here would word them twice. */
  it("leaves every other refusal, and a failure that is no refusal, to the spine", () => {
    assert.equal(mapEinwilligungWahlRefusal(refusedOn(PUPIL_WRITE, "REQ-FUNKTION-001", 403)), null);
    assert.equal(mapEinwilligungWahlRefusal(refusedOn(PUPIL_WRITE, "REQ-AUTH-008", 403)), null);
    assert.equal(mapEinwilligungWahlRefusal(new Error("network")), null);
  });

  /* The shared answer to a lost Funktion names a team, which a pupil's or a referee's record has none of. */
  it("words a pupil's or a referee's lost record itself, and the rest as the shared mapper does", () => {
    assert.deepEqual(mapEigeneEinwilligungRefusal(refusedOn(PUPIL_WRITE, "REQ-FUNKTION-001", 403)), { error: EINTRAG_WEG });
    assert.deepEqual(mapEigeneEinwilligungRefusal(refusedOn(PUPIL_WRITE, "REQ-EINWILLIGUNG-001", 409)), { error: SEITE_VERALTET });
    assert.equal(mapEigeneEinwilligungRefusal(refusedOn(PUPIL_WRITE, "REQ-AUTH-008", 403)), null);
  });
});
