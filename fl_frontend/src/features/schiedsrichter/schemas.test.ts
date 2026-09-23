import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bestehtSchreibregel, hatAdresse } from "./schemas.ts";

/** A row stored before the address rule: its umlaut stands before the at sign, where no payload takes one now. */
const VOR_DER_REGEL = "jürgen@schule.de";

const PLATZHALTER = "adresse-fehlt@frankfurtleague.invalid";

describe("whether a referee row holds an address", () => {
  /* The write rule is the editor's alone: read by the table or the facet, it shows a real stored
     address as none, and the administrator who has to replace it never sees it. */
  it("takes an address the write rule refuses as one the row holds", () => {
    assert.equal(bestehtSchreibregel(VOR_DER_REGEL), false, "the write rule takes the row, so this compares nothing");
    assert.equal(hatAdresse(VOR_DER_REGEL), true);
    assert.equal(hatAdresse("anna@schule.de"), true);
  });

  it("reads no address, a blank one and the placeholder alike as none", () => {
    assert.equal(hatAdresse(null), false);
    assert.equal(hatAdresse(""), false);
    assert.equal(hatAdresse("   "), false);
    assert.equal(hatAdresse(PLATZHALTER), false);
    assert.equal(hatAdresse(PLATZHALTER.toUpperCase()), false, "the placeholder in capitals is read as an address");
  });
});
