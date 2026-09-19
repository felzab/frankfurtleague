import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classListsIn, classTokensIn } from "./classTokens.ts";

/** A recipe's own literal, a list parted by a hole, and the grade named in prose beside them. */
const SAMPLE = `
// \`bg-brand\` under \`animate-ping\`, never the solid fill.
const chip = "px-2 py-1";
const dot = \`bg-brand \${size} animate-ping\`;
const bare = <span className="gap-2" />;
`;

describe("the literal readers every class sweep goes through", () => {
  /* Read off the literals and not the raw text: the grades are argued in prose wherever they are
     chosen, and a matcher counting occurrences reads those comments as class lists. */
  it("read no token out of a comment", () => {
    assert.ok(!classTokensIn("sample.tsx", SAMPLE).includes("never"));
    assert.deepEqual(
      classListsIn("sample.tsx", SAMPLE).filter((list) => list.includes("never")),
      [],
    );
  });

  it("join a template's chunks into one list and keep separate literals apart", () => {
    const lists = classListsIn("sample.tsx", SAMPLE);

    assert.ok(
      lists.some((list) => list.includes("bg-brand") && list.includes("animate-ping")),
      "a list parted by a hole reads as two",
    );
    assert.ok(!lists.some((list) => list.includes("px-2") && list.includes("gap-2")), "two literals read as one list");
  });

  it("flatten to the same tokens the lists hold", () => {
    assert.deepEqual(classTokensIn("sample.tsx", SAMPLE).sort(), classListsIn("sample.tsx", SAMPLE).flat().sort());
  });
});
