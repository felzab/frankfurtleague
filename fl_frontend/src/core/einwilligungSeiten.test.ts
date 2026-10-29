import { readEinwilligungDocument } from "@/test-support/einwilligungDocument.ts";
import { assert, describe, expect, it } from "vitest";

import { EINWILLIGUNG_SEITEN } from "./einwilligungSeiten.ts";

describe("the pages the consent client may ask for", () => {
  /* Both directions: a page the backend runs that this list lacks has no typed way to be asked for,
     and a page listed here that the backend dropped throws at the first render asking for it. */
  it("are exactly the pages the backend runs a label on", () => {
    const laufend = Object.keys(readEinwilligungDocument().laufende_fassungen);

    assert.ok(laufend.length > 0, "the artifact runs no page, so this compares nothing");
    expect([...EINWILLIGUNG_SEITEN].sort()).toStrictEqual([...laufend].sort());
  });
});
