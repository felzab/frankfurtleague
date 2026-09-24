import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { KONTAKT_NAME_MAX_LENGTH, KONTAKT_NAME_ZU_LANG } from "@/features/teams/constants.ts";

import { FLPatchSpielerPayloadSchema, FLSpielerAdminSingleResponseSchema, FLSpielerPublicSchema } from "./schemas.ts";

// Each read model states the floor its twin states, and the public row carries none: the gate
// answers both names as `null` for a person it withholds (`READ-PUPIL-003`), and a stricter mirror
// reports a landed write as failed.
describe("the floor a read of a player states", () => {
  const publik = { id: "0".repeat(24), vorname: "Anna", nachname: "M.", nummer: "7", position: "Tor" };
  const echo = { acknowledged: 1, spieler_id: "0".repeat(24), vorname: "Anna", nachname: "Mustermann", inactive_since: null };

  it("takes the two null names the gate serves for a withheld person", () => {
    assert.equal(FLSpielerPublicSchema.safeParse(publik).success, true);
    assert.equal(FLSpielerPublicSchema.safeParse({ ...publik, vorname: null, nachname: null }).success, true);
  });

  it("takes an empty first name on the admin echo, whose model states no floor", () => {
    assert.equal(FLSpielerAdminSingleResponseSchema.safeParse(echo).success, true);
    assert.equal(FLSpielerAdminSingleResponseSchema.safeParse({ ...echo, vorname: "" }).success, true);
  });
});

// An administrator's edit may not store a name the pupil's own registration would refuse, and says so
// in the sentence every form holding a name to that ceiling says.
describe("the ceiling a person edit holds each name to", () => {
  const names = { id: "0".repeat(24), vorname: "Max", nachname: "Mustermann", geburtsdatum: null };

  for (const part of ["vorname", "nachname"] as const) {
    it(`refuses a ${part} one past the registration's ceiling, in that ceiling's words`, () => {
      const parsed = FLPatchSpielerPayloadSchema.safeParse({ ...names, [part]: "A".repeat(KONTAKT_NAME_MAX_LENGTH + 1) });

      assert.equal(parsed.success, false);
      assert.deepEqual(
        parsed.error?.issues.map(({ path, message }) => [path.join("."), message]),
        [[part, KONTAKT_NAME_ZU_LANG]],
      );
    });

    it(`takes a ${part} at the ceiling`, () => {
      assert.equal(FLPatchSpielerPayloadSchema.safeParse({ ...names, [part]: "A".repeat(KONTAKT_NAME_MAX_LENGTH) }).success, true);
    });
  }
});
