import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { joinUnd } from "./joinUnd.ts";

describe("joinUnd", () => {
  /* A plain `join(" und ")` reads „A und B und C“ from the third label on, which is the shape a seat
     list reaches as soon as one person holds two seats beside a third. */
  it("parts every label but the last with a comma", () => {
    assert.equal(joinUnd(["Ansprechperson", "Stellvertretung", "Trainer"]), "Ansprechperson, Stellvertretung und Trainer");
    assert.equal(joinUnd(["Ansprechperson", "Trainer"]), "Ansprechperson und Trainer");
  });

  it("answers one label as itself, and an empty list as nothing", () => {
    assert.equal(joinUnd(["Trainer"]), "Trainer");
    assert.equal(joinUnd([]), "");
  });
});
