import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bestaetigteEmpfaenger } from "./empfaenger.ts";

import type { FLKontaktperson, FLSaisonTeamKontakte } from "@/features/teams/schemas.ts";

const person = (vorname: string, email: string, bestaetigtAm: string | null): FLKontaktperson => ({
  vorname: vorname,
  nachname: "Beispiel",
  email: email,
  telefon: "069 1234567",
  geburtsdatum: bestaetigtAm === null ? null : "1990-04-01",
  einwilligung: {
    umfang: "kontaktdaten",
    erfasst_von: bestaetigtAm === null ? "administrativ" : "person",
    text_version: "2026-08-01",
    datum: "2026-08-02",
    bestaetigt_am: bestaetigtAm,
  },
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

    assert.deepEqual(bestaetigteEmpfaenger(kontakte), [{ rolle: "ansprechperson", vorname: "Erika", email: "erika@beispiel.de" }]);
  });

  /* One person, one message: a seat pair on one mailbox would otherwise be written to twice, and the
     second copy carries the same link the first did. */
  it("answers one row per mailbox, named for the first seat in Trainer, Ansprechperson, Stellvertretung order", () => {
    const kontakte = block({
      ansprechperson: person("Erika", "erika@beispiel.de", "2026-08-20"),
      stellvertretung: person("Erika", "erika@beispiel.de", "2026-08-20"),
      trainer: person("Jonas", "jonas@beispiel.de", "2026-08-21"),
    });

    assert.deepEqual(bestaetigteEmpfaenger(kontakte), [
      { rolle: "trainer", vorname: "Jonas", email: "jonas@beispiel.de" },
      { rolle: "ansprechperson", vorname: "Erika", email: "erika@beispiel.de" },
    ]);
  });

  /* The local part is compared byte for byte, as the endpoint compares it: two people whose
     mailboxes differ only in case are two people, and folding the address would cost one of them
     the message. */
  it("keeps two seats apart where only the local part's case differs", () => {
    const kontakte = block({
      trainer: person("Jonas", "J.Beispiel@beispiel.de", "2026-08-21"),
      ansprechperson: person("Erika", "j.beispiel@beispiel.de", "2026-08-20"),
    });

    assert.deepEqual(bestaetigteEmpfaenger(kontakte), [
      { rolle: "trainer", vorname: "Jonas", email: "J.Beispiel@beispiel.de" },
      { rolle: "ansprechperson", vorname: "Erika", email: "j.beispiel@beispiel.de" },
    ]);
  });

  /* A domain is case-insensitive, so the same person typed twice is one mailbox and one message —
     and the address answered is the one that was stored, not the folded key. */
  it("answers one row where only the domain's case differs", () => {
    const kontakte = block({
      trainer: person("Jonas", "jonas@Beispiel.DE", "2026-08-21"),
      stellvertretung: person("Jonas", "jonas@beispiel.de", "2026-08-21"),
    });

    assert.deepEqual(bestaetigteEmpfaenger(kontakte), [{ rolle: "trainer", vorname: "Jonas", email: "jonas@Beispiel.DE" }]);
  });

  /* An erasure empties the slot naming the person who asked for it, and a confirmed seat whose
     address is gone would otherwise be handed to the fan-out as an empty recipient. */
  it("answers nobody for a block with no seats and none for an emptied address", () => {
    assert.deepEqual(bestaetigteEmpfaenger(null), []);
    assert.deepEqual(bestaetigteEmpfaenger(block({})), []);
    assert.deepEqual(bestaetigteEmpfaenger(block({ trainer: person("Jonas", "", "2026-08-21") })), []);
  });
});
