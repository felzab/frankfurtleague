import { readFileSync } from "node:fs";
import path from "node:path";

import { assert, describe, expect, it } from "vitest";
import { z } from "zod";

import { asSignInIdentifier } from "@/core/emailAddress.ts";

import { ERASURE_ANLASS_MAX_LENGTH } from "./constants.ts";
import { FLAbmeldungPayloadSchema, FLErasureAnsichtPayloadSchema, FLErasurePayloadSchema } from "./schemas.ts";

const ANLASS = "E-Mail vom 12.10.2026, Betreff Löschung meiner Daten";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");

// Read rather than retyped: the API's validator answers the same rows in its own suite, the only
// comparison the predicate gets, since the API's sentence reaches its log line and never this box.
const PROBE = z.array(z.object({ value: z.string(), refused: z.boolean() }));
const REFUSALS = z
  .object({ anlass: PROBE })
  .parse(JSON.parse(readFileSync(path.resolve(REPO_ROOT, "fl_backend", "tests", "shared", "erasure_refusals.json"), "utf8")));

/** The three payloads keyed on an address, each judged on the address alone. */
const LOOKUPS = [
  ["the reveal", (email: unknown) => FLErasureAnsichtPayloadSchema.safeParse({ email: email }).success],
  ["the erasure", (email: unknown) => FLErasurePayloadSchema.safeParse({ email: email, anlass: ANLASS }).success],
  ["the sign-out", (email: unknown) => FLAbmeldungPayloadSchema.safeParse({ email: email }).success],
] as const;

describe("the address the erasure, its reveal and the sign-out look up", () => {
  /* The records an erasure removes are keyed on whatever a rule of their day stored; refusing that erases
     nobody (GDPR Art. 17). The full-width at sign is built from its code point. */
  it("takes every address any rule stored, so the request can name any record", () => {
    const stored = [
      "käthe@example.de",
      "kaethe@käthe-schule.example",
      "a!b@example.de",
      "anna..mueller@schule.de",
      "erika@example",
      `erika${String.fromCharCode(0xff20)}x@example.de`,
    ];
    for (const [payload, takes] of LOOKUPS) {
      for (const email of stored) expect(takes(email), `${payload} refused "${email}"`).toBe(true);
    }
  });

  /* The endpoints answer these with a REQ-VAL-001 whose mark names no rule, so the box has to say it first. */
  it("refuses what the API's lookup refuses, so the box carries the message", () => {
    for (const [payload, takes] of LOOKUPS) {
      for (const email of ["", "   ", "erika.example.de", `${"a".repeat(250)}@schule.de`]) {
        expect(takes(email), `${payload} took "${email}"`).toBe(false);
      }
    }
  });
});

/**
 * The mirror table both folds are held to, the frontend's own fold recorded where the two runtimes' tables part;
 * `fl_backend/tests/shared/test_email_address.py` holds the API's lookup to it too.
 */
const ADDRESSES = z
  .array(z.object({ case: z.string(), typed: z.string(), folded: z.string(), frontend: z.object({ folded: z.string() }).optional() }))
  .parse(JSON.parse(readFileSync(path.resolve(REPO_ROOT, "fl_backend", "tests", "shared", "email_addresses.json"), "utf8")));

describe("the mailbox each lookup asks for", () => {
  /* The action ends the sign-in account of what the box trimmed, so a box trimming otherwise than the API's erases one
     mailbox's records and leaves another's account. */
  it("is the one the mirror table folds each row to on this side, the API's lookup answering its own", () => {
    assert.ok(
      ADDRESSES.some(({ typed }) => typed.trim() !== typed),
      "no row is trimmed, so the case compares nothing",
    );
    const parsed = [
      ["the reveal", (email: string) => FLErasureAnsichtPayloadSchema.parse({ email: email }).email],
      ["the erasure", (email: string) => FLErasurePayloadSchema.parse({ email: email, anlass: ANLASS }).email],
      ["the sign-out", (email: string) => FLAbmeldungPayloadSchema.parse({ email: email }).email],
    ] as const;
    for (const [payload, asked] of parsed) {
      for (const row of ADDRESSES) {
        expect(asSignInIdentifier(asked(row.typed)), `${payload}: ${row.case}`).toBe((row.frontend ?? row).folded);
      }
    }
  });
});

describe("the request the erasure answers", () => {
  const refused = (anlass: string): string | undefined =>
    FLErasurePayloadSchema.safeParse({ email: "ada@example.org", anlass: anlass }).error?.issues[0]?.message;

  it("takes a date and a subject", () => {
    expect(refused(ANLASS)).toBe(undefined);
  });

  /* Each a refusal the API makes too (`fl_backend/app/api/sperrliste/schemas.py :: ADDRESS_IN_FREE_TEXT` for the
     address): the log keeps the Anlass a year, past the redaction of anybody it names. */
  it("refuses a blank one, an over-long one, one of two lines and one holding an address, each in German", () => {
    expect(refused("   ")).toBe("Bitte gib einen Anlass ein.");
    expect(refused("a".repeat(ERASURE_ANLASS_MAX_LENGTH + 1))).toBe(
      `Der Anlass darf höchstens ${String(ERASURE_ANLASS_MAX_LENGTH)} Zeichen lang sein.`,
    );
    expect(refused("E-Mail vom 12.10.2026\nBetreff Löschung")).toBe("Der Anlass darf keine Zeilenumbrüche oder Steuerzeichen enthalten.");
    expect(refused("E-Mail von ada@example.org vom 12.10.2026")).toBe("Der Anlass darf keine E-Mail-Adresse enthalten.");
  });

  /* Measured as the API measures it, after the strip. */
  it("counts the bound on the trimmed request", () => {
    expect(refused(` ${"a".repeat(ERASURE_ANLASS_MAX_LENGTH)} `)).toBe(undefined);
  });

  /* A deliverable shape only: an at sign in prose, or a domain with no top level, stays an Anlass. */
  it("refuses an address where the API's table refuses one", () => {
    for (const { value, refused: verweigert } of REFUSALS.anlass) {
      expect(refused(value), `"${value}"`).toBe(verweigert ? "Der Anlass darf keine E-Mail-Adresse enthalten." : undefined);
    }
  });
});
