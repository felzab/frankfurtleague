import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { publishedOperations } from "@/core/openapiDocument.ts";
import { refusedOn } from "@/shared/testing/publishedRefusals.ts";

import {
  BEWERBUNG_NICHT_MEHR_OFFEN,
  EINTRAG_WEG,
  EINWILLIGUNG_WAHL_SAETZE,
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

/**
 * The code set the three mappers share. A withdraw-only write publishes no media floor and no ceiling,
 * both refusing a grant its page never sends, so each code is asked of the writes publishing it alone.
 */
const GETEILT = [
  ["REQ-EINWILLIGUNG-001", "a stale wording", SEITE_VERALTET],
  ["REQ-EINWILLIGUNG-003", "a stale choice", SEITE_VERALTET],
  ["REQ-EINWILLIGUNG-002", "a media consent below the floor", MEDIEN_ZU_JUNG],
  // The record is the person's and only the grant was refused, so never the lost record's sentence.
  ["REQ-EINWILLIGUNG-004", "a grant on a record taking a withdrawal alone", NUR_WIDERRUF],
  // Ahead of the person spine's ceiling sentence, which says nothing of a withdrawal, never counted here.
  ["REQ-DROSSELUNG-001", "a grant past the day's ceiling", ZUSTIMMEN_MORGEN],
] as const;

/** Every code each operation publishes, the ceiling's protocol family included, which `publishedRefusals` leaves out. */
const CODES = new Map(publishedOperations().map(({ operation, answers }) => [operation, new Set(answers.map(({ code }) => code))]));
const codesOf = (operation: string): ReadonlySet<string> => CODES.get(operation) ?? assert.fail(`the document publishes no ${operation}`);

/** The consent PATCHes the eigene mapper serves beside the pupil's. */
const EIGENE_WEITERE = [
  "PATCH /schiedsrichter/selbst/{schiedsrichter_id}/einwilligung",
  "PATCH /teams/{team_id}/saisons/{saison_id}/person/einwilligung",
];

describe("the consent writes' mappers", () => {
  /* A code the mappers word that no consent write publishes is a sentence nobody can be shown: read off
     the mappers' own set, never this suite's table. */
  it("words no shared code that no consent write publishes", () => {
    const veroeffentlicht = new Set(
      [...MAPPERS.map(([, operation]) => operation), ...EIGENE_WEITERE].flatMap((operation) => [...codesOf(operation)]),
    );
    assert.deepEqual(
      Object.keys(EINWILLIGUNG_WAHL_SAETZE).filter((code) => !veroeffentlicht.has(code)),
      [],
    );
  });

  /* The table below asks each worded code's sentence, so a code the mappers gain is asked too. */
  it("asks every code the mappers share", () => {
    assert.deepEqual(GETEILT.map(([code]) => code).sort(), Object.keys(EINWILLIGUNG_WAHL_SAETZE).sort());
  });

  for (const [art, operation, mapper, eintragWeg] of MAPPERS) {
    const veroeffentlicht = codesOf(operation);
    for (const [code, ursache, worte] of GETEILT.filter(([code]) => veroeffentlicht.has(code))) {
      /* Read by its code at any status: a rule the backend moves to another status keeps its words. */
      it(`words ${ursache} on ${art}, at any status`, () => {
        for (const status of [403, 409, 422, 429]) assert.deepEqual(mapper(refusedOn(operation, code, status)), { error: worte });
      });
    }

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

  /* The words themselves, through the mapper: the table above takes the sentence from the module it tests. */
  it("tells a pupil whose registration closed to reload, in sentences of their own", () => {
    assert.deepEqual(mapRegistrierungEinwilligungRefusal(refusedOn(MAPPERS[2][1], "REQ-FUNKTION-001", 403)), {
      error: "Diese Registrierung ist nicht mehr offen. Lade die Seite neu. Dort steht, was jetzt für Dich gilt.",
    });
  });

  it("gives each cause its own sentence", () => {
    const saetze = [EINTRAG_WEG, BEWERBUNG_NICHT_MEHR_OFFEN, REGISTRIERUNG_NICHT_MEHR_OFFEN, NUR_WIDERRUF, MEDIEN_ZU_JUNG];
    assert.equal(new Set(saetze).size, saetze.length);
  });
});
