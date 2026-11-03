// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";

import { render, screen, within } from "@testing-library/react";
import postcss from "postcss";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { SERVER_COPY } from "@/core/serverCopy";

import { BracketTree } from "./BracketTree";

import type { ComponentProps } from "react";
import type { BracketMatch, BracketRound } from "./BracketTree";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

const { phase } = COPY.shared;
const ROUND_NAMES = [phase.achtelfinale, phase.viertelfinale, phase.halbfinale, phase.finale];

const match = (id: string): BracketMatch => ({
  id,
  href: `/saisons/2027/spiele/${id}`,
  when: COPY.spielplan.when(null, null),
  home: { name: { record: `Heim ${id}` }, plaque: { quelle: COPY.spielplan.quelle.gruppeShort("A", 1) } },
  away: { name: { record: `Gast ${id}` }, plaque: { quelle: COPY.spielplan.quelle.gruppeShort("B", 2) } },
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
      [SERVER_COPY.season.thirdPlace, 1],
      ["Finale", 1],
    ]);
  });
});

/** The phone's card width the token sets, in px at the root's 16-px rem. */
function phoneCardWidth(): number {
  const file = path.resolve(import.meta.dirname, "..", "app", "tokens.css");
  let width = Number.NaN;
  postcss.parse(readFileSync(file, "utf8"), { from: file }).walkDecls("--container-bracket-phone", (declaration) => {
    width = Number(/^([\d.]+)rem$/.exec(declaration.value)?.[1]) * 16;
  });
  return width;
}

// jsdom lays nothing out, so the fit is held by the token and the card's classes: a sideways scroll on a phone shows
// on screen alone, where nothing but an eye would catch it.
describe("the K.-o.-Baum on a phone", () => {
  it("fits four cards across a 360-px phone inside the page's 16-px gutters", () => {
    render(<BracketTree rounds={bracket(3)} />);
    const [first] = screen.getAllByRole("list");
    const cards = within(first as HTMLElement)
      .getAllByRole("link")
      .map((link) => link.closest("li")?.firstElementChild);

    expect(cards).toHaveLength(4);
    for (const card of cards) {
      // Below `lg` the card takes no side padding of its own, so its width is the token's alone.
      expect(card?.className.split(" ").filter((name) => /^p[xlrse]?-/.test(name))).toStrictEqual([]);
      expect(card?.classList).toContain("w-bracket-phone");
    }
    expect(4 * phoneCardWidth() + 2 * 16).toBeLessThanOrEqual(360);
  });
});
