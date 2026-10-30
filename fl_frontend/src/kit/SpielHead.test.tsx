// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { SpielHead } from "./SpielHead";
import { NONE } from "./SpielRow";

const PAIRING = {
  eyebrow: "1. Spieltag",
  home: { name: "Goethe", plaque: { kuerzel: "GOE" } },
  away: { name: "Helmholtz", plaque: { kuerzel: "HEL" } },
} as const;

describe("the match head", () => {
  it("says a shoot-out under the score", () => {
    render(
      <SpielHead
        {...PAIRING}
        result={{ tore: { team1: 2, team2: 2 }, elfmeterschiessen: { team1: 4, team2: 3 } }}
      />,
    );

    expect(screen.getByText(COPY.shared.nachElfmeterschiessen)).toBeTruthy();
  });

  it("reads a dash for each side until a result is entered, under the matchday", () => {
    render(<SpielHead {...PAIRING} />);

    expect(screen.getAllByText(NONE)).toHaveLength(2);
    expect(screen.getByText("1. Spieltag")).toBeTruthy();
  });
});
