// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { BracketTree } from "./BracketTree";

import type { ComponentProps } from "react";
import type { BracketMatch, BracketRound } from "./BracketTree";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

const ROUND_NAMES = ["Achtelfinale", "Viertelfinale", "Halbfinale", "Finale"];

const match = (id: string): BracketMatch => ({
  id,
  href: `/saisons/2027/spiele/${id}`,
  when: "Termin offen",
  home: { name: `Heim ${id}`, plaque: { quelle: "A1" } },
  away: { name: `Gast ${id}`, plaque: { quelle: "B2" } },
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

/** Each round's list as the page reads it, top to bottom, with its count of cards. */
const rowsOf = () => screen.getAllByRole("list").map((list) => [list.getAttribute("aria-label"), within(list).getAllByRole("link").length]);

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

  it("sets the match for third place on its own row above the Finale", () => {
    render(
      <BracketTree
        rounds={bracket(3)}
        third={match("platz-3")}
      />,
    );

    expect(rowsOf()).toStrictEqual([
      ["Viertelfinale", 4],
      ["Halbfinale", 2],
      [COPY.shared.season.thirdPlace, 1],
      ["Finale", 1],
    ]);
  });
});
