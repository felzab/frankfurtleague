import { assert, describe, expect, it } from "vitest";

import { SEAT_TEXT_VERSIONS } from "@/core/consentWordings.ts";
import { gleicheAdresse } from "@/features/teams/kontaktePersonen";
import { toFieldErrors } from "@/shared/utils/validation";

import { BEWERBUNG_TOKEN_MAX_LENGTH } from "./constants.ts";
import { FLBewerbungEinwilligungAnswerPayloadSchema, FLBewerbungKontaktEmailPayloadSchema } from "./schemas.ts";

describe("the one field of a submitted application an administrator may move", () => {
  const CORRECTION = {
    id: "6890a1b2c3d4e5f607190001",
    rolle: "ansprechperson" as const,
    email: "erika@schule.de",
    version: 0,
  };

  const refusalFor = (payload: unknown): Record<string, string> => {
    const parsed = FLBewerbungKontaktEmailPayloadSchema.safeParse(payload);

    return parsed.success ? {} : toFieldErrors(parsed.error);
  };

  it("takes an application, a seat, an address and the version the page read, and refuses any other key", () => {
    expect(refusalFor(CORRECTION)).toStrictEqual({});
    expect(Object.keys(FLBewerbungKontaktEmailPayloadSchema.parse({ ...CORRECTION, first_name: "Erika" }))).toStrictEqual([
      "id",
      "rolle",
      "email",
      "version",
    ]);
  });

  /* One address is judged alike wherever it is typed: a sentence of this schema's own would tell an
     administrator something different from what the school was told about the same value. */
  it("refuses a malformed address in the submission's own words", () => {
    expect(refusalFor({ ...CORRECTION, email: "erika@" })["email"]).toBe("Bitte gib eine gültige E-Mail-Adresse ein.");
    expect(refusalFor({ ...CORRECTION, email: `${"e".repeat(300)}@schule.de` })["email"] ?? "").toMatch(/^Die E-Mail-Adresse darf höchstens /);
  });

  it("refuses an empty address rather than storing a seat nothing can reach", () => {
    assert.ok(refusalFor({ ...CORRECTION, email: "" })["email"] !== undefined);
  });

  /* The correction exists to reach a mailbox the submission could not, so an address the API stores
     has to pass here: refused, the seat stays unreachable and no other route moves it. */
  it("takes every address the API stores, so any mailbox can be corrected to", () => {
    for (const email of ["erika@xn--kthe-schule-l8a.example", "a!b@schule.de"]) {
      expect(refusalFor({ ...CORRECTION, email }), email).toStrictEqual({});
    }
  });

  /* Exported for the editor, which refuses another person's address at the field: two spellings of one
     rule would let a correction through that the submission's own comparison refuses. */
  it("compares two spellings of one address the way the submission does", () => {
    expect(gleicheAdresse(" Erika@Schule.de ", "erika@schule.de")).toBe(true);
    expect(gleicheAdresse("erika@schule.de", "mira@schule.de")).toBe(false);
    expect(gleicheAdresse("", ""), "two empty boxes read as one address, which would refuse a seat that has none").toBe(false);
  });

  /* The sign-in fold, as the API compares: ASCII case alone, so a full-width „e“ before the at sign is
     another address (built from its code point, rendering as the ASCII one). */
  it("folds as sign-in folds, never as a case-fold would", () => {
    expect(gleicheAdresse("erika@XN--MLLER-KVA.de", "Erika@xn--mller-kva.de")).toBe(true);
    expect(gleicheAdresse(`${String.fromCharCode(0xff45)}rika@schule.de`, "erika@schule.de")).toBe(false);
  });
});

describe("the consenting answer's birth date", () => {
  /* The empty picker is the missing date, so the date picker's required mark is set by hand on the
     strength of this refusal alone. */
  it("is refused missing, on the date's own path, in German", () => {
    const parsed = FLBewerbungEinwilligungAnswerPayloadSchema.safeParse({
      token: "x".repeat(20),
      answer: "given",
      birth_date: "",
      whatsapp: false,
      media: false,
      text_versions: SEAT_TEXT_VERSIONS,
    });

    expect(parsed.error?.issues.map((issue) => [issue.path.join("."), issue.message])).toStrictEqual([
      ["birth_date", "Bitte gib Dein Geburtsdatum ein."],
    ]);
  });
});

describe("the ceiling on the confirmation link's own token", () => {
  /* A decline, so the body is whole without a date and no clock decides the case. */
  const antwortBody = { answer: "declined" };

  const verdict = (token: string) => FLBewerbungEinwilligungAnswerPayloadSchema.safeParse({ token: token, ...antwortBody });

  /* No control renders the token, so past `CustomBewerbungToken`'s ceiling the endpoint's
     `payload_refused` naming it marks nothing, and the page can only report a failed save. */
  it("answers a token past the endpoint's ceiling with the sentence the missing one gets", () => {
    const parsed = verdict("x".repeat(BEWERBUNG_TOKEN_MAX_LENGTH + 1));
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.message)).toStrictEqual(["Bitte öffne den Link aus Deiner E-Mail erneut."]);
  });

  it("takes a token at the ceiling, as the endpoint does", () => {
    expect(verdict("x".repeat(BEWERBUNG_TOKEN_MAX_LENGTH)).success).toBe(true);
  });
});
