import { describe, expect, it } from "vitest";

import { describeSaisonTeamsFanOut, describeSpieleFanOut } from "./fanOutNotes.ts";

describe("describeSpieleFanOut", () => {
  it("names the scope on a zero rather than claiming the club has no fixture", () => {
    expect(describeSpieleFanOut(0)).toBe("In den laufenden und geplanten Saisons wurden Name und Kürzel an keinem Spiel geändert.");
    // The count is `modified_count`, so a row already holding the submitted values reaches this
    // zero too. Claiming the club has no fixture would be false in exactly that case.
    expect(describeSpieleFanOut(0)).not.toMatch(/kein Spiel/);
  });

  it("reads as one match in the singular", () => {
    expect(describeSpieleFanOut(1)).toBe("Name und Kürzel wurden in 1 Spiel nachgezogen.");
  });

  it("counts the matches it rewrote", () => {
    expect(describeSpieleFanOut(14)).toBe("Name und Kürzel wurden in 14 Spielen nachgezogen.");
  });
});

describe("describeSaisonTeamsFanOut", () => {
  // Three states share this zero: every season closed, no junction row at all, and rows that
  // already hold the submitted values, since the count is `modified_count`. The sentence may name
  // the scope and never the cause.
  it("names the scope on a zero rather than a cause it cannot tell apart", () => {
    expect(describeSaisonTeamsFanOut(0)).toBe(
      "Kein Eintrag in einer laufenden oder geplanten Saison wurde geändert. Nur dort werden Name und Kürzel nachgezogen.",
    );
    expect(describeSaisonTeamsFanOut(0)).not.toMatch(/abgeschlossen/);
    expect(describeSaisonTeamsFanOut(0)).not.toMatch(/ist in keiner/);
  });

  it("reads as one season in the singular", () => {
    expect(describeSaisonTeamsFanOut(1)).toBe("1 Saison trägt den neuen Namen und das neue Kürzel.");
  });

  it("counts the seasons it rewrote", () => {
    expect(describeSaisonTeamsFanOut(3)).toBe("3 Saisons tragen den neuen Namen und das neue Kürzel.");
  });
});

// The whole reason the two counts are separate sentences: a shared one would have to pick a meaning
// for zero, and the two zeros do not share one.
describe("the two zero cases", () => {
  it("never share a sentence", () => {
    expect(describeSpieleFanOut(0)).not.toBe(describeSaisonTeamsFanOut(0));
  });
});
