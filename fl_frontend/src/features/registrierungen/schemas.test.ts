import { parseDate } from "@internationalized/date";
import { describe, expect, it } from "vitest";

import { SPIELER_TEXT_VERSIONS } from "@/core/consentWordings.ts";
import { KONTAKT_NAME_MAX_LENGTH, KONTAKT_NAME_ZU_LANG } from "@/features/teams/constants.ts";
import { getGermanTodayStr } from "@/shared/utils/date.ts";

import { buildRegistrierungBestaetigungPayloadSchema, FLPostRegistrierungPayloadSchema } from "./schemas.ts";

// A pupil is told the sentence every other form holding a name to that ceiling says, never one of
// its own: two wordings of one refusal read as two rules.
describe("the ceiling a pupil's registration holds each name to", () => {
  const registrierung = {
    token: "a".repeat(43),
    vorname: "Lena",
    nachname: "Meier",
    email: "lena.meier@beispiel.de",
    position: null,
    nummer: null,
    stufe: null,
  };

  it("takes the registration this file varies", () => {
    // Without it a body refused for another field makes the refusal below pass for the wrong reason.
    expect(FLPostRegistrierungPayloadSchema.safeParse(registrierung).success).toBe(true);
  });

  for (const part of ["vorname", "nachname"] as const) {
    it(`refuses a ${part} one past the ceiling, in the ceiling's shared words`, () => {
      const parsed = FLPostRegistrierungPayloadSchema.safeParse({ ...registrierung, [part]: "A".repeat(KONTAKT_NAME_MAX_LENGTH + 1) });

      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map(({ path, message }) => [path.join("."), message])).toStrictEqual([[part, KONTAKT_NAME_ZU_LANG]]);
    });

    it(`takes a ${part} at the ceiling`, () => {
      expect(FLPostRegistrierungPayloadSchema.safeParse({ ...registrierung, [part]: "A".repeat(KONTAKT_NAME_MAX_LENGTH) }).success).toBe(true);
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
    const schema = buildRegistrierungBestaetigungPayloadSchema(mindestalter, "bestaetigung_spieler");
    const antwort = { token: "kein-echtes-token", umfang: "intern", media: false, text_versions: SPIELER_TEXT_VERSIONS };

    expect(schema.safeParse({ ...antwort, geburtsdatum: spaeteste.toString() }).success, "the latest date the floor allows is refused").toBe(
      true,
    );
    expect(
      schema.safeParse({ ...antwort, geburtsdatum: spaeteste.add({ days: 1 }).toString() }).success,
      "a day younger than the floor is accepted",
    ).toBe(false);
  });
});
