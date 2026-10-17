import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { adressenSatz, KEINE_TEAMS, versandSatz } from "./meldungen.ts";

describe("what the invite's two presses report", () => {
  /* The title already names the link's grade in the singular, so a body repeating the link's fate
     word for word says nothing; „1 von 1 Teams“ is what one sentence carrying both figures reads like. */
  it("gives one team the press meant to write to its own sentence, reached and not reached", () => {
    assert.equal(versandSatz(1, 1, 1), "Der Link ging an das Team.");
    assert.equal(versandSatz(0, 1, 1), "Das Team hat keinen neuen Link bekommen.");
  });

  /* Above one, both figures are spelled: zero delivered is the answer every stack but production
     gives, so a sentence hiding the shortfall would read as a whole season mailed. */
  it("spells both figures for several teams, the shortfall included", () => {
    assert.equal(versandSatz(2, 3, 3), "Registrierungslinks gesendet: 2 von 3 Teams.");
    assert.equal(versandSatz(0, 16, 16), "Registrierungslinks gesendet: 0 von 16 Teams.");
  });

  /* A pass-over is an ordinary state of a season being set up, so it reads as one rather than in a failure's words. */
  it("says a press that meant to write to nobody passed every team over", () => {
    assert.equal(versandSatz(0, 0, 1), "Das Team wurde übersprungen.");
    assert.equal(versandSatz(0, 0, 4), "Jedes Team wurde übersprungen.");
  });

  it("names the empty season rather than counting to zero over it", () => {
    assert.equal(versandSatz(0, 0, 0), KEINE_TEAMS);
  });

  /* The single press's own sentence, under the same rule: „an 1 Adressen“ is what a count
     interpolated before a plural noun produces. */
  it("recasts the one-address case rather than writing a numeral before a plural noun", () => {
    assert.equal(adressenSatz(1, 1), "Der Link ist unterwegs.");
    assert.equal(adressenSatz(3, 3), "Der Link ist an alle 3 Adressen unterwegs.");
    assert.equal(adressenSatz(1, 3), "Der Link ist unterwegs: 1 von 3.");
  });
});
