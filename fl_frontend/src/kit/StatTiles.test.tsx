// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { StatTiles } from "./StatTiles";

import type { StatTile } from "./StatTiles";

const FOUR = [
  { label: COPY.spielplan.fact.spieltag, value: { record: "1." }, line: COPY.shared.phase.gruppenphase },
  { label: COPY.spielplan.fact.date, value: { record: "Sa., 06.03.2027" } },
  { label: COPY.spielplan.fact.time, value: { record: "14:00" } },
  { label: COPY.spielplan.fact.spielort, value: { record: "Sportplatz Ahornweg" }, words: true },
] as const satisfies readonly StatTile[];

describe("the stat tiles", () => {
  it("name each value by its label, the line under the value, in one tile each", () => {
    render(
      <StatTiles
        layout="four"
        items={FOUR}
      />,
    );
    // A definition list: each tile a term followed by its value and, where one is due, its line.
    const tiles = screen.getAllByRole("term").map((term) => term.parentElement);
    expect(tiles).toHaveLength(4);
    const read = tiles.map((tile) => [
      within(tile as HTMLElement).getByRole("term").textContent,
      ...within(tile as HTMLElement)
        .getAllByRole("definition")
        .map((value) => value.textContent),
    ]);
    expect(read).toEqual([
      [COPY.spielplan.fact.spieltag, "1.", "Gruppenphase"],
      [COPY.spielplan.fact.date, "Sa., 06.03.2027"],
      [COPY.spielplan.fact.time, "14:00"],
      [COPY.spielplan.fact.spielort, "Sportplatz Ahornweg"],
    ]);
  });
});

describe("a tile whose value stands on another site", () => {
  // The match page's venue opens its map, as the pop-up's venue does; the tile's value is the one way to it.
  it("draws its value as a link to it, opening a new tab", () => {
    const map = "https://www.google.com/maps/search/?api=1&query=Sportplatz";
    render(
      <StatTiles
        layout="four"
        items={[FOUR[0], FOUR[1], FOUR[2], { ...FOUR[3], href: map }]}
      />,
    );
    const link = screen.getByRole("link", { name: "Sportplatz Ahornweg" });
    expect(link.getAttribute("href")).toBe(map);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.closest("dd")).not.toBeNull();
  });
});
