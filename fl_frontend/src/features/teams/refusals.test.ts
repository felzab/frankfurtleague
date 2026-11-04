import { answerShown, refusalCodes } from "@/test-support/refusals.ts";
import { describe, expect, it } from "vitest";

import { mapEntryRefusal, mapReplacementRefusal } from "./refusals.ts";

/* A code its mapper leaves out reaches the admin as the generic failure, whose retry the same rule refuses again. */
describe("the club editor's season panel", () => {
  it("answers every refusal the replacement publishes", () => {
    for (const code of refusalCodes(
      "document_not_found",
      "saison_past",
      "replace_saison_started",
      "sides_taken_place",
      "replace_incoming_already_entered",
      "replace_one_team_on_both_ends",
      "team_retired",
    )) {
      expect(answerShown(code, mapReplacementRefusal), `${code} reaches the admin as a generic failure`).not.toBe(null);
    }
  });

  it("answers a finished season on the season row's edit", () => {
    expect(answerShown("saison_past", mapEntryRefusal)).not.toBe(null);
  });
});
