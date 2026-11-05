import { parseDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";

import { SCHIEDSRICHTER_TEXT_VERSIONS } from "@/core/consentWordings.ts";
import { KONTAKT_NAME_MAX_LENGTH, KONTAKT_NAME_ZU_LANG } from "@/features/teams/constants.ts";
import { getGermanTodayStr } from "@/shared/utils/date.ts";

import {
  buildSchiedsrichterBestaetigungPayloadSchema,
  FLPatchSchiedsrichterPayloadSchema,
  FLPostSchiedsrichterPayloadSchema,
  hatAdresse,
} from "./schemas.ts";

describe("whether a referee row holds an address", () => {
  // Without it a check answering none for everything passes the case below.
  it("takes a stored address as one the row holds", () => {
    expect(hatAdresse("anna@schule.de")).toBe(true);
  });

  it("reads no address and a blank one alike as none", () => {
    expect(hatAdresse(null)).toBe(false);
    expect(hatAdresse("")).toBe(false);
    expect(hatAdresse("   ")).toBe(false);
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

describe("the birth date the page's own schema accepts", () => {
  /* The page judges the date against the German day as the endpoint does, so a youngest date one day short
     of the floor is told to correct a date the endpoint would take, and one a day past it is let through to a
     refusal. The bound is worked out here from the day, never read back off the helper the schema calls. */
  it("takes the latest date the floor allows and refuses the day after it", () => {
    const mindestalter = 16;
    const spaeteste = parseDate(getGermanTodayStr()).subtract({ years: mindestalter });
    const schema = buildSchiedsrichterBestaetigungPayloadSchema(mindestalter);
    const antwort = { token: "kein-echtes-token", umfang: "intern", media: false, text_versions: SCHIEDSRICHTER_TEXT_VERSIONS };

    expect(schema.safeParse({ ...antwort, geburtsdatum: spaeteste.toString() }).success, "the latest date the floor allows is refused").toBe(
      true,
    );
    expect(
      schema.safeParse({ ...antwort, geburtsdatum: spaeteste.add({ days: 1 }).toString() }).success,
      "a day younger than the floor is accepted",
    ).toBe(false);
  });
});
