import { describe, expect, it } from "vitest";

import { adressenSatz, KEINE_TEAMS, versandSatz } from "./meldungen.ts";

describe("what the invite's two presses report", () => {
  /* The title already names the link's grade in the singular, so a body repeating the link's fate
     word for word says nothing; „1 von 1 Teams“ is what one sentence carrying both figures reads like. */
  it("gives one team the press meant to write to its own sentence, reached and not reached", () => {
    expect(versandSatz(1, 1, 1)).toBe("Der Link ging an das Team.");
    expect(versandSatz(0, 1, 1)).toBe("Das Team hat keinen neuen Link bekommen.");
  });

  /* Above one, both figures are spelled: zero delivered is the answer every stack but production
     gives, so a sentence hiding the shortfall would read as a whole season mailed. */
  it("spells both figures for several teams, the shortfall included", () => {
    expect(versandSatz(2, 3, 3)).toBe("Registrierungslinks gesendet: 2 von 3 Teams.");
    expect(versandSatz(0, 16, 16)).toBe("Registrierungslinks gesendet: 0 von 16 Teams.");
  });

  /* A pass-over is an ordinary state of a season being set up, so it reads as one rather than in a failure's words. */
  it("says a press that meant to write to nobody passed every team over", () => {
    expect(versandSatz(0, 0, 1)).toBe("Das Team wurde übersprungen.");
    expect(versandSatz(0, 0, 4)).toBe("Jedes Team wurde übersprungen.");
  });

  it("names the empty season rather than counting to zero over it", () => {
    expect(versandSatz(0, 0, 0)).toBe(KEINE_TEAMS);
  });

  /* The single press's own sentence, under the same rule: „an 1 Adressen“ is what a count
     interpolated before a plural noun produces. */
  it("recasts the one-address case rather than writing a numeral before a plural noun", () => {
    expect(adressenSatz(1, 1)).toBe("Der Link ist unterwegs.");
    expect(adressenSatz(3, 3)).toBe("Der Link ist an alle 3 Adressen unterwegs.");
    expect(adressenSatz(1, 3)).toBe("Der Link ist unterwegs: 1 von 3.");
  });
});
