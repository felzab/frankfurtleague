import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FLKontaktErasurePayloadSchema } from "./schemas.ts";

describe("FLKontaktErasurePayloadSchema", () => {
  const refused = (email: unknown): boolean => !FLKontaktErasurePayloadSchema.safeParse({ email }).success;

  /* The address IS the request, and the rows it would clear are keyed on the value `EmailStr` stored.
     A rule refusing what that stored erases nobody, and the person who asked stays in both collections. */
  it("takes every address the API stores, so an erasure can name any seat", () => {
    for (const email of ["käthe@example.de", "kaethe@käthe-schule.example", "a!b@example.de"]) {
      assert.equal(refused(email), false, `expected "${email}" to be accepted`);
    }
  });

  /* The endpoint answers a malformed address with a bare REQ-VAL-001 naming no field, and this payload
     is typed into a danger panel, where an unmarked box reads as a deletion that ran. */
  it("refuses an address the API would refuse, so the box carries the message", () => {
    for (const email of ["erika@", "erika@ab-.de", "erika@example", ""]) {
      assert.equal(refused(email), true, `expected "${email}" to be rejected`);
    }
  });
});
