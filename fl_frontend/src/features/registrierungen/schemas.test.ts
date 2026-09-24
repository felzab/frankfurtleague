import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { KONTAKT_NAME_MAX_LENGTH, KONTAKT_NAME_ZU_LANG } from "@/features/teams/constants.ts";

import { FLPostRegistrierungPayloadSchema } from "./schemas.ts";

// A pupil is told the sentence every other form holding a name to that ceiling says, never one of
// its own: two wordings of one refusal read as two rules.
describe("the ceiling a pupil's registration holds each name to", () => {
  const registrierung = {
    token: "a".repeat(43),
    vorname: "Lena",
    nachname: "Meier",
    email: "lena.meier@beispiel.de",
    position: null,
    nummer: null,
    stufe: null,
  };

  it("takes the registration this file varies", () => {
    // Without it a body refused for another field makes the refusal below pass for the wrong reason.
    assert.equal(FLPostRegistrierungPayloadSchema.safeParse(registrierung).success, true);
  });

  for (const part of ["vorname", "nachname"] as const) {
    it(`refuses a ${part} one past the ceiling, in the ceiling's shared words`, () => {
      const parsed = FLPostRegistrierungPayloadSchema.safeParse({ ...registrierung, [part]: "A".repeat(KONTAKT_NAME_MAX_LENGTH + 1) });

      assert.equal(parsed.success, false);
      assert.deepEqual(
        parsed.error?.issues.map(({ path, message }) => [path.join("."), message]),
        [[part, KONTAKT_NAME_ZU_LANG]],
      );
    });

    it(`takes a ${part} at the ceiling`, () => {
      assert.equal(FLPostRegistrierungPayloadSchema.safeParse({ ...registrierung, [part]: "A".repeat(KONTAKT_NAME_MAX_LENGTH) }).success, true);
    });
  }
});
