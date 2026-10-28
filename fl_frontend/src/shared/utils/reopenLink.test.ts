import { describe, expect, it } from "vitest";

import { ANTWORT_NEU_OEFFNEN, FASSUNG_NEU_OEFFNEN, REGISTRIERUNG_NEU_OEFFNEN } from "./reopenLink.ts";

/* The visitor already stands on the page the link opened, so a sentence asking the link opened without „erneut“, the
   one word for again (`docs/frontend/spec.md` §1.12), reads as an opening they have made and sends them nowhere. */
describe("the sentences that send a visitor back to their link", () => {
  it("ask the link reopened „erneut“, each of them", () => {
    for (const satz of [ANTWORT_NEU_OEFFNEN, FASSUNG_NEU_OEFFNEN, REGISTRIERUNG_NEU_OEFFNEN]) {
      expect(satz, satz).toMatch(/Öffne den Link [^.]*erneut/);
    }
  });
});
