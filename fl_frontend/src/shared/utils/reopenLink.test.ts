import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ANTWORT_NEU_OEFFNEN, FASSUNG_NEU_OEFFNEN, REGISTRIERUNG_NEU_OEFFNEN } from "./reopenLink.ts";

/* Reopening a link is „noch einmal“ in every sentence that asks it, „erneut“ being the retry of an
   answer: one act in two words reads as two acts. */
describe("the sentences that send a visitor back to their link", () => {
  it("ask the link reopened „noch einmal“, each of them", () => {
    for (const satz of [ANTWORT_NEU_OEFFNEN, FASSUNG_NEU_OEFFNEN, REGISTRIERUNG_NEU_OEFFNEN]) {
      assert.match(satz, /Öffne den Link [^.]*noch einmal/, satz);
    }
  });
});
