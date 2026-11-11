import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { spielChipOf } from "./spielChip";

const CONFIRMED = { sonderereignis: null, starts: null, ansetzung_confirmed: true } as const;

// The owner's rule for a match card's one chip: what befell the match first, else the pupil's place in the line-up,
// „Vorläufig“ only where neither applies. A wrong chip shows a pupil a state their read does not say.
describe("the chip on a pupil's match card", () => {
  it("leaves a match something befell to that event's own chip, whatever the line-up says", () => {
    expect(spielChipOf({ ...CONFIRMED, sonderereignis: "ausgefallen", starts: true }, false)).toBe(undefined);
  });

  it.each([
    [true, COPY.area.spieler.lineupPlace.starts],
    [false, COPY.area.spieler.lineupPlace.bench],
  ])("names the pupil's place where the line-up names them (starts %s), over an unconfirmed date", (starts, label) => {
    expect(spielChipOf({ ...CONFIRMED, starts, ansetzung_confirmed: false }, false)?.label).toBe(label);
  });

  it("says „Vorläufig“ for an unconfirmed date the line-up leaves the pupil out of", () => {
    expect(spielChipOf({ ...CONFIRMED, ansetzung_confirmed: false }, false)?.label).toBe(COPY.admin.spiel.provisional);
    expect(spielChipOf(CONFIRMED, false)).toBe(undefined);
  });

  // The page's own test holds that a deregistered pupil's card names no place; the match's date stays a fact of it.
  it("still says „Vorläufig“ on a deregistered pupil's card", () => {
    expect(spielChipOf({ ...CONFIRMED, starts: false, ansetzung_confirmed: false }, true)?.label).toBe(COPY.admin.spiel.provisional);
  });
});
