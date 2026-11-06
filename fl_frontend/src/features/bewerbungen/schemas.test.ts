import { assert, describe, expect, it } from "vitest";

import { gleicheAdresse } from "@/features/teams/kontaktePersonen";
import { toFieldErrors } from "@/shared/utils/validation";

import { FLBewerbungKontaktEmailPayloadSchema } from "./schemas.ts";

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
