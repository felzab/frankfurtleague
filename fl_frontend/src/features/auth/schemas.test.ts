import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SignInPayloadSchema } from "./schemas.ts";

describe("SignInPayloadSchema", () => {
  const refused = (email: unknown): boolean => !SignInPayloadSchema.safeParse({ email }).success;

  /* A session is reachable through this box alone, so an address refused here is one no administrator
     can ever sign in with: the refusal IS the lock-out, and the grant form takes no address beyond it. */
  it("takes every address a grant can be made to, umlaut domains and atext characters and all", () => {
    for (const email of ["erika@käthe-schule.example", "a!b@schule.de"]) {
      assert.equal(refused(email), false, `expected "${email}" to be accepted`);
    }
  });

  /* Whatever passes here is folded and mailed, and the action answers both outcomes with the same
     sentence: an undeliverable address leaves the reader waiting on a code that never went. */
  it("refuses an address no mailbox can be reached at", () => {
    for (const email of ["erika@ab-.de", "erika@schule", "erika@", "", "erika@@schule.de", "Erika <erika@schule.de>"]) {
      assert.equal(refused(email), true, `expected "${email}" to be rejected`);
    }
  });

  it("carries one German sentence for a malformed address", () => {
    assert.deepEqual(
      SignInPayloadSchema.safeParse({ email: "erika@" }).error?.issues.map((issue) => issue.message),
      ["Bitte gib eine gültige E-Mail-Adresse ein."],
    );
  });
});
