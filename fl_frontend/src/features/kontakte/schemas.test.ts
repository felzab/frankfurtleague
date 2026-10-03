import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FLKontaktErasurePayloadSchema, FLPatchSaisonTeamKontaktePayloadSchema } from "./schemas.ts";

describe("FLKontaktErasurePayloadSchema", () => {
  const refused = (email: unknown): boolean => !FLKontaktErasurePayloadSchema.safeParse({ email }).success;

  /* The rows an erasure clears are keyed on whatever a rule of its day stored; refusing that erases
     nobody (GDPR Art. 17). The full-width at sign is built from its code point. */
  it("takes every address any rule stored, so an erasure can name any seat", () => {
    const stored = [
      "käthe@example.de",
      "kaethe@käthe-schule.example",
      "a!b@example.de",
      "anna..mueller@schule.de",
      "erika@example",
      `erika${String.fromCharCode(0xff20)}x@example.de`,
    ];
    for (const email of stored) {
      assert.equal(refused(email), false, `expected "${email}" to be accepted`);
    }
  });

  /* The endpoint answers these with a REQ-VAL-001 whose mark names no rule, and this payload is typed
     into a danger panel, where the box has to say what is wrong with the address it holds. */
  it("refuses what the API's lookup refuses, so the box carries the message", () => {
    for (const email of ["", "   ", "erika.example.de", `${"a".repeat(250)}@schule.de`]) {
      assert.equal(refused(email), true, `expected "${email}" to be rejected`);
    }
  });
});

/* The application's two rules on the season row's write, mirroring the backend's 422 so a refusal lands
   on a box: the paths are what the editor's fields are named by. */
describe("FLPatchSaisonTeamKontaktePayloadSchema's people", () => {
  const sitz = (vorname: string, email: string, telefon: string) => ({
    vorname,
    nachname: "Meier",
    email,
    telefon,
    einwilligung: { umfang: "kontaktdaten" as const, text_version: "1", datum: "2026-10-03" },
  });
  const ANNA = sitz("Anna", "anna@schule.example", "069 501");
  const BERND = sitz("Bernd", "bernd@schule.example", "069 502");
  const payload = (kontakte: Record<string, unknown>) => ({
    team_id: "507f1f77bcf86cd799439011",
    saison_id: "2627",
    kontakte_stand: "9f2c",
    kontakte: { trainer: null, ansprechperson: null, stellvertretung: null, trainer_ist_zugleich: null, ...kontakte },
  });
  const refusedPaths = (kontakte: Record<string, unknown>): string[] =>
    (FLPatchSaisonTeamKontaktePayloadSchema.safeParse(payload(kontakte)).error?.issues ?? []).map((issue) => issue.path.join("."));

  it("refuses a second seat sharing a person's address or number, on that seat's box", () => {
    assert.deepEqual(refusedPaths({ ansprechperson: ANNA, stellvertretung: { ...BERND, email: "Anna@Schule.Example" } }), [
      "kontakte.stellvertretung.email",
    ]);
    assert.deepEqual(refusedPaths({ ansprechperson: ANNA, trainer: { ...BERND, telefon: "+49 69 501" } }), ["kontakte.trainer.telefon"]);
  });

  /* An erasure leaves a seat empty, and an empty seat holds nobody two people could be. */
  it("takes empty seats, and compares only the people the block holds", () => {
    assert.deepEqual(refusedPaths({ ansprechperson: ANNA }), []);
    assert.deepEqual(refusedPaths({ ansprechperson: ANNA, stellvertretung: BERND }), []);
  });

  /* The paired Trainer IS the seat's person, so sharing everything is the point, and differing is a drift. */
  it("compares a paired Trainer as one person with the seat it holds", () => {
    assert.deepEqual(refusedPaths({ ansprechperson: ANNA, trainer: ANNA, trainer_ist_zugleich: "ansprechperson" }), []);
    assert.deepEqual(refusedPaths({ ansprechperson: ANNA, trainer: { ...ANNA, vorname: "Anne" }, trainer_ist_zugleich: "ansprechperson" }), [
      "kontakte.ansprechperson.vorname",
    ]);
  });
});
