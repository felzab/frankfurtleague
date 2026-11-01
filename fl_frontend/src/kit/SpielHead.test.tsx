// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { SpielHead } from "./SpielHead";
import { NONE } from "./SpielRow";

import type { ComponentProps } from "react";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

const PAIRING = {
  eyebrow: "1. Spieltag",
  home: { name: "Goethe", plaque: { kuerzel: "GOE" } },
  away: { name: "Helmholtz", plaque: { kuerzel: "HEL" } },
} as const;

describe("the match head's clubs", () => {
  it("links each club's name to its page and the line under it to where the club stands", () => {
    render(
      <SpielHead
        {...PAIRING}
        home={{
          ...PAIRING.home,
          href: "/saisons/2027/teams/goe",
          standing: { text: "1. Platz · Gruppe A", href: "/saisons/2027/tabelle#goe" },
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "Goethe" }).getAttribute("href")).toBe("/saisons/2027/teams/goe");
    expect(screen.getByRole("link", { name: "1. Platz · Gruppe A" }).getAttribute("href")).toBe("/saisons/2027/tabelle#goe");
    // A club not yet linked keeps its name as text.
    expect(screen.queryByRole("link", { name: "Helmholtz" })).toBeNull();
  });
});

describe("the match head", () => {
  it("says a shoot-out under the score", () => {
    render(
      <SpielHead
        {...PAIRING}
        result={{ tore: { team1: 2, team2: 2 }, elfmeterschiessen: { team1: 4, team2: 3 } }}
      />,
    );

    expect(screen.getByText(COPY.shared.afterElfmeterschiessen)).toBeTruthy();
  });

  it("reads a dash for each side until a result is entered, under the matchday", () => {
    render(<SpielHead {...PAIRING} />);

    expect(screen.getAllByText(NONE)).toHaveLength(2);
    expect(screen.getByText("1. Spieltag")).toBeTruthy();
  });
});

describe("the match head's club names", () => {
  // jsdom lays nothing out, so the cut is held by Tailwind's `truncate`, and `max-w-full`, which keeps a
  // centred grid item from growing past its third of the head.
  it("are cut with „…“ where too long, each whole in its title", () => {
    render(
      <SpielHead
        {...PAIRING}
        home={{ ...PAIRING.home, href: "/saisons/2027/teams/goe" }}
      />,
    );

    for (const club of ["Goethe", "Helmholtz"]) {
      const name = screen.getByTitle(club);
      expect(name.textContent).toBe(club);
      expect([...name.classList]).toEqual(expect.arrayContaining(["truncate", "max-w-full"]));
    }
  });
});
