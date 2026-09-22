import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isDeliverableAddress, withAsciiDomain } from "@/core/emailAddress";

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

/** Built rather than spelled: written into the source it would attach to the quote in front of it. */
const COMBINING_ACUTE = String.fromCharCode(0x301);

describe("where the local part admits a combining mark", () => {
  /* Both directions, or a guard banning the mark everywhere passes too: the mark is atext above
     ASCII like any other, and its OPENING position alone is what the refusal is about. */
  it("refuses one that opens the local part, and takes one inside it", () => {
    assert.equal(isDeliverableAddress(`${COMBINING_ACUTE}vorstand@schule.de`), false);
    assert.equal(isDeliverableAddress(`vorstand${COMBINING_ACUTE}@schule.de`), true);
  });
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
