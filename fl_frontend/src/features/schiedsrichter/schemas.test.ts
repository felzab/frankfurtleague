import { parseDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";

import { KONTAKT_NAME_MAX_LENGTH, KONTAKT_NAME_ZU_LANG } from "@/features/teams/constants.ts";
import { getGermanTodayStr } from "@/shared/utils/date.ts";

import {
  buildSchiedsrichterBestaetigungPayloadSchema,
  FLPatchSchiedsrichterPayloadSchema,
  FLPostSchiedsrichterPayloadSchema,
  FLSchiedsrichterBestaetigungPayloadSchema,
  FLSchiedsrichterListResponseSchema,
  hatAdresse,
} from "./schemas.ts";

// Under a special-use name, which the address rule refuses and a rule of an earlier day may have stored.
const ALTE_ADRESSE = "jemand@schule.invalid";

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

/* The read states no address rule: one row holding an address the rule refuses would otherwise fail the whole list's
   parse and take every referee off the page. */
describe("the referee list's read", () => {
  it("takes a row holding an address the rule refuses", () => {
    const row = {
      id: "6890a1b2c3d4e5f607800001",
      name: "Anna Körner",
      schule: null,
      default_payment: 20,
      kontakt: { telefon: null, email: ALTE_ADRESSE },
      inactive_since: null,
      geburtsdatum: null,
      einwilligung: null,
      bestaetigung: null,
    };

    expect(FLSchiedsrichterListResponseSchema.safeParse({ acknowledged: 1, schiedsrichter: [row] }).success).toBe(true);
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

describe("the label a confirmation's answer names", () => {
  /* The endpoint refuses an empty label, so the page refuses it first, in German, rather than sending a
     body the endpoint answers with a code no box can carry. */
  it("is refused empty or blank, as the endpoint refuses it", () => {
    const antwort = { token: "kein-echtes-token", geburtsdatum: "1990-01-01", umfang: "intern", medien: false };

    expect(
      FLSchiedsrichterBestaetigungPayloadSchema.safeParse({ ...antwort, text_version: "2026-09-seite" }).success,
      "the fixture is refused for a field of its own",
    ).toBe(true);
    for (const text_version of ["", "   "]) {
      const parsed = FLSchiedsrichterBestaetigungPayloadSchema.safeParse({ ...antwort, text_version });
      expect(
        parsed.error?.issues.map((issue) => [issue.path.join("."), issue.message]),
        JSON.stringify(text_version),
      ).toStrictEqual([["text_version", "Deine Antwort nennt keine Fassung. Öffne den Link aus Deiner E-Mail erneut."]]);
    }
  });
});

describe("the birth date the page's own schema accepts", () => {
  /* The page judges the date against the German day as the endpoint does, so a youngest date one day short
     of the floor is told to correct a date the endpoint would take, and one a day past it is let through to a
     refusal. The bound is worked out here from the day, never read back off the helper the schema calls. */
  it("takes the latest date the floor allows and refuses the day after it", () => {
    const mindestalter = 16;
    const spaeteste = parseDate(getGermanTodayStr()).subtract({ years: mindestalter });
    const schema = buildSchiedsrichterBestaetigungPayloadSchema(mindestalter);
    const antwort = { token: "kein-echtes-token", umfang: "intern", medien: false, text_version: "2026-09-seite" };

    expect(schema.safeParse({ ...antwort, geburtsdatum: spaeteste.toString() }).success, "the latest date the floor allows is refused").toBe(
      true,
    );
    expect(
      schema.safeParse({ ...antwort, geburtsdatum: spaeteste.add({ days: 1 }).toString() }).success,
      "a day younger than the floor is accepted",
    ).toBe(false);
  });
});
