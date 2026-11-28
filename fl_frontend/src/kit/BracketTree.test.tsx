// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy/shared";

import { BracketTree } from "./BracketTree";

import type { BracketMatch, BracketRound } from "./BracketTree";

const { phase } = COPY.shared;
const ROUND_NAMES = [phase.achtelfinale, phase.viertelfinale, phase.halbfinale, phase.finale];

const match = (id: string): BracketMatch => ({
  id,
  href: `/saisons/2027/spiele/${id}`,
  when: COPY.spielplan.when(null, null),
  team1: { name: { record: `Heim ${id}` }, plaque: { quelle: COPY.spielplan.quelle.gruppeShort("A", 1) } },
  team2: { name: { record: `Gast ${id}` }, plaque: { quelle: COPY.spielplan.quelle.gruppeShort("B", 2) } },
});

/** The last `count` rounds of the bracket, each half as wide as the one before, the Finale last. */
function bracket(count: number): readonly [BracketRound, ...BracketRound[]] {
  const names = ROUND_NAMES.slice(-count);
  const rounds = names.map((label, index) => ({
    id: label,
    label,
    matches: Array.from({ length: 2 ** (names.length - 1 - index) }, (_, slot) => match(`${label}-${String(slot)}`)),
  }));
  const [first, ...rest] = rounds;
  if (first === undefined) throw new Error("a bracket has a Finale");
  return [first, ...rest];
}

/**
 * Each round as the page reads it, top to bottom: its heading's words, with the count of cards in the one list that
 * bears that name and no other.
 */
function rowsOf() {
  const lists = screen.getAllByRole("list");
  const rows = screen.getAllByRole("heading", { level: 2 }).map((heading) => {
    const name = heading.textContent;
    return [name, within(screen.getByRole("list", { name })).getAllByRole("link").length];
  });
  // Every list is one round's, named by its heading.
  expect(rows).toHaveLength(lists.length);
  return rows;
}

describe("the K.-o.-Baum", () => {
  it.each([
    [1, [["Finale", 1]]],
    [
      2,
      [
        ["Halbfinale", 2],
        ["Finale", 1],
      ],
    ],
    [
      3,
      [
        ["Viertelfinale", 4],
        ["Halbfinale", 2],
        ["Finale", 1],
      ],
    ],
    [
      4,
      [
        ["Achtelfinale", 8],
        ["Viertelfinale", 4],
        ["Halbfinale", 2],
        ["Finale", 1],
      ],
    ],
  ])("draws %i rounds upright, the first on top and the Finale at the bottom", (count, rows) => {
    render(<BracketTree rounds={bracket(count)} />);

    expect(screen.getByRole("region", { name: COPY.shared.kOBaum })).toBeTruthy();
    expect(rowsOf()).toStrictEqual(rows);
  });
});
