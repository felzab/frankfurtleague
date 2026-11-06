import { describe, expect, it } from "vitest";

// Relative import, not the "@/" alias: Node's resolver does not read tsconfig paths.
import { nummerPayload } from "./utils.ts";

describe("nummerPayload", () => {
  // Both squad forms send through it, so one number is never refused on one form and taken on the other.
  it("sends a number without the space around it, and an emptied box as no number", () => {
    expect(nummerPayload(" 7 ")).toBe("7");
    expect(nummerPayload("  ")).toBe(null);
    expect(nummerPayload(null)).toBe(null);
  });
});
