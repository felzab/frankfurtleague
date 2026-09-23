import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FLKontaktErasurePayloadSchema } from "./schemas.ts";

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

  /* The endpoint answers these with a bare REQ-VAL-001 naming no field, and this payload is typed into
     a danger panel, where an unmarked box reads as a deletion that ran. */
  it("refuses what the API's lookup refuses, so the box carries the message", () => {
    for (const email of ["", "   ", "erika.example.de", `${"a".repeat(250)}@schule.de`]) {
      assert.equal(refused(email), true, `expected "${email}" to be rejected`);
    }
  });
});
