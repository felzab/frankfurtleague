import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MEDIEN_MIN_ALTER } from "@/features/registrierungen/constants.ts";
import { refusedOn } from "@/shared/testing/publishedRefusals.ts";

import {
  BEWERBUNG_NICHT_MEHR_OFFEN,
  EINTRAG_WEG,
  mapBewerbungEinwilligungRefusal,
  mapEigeneEinwilligungRefusal,
  mapRegistrierungEinwilligungRefusal,
  MEDIEN_ZU_JUNG,
  NUR_WIDERRUF,
  REGISTRIERUNG_NICHT_MEHR_OFFEN,
  SEITE_VERALTET,
  ZUSTIMMEN_MORGEN,
} from "./einwilligung.ts";

/** Each consent mapper, an operation it serves and the sentence its lost record takes. */
const MAPPERS = [
  ["a pupil's, a referee's or a season's seats", "PATCH /spieler/selbst/einwilligung", mapEigeneEinwilligungRefusal, EINTRAG_WEG],
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
] as const;

describe("the consent writes' mappers", () => {
  for (const [art, operation, mapper, eintragWeg] of MAPPERS) {
    /* Read by its code at any status: a rule the backend moves to another status keeps its words. */
    for (const status of [409, 422]) {
      it(`words a stale wording, a stale choice and a media consent below the floor on ${art} at ${String(status)}`, () => {
        assert.deepEqual(mapper(refusedOn(operation, "REQ-EINWILLIGUNG-001", status)), { error: SEITE_VERALTET });
        assert.deepEqual(mapper(refusedOn(operation, "REQ-EINWILLIGUNG-003", status)), { error: SEITE_VERALTET });
        assert.deepEqual(mapper(refusedOn(operation, "REQ-EINWILLIGUNG-002", status)), { error: MEDIEN_ZU_JUNG });
      });
    }

    /* Ahead of the person spine's ceiling sentence, which promises nothing about a withdrawal: here a
       withdrawal is never counted, and the page says so. */
    for (const status of [429, 409]) {
      it(`words a grant past the day's ceiling on ${art} at ${String(status)}`, () => {
        assert.deepEqual(mapper(refusedOn(operation, "REQ-DROSSELUNG-001", status)), { error: ZUSTIMMEN_MORGEN });
      });
    }

    /* The record was found and is the person's: only the grant was refused, so the sentence says
       that, never that the record is gone. */
    it(`words a grant on ${art} that takes a withdrawal alone by that cause`, () => {
      assert.deepEqual(mapper(refusedOn(operation, "REQ-EINWILLIGUNG-004", 403)), { error: NUR_WIDERRUF });
    });

    /* The shared answer to a lost Funktion names a team, which these records have none of. */
    it(`words ${art} no longer the person's by that record`, () => {
      assert.deepEqual(mapper(refusedOn(operation, "REQ-FUNKTION-001", 403)), { error: eintragWeg });
    });

    /* A barred address is the person spine's, which words it once for every person write; answering
       it here would word it twice. */
    it(`leaves every other refusal on ${art}, and a failure that is no refusal, to the spine`, () => {
      assert.equal(mapper(refusedOn(operation, "REQ-AUTH-008", 403)), null);
      assert.equal(mapper(new Error("network")), null);
    });
  }

  it("names the floor the backend refuses at", () => {
    assert.ok(MEDIEN_ZU_JUNG.includes(`ab ${String(MEDIEN_MIN_ALTER)} Jahren`), MEDIEN_ZU_JUNG);
  });

  it("gives each record's lost-record sentence its own words, and none the withdraw-only one", () => {
    const saetze = [EINTRAG_WEG, BEWERBUNG_NICHT_MEHR_OFFEN, REGISTRIERUNG_NICHT_MEHR_OFFEN, NUR_WIDERRUF];
    assert.equal(new Set(saetze).size, saetze.length);
  });
});
