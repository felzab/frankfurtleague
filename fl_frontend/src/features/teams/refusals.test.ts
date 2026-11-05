import { answerShown } from "@/test-support/refusals.ts";
import { describe, expect, it } from "vitest";

import { mapEntryRefusal } from "./refusals.ts";

/* A code its mapper leaves out reaches the admin as the generic failure, whose retry the same rule refuses again. */
describe("the club editor's season panel", () => {
  it("answers a finished season on the season row's edit", () => {
    expect(answerShown("saison_past", mapEntryRefusal)).not.toBe(null);
  });
});
