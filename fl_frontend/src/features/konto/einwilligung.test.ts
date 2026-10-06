import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MEDIEN_MIN_ALTER } from "@/features/registrierungen/constants.ts";
import { refusedOn } from "@/shared/testing/publishedRefusals.ts";

import {
  BEWERBUNG_NICHT_MEHR_OFFEN,
  EINTRAG_GEAENDERT,
  mapBewerbungEinwilligungRefusal,
  mapEigeneEinwilligungRefusal,
  mapEinwilligungWahlRefusal,
  mapRegistrierungEinwilligungRefusal,
  MEDIEN_ZU_JUNG,
  REGISTRIERUNG_NICHT_MEHR_OFFEN,
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

  /* The shared answer to a lost Funktion names a team, which these records have none of; and the code
     answers a refused grant there too, so neither cause alone is named. */
  it("words a record admitting a grant by both causes the code answers, and the rest as the shared mapper does", () => {
    assert.deepEqual(mapEigeneEinwilligungRefusal(refusedOn(PUPIL_WRITE, "REQ-FUNKTION-001", 403)), { error: EINTRAG_GEAENDERT });
    assert.deepEqual(mapEigeneEinwilligungRefusal(refusedOn(PUPIL_WRITE, "REQ-EINWILLIGUNG-001", 409)), { error: SEITE_VERALTET });
    assert.equal(mapEigeneEinwilligungRefusal(refusedOn(PUPIL_WRITE, "REQ-AUTH-008", 403)), null);
  });

  /* A withdraw-only record's page offers no grant, so the code there answers the record alone: not
     pending, its own sentence, whatever else the shared mapper words alike. */
  for (const [art, operation, mapper, words] of [
    [
      "a pending application's seats",
      "PATCH /bewerbungen/{bewerbung_id}/person/einwilligung",
      mapBewerbungEinwilligungRefusal,
      BEWERBUNG_NICHT_MEHR_OFFEN,
    ],
    [
      "a pending registration",
      "PATCH /registrierungen/selbst/{registrierung_id}/einwilligung",
      mapRegistrierungEinwilligungRefusal,
      REGISTRIERUNG_NICHT_MEHR_OFFEN,
    ],
  ] as const) {
    it(`words ${art} not pending any more by that record, and the rest as the shared mapper does`, () => {
      assert.deepEqual(mapper(refusedOn(operation, "REQ-FUNKTION-001", 403)), { error: words });
      assert.deepEqual(mapper(refusedOn(operation, "REQ-EINWILLIGUNG-003", 409)), { error: SEITE_VERALTET });
      assert.equal(mapper(refusedOn(operation, "REQ-AUTH-008", 403)), null);
    });
  }
});
