import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SCHIEDSRICHTER_RETIREMENT_CONSEQUENCE } from "./constants.ts";

/**
 * The noun's own article is not one — `den Schiedsrichter` names the record. The same sentence in the
 * venue dialog keeps its `Er`, which agrees with a place and must not be recast.
 */
const MASKULIN = /\bdiesen schiedsrichter\b|\bsein(?:e|em|en|er|es)?\b|\b(?:er|ihn|ihm)\b/i;

describe("the retirement dialog's second step", () => {
  it("names the referee neutrally in the consequence it escalates to", () => {
    assert.match(SCHIEDSRICHTER_RETIREMENT_CONSEQUENCE, /Schon eingetragene Spiele behalten/, "the consequence stopped naming what survives");
    assert.doesNotMatch(SCHIEDSRICHTER_RETIREMENT_CONSEQUENCE, MASKULIN, "the consequence names the referee with a masculine word");
  });
});
