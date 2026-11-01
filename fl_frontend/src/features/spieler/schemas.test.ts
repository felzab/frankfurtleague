import { describe, expect, it } from "vitest";

import { KONTAKT_NAME_MAX_LENGTH, KONTAKT_NAME_ZU_LANG } from "@/features/teams/constants.ts";

import { FLPatchSpielerPayloadSchema } from "./schemas.ts";

// An administrator's edit may not store a name the pupil's own registration would refuse, and says so
// in the sentence every form holding a name to that ceiling says.
describe("the ceiling a person edit holds each name to", () => {
  const names = { id: "0".repeat(24), vorname: "Max", nachname: "Mustermann", geburtsdatum: "2009-05-04" };

  for (const part of ["vorname", "nachname"] as const) {
    it(`refuses a ${part} one past the registration's ceiling, in that ceiling's words`, () => {
      const parsed = FLPatchSpielerPayloadSchema.safeParse({ ...names, [part]: "A".repeat(KONTAKT_NAME_MAX_LENGTH + 1) });

      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map(({ path, message }) => [path.join("."), message])).toStrictEqual([[part, KONTAKT_NAME_ZU_LANG]]);
    });

    it(`takes a ${part} at the ceiling`, () => {
      expect(FLPatchSpielerPayloadSchema.safeParse({ ...names, [part]: "A".repeat(KONTAKT_NAME_MAX_LENGTH) }).success).toBe(true);
    });
  }
});
