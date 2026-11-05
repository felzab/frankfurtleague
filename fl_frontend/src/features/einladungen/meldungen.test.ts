import { describe, expect, it } from "vitest";

import { adressenSatz } from "./meldungen.ts";

describe("what the invite's single press reports", () => {
  /* „an 1 Adressen“ is what a count interpolated before a plural noun produces. */
  it("recasts the one-address case rather than writing a numeral before a plural noun", () => {
    expect(adressenSatz(1, 1)).toBe("Der Link ist unterwegs.");
    expect(adressenSatz(3, 3)).toBe("Der Link ist an alle 3 Adressen unterwegs.");
    expect(adressenSatz(1, 3)).toBe("Der Link ist unterwegs: 1 von 3.");
  });
});
