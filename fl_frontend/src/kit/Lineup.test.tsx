// @vitest-environment jsdom
import { useState } from "react";

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { Lineup, lineupMoves, lineupValue } from "./Lineup";

import type { Copy } from "@/core/copy";
import type { LineupPlayer, LineupValue, LineupWords, NamelessEntry } from "./Lineup";

vi.mock("next/navigation", () => ({
  usePathname: () => "/area/team/aho/2027/spiele/spiel-1",
  useParams: () => ({}),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
}));

const MAX = 11;
const WORDS: LineupWords = {
  picked: COPY.shared.spieler,
  rest: COPY.shared.kader,
  name: COPY.shared.name,
  nummer: COPY.admin.spieler.nummer,
  position: COPY.admin.spieler.position,
  starts: COPY.shared.startelf,
  pick: COPY.shared.verb.create,
  remove: COPY.shared.verb.remove,
  none: { kind: "none", plural: COPY.shared.spieler },
  noSquad: { kind: "none", plural: COPY.shared.kader, one: true },
  startersFull: COPY.shared.field.max(MAX),
  nomineeLocked: COPY.template.draftUnsaved,
  anonymous: COPY.shared.anonymous,
};

const nameOf = (nummer: number) => `Spieler ${String(nummer)}`;

/**
 * `count` regular pupils numbered from 1. An id sorts the other way round than its number, so the lists' order is
 * the numbers' and never the ids' or the order of naming.
 */
const squad = (count: number): LineupPlayer[] =>
  Array.from({ length: count }, (_, index) => ({ id: `p${String(99 - index)}`, name: { record: nameOf(index + 1) }, nummer: index + 1 }));

const idOf = (nummer: number) => `p${String(100 - nummer)}`;

const nominee = (nummer: number): LineupPlayer => ({
  id: `n${String(nummer)}`,
  name: { record: nameOf(nummer) },
  nummer,
  nominee: true,
  chip: { tone: "info", label: COPY.admin.spieler.nominee },
});

/** The block over a value held as its page's editor holds it, `seen` taking each value it raises. */
function Held({
  players,
  start = lineupValue([], []),
  seen,
  locked,
  refusals,
  nameless = [],
}: {
  players: LineupPlayer[];
  start?: LineupValue;
  seen?: (value: LineupValue) => void;
  locked?: Copy;
  refusals?: Record<string, Copy>;
  nameless?: ReadonlyArray<NamelessEntry>;
}) {
  const [value, setValue] = useState(start);
  return (
    <Lineup
      players={players}
      value={value}
      nameless={nameless}
      onChange={(next) => {
        setValue(next);
        seen?.(next);
      }}
      startersMax={MAX}
      words={WORDS}
      locked={locked}
      refusals={refusals}
    />
  );
}

/** A pupil's name at the start of what names its row, with whatever follows it there. */
const named = (nummer: number) => new RegExp(`^${nameOf(nummer)}(?!\\d)`);
const rowOf = (nummer: number) => screen.getByRole("row", { name: named(nummer) });
// Found in its row: every row's word and cross have the same name.
const pick = (nummer: number) => userEvent.click(within(rowOf(nummer)).getByRole("button", { name: WORDS.pick }));
const tickOf = (nummer: number) => screen.getByRole<HTMLInputElement>("checkbox", { name: `${WORDS.starts} ${nameOf(nummer)}` });
const crossOf = (nummer: number) => within(rowOf(nummer)).getByRole("button", { name: WORDS.remove });

/** The names a list shows, in its rows' order. */
const namesIn = (list: Copy) =>
  within(screen.getByRole("table", { name: list }))
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.firstElementChild?.firstElementChild?.firstElementChild?.textContent);

const ids = (...nummern: number[]) => nummern.map(idOf).sort();

describe("a line-up", () => {
  // The harm: a twelfth starter the save then refuses with nothing on the row saying which, a pupil taken out who still
  // starts, or lists in the order of the presses.
  it("names pupils into one list in shirt-number order, lets eleven start, refuses a twelfth on its row, and takes a row out", async () => {
    const seen = vi.fn();
    render(
      <Held
        players={squad(13)}
        seen={seen}
      />,
    );
    expect(screen.getByText(COPY.shared.empty.none(COPY.shared.spieler))).toBeTruthy();

    // Named from the highest number down, twelve of the thirteen.
    for (let nummer = 12; nummer >= 1; nummer -= 1) await pick(nummer);
    expect(namesIn(WORDS.picked)).toStrictEqual(Array.from({ length: 12 }, (_, index) => nameOf(index + 1)));
    expect(namesIn(WORDS.rest)).toStrictEqual([nameOf(13)]);

    for (let nummer = 1; nummer <= MAX; nummer += 1) await userEvent.click(tickOf(nummer));
    const full = { picked: ids(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12), starters: ids(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11) };
    expect(seen).toHaveBeenLastCalledWith(full);

    // The twelfth: refused on its own row by the press.
    expect(within(rowOf(12)).queryByText(WORDS.startersFull)).toBeNull();
    const raised = seen.mock.calls.length;
    await userEvent.click(tickOf(12));
    expect(tickOf(12).checked).toBe(false);
    expect(seen).toHaveBeenCalledTimes(raised);
    expect(within(rowOf(12)).getByText(WORDS.startersFull)).toBeTruthy();

    // A starter less makes room, and the refusal goes with the change.
    await userEvent.click(tickOf(3));
    expect(screen.queryByText(WORDS.startersFull)).toBeNull();
    await userEvent.click(tickOf(12));
    expect(seen).toHaveBeenLastCalledWith({ ...full, starters: ids(1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12) });

    // Taken out, a starter starts no longer, and stands among the others again at its number's place.
    await userEvent.click(crossOf(5));
    expect(seen).toHaveBeenLastCalledWith({
      picked: ids(1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12),
      starters: ids(1, 2, 4, 6, 7, 8, 9, 10, 11, 12),
    });
    expect(namesIn(WORDS.rest)).toStrictEqual([nameOf(5), nameOf(13)]);
  });
});

describe("a nominee in a line-up", () => {
  const players = [...squad(11), nominee(30), nominee(31)];
  const regulars = (count: number) => Array.from({ length: count }, (_, index) => idOf(index + 1));

  // The harm: a line-up the save refuses for its nominee, with a button that offered the nominee all along.
  it("can be named while fewer than eleven regular pupils are, one for each place they leave", async () => {
    const seen = vi.fn();
    render(
      <Held
        players={players}
        start={lineupValue(regulars(10), [])}
        seen={seen}
      />,
    );

    await pick(30);
    expect(seen).toHaveBeenLastCalledWith(lineupValue([...regulars(10), "n30"], []));

    // The one place is taken: the second nominee's word answers with the reason and names nobody.
    await pick(31);
    expect((await screen.findByRole("tooltip")).textContent).toBe(WORDS.nomineeLocked);
    expect(seen).toHaveBeenCalledOnce();
  });

  it("stays named when an eleventh regular pupil is, its row saying why it cannot stay", async () => {
    const seen = vi.fn();
    render(
      <Held
        players={players}
        start={lineupValue([...regulars(10), "n30"], [])}
        seen={seen}
      />,
    );
    expect(within(rowOf(30)).queryByText(WORDS.nomineeLocked)).toBeNull();

    await pick(11);

    expect(seen).toHaveBeenLastCalledWith(lineupValue([...regulars(11), "n30"], []));
    expect(within(rowOf(30)).getByText(WORDS.nomineeLocked)).toBeTruthy();

    // Eleven regular pupils leave no place: the other nominee's word answers with the reason and names nobody.
    await pick(31);
    expect((await screen.findByRole("tooltip")).textContent).toBe(WORDS.nomineeLocked);
    expect(seen).toHaveBeenCalledOnce();
  });
});

describe("a line-up's states", () => {
  // The harm: a press on a closed screen changing the draft, which the save then refuses with the bar's line alone.
  it("closes every act with the reason while it is locked", async () => {
    const seen = vi.fn();
    render(
      <Held
        players={squad(3)}
        start={lineupValue([idOf(1)], [])}
        seen={seen}
        locked={COPY.admin.spiel.departed}
      />,
    );

    expect(tickOf(1).disabled).toBe(true);
    await userEvent.click(crossOf(1));
    expect((await screen.findByRole("tooltip")).textContent).toBe(COPY.admin.spiel.departed);
    await pick(2);
    expect(seen).not.toHaveBeenCalled();
  });

  // The harm: a pupil the squad lost offered again once taken out, or a refused entry with no row saying which.
  it("says a refused pupil's reason and a departed pupil's state on their own rows, and offers a departed one no more", async () => {
    const gone: LineupPlayer = { id: "g1", name: { record: nameOf(40) }, nummer: 40, gone: COPY.admin.spiel.departed };
    render(
      <Held
        players={[...squad(2), gone]}
        start={lineupValue([idOf(1), "g1"], [])}
        refusals={{ [idOf(1)]: COPY.shared.failure.stale }}
      />,
    );

    expect(within(rowOf(1)).getByText(COPY.shared.failure.stale)).toBeTruthy();
    expect(within(rowOf(40)).getByText(COPY.admin.spiel.departed)).toBeTruthy();
    expect(tickOf(40).disabled).toBe(true);

    await userEvent.click(crossOf(40));
    expect(namesIn(WORDS.rest)).toStrictEqual([nameOf(2)]);
  });
});

// The harm: the start of an entry naming nobody left out of the count, so the page lets a twelfth start and the write
// refuses it; or such an entry let into the draft, where a press could take it out or tick it.
describe("a line-up keeping entries naming nobody", () => {
  it("draws them read-only, counts them as named, starting and regular, and keeps them out of the value", async () => {
    const seen = vi.fn();
    render(
      <Held
        players={[...squad(11), nominee(20)]}
        start={lineupValue(ids(1, 2, 3, 4, 5, 6, 7, 8, 9, 10), ids(1, 2, 3, 4, 5, 6, 7, 8, 9, 10))}
        nameless={[{ starts: true }]}
        seen={seen}
      />,
    );
    const picked = within(screen.getByRole("table", { name: WORDS.picked }));
    const kept = picked.getByRole("checkbox", { name: `${WORDS.starts} ${COPY.shared.anonymous}` });

    expect(kept).toHaveProperty("checked", true);
    expect(kept).toHaveProperty("disabled", true);
    expect(picked.getAllByRole("button", { name: WORDS.remove })).toHaveLength(10);
    expect(screen.getByRole("heading", { name: WORDS.picked }).nextElementSibling?.textContent).toBe("11");

    // Ten named and the kept start make eleven: an eleventh named regular leaves a nominee no gap, and no twelfth starts.
    await pick(11);
    expect(within(rowOf(20)).getByRole("button", { name: WORDS.pick }).getAttribute("aria-disabled")).toBe("true");
    await userEvent.click(tickOf(11));
    expect(tickOf(11).checked).toBe(false);
    expect(seen.mock.calls.at(-1)?.[0]).toStrictEqual(lineupValue(ids(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11), ids(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)));
  });
});

describe("a line-up's changes", () => {
  // The harm: six pupils moved reading „2 Änderungen“, the two fields, or a line-up put back as it was stored still
  // counted as changed, so the way back asks about changes nobody made.
  it("counts each pupil moved, and nothing once they are back", () => {
    const stored = lineupValue([idOf(7), idOf(8)], [idOf(7)]);

    // Four named, the starter taken out, the other one starting.
    expect(lineupMoves(stored, lineupValue([idOf(1), idOf(2), idOf(3), idOf(4), idOf(8)], [idOf(8)]))).toBe(6);
    // Back, the stored pair named in the other order than it was stored in.
    expect(lineupMoves(stored, lineupValue([idOf(8), idOf(7)], [idOf(7)]))).toBe(0);
  });
});
