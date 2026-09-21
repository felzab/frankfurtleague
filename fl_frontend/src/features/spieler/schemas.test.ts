import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FLSpielerAdminSingleResponseSchema, FLSpielerPublicSchema } from "./schemas.ts";

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
