import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isDeliverableAddress } from "@/core/emailAddress";

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
