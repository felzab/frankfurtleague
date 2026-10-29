import { refusalCodes, refused } from "@/test-support/refusals.ts";
import { assert, describe, expect, it } from "vitest";

import {
  BEWERBUNG_NICHT_MEHR_OFFEN,
  EINTRAG_WEG,
  EINWILLIGUNG_WAHL_SAETZE,
  mapBewerbungEinwilligungRefusal,
  mapEigeneEinwilligungRefusal,
  mapRegistrierungEinwilligungRefusal,
  medienZuJung,
  NUR_WIDERRUF,
  REGISTRIERUNG_NICHT_MEHR_OFFEN,
  SEITE_VERALTET,
  ZUSTIMMEN_MORGEN,
} from "./einwilligung.ts";

/** A media floor no record is served today, so a sentence naming it took the floor it was handed. */
const MEDIEN_ALTER = 21;

/** Each consent mapper, an operation it serves and the sentence its lost record takes. */
const MAPPERS = [
  [
    "a pupil's, a referee's or a season's seats",
    "PATCH /spieler/selbst/einwilligung",
    (error: unknown) => mapEigeneEinwilligungRefusal(error, MEDIEN_ALTER),
    EINTRAG_WEG,
  ],
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
 * The code set the three mappers share. A withdraw-only write publishes no ceiling, which refuses a
 * grant its page never sends, so each code is asked of the writes publishing it alone.
 */
const GETEILT = [
  ["REQ-EINWILLIGUNG-001", "a stale wording", SEITE_VERALTET],
  ["REQ-EINWILLIGUNG-003", "a stale choice", SEITE_VERALTET],
  // The record is the person's and only the grant was refused, so never the lost record's sentence.
  ["REQ-EINWILLIGUNG-004", "a grant on a record taking a withdrawal alone", NUR_WIDERRUF],
  // Ahead of the person spine's ceiling sentence, which says nothing of a withdrawal, never counted here.
  ["REQ-DROSSELUNG-001", "a grant past the day's ceiling", ZUSTIMMEN_MORGEN],
] as const;

/**
 * The consent codes each write's service raises, the ceiling's protocol family included: a withdraw-only write
 * counts no grant against the day's ceiling and takes no media choice.
 */
const GRANT_CODES = refusalCodes(
  "REQ-EINWILLIGUNG-001",
  "REQ-EINWILLIGUNG-002",
  "REQ-EINWILLIGUNG-003",
  "REQ-EINWILLIGUNG-004",
  "REQ-DROSSELUNG-001",
);
const WITHDRAW_CODES = refusalCodes("REQ-EINWILLIGUNG-001", "REQ-EINWILLIGUNG-003", "REQ-EINWILLIGUNG-004");
const CODES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["PATCH /spieler/selbst/einwilligung", new Set(GRANT_CODES)],
  ["PATCH /bewerbungen/{bewerbung_id}/person/einwilligung", new Set(WITHDRAW_CODES)],
  ["PATCH /registrierungen/selbst/{registrierung_id}/einwilligung", new Set(WITHDRAW_CODES)],
  ["PATCH /schiedsrichter/selbst/{schiedsrichter_id}/einwilligung", new Set(GRANT_CODES)],
  ["PATCH /teams/{team_id}/saisons/{saison_id}/person/einwilligung", new Set(GRANT_CODES)],
]);
const codesOf = (operation: string): ReadonlySet<string> => CODES.get(operation) ?? assert.fail(`no codes stated for ${operation}`);

/** The consent PATCHes the eigene mapper serves beside the pupil's. */
const EIGENE_WEITERE = [
  "PATCH /schiedsrichter/selbst/{schiedsrichter_id}/einwilligung",
  "PATCH /teams/{team_id}/saisons/{saison_id}/person/einwilligung",
];

describe("the consent writes' mappers", () => {
  /* A code the mappers word that no consent write raises is a sentence nobody can be shown: read off
     the mappers' own set, never this suite's table. */
  it("words no shared code that no consent write raises", () => {
    const veroeffentlicht = new Set(
      [...MAPPERS.map(([, operation]) => operation), ...EIGENE_WEITERE].flatMap((operation) => [...codesOf(operation)]),
    );
    expect(Object.keys(EINWILLIGUNG_WAHL_SAETZE).filter((code) => !veroeffentlicht.has(code))).toStrictEqual([]);
  });

  /* The table below asks each worded code's sentence, so a code the mappers gain is asked too. */
  it("asks every code the mappers share", () => {
    expect(GETEILT.map(([code]) => code).sort()).toStrictEqual(Object.keys(EINWILLIGUNG_WAHL_SAETZE).sort());
  });

  for (const [art, operation, mapper, eintragWeg] of MAPPERS) {
    const veroeffentlicht = codesOf(operation);
    for (const [code, ursache, worte] of GETEILT.filter(([code]) => veroeffentlicht.has(code))) {
      /* Read by its code at any status: a rule the backend moves to another status keeps its words. */
      it(`words ${ursache} on ${art}, at any status`, () => {
        for (const status of [403, 409, 422, 429]) expect(mapper(refused(code, status))).toStrictEqual({ error: worte });
      });
    }

    /* The shared answer to a lost Funktion names a team, which these records have none of. */
    it(`words ${art} no longer the person's by that record`, () => {
      expect(mapper(refused("REQ-FUNKTION-001", 403))).toStrictEqual({ error: eintragWeg });
    });

    /* A barred address is the person spine's, which words it once for every person write; answering
       it here would word it twice. */
    it(`leaves every other refusal on ${art}, and a failure that is no refusal, to the spine`, () => {
      expect(mapper(refused("REQ-AUTH-008", 403))).toBe(null);
      expect(mapper(new Error("network"))).toBe(null);
    });
  }

  /* The floor is the record's, handed to the mapper by its write: a number typed into the sentence would
     name another age the day the backend's rule moves. Only the three writes taking a grant publish it. */
  for (const operation of ["PATCH /spieler/selbst/einwilligung", ...EIGENE_WEITERE]) {
    it(`names the media floor its record was served on ${operation}, and asks for a reload, at any status`, () => {
      for (const status of [403, 409, 422, 429]) {
        expect(mapEigeneEinwilligungRefusal(refused("REQ-EINWILLIGUNG-002", status), MEDIEN_ALTER)).toStrictEqual({
          error: "Fotos, Videos und Interviews kannst Du erst ab 21 Jahren erlauben. Lade die Seite neu.",
        });
      }
    });
  }

  /* The words themselves, through the mapper: the table above takes the sentence from the module it tests. */
  it("tells a pupil whose registration closed to reload, in sentences of their own", () => {
    expect(mapRegistrierungEinwilligungRefusal(refused("REQ-FUNKTION-001", 403))).toStrictEqual({
      error: "Diese Registrierung ist nicht mehr offen. Lade die Seite neu. Dort steht, was jetzt für Dich gilt.",
    });
  });

  it("gives each cause its own sentence", () => {
    const saetze = [EINTRAG_WEG, BEWERBUNG_NICHT_MEHR_OFFEN, REGISTRIERUNG_NICHT_MEHR_OFFEN, NUR_WIDERRUF, medienZuJung(MEDIEN_ALTER)];
    expect(new Set(saetze).size).toBe(saetze.length);
  });
});
