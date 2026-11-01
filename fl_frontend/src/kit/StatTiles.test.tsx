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
