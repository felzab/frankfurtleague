import { describe, expect, it } from "vitest";

import { saisonChipOf } from "./saisonState";

describe("where a season stands", () => {
  // The hue is the state's whole sign on a list of seasons: one state drawn in another's hue reads as that state.
  it("is grey before its start, blue while it runs and green once decided", () => {
    expect([
      saisonChipOf({ begun: false, decided: false }).tone,
      saisonChipOf({ begun: true, decided: false }).tone,
      saisonChipOf({ begun: true, decided: true }).tone,
    ]).toStrictEqual(["neutral", "info", "success"]);
  });
});
