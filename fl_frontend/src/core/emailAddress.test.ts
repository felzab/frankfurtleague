import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { z } from "zod";

import {
  asSignInIdentifier,
  hasAsciiLocalPart,
  isDeliverableAddress,
  isOneBareMailbox,
  mailboxKey,
  withAsciiDomain,
} from "@/core/emailAddress";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

/** `new URL` DELETES these five while parsing, so each reaches every later check as `xy.de` (I226). */
const INVISIBLE = ["​", "﻿", "­", "⁠", "᠎"];

/** The tab and the second at sign survive `new URL` too, where the enumerated punctuation does not. */
const REFUSED_PAST_THE_URL = [...INVISIBLE, "\t", "@"];

/** A letter-digit-hyphen host, a dotted one, and the two shapes RFC 6531 admits above ASCII. */
const TAKEN = ["-", ".", "ü", "日"];

const hostOf = (middle: string): string => `person@x${middle}y.de`;

describe("the host alphabet an address is held to", () => {
  it("takes a plain host, so a refusal below is the alphabet and not the function refusing everything", () => {
    assert.equal(isDeliverableAddress("person@xy.de"), true);
    assert.ok(TAKEN.length > 0 && REFUSED_PAST_THE_URL.length > 0, "a table is empty, so this case compares nothing");
  });

  it("takes a hyphen, a dot and a character above ASCII", () => {
    for (const middle of TAKEN) {
      assert.equal(isDeliverableAddress(hostOf(middle)), true, `expected a host carrying ${JSON.stringify(middle)} to be deliverable`);
    }
  });

  /* Each of these is refused by the alphabet ALONE: drop one from the class and the address is
     accepted, because every check after the alphabet reads the host `new URL` already cleaned. */
  it("refuses what survives the URL parse to reach a later check as a different host", () => {
    for (const middle of REFUSED_PAST_THE_URL) {
      assert.equal(isDeliverableAddress(hostOf(middle)), false, `expected a host carrying ${JSON.stringify(middle)} to be refused`);
    }
  });

  /* One character class cannot backtrack, so a host of nothing but hyphens answers rather than
     hangs. The runner's own timeout is what a regression here would trip. */
  it("answers on a host of twenty thousand hyphens", () => {
    assert.equal(isDeliverableAddress(`person@${"-".repeat(20000)} .de`), false);
  });
});

/** An address of `local@` and thirteen umlaut labels, `pad` ASCII letters, then `.de`: 164 characters at five, 255 octets punycoded. */
const umlautAddressOf = (pad: number): string => `${"a".repeat(64)}@${"müller.".repeat(13)}${"b".repeat(pad)}.de`;

/* The API measures the whole address with its host punycoded, where each `müller` costs thirteen
   octets rather than six characters: read as typed, the refused one is ninety characters short. */
describe("the whole-address ceiling an umlaut domain reaches", () => {
  it("takes the address whose punycoded form is 254 octets and refuses the one at 255", () => {
    assert.equal(isDeliverableAddress(umlautAddressOf(4)), true);
    assert.equal(isDeliverableAddress(umlautAddressOf(5)), false);
    assert.ok(umlautAddressOf(5).length < 254, "the refused address is already over the ceiling as typed, so this compares nothing");
  });

  /* A label of one repeated umlaut punycodes to about an octet a letter and takes two in UTF-8, so
     here the address as typed is what the API refuses, the punycoded form sitting well inside. */
  it("refuses an address whose typed form alone passes the ceiling in UTF-8 octets", () => {
    const address = `a@${Array.from({ length: 3 }, () => "ä".repeat(57)).join(".")}.de`;

    assert.equal(new TextEncoder().encode(address).length, 349);
    assert.ok(address.length < 254, "the address is over the ceiling in characters, so this compares nothing");
    assert.equal(isDeliverableAddress(address), false);
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
      assert.equal(isDeliverableAddress(address), false, `expected ${JSON.stringify(address)} to be refused`);
      assert.equal(hasAsciiLocalPart(address), false, `expected ${JSON.stringify(address)} to be worded as its local part`);
    }
  });

  /* The control: a rule refusing every character above ASCII fails here rather than passing the case above. */
  it("is told apart from one whose domain alone is above ASCII", () => {
    assert.equal(isDeliverableAddress(`anna@m${String.fromCodePoint(0xfc)}ller.de`), true);
    assert.equal(hasAsciiLocalPart(`anna@m${String.fromCodePoint(0xfc)}ller.de`), true);
  });

  it("leaves a value without an at sign to the generic refusal", () => {
    assert.equal(hasAsciiLocalPart(`j${String.fromCodePoint(0xfc)}rgen`), true);
  });
});

/** One table both suites run their own rule and fold over; `fl_backend/tests/shared/test_email_address.py` holds the API's half. */
const ROWS = z
  .array(z.object({ case: z.string(), typed: z.string(), stored: z.string().nullable(), folded: z.string() }))
  .parse(JSON.parse(readFileSync(path.resolve(REPO_ROOT, "fl_backend", "tests", "shared", "email_addresses.json"), "utf8")));

/* Each runtime converts a Unicode domain with its own tables: this table is where the two are held to one answer. */
describe("the address table the API is held to as well", () => {
  for (const row of ROWS) {
    it(`answers ${row.case} as the API does`, () => {
      // Trimmed first, as the address box trims before the rule reads the value.
      const typed = row.typed.trim();
      assert.equal(isDeliverableAddress(typed), row.stored !== null);
      assert.equal(asSignInIdentifier(row.typed), row.folded);
      if (row.stored !== null) {
        // The domain converted as the API stores it, the local part untouched.
        assert.equal(mailboxKey(typed), row.stored);
        assert.equal(asSignInIdentifier(row.stored), row.folded);
      }
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
    assert.equal(withAsciiDomain("person@münchen.de"), "person@xn--mnchen-3ya.de");
    assert.ok(ANSWERED_AS_ANOTHER_HOST.length > 0 && REFUSED_BY_THE_PARSE.length > 0, "a table is empty, so a case below compares nothing");
  });

  /* Each is dropped or read as structure by the parse, which then answers a host the sender never
     typed -- `xü` alone for the punctuation, `xüy.de` for the rest -- and the message goes there. */
  it("refuses a host the parse would answer a different name on", () => {
    for (const middle of ANSWERED_AS_ANOTHER_HOST) {
      assert.equal(withAsciiDomain(convertedHostOf(middle)), undefined, `expected a host carrying ${JSON.stringify(middle)} to be refused`);
    }
  });

  it("refuses a host the parse throws over too", () => {
    for (const middle of REFUSED_BY_THE_PARSE) {
      assert.equal(withAsciiDomain(convertedHostOf(middle)), undefined, `expected a host carrying ${JSON.stringify(middle)} to be refused`);
    }
  });
});

describe("one bare mailbox, the only recipient the mailer takes", () => {
  /* Each a spelling the ban list's keying answers unbarred where a provider may still find a mailbox
     in it: handed on, it reached a barred person past the gate (`docs/frontend/spec.md :: I541`). */
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
      assert.equal(isOneBareMailbox(spelled), false);
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
      assert.equal(isOneBareMailbox(address), true, address);
    }
  });
});
