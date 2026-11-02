// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BracketCard } from "./BracketCard";

import type { ComponentProps } from "react";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

describe("a bracket card", () => {
  it("sets both figures bold after a shoot-out, the loser's as the winner's", () => {
    render(
      <BracketCard
        href="/saisons/2027/spiele/64b000000000000000000001"
        when="Termin offen"
        home={{ name: "Goethe", plaque: { kuerzel: "GOE" } }}
        away={{ name: "Helmholtz", plaque: { kuerzel: "HEL" } }}
        result={{ tore: { team1: 1, team2: 1 }, elfmeterschiessen: { team1: 4, team2: 3 } }}
      />,
    );

    // Each side's goals with its shoot-out goals added: 5 for the winner, 4 for the loser.
    for (const figure of ["5", "4"]) {
      const classes = screen.getByText(figure).className.split(" ");
      expect(classes).toContain("font-bold");
      expect(classes).not.toContain("font-normal");
    }
  });

  // jsdom applies no stylesheet, so the phone's hiding is read from the class: `sr-only` keeps the words in the
  // accessibility tree where `hidden` would take them out of the link's name.
  it("names its link by both clubs on a phone, which draws the plaques alone, and titles a cut name", () => {
    render(
      <BracketCard
        href="/saisons/2027/spiele/64b000000000000000000001"
        when="Termin offen"
        home={{ name: "Carlo-Mierendorff-Schule", plaque: { kuerzel: "CMS" } }}
        away={{ name: "Helmholtzschule", plaque: { kuerzel: "HEL" } }}
      />,
    );

    for (const name of ["Carlo-Mierendorff-Schule", "Helmholtzschule"]) {
      const words = screen.getByText(name);
      expect(words.classList).toContain("max-lg:sr-only");
      expect(words.className).not.toMatch(/(^|\s)max-lg:hidden(\s|$)/);
      expect(words.getAttribute("title")).toBe(name);
      expect(words.closest("a")).not.toBe(null);
    }
  });
});
