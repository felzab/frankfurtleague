import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { membershipAnswer } from "./membershipFixtures.ts";

/* Reached with `await import`, for `selbstFixtures.test.ts`'s reason: a module under `shared` may not name a slice. */
const { FLTeamMembershipSchema } = await import("@/features/teams/schemas.ts");

describe("the season membership every suite answering the clubs' read starts from", () => {
  /* Both directions, because zod strips an unknown key in silence: a field the read gains and the
     fixture lacks fails the parse in every suite at once, which reads as a read nobody answered. */
  it("spells exactly the fields the membership mirror declares, and parses", () => {
    assert.deepEqual(Object.keys(membershipAnswer()).sort(), Object.keys(FLTeamMembershipSchema.shape).sort());
    assert.doesNotThrow(() => FLTeamMembershipSchema.parse(membershipAnswer()));
  });

  it("hands each suite its own copy, so a case's change never reaches the next case", () => {
    assert.notEqual(membershipAnswer(), membershipAnswer());
  });
});
