import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { KONTAKT_NAME_MAX_LENGTH, KONTAKT_NAME_ZU_LANG } from "@/features/teams/constants.ts";

import {
  FLPatchSchiedsrichterPayloadSchema,
  FLPostSchiedsrichterPayloadSchema,
  FLSchiedsrichterListResponseSchema,
  hatAdresse,
} from "./schemas.ts";

const PLATZHALTER = "adresse-fehlt@frankfurtleague.invalid";

describe("whether a referee row holds an address", () => {
  // Without it a check answering none for everything passes the case below.
  it("takes a stored address as one the row holds", () => {
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

/* The read states no address rule: one row holding the placeholder, which the rule refuses, would otherwise fail the
   whole list's parse and take every referee off the page. */
describe("the referee list's read", () => {
  it("takes a row holding the placeholder address", () => {
    const row = {
      id: "6890a1b2c3d4e5f607800001",
      name: "Anna Körner",
      schule: null,
      default_payment: 20,
      kontakt: { telefon: null, email: PLATZHALTER },
      inactive_since: null,
      geburtsdatum: null,
      einwilligung: null,
      bestaetigung: null,
    };

    assert.equal(FLSchiedsrichterListResponseSchema.safeParse({ acknowledged: 1, schiedsrichter: [row] }).success, true);
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

    // The API strips before it counts, so a space typed on either side of a name at the ceiling is a name it takes.
    it(`takes a name at the ceiling with spaces around it on the ${label}, and sends it trimmed`, () => {
      const atCeiling = "A".repeat(KONTAKT_NAME_MAX_LENGTH);
      const parsed = schema.safeParse({ ...schiedsrichter, name: ` ${atCeiling} ` });

      assert.equal(parsed.data?.name, atCeiling);
    });
  }
});
