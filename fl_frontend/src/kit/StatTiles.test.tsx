// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { StatTiles } from "./StatTiles";

import type { StatTile } from "./StatTiles";

const FOUR = [
  { label: COPY.spielplan.fact.spieltag, value: "1.", line: "Gruppenphase" },
  { label: COPY.spielplan.fact.datum, value: "06.03.", line: "Samstag 2027" },
  { label: COPY.spielplan.fact.uhrzeit, value: "14:00" },
  { label: COPY.spielplan.fact.spielort, value: "Sportplatz Ahornweg", words: true },
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
      [COPY.spielplan.fact.datum, "06.03.", "Samstag 2027"],
      [COPY.spielplan.fact.uhrzeit, "14:00"],
      [COPY.spielplan.fact.spielort, "Sportplatz Ahornweg"],
    ]);
  });
});

const FIVE = [
  { label: COPY.spielplan.fact.spieltag, value: "1." },
  { label: COPY.spielplan.fact.datum, value: "06.03.", line: "Samstag 2027" },
  { label: COPY.spielplan.fact.uhrzeit, value: "14:00" },
  { label: COPY.spielplan.fact.schiedsrichter, value: "2" },
  { label: COPY.spielplan.fact.spielort, value: "Sportplatz Ahornweg", words: true },
] as const satisfies readonly StatTile[];

/** Each tile's classes, in the list's order. */
const tileClasses = () => screen.getAllByRole("term").map((term) => term.parentElement?.className.split(" ") ?? []);

// jsdom lays nothing out, so the tiles' geometry is held by their classes.
describe("a tile's contents", () => {
  it("keep a label on one line, cut past its tile, and a figure whole on its line", () => {
    render(
      <StatTiles
        layout="five"
        items={FIVE}
      />,
    );
    for (const term of screen.getAllByRole("term")) {
      expect(term.classList).toContain("truncate");
      // The capitals' tracking would push „Schiedsrichter“ past a tile's edge.
      expect(term.className).not.toMatch(/tracking-/);
    }
    for (const value of ["1.", "06.03.", "14:00", "2"]) {
      const classes = screen.getByText(value).className;
      expect(classes).toMatch(/(^|\s)whitespace-nowrap(\s|$)/);
      expect(classes).not.toMatch(/overflow-wrap|break-/);
    }
  });

  it("set side by side on one baseline, each tile taking its rows from the list", () => {
    render(
      <StatTiles
        layout="four"
        items={FOUR}
      />,
    );
    for (const tile of tileClasses()) expect(tile).toEqual(expect.arrayContaining(["row-span-3", "grid-rows-subgrid", "items-baseline"]));
  });
});

describe("a match's five facts", () => {
  it("stand two a row on a phone with the fifth wide, and five equal tiles in one row from `lg`, each at its natural height", () => {
    render(
      <StatTiles
        layout="five"
        items={FIVE}
      />,
    );
    expect(screen.getAllByRole("term")[0]?.closest("dl")?.className.split(" ")).toEqual(
      expect.arrayContaining(["grid-cols-2", "lg:grid-cols-5"]),
    );
    const [first, second, third, fourth, fifth] = tileClasses();
    for (const tile of [first, second, third, fourth]) {
      expect(tile).toEqual(expect.arrayContaining(["row-span-3", "grid-rows-subgrid"]));
      expect(tile).not.toContain("col-span-2");
    }
    expect(fifth).toEqual(expect.arrayContaining(["col-span-2", "lg:col-span-1", "grid-rows-subgrid"]));
    // No tile is a square at any width: each is as tall as its label, value and line.
    for (const tile of [first, second, third, fourth, fifth]) expect(tile?.some((name) => name.includes("aspect"))).toBe(false);
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
