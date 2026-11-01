import { describe, expect, it } from "vitest";

import {
  bewerbungenPostBewerbungBodySchuleOneShorthandRegExp,
  teamsPatchTeamBodyShorthandRegExp,
  teamsPostTeamBodyShorthandRegExp,
} from "@/core/generated/zod/inputs.ts";

import { KUERZEL_LAENGE } from "./constants.ts";

/* The controls cannot import the generated module, which is server-only, so the length they cap a code at is
   held here to the pattern every write of a code publishes. The pattern is asked what it accepts rather than
   compared as text: the request side also admits the padding and the case the backend folds on arrival. */
describe("the club code's length", () => {
  it("is the length every published code pattern takes", () => {
    for (const pattern of [
      teamsPostTeamBodyShorthandRegExp,
      teamsPatchTeamBodyShorthandRegExp,
      bewerbungenPostBewerbungBodySchuleOneShorthandRegExp,
    ]) {
      expect(pattern.test("A".repeat(KUERZEL_LAENGE))).toBe(true);
      expect(pattern.test("A".repeat(KUERZEL_LAENGE - 1))).toBe(false);
      expect(pattern.test("A".repeat(KUERZEL_LAENGE + 1))).toBe(false);
    }
  });
});
