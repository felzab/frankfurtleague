import { describe, expect, it } from "vitest";

import { describeSaisonTeamsFanOut } from "./fanOutNotes.ts";

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
