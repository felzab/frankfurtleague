import { describe, expect, it } from "vitest";

import { KONTAKT_NAME_MAX_LENGTH, KONTAKT_NAME_ZU_LANG } from "@/features/teams/constants.ts";

import { FLPostRegistrierungPayloadSchema, FLRegistrierungBestaetigungPayloadSchema } from "./schemas.ts";

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

describe("the label a confirmation's answer names", () => {
  /* The endpoint refuses an empty label, so the page refuses it first, in German, rather than sending a
     body the endpoint answers with a code no box can carry. */
  it("is refused empty or blank, as the endpoint refuses it", () => {
    const antwort = { token: "kein-echtes-token", geburtsdatum: "2010-01-01", umfang: "intern", medien: false };

    expect(
      FLRegistrierungBestaetigungPayloadSchema.safeParse({ ...antwort, text_version: "2026-09-seite" }).success,
      "the fixture is refused for a field of its own",
    ).toBe(true);
    for (const text_version of ["", "   "]) {
      const parsed = FLRegistrierungBestaetigungPayloadSchema.safeParse({ ...antwort, text_version });
      expect(
        parsed.error?.issues.map((issue) => [issue.path.join("."), issue.message]),
        JSON.stringify(text_version),
      ).toStrictEqual([["text_version", "Deine Antwort nennt keine Fassung. Öffne den Link aus Deiner E-Mail erneut."]]);
    }
  });
});
