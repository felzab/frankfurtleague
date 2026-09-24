import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { KONTAKT_NAME_MAX_LENGTH, KONTAKT_NAME_ZU_LANG } from "@/features/teams/constants.ts";

import { bestehtSchreibregel, FLPatchSchiedsrichterPayloadSchema, FLPostSchiedsrichterPayloadSchema, hatAdresse } from "./schemas.ts";

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

// A referee's whole name takes the ceiling one part of any other person's does, refused in the one
// sentence every form holding a name to it says.
describe("the ceiling a referee's name is held to", () => {
  const schiedsrichter = {
    id: "0".repeat(24),
    name: "Anna Schmidt",
    default_payment: 20,
    kontakt: { telefon: null, email: "anna.schmidt@beispiel.de" },
    schule: null,
  };

  for (const [label, schema] of [
    ["create", FLPostSchiedsrichterPayloadSchema],
    ["edit", FLPatchSchiedsrichterPayloadSchema],
  ] as const) {
    it(`takes the ${label} body this case varies`, () => {
      // Without it a body refused for another field makes the refusal below pass for the wrong reason.
      assert.equal(schema.safeParse(schiedsrichter).success, true);
    });

    it(`refuses a name one past the ceiling on the ${label}, in the ceiling's shared words`, () => {
      const parsed = schema.safeParse({ ...schiedsrichter, name: "A".repeat(KONTAKT_NAME_MAX_LENGTH + 1) });

      assert.equal(parsed.success, false);
      assert.deepEqual(
        parsed.error?.issues.map(({ path, message }) => [path.join("."), message]),
        [["name", KONTAKT_NAME_ZU_LANG]],
      );
    });

    it(`takes a name at the ceiling on the ${label}`, () => {
      assert.equal(schema.safeParse({ ...schiedsrichter, name: "A".repeat(KONTAKT_NAME_MAX_LENGTH) }).success, true);
    });
  }
});
