import { readFileSync } from "node:fs";
import path from "node:path";

import { assert, describe, expect, it } from "vitest";
import { z } from "zod";

import { asSignInIdentifier, hasAsciiLocalPart, isDeliverableAddress, isOneBareMailbox, withAsciiDomain } from "@/core/emailAddress";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

/** `new URL` DELETES these five while parsing, so each reaches every later check as `xy.de`. */
const INVISIBLE = ["​", "﻿", "­", "⁠", "᠎"];

/** Outside a host label's letters, digits and hyphens: an umlaut and a CJK letter, which the rule refuses rather than converts, among them. */
const REFUSED = [...INVISIBLE, "\t", "@", "_", "ü", "日"];

const hostOf = (middle: string): string => `person@x${middle}y.de`;

describe("the host alphabet an address is held to", () => {
  it("takes a hyphen and a dot, so a refusal below is the alphabet and not the function refusing everything", () => {
    for (const middle of ["-", "."]) {
      expect(isDeliverableAddress(hostOf(middle)), `expected a host carrying ${JSON.stringify(middle)} to be deliverable`).toBe(true);
    }
  });

  it("refuses every character outside a label's letters, digits and hyphens", () => {
    for (const middle of REFUSED) {
      expect(isDeliverableAddress(hostOf(middle)), `expected a host carrying ${JSON.stringify(middle)} to be refused`).toBe(false);
    }
  });
});

/* Built from code points, so no editor normalises one into the ASCII the case must not compare: the
   full-width a and the no-break space pass for ASCII, and the accent stays uncomposed. */
const BEYOND_ASCII = [
  `j${String.fromCodePoint(0xfc)}rgen@schule.de`,
  `${String.fromCodePoint(0xff41)}nna@schule.de`,
  `vorstand${String.fromCodePoint(0x301)}@schule.de`,
  `an${String.fromCodePoint(0xa0)}na@schule.de`,
];

describe("a local part above ASCII", () => {
  it("is refused wherever the character stands, and worded apart from every other refusal", () => {
    for (const address of BEYOND_ASCII) {
      expect(isDeliverableAddress(address), `expected ${JSON.stringify(address)} to be refused`).toBe(false);
      expect(hasAsciiLocalPart(address), `expected ${JSON.stringify(address)} to be worded as its local part`).toBe(false);
    }
  });

  /* The control: a wording reading the whole address would give an umlaut domain the local part's sentence. */
  it("is told apart from a domain above ASCII, which takes the generic refusal", () => {
    expect(isDeliverableAddress(`anna@m${String.fromCodePoint(0xfc)}ller.de`)).toBe(false);
    expect(hasAsciiLocalPart(`anna@m${String.fromCodePoint(0xfc)}ller.de`)).toBe(true);
  });

  it("leaves a value without an at sign to the generic refusal", () => {
    expect(hasAsciiLocalPart(`j${String.fromCodePoint(0xfc)}rgen`)).toBe(true);
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

/* Every row carries a character above ASCII as well: an ASCII host is handed back byte for byte
   and never reaches the parse the characters below mislead. */
const convertedHostOf = (middle: string): string => `person@xü${middle}y.de`;

/** What `new URL` ANSWERS on rather than throwing over, so nothing but the alphabet stands between it and a host nobody typed. */
const ANSWERED_AS_ANOTHER_HOST = [...INVISIBLE, "\t", "/", "\\", "?", "#"];

/** Where the alphabet is the second of two refusals: the parse throws over these, so a regression in it would still be refused. */
const REFUSED_BY_THE_PARSE = [" ", ":"];

describe("the domain the conversion is willing to rewrite", () => {
  it("converts a host above ASCII, so a refusal below is the alphabet and not the function refusing everything", () => {
    expect(withAsciiDomain("person@münchen.de")).toBe("person@xn--mnchen-3ya.de");
    assert.ok(ANSWERED_AS_ANOTHER_HOST.length > 0 && REFUSED_BY_THE_PARSE.length > 0, "a table is empty, so a case below compares nothing");
  });

  /* Each is dropped or read as structure by the parse, which then answers a host the sender never
     typed -- `xü` alone for the punctuation, `xüy.de` for the rest -- and the message goes there. */
  it("refuses a host the parse would answer a different name on", () => {
    for (const middle of ANSWERED_AS_ANOTHER_HOST) {
      expect(withAsciiDomain(convertedHostOf(middle)), `expected a host carrying ${JSON.stringify(middle)} to be refused`).toBe(undefined);
    }
  });

  it("refuses a host the parse throws over too", () => {
    for (const middle of REFUSED_BY_THE_PARSE) {
      expect(withAsciiDomain(convertedHostOf(middle)), `expected a host carrying ${JSON.stringify(middle)} to be refused`).toBe(undefined);
    }
  });
});

describe("one bare mailbox, the only recipient the mailer takes", () => {
  /* Each a spelling the ban list's keying answers unbarred where a provider may still find a mailbox
     in it: handed on, it reached a barred person past the gate. */
  const AROUND_A_MAILBOX: readonly (readonly [string, string])[] = [
    ["a display name", "Gerda <gerda.gesperrt@schule.de>"],
    ["angle brackets", "<gerda.gesperrt@schule.de>"],
    ["a trailing dot", "gerda.gesperrt@schule.de."],
    ["a list", "gerda.gesperrt@schule.de, x@schule.de"],
    ["a semicolon list", "gerda.gesperrt@schule.de;x@schule.de"],
    ["leading whitespace", " gerda.gesperrt@schule.de"],
    ["trailing whitespace", "gerda.gesperrt@schule.de\n"],
    ["a quoted local part", '"gerda gesperrt"@schule.de'],
    ["a comment", "gerda.gesperrt(x)@schule.de"],
    ["a domain literal", "gerda@[192.0.2.1]"],
    ["a leading dot", ".gerda@schule.de"],
    ["a doubled dot", "gerda..gesperrt@schule.de"],
    ["two at signs", "gerda@x@schule.de"],
    ["no at sign", "gerda.gesperrt"],
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
      "anna+u12@schule.de",
      "vorstand@münchen-schule.de",
      "jörg@schule.de",
    ]) {
      expect(isOneBareMailbox(address), address).toBe(true);
    }
  });
});
