// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { MatchHead } from "./MatchHead";
import { NONE } from "./MatchRow";

const PAIRING = {
  eyebrow: "1. Spieltag",
  home: { name: "Goethe", plaque: { kuerzel: "GOE" } },
  away: { name: "Helmholtz", plaque: { kuerzel: "HEL" } },
} as const;

describe("the match head", () => {
  it("marks the winner as the bracket card does, and says a shoot-out under the score", () => {
    render(
      <MatchHead
        {...PAIRING}
        result={{ tore: { team1: 2, team2: 2 }, elfmeterschiessen: { team1: 4, team2: 3 } }}
      />,
    );

    expect(screen.getByText("Goethe").className.split(" ")).toContain("font-semibold");
    expect(screen.getByText("Helmholtz").className.split(" ")).not.toContain("font-semibold");
    expect(screen.getByText(COPY.shared.nachElfmeterschiessen)).toBeTruthy();
  });

  it("reads a dash for each side until a result is entered, under the matchday", () => {
    render(<MatchHead {...PAIRING} />);

    expect(screen.getAllByText(NONE)).toHaveLength(2);
    expect(screen.getByText("1. Spieltag")).toBeTruthy();
  });
});
