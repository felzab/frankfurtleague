import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { adressenSatz, KEINE_TEAMS, versandSatz } from "./meldungen.ts";

describe("what the invite's two presses report", () => {
  /* A season of one team is the ordinary start of a season, and „1 von 1 Teams“ is what one
     sentence carrying both figures reads like there. */
  it("gives a season of one team its own sentence, reached and not reached", () => {
    assert.equal(versandSatz(1, 1), "Registrierungslink gesendet: an das Team.");
    assert.equal(versandSatz(0, 1), "Registrierungslink nicht gesendet.");
  });

  /* Above one, both figures are spelled: zero delivered is the answer every stack but production
     gives, so a sentence hiding the shortfall would read as a whole season mailed. */
  it("spells both figures for a season of several teams, the shortfall included", () => {
    assert.equal(versandSatz(2, 3), "Registrierungslinks gesendet: 2 von 3 Teams.");
    assert.equal(versandSatz(0, 16), "Registrierungslinks gesendet: 0 von 16 Teams.");
  });

  it("names the empty season rather than counting to zero over it", () => {
    assert.equal(versandSatz(0, 0), KEINE_TEAMS);
  });

  /* The single press's own sentence, under the same rule: „an 1 Adressen“ is what a count
     interpolated before a plural noun produces. */
  it("recasts the one-address case rather than writing a numeral before a plural noun", () => {
    assert.equal(adressenSatz(1, 1), "Der Link ist unterwegs.");
    assert.equal(adressenSatz(3, 3), "Der Link ist an alle 3 Adressen unterwegs.");
    assert.equal(adressenSatz(1, 3), "Der Link ist unterwegs: 1 von 3.");
  });
});
