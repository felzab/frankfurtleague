import { answerShown } from "@/test-support/refusals.ts";
import { describe, expect, it } from "vitest";

import { mapSpielRefusal } from "./refusals.ts";

describe("the classic match editor's refusals", () => {
  /* Its save and its dry run alike: left to the generic failure, the admin is sent to a retry the same rule refuses. */
  it("answers a finished season", () => {
    expect(answerShown("saison_past", mapSpielRefusal)).not.toBe(null);
  });
});
