import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isRefusalCode, PROTOCOL_FAMILIES } from "@/core/errors.ts";
import { publishedProtocolFamilies } from "@/core/openapiDocument.ts";

describe("the protocol's code families", () => {
  /* A family the backend publishes and this frontend lacks is read as a rule's and asked of every slice's
     mapper; one this frontend holds and the backend does not hides a rule's code from every mapper. */
  it("are exactly the ones the document publishes", () => {
    assert.deepEqual([...PROTOCOL_FAMILIES].sort(), [...publishedProtocolFamilies()].sort());
  });

  /* The list is held above; this holds the predicate built from it, which no other case reads family by family. */
  it("each hand no code of theirs to a slice's mapper", () => {
    for (const name of publishedProtocolFamilies()) assert.equal(isRefusalCode(`REQ-${name}-001`), false, name);
  });
});
