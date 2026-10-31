// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { formatErgebnis } from "@/core/format";

import { SpielList } from "./SpielRow";

const SPIEL = {
  id: "1",
  href: "/saisons/2027",
  when: "Mi, 14.04. · 15:30",
  home: { name: "Goethe", plaque: { kuerzel: "GOE" } },
  away: { name: "Helmholtz", plaque: { kuerzel: "HEL" } },
} as const;

describe("a match row's score", () => {
  it("sets the two figures apart by the mark the formatting module writes between them", () => {
    render(<SpielList matches={[{ ...SPIEL, result: { tore: { team1: 3, team2: 1 } } }]} />);
    const [desktop] = [...screen.getByRole("link").children];
    const score = desktop?.children[2];
    expect(score?.textContent).toBe(formatErgebnis({ team1: 3, team2: 1 }));
  });
});

describe("a match row's chevron", () => {
  it("ends the desktop row, which stands in a list, and is left off the phone's card", () => {
    render(<SpielList matches={[SPIEL]} />);
    const [desktop, phone] = [...screen.getByRole("link").children];
    expect(desktop?.lastElementChild?.querySelector("svg")).not.toBe(null);
    // The phone's card draws its plaques, and no other glyph.
    expect(phone?.querySelector("svg")).toBe(null);
  });
});
