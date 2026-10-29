import { describe, expect, it } from "vitest";

import { joinUnd } from "./joinUnd.ts";

describe("joinUnd", () => {
  /* A plain `join(" und ")` reads „A und B und C“ from the third label on, which is the shape a seat
     list reaches as soon as one person holds two seats beside a third. */
  it("parts every label but the last with a comma", () => {
    expect(joinUnd(["Ansprechperson", "Stellvertretung", "Trainer"])).toBe("Ansprechperson, Stellvertretung und Trainer");
    expect(joinUnd(["Ansprechperson", "Trainer"])).toBe("Ansprechperson und Trainer");
  });

  it("answers one label as itself, and an empty list as nothing", () => {
    expect(joinUnd(["Trainer"])).toBe("Trainer");
    expect(joinUnd([])).toBe("");
  });
});
