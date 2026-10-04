import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { KONTAKT_NAME_MAX_LENGTH, KONTAKT_NAME_ZU_LANG } from "@/features/teams/constants.ts";

import {
  FLEinwilligungSchema,
  FLEinwilligungStandPayloadSchema,
  FLEinwilligungStandSchema,
  FLPatchSpielerPayloadSchema,
  FLSpielerAdminSingleResponseSchema,
  FLSpielerPublicSchema,
} from "./schemas.ts";

/* Composed by the backend's own writers and serialised by its read model: confirmed on the pupil page
   with both choices granted, then media withdrawn on the account page. `apiContract.test.ts` compares
   the shapes and never a value inside one. */
const SERVED_EINWILLIGUNG = {
  umfang: "kader_oeffentlich",
  erteilt_von: "volljaehrig",
  datum: "2026-10-01",
  bestaetigt_am: "2026-10-01",
  text_version: "2026-10-spielerseite-4",
  medien: false,
  nachweis: {
    umfang: { am: "2026-10-01T07:42:10+00:00", text_version: "2026-10-spielerseite-4", erteilt_zuvor: null },
    medien: {
      am: "2026-10-03T16:05:31+00:00",
      text_version: "2026-10-konto-spieler",
      erteilt_zuvor: { am: "2026-10-01T07:42:10+00:00", text_version: "2026-10-spielerseite-4" },
    },
  },
};
const SERVED_STAND = { medien: "2026-10-03T16:05:31+00:00", umfang: "2026-10-01T07:42:10+00:00" };

describe("a consent record whose evidence is filled, as a read serves it", () => {
  // Equal rather than merely parsed: an object schema drops a key it does not declare, which would
  // lose the grant a withdrawal names and still parse.
  it("keeps a granted choice's act and a withdrawn choice's act with the grant it ended", () => {
    assert.deepEqual(FLEinwilligungSchema.parse(SERVED_EINWILLIGUNG), SERVED_EINWILLIGUNG);
  });

  it("keeps the instants a read serves as the press's precondition, and sends them back unchanged", () => {
    assert.deepEqual(FLEinwilligungStandSchema.parse(SERVED_STAND), SERVED_STAND);
    assert.deepEqual(FLEinwilligungStandPayloadSchema.parse(SERVED_STAND), SERVED_STAND);
  });
});

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
