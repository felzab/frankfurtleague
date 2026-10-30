import { kenntnisnahme } from "@/test-support/kenntnisnahme.ts";
import { describe, expect, it } from "vitest";

import { bestaetigteEmpfaenger } from "./empfaenger.ts";

import type { FLKontaktperson, FLSaisonTeamKontakte } from "@/core/generated/client/types.ts";

const person = (vorname: string, email: string, bestaetigtAm: string | null): FLKontaktperson => ({
  vorname: vorname,
  nachname: "Beispiel",
  email: email,
  telefon: "069 1234567",
  geburtsdatum: bestaetigtAm === null ? null : "1990-04-01",
  einwilligung: kenntnisnahme({
    text_version: "2026-08-01",
    datum: "2026-08-02",
    bestaetigt_am: bestaetigtAm,
  }),
});

const block = (seats: Partial<FLSaisonTeamKontakte>): FLSaisonTeamKontakte => ({
  trainer: null,
  ansprechperson: null,
  stellvertretung: null,
  trainer_ist_zugleich: null,
  ...seats,
});

describe("who a team's invite is mailed to", () => {
  /* An address nobody has proven is one the league has only its own transcription of, and a
     registration link is a bearer credential. */
  it("passes over every seat whose own person has not confirmed", () => {
    const kontakte = block({
      ansprechperson: person("Erika", "erika@beispiel.de", "2026-08-20"),
      trainer: person("Jonas", "jonas@beispiel.de", null),
    });

    expect(bestaetigteEmpfaenger(kontakte)).toStrictEqual([{ rolle: "ansprechperson", vorname: "Erika", email: "erika@beispiel.de" }]);
  });

  /* One person, one message: a seat pair on one mailbox would otherwise be written to twice, and the
     second copy carries the same link the first did. */
  it("answers one row per mailbox, named for the first seat in Trainer, Ansprechperson, Stellvertretung order", () => {
    const kontakte = block({
      ansprechperson: person("Erika", "erika@beispiel.de", "2026-08-20"),
      stellvertretung: person("Erika", "erika@beispiel.de", "2026-08-20"),
      trainer: person("Jonas", "jonas@beispiel.de", "2026-08-21"),
    });

    expect(bestaetigteEmpfaenger(kontakte)).toStrictEqual([
      { rolle: "trainer", vorname: "Jonas", email: "jonas@beispiel.de" },
      { rolle: "ansprechperson", vorname: "Erika", email: "erika@beispiel.de" },
    ]);
  });

  /* An erasure empties the slot naming the person who asked for it, and a confirmed seat whose
     address is gone would otherwise be handed to the fan-out as an empty recipient. */
  it("answers nobody for a block with no seats and none for an emptied address", () => {
    expect(bestaetigteEmpfaenger(null)).toStrictEqual([]);
    expect(bestaetigteEmpfaenger(block({}))).toStrictEqual([]);
    expect(bestaetigteEmpfaenger(block({ trainer: person("Jonas", "", "2026-08-21") }))).toStrictEqual([]);
  });
});
