import { describe, expect, it } from "vitest";

import { SCHIEDSRICHTER_RETIREMENT_CONSEQUENCE } from "./constants.ts";

/**
 * The noun's own article is not one — `den Schiedsrichter` names the record. The same sentence in the
 * venue dialog keeps its `Er`, which agrees with a place and must not be recast.
 */
const MASKULIN = /\bdiesen schiedsrichter\b|\bsein(?:e|em|en|er|es)?\b|\b(?:er|ihn|ihm)\b/i;

describe("the retirement dialog's second step", () => {
  it("names the referee neutrally in the consequence it escalates to", () => {
    expect(SCHIEDSRICHTER_RETIREMENT_CONSEQUENCE, "the consequence stopped naming what survives").toMatch(/Schon eingetragene Spiele behalten/);
    expect(SCHIEDSRICHTER_RETIREMENT_CONSEQUENCE, "the consequence names the referee with a masculine word").not.toMatch(MASKULIN);
  });
});
