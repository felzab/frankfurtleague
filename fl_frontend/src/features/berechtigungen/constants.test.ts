import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ERASED_ACTOR_MARKER } from "@/core/erasedActor.ts";
import { GELOESCHTE_PERSON, GESPERRTE_ADRESSE, vonOderGesperrt } from "@/features/berechtigungen/constants.ts";

describe("the actor an admin card names", () => {
  it("names an administrator by their address", () => {
    assert.equal(vonOderGesperrt("vorstand@schule.de", false), "vorstand@schule.de");
  });

  it("names a withheld administrator by their state", () => {
    assert.equal(vonOderGesperrt(null, true), GESPERRTE_ADRESSE);
  });

  // The backend never sends one half of the pair without the other; a card meeting it names no address
  // the flag says is barred, and never leaves the line empty.
  it("reads either half of the withheld pair alone as withheld", () => {
    assert.equal(vonOderGesperrt("vorstand@schule.de", true), GESPERRTE_ADRESSE);
    assert.equal(vonOderGesperrt(null, false), GESPERRTE_ADRESSE);
  });

  // The marker names nobody, so printed as it is served it would read as an address; and the person is
  // erased rather than barred.
  it("names an erased administrator by that state, never the marker and never as barred", () => {
    assert.equal(vonOderGesperrt(ERASED_ACTOR_MARKER, false), GELOESCHTE_PERSON);
  });
});
