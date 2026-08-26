import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeSaisonTeamsFanOut, describeSpieleFanOut } from "./fanOutNotes.ts";

describe("describeSpieleFanOut", () => {
  it("names the scope on a zero rather than claiming the club has no fixture", () => {
    assert.equal(describeSpieleFanOut(0), "In den laufenden und geplanten Saisons wurden Name und Kürzel an keinem Spiel geändert.");
    // The count is `modified_count`, so a row already holding the submitted values reaches this
    // zero too. Claiming the club has no fixture would be false in exactly that case.
    assert.doesNotMatch(describeSpieleFanOut(0), /kein Spiel/);
  });

  it("reads as one match in the singular", () => {
    assert.equal(describeSpieleFanOut(1), "Name und Kürzel wurden in 1 Spiel nachgezogen.");
  });

  it("counts the matches it rewrote", () => {
    assert.equal(describeSpieleFanOut(14), "Name und Kürzel wurden in 14 Spielen nachgezogen.");
  });
});

describe("describeSaisonTeamsFanOut", () => {
  // Three states share this zero: every season closed, no junction row at all, and rows that
  // already hold the submitted values, since the count is `modified_count`. The sentence may name
  // the scope and never the cause.
  it("names the scope on a zero rather than a cause it cannot tell apart", () => {
    assert.equal(
      describeSaisonTeamsFanOut(0),
      "Kein Eintrag in einer laufenden oder geplanten Saison wurde geändert; nur dort werden Name und Kürzel nachgezogen.",
    );
    assert.doesNotMatch(describeSaisonTeamsFanOut(0), /abgeschlossen/);
    assert.doesNotMatch(describeSaisonTeamsFanOut(0), /ist in keiner/);
  });

  it("reads as one season in the singular", () => {
    assert.equal(describeSaisonTeamsFanOut(1), "1 Saison trägt den neuen Namen und das neue Kürzel.");
  });

  it("counts the seasons it rewrote", () => {
    assert.equal(describeSaisonTeamsFanOut(3), "3 Saisons tragen den neuen Namen und das neue Kürzel.");
  });
});

// The whole reason the two counts are separate sentences: a shared one would have to pick a meaning
// for zero, and the two zeros do not share one.
describe("the two zero cases", () => {
  it("never share a sentence", () => {
    assert.notEqual(describeSpieleFanOut(0), describeSaisonTeamsFanOut(0));
  });
});
