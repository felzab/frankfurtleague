import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { asSignInIdentifier, isDeliverableAddress, isOneBareMailbox } from "@/core/emailAddress";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

/** Five characters a reader cannot see, which `new URL` deletes while parsing, so a host carrying one reads as another. */
const INVISIBLE = ["\u200B", "\uFEFF", "\u00AD", "\u2060", "\u180E"];

/** Outside a host label's letters, digits and hyphens: an umlaut and a CJK letter, which the rule refuses rather than converts, among them. */
const REFUSED = [...INVISIBLE, "\t", "@", "_", "ü", "日"];

const hostOf = (middle: string): string => `person@x${middle}y.example.org`;

describe("the host alphabet an address is held to", () => {
  it("refuses every character outside a label's letters, digits and hyphens", () => {
    for (const middle of REFUSED) {
      expect(isDeliverableAddress(hostOf(middle)), `expected a host carrying ${JSON.stringify(middle)} to be refused`).toBe(false);
    }
  });
});

/** One table both suites run their own rule and fold over; `fl_backend/tests/shared/test_email_address.py` holds the API's half. */
const ROWS = z
  .array(z.object({ case: z.string(), typed: z.string(), stored: z.string().nullable(), folded: z.string() }))
  .parse(JSON.parse(readFileSync(path.resolve(REPO_ROOT, "fl_backend", "tests", "shared", "email_addresses.json"), "utf8")));

describe("the address table the API is held to as well", () => {
  for (const { case: what, typed, stored, folded } of ROWS) {
    it(`answers ${what} as the table records`, () => {
      // Trimmed first, as the address box trims before the rule reads the value.
      expect(isDeliverableAddress(typed.trim())).toBe(stored !== null);
      expect(asSignInIdentifier(typed)).toBe(folded);
      // The API stores the fold itself, so the address this side folds meets the stored row by equality.
      if (stored !== null) expect(asSignInIdentifier(typed.trim())).toBe(stored);
    });
  }
});

describe("one bare mailbox, the only recipient the mailer takes", () => {
  /* Each a spelling the ban list's keying answers unbarred where a provider may still find a mailbox
     in it: handed on, it reached a barred person past the gate. */
  const AROUND_A_MAILBOX: readonly (readonly [string, string])[] = [
    ["a display name", "Gerda <gerda.gesperrt@schule.example.org>"],
    ["angle brackets", "<gerda.gesperrt@schule.example.org>"],
    ["a trailing dot", "gerda.gesperrt@schule.example.org."],
    ["a list", "gerda.gesperrt@schule.example.org, x@schule.example.org"],
    ["a semicolon list", "gerda.gesperrt@schule.example.org;x@schule.example.org"],
    ["leading whitespace", " gerda.gesperrt@schule.example.org"],
    ["trailing whitespace", "gerda.gesperrt@schule.example.org\n"],
    ["a quoted local part", '"gerda gesperrt"@schule.example.org'],
    ["a comment", "gerda.gesperrt(x)@schule.example.org"],
    ["a domain literal", "gerda@[192.0.2.1]"],
    ["a leading dot", ".gerda@schule.example.org"],
    ["a doubled dot", "gerda..gesperrt@schule.example.org"],
    ["two at signs", "gerda@x@schule.example.org"],
    ["no at sign", "gerda.barred"],
    ["an undotted domain", "gerda@localhost"],
  ];

  for (const [what, spelled] of AROUND_A_MAILBOX) {
    it(`refuses ${what}`, () => {
      expect(isOneBareMailbox(spelled)).toBe(false);
    });
  }

  /* The control: a rule refusing an alphabet rather than the spelling around a mailbox fails here,
     and an address the stores hold would never reach its recipient. */
  it("takes every bare mailbox, whatever its alphabet", () => {
    for (const address of [
      "trainer@example.org",
      "Trainer@Example.ORG",
      "anna+u12@schule.example.org",
      "vorstand@münchen-schule.example.org",
      "jörg@schule.example.org",
    ]) {
      expect(isOneBareMailbox(address), address).toBe(true);
    }
  });
});
