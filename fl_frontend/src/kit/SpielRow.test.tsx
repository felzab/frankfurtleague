// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";
import { formatErgebnis } from "@/core/format";

import { SpielList } from "./SpielRow";

const SPIEL = {
  id: "1",
  href: "/saisons/2027",
  when: COPY.spielplan.when("2027-04-14", "15:30"),
  team1: { name: { record: "Goethe" }, plaque: { record: "GOE" } },
  team2: { name: { record: "Helmholtz" }, plaque: { record: "HEL" } },
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

describe("a match row's club names", () => {
  // jsdom lays nothing out, so the cut is held by Tailwind's `truncate` on each name in both forms.
  it("are cut with „…“ in both forms where too long, each whole in its title", () => {
    render(<SpielList matches={[SPIEL]} />);
    const names = screen.getAllByTitle("Goethe");
    expect(names).toHaveLength(2);
    for (const name of names) {
      expect(name.textContent).toBe("Goethe");
      expect(name.classList).toContain("truncate");
    }
  });
});
