import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ERASURE_ANLASS_MAX_LENGTH } from "./constants.ts";
import { FLAbmeldungPayloadSchema, FLErasureAnsichtPayloadSchema, FLErasurePayloadSchema } from "./schemas.ts";

const ANLASS = "E-Mail vom 12.10.2026, Betreff Löschung meiner Daten";

/** The three payloads keyed on an address, each judged on the address alone. */
const LOOKUPS = [
  ["the reveal", (email: unknown) => FLErasureAnsichtPayloadSchema.safeParse({ email: email }).success],
  ["the erasure", (email: unknown) => FLErasurePayloadSchema.safeParse({ email: email, anlass: ANLASS }).success],
  ["the sign-out", (email: unknown) => FLAbmeldungPayloadSchema.safeParse({ email: email }).success],
] as const;

describe("the address the erasure, its reveal and the sign-out look up", () => {
  /* The records an erasure removes are keyed on whatever a rule of their day stored; refusing that erases
     nobody (GDPR Art. 17, `docs/backend/spec.md :: I329`). The full-width at sign is built from its code point. */
  it("takes every address any rule stored, so the request can name any record", () => {
    const stored = [
      "käthe@example.de",
      "kaethe@käthe-schule.example",
      "a!b@example.de",
      "anna..mueller@schule.de",
      "erika@example",
      `erika${String.fromCharCode(0xff20)}x@example.de`,
    ];
    for (const [payload, takes] of LOOKUPS) {
      for (const email of stored) assert.equal(takes(email), true, `${payload} refused "${email}"`);
    }
  });

  /* The endpoints answer these with a REQ-VAL-001 whose mark names no rule, so the box has to say it first. */
  it("refuses what the API's lookup refuses, so the box carries the message", () => {
    for (const [payload, takes] of LOOKUPS) {
      for (const email of ["", "   ", "erika.example.de", `${"a".repeat(250)}@schule.de`]) {
        assert.equal(takes(email), false, `${payload} took "${email}"`);
      }
    }
  });
});

describe("the request the erasure answers", () => {
  const refused = (anlass: string): string | undefined =>
    FLErasurePayloadSchema.safeParse({ email: "ada@example.org", anlass: anlass }).error?.issues[0]?.message;

  it("takes a date and a subject", () => {
    assert.equal(refused(ANLASS), undefined);
  });

  /* Each a refusal the API makes too (`fl_backend/app/api/sperrliste/schemas.py :: ADDRESS_IN_FREE_TEXT` for the
     address): the log keeps the Anlass a year, past the redaction of anybody it names. */
  it("refuses a blank one, an over-long one, one of two lines and one holding an address, each in German", () => {
    assert.equal(refused("   "), "Bitte gib einen Anlass ein.");
    assert.equal(
      refused("a".repeat(ERASURE_ANLASS_MAX_LENGTH + 1)),
      `Der Anlass darf höchstens ${String(ERASURE_ANLASS_MAX_LENGTH)} Zeichen lang sein.`,
    );
    assert.equal(refused("E-Mail vom 12.10.2026\nBetreff Löschung"), "Der Anlass darf keine Zeilenumbrüche oder Steuerzeichen enthalten.");
    assert.equal(refused("E-Mail von ada@example.org vom 12.10.2026"), "Der Anlass darf keine E-Mail-Adresse enthalten.");
  });

  /* Measured as the API measures it, after the strip. */
  it("counts the bound on the trimmed request", () => {
    assert.equal(refused(` ${"a".repeat(ERASURE_ANLASS_MAX_LENGTH)} `), undefined);
  });
});
