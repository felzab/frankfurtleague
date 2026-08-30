import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { enteredNumber } from "./numberField.ts";

describe("enteredNumber", () => {
  it("records an emptied box as nothing entered", () => {
    // `NaN` is what react-aria reports for a cleared field; `undefined` is what it reports before a commit.
    assert.equal(enteredNumber(Number.NaN), null);
    assert.equal(enteredNumber(undefined), null);
  });

  it("keeps a typed zero, which is the whole distinction", () => {
    // A fixture that ended 0:0 is not a fixture with no result recorded.
    assert.equal(enteredNumber(0), 0);
  });

  it("passes every other number through untouched", () => {
    assert.equal(enteredNumber(7), 7);
    assert.equal(enteredNumber(-3), -3);
  });
});
