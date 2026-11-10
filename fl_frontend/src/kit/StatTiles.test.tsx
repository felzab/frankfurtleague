// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { StatTiles } from "./StatTiles";

import type { ComponentProps } from "react";
import type { StatTile } from "./StatTiles";

// Next's link, standing in as an anchor that says it navigates on the client.
vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentProps<"a">) => (
    <a
      data-client-navigation
      {...props}>
      {children}
    </a>
  ),
}));

const CLUB = "/saisons/2027/teams/64b000000000000000000001";

/** A pupil's four tiles, the club's first, as the tile under test. */
function tiles(team: StatTile) {
  return [
    team,
    { label: COPY.admin.spieler.nummer, value: { record: "9" } },
    { label: COPY.admin.spieler.position, value: { record: "Angriff" }, words: true },
    { label: COPY.admin.spieler.stufe, value: { record: "Q2" }, words: true },
  ] as const;
}

describe("a tile's value", () => {
  it("carries its chip directly after it, inside the value the label names", () => {
    render(
      <StatTiles
        layout="four"
        items={tiles({
          label: COPY.shared.facts.team,
          value: { record: "Ahorn" },
          words: true,
          chip: { tone: "info", label: COPY.admin.spieler.nominee },
        })}
      />,
    );
    const value = screen.getByText(COPY.shared.facts.team).nextElementSibling;
    expect(value?.tagName).toBe("DD");
    expect(value?.textContent).toBe(`Ahorn${COPY.admin.spieler.nominee}`);
  });

  it("links a page of the site through Next's link, in the same tab", () => {
    render(
      <StatTiles
        layout="four"
        items={tiles({ label: COPY.shared.facts.team, value: { record: "Ahorn" }, words: true, href: CLUB })}
      />,
    );
    const link = screen.getByRole("link", { name: "Ahorn" });
    expect(link.getAttribute("href")).toBe(CLUB);
    expect(link.hasAttribute("data-client-navigation")).toBe(true);
    expect(link.getAttribute("target")).toBe(null);
  });
});
