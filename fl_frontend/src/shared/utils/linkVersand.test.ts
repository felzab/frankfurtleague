import { describe, expect, it } from "vitest";

import { schlechtesterVersand, versandGrad, versandWarnt } from "./linkVersand.ts";

import type { LinkVersand, VersandGrad } from "./linkVersand.ts";

/** Every way a link mail ends, and the grade its administrator is told (`docs/frontend/spec.md :: I725`). */
const GRADE: readonly (readonly [LinkVersand, VersandGrad])[] = [
  ["gesendet", "gesendet"],
  ["fehlgeschlagen", "fehlgeschlagen"],
  // Filed and never sent, and never a failure (`docs/frontend/spec.md :: I542`).
  ["gesperrt", "abgelegt"],
  ["zurueckgehalten", "abgelegt"],
];

describe("the grade of a link mail", () => {
  it("grades every way a link mail ends", () => {
    expect(GRADE.map(([versand]) => [versand, versandGrad(versand)])).toStrictEqual(GRADE);
  });

  /* A write whose title names its own outcome warns for any link that did not go out, and for none it never sent. */
  it("warns for every link but a sent one, and for no link at all never", () => {
    expect(GRADE.map(([versand]) => [versand, versandWarnt(versand)])).toStrictEqual([
      ["gesendet", false],
      ["fehlgeschlagen", true],
      ["gesperrt", true],
      ["zurueckgehalten", true],
    ]);
    expect(versandWarnt(undefined)).toBe(false);
  });
});

describe("the one report of a write sending several links", () => {
  /* The order of the sends is the order of the seats, so a worse link after a better one is the case a
     reader taking the first or the last would miss. */
  it("reports the worst-graded link, a failure ahead of one held back ahead of a sent one", () => {
    expect(schlechtesterVersand(["gesendet", "gesperrt", "gesendet"])).toBe("gesperrt");
    expect(schlechtesterVersand(["zurueckgehalten", "fehlgeschlagen", "gesendet"])).toBe("fehlgeschlagen");
    expect(schlechtesterVersand(["gesendet", "gesendet"])).toBe("gesendet");
  });

  it("reports nothing for a write that sent no link", () => {
    expect(schlechtesterVersand([])).toBe(undefined);
  });
});
