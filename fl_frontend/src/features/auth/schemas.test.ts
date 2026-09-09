import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SignInPayloadSchema } from "./schemas.ts";

describe("SignInPayloadSchema", () => {
  const refused = (email: unknown): boolean => !SignInPayloadSchema.safeParse({ email }).success;

  /* A session is reachable through this box alone, so an address refused here is one no administrator
     can ever sign in with: the refusal IS the lock-out, and `ALLOWED_ADMIN_EMAILS` has to hold the
     same set. */
  it("takes every address an allowlist entry can hold, umlauts and atext characters and all", () => {
    for (const email of ["käthe@schule.de", "erika@käthe-schule.example", "a!b@schule.de"]) {
      assert.equal(refused(email), false, `expected "${email}" to be accepted`);
    }
  });

  /* Auth.js normalises and mails whatever passes here, and the action answers both outcomes with the
     same sentence: an undeliverable address leaves the reader waiting on a link that never went. */
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
