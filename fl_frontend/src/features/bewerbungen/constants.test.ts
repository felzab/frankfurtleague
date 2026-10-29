import { describe, expect, it } from "vitest";

import {
  bewerbungenPostBewerbungBodySchuleOneShorthandRegExp,
  teamsPatchTeamBodyShorthandRegExp,
  teamsPostTeamBodyShorthandRegExp,
} from "@/core/generated/zod/inputs.ts";

import { KUERZEL_LAENGE } from "./constants.ts";

/* The controls cannot import the generated module, which is server-only, so the length they cap a code at is
   held here to the pattern every write of a code publishes. */
describe("the club code's length", () => {
  it("is the length every published code pattern takes", () => {
    for (const pattern of [
      teamsPostTeamBodyShorthandRegExp,
      teamsPatchTeamBodyShorthandRegExp,
      bewerbungenPostBewerbungBodySchuleOneShorthandRegExp,
    ]) {
      expect(pattern.source).toBe(`^[A-Z]{${String(KUERZEL_LAENGE)}}$`);
    }
  });
});
