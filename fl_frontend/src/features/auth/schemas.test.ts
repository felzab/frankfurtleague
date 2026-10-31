import { describe, expect, it } from "vitest";

import { SignInPayloadSchema } from "./schemas.ts";

describe("SignInPayloadSchema", () => {
  const refused = (email: unknown): boolean => !SignInPayloadSchema.safeParse({ email }).success;

  /* A session is reachable through this box alone, so an address refused here is one no administrator
     can ever sign in with: the refusal IS the lock-out, and the grant form takes no address beyond it. */
  it("takes every address a grant can be made to, umlaut domains and atext characters and all", () => {
    for (const email of ["erika@käthe-schule.example", "a!b@schule.de"]) {
      expect(refused(email), `expected "${email}" to be accepted`).toBe(false);
    }
  });

  /* Whatever passes here is folded and mailed, and the action answers both outcomes with the same
     sentence: an undeliverable address leaves the reader waiting on a code that never went. */
  it("refuses an address no mailbox can be reached at", () => {
    for (const email of ["erika@ab-.de", "erika@schule", "erika@", "", "erika@@schule.de", "Erika <erika@schule.de>"]) {
      expect(refused(email), `expected "${email}" to be rejected`).toBe(true);
    }
  });

  /* A message of the schema's own is past the action's map, which places none, so the box would answer the
     unexpected line (`fl_frontend/src/core/action.ts :: parsed`). */
  it("words no refusal itself, leaving each to the map", () => {
    for (const email of [undefined, "", "erika@", "jürgen@schule.de", `${"a".repeat(260)}@schule.de`]) {
      const issues = SignInPayloadSchema.safeParse({ email }, { error: () => "the map's" }).error?.issues ?? [];
      expect(issues.length, `expected "${String(email)}" to be refused`).toBeGreaterThan(0);
      expect(
        issues.map((issue) => issue.message),
        `expected "${String(email)}" to be worded by the map`,
      ).toStrictEqual(issues.map(() => "the map's"));
    }
  });
});
