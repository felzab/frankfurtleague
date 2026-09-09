import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FLSpielerAdminSingleResponseSchema, FLSpielerPublicSchema } from "./schemas.ts";

// Each read model states the floor its backend twin states: `FLSpielerPublic` has `min_length=1` from
// the shared person block where `FLSpielerSingleResponse` has none, and a mirror stricter than its
// twin reports a landed write as failed.
describe("the floor a read of a player states", () => {
  const publik = { id: "0".repeat(24), vorname: "Anna", nachname: "M.", nummer: "7", position: "Tor" };
  const echo = { acknowledged: 1, spieler_id: "0".repeat(24), vorname: "Anna", nachname: "Mustermann", inactive_since: null };

  it("requires a first name on the public row, as the projection's own model does", () => {
    assert.equal(FLSpielerPublicSchema.safeParse(publik).success, true);
    assert.equal(FLSpielerPublicSchema.safeParse({ ...publik, vorname: "" }).success, false);
  });

  it("takes an empty first name on the admin echo, whose model states no floor", () => {
    assert.equal(FLSpielerAdminSingleResponseSchema.safeParse(echo).success, true);
    assert.equal(FLSpielerAdminSingleResponseSchema.safeParse({ ...echo, vorname: "" }).success, true);
  });
});
