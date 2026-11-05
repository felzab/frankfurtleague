import { describe, expect, it } from "vitest";

import { KONTAKT_NAME_MAX_LENGTH, KONTAKT_NAME_ZU_LANG } from "@/features/teams/constants.ts";

import { FLPostSchiedsrichterPayloadSchema } from "./schemas.ts";

// A referee's whole name takes the ceiling one part of any other person's does, refused in the one
// sentence every form holding a name to it says.
describe("the ceiling a referee's name is held to", () => {
  const schiedsrichter = {
    name: "Anna Schmidt",
    default_payment: 20,
    kontakt: { telefon: null, email: "anna.schmidt@beispiel.de" },
    schule: null,
  };

  for (const [label, schema] of [["create", FLPostSchiedsrichterPayloadSchema]] as const) {
    it(`takes the ${label} body this case varies`, () => {
      // Without it a body refused for another field makes the refusal below pass for the wrong reason.
      expect(schema.safeParse(schiedsrichter).success).toBe(true);
    });

    it(`refuses a name one past the ceiling on the ${label}, in the ceiling's shared words`, () => {
      const parsed = schema.safeParse({ ...schiedsrichter, name: "A".repeat(KONTAKT_NAME_MAX_LENGTH + 1) });

      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map(({ path, message }) => [path.join("."), message])).toStrictEqual([["name", KONTAKT_NAME_ZU_LANG]]);
    });

    it(`takes a name at the ceiling on the ${label}`, () => {
      expect(schema.safeParse({ ...schiedsrichter, name: "A".repeat(KONTAKT_NAME_MAX_LENGTH) }).success).toBe(true);
    });

    // The API strips before it counts, so a space typed on either side of a name at the ceiling is a name it takes.
    it(`takes a name at the ceiling with spaces around it on the ${label}, and sends it trimmed`, () => {
      const atCeiling = "A".repeat(KONTAKT_NAME_MAX_LENGTH);
      const parsed = schema.safeParse({ ...schiedsrichter, name: ` ${atCeiling} ` });

      expect(parsed.data?.name).toBe(atCeiling);
    });
  }
});
