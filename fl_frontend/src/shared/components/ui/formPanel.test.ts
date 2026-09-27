import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formPanel } from "./formPanel";

describe("the panel an editor's section stands in", () => {
  /* Inherited by every sentence in the body, at every tone: a sentence may name a person or a team as
     somebody typed it, one word wider than the panel on a phone. */
  it("breaks a word wider than its body inside it", () => {
    for (const tone of ["neutral", "danger"] as const) {
      assert.ok(formPanel({ tone }).body().split(" ").includes("wrap-break-word"), `the ${tone} panel's body runs a long word past its edge`);
    }
  });
});
