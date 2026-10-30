import { describe, expect, it } from "vitest";

import { versandGrad, versandWarnt } from "./linkVersand.ts";

import type { LinkVersand, VersandGrad } from "./linkVersand.ts";

/** Every way a link mail ends, and the grade its administrator is told. */
const GRADE: readonly (readonly [LinkVersand, VersandGrad])[] = [
  ["gesendet", "gesendet"],
  ["fehlgeschlagen", "fehlgeschlagen"],
  // Filed and never sent, and never a failure.
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
