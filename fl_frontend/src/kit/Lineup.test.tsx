// @vitest-environment jsdom
import { useState } from "react";

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { EditorPage } from "./EditorPage";
import { Lineup, lineupMoves, LineupPlaceholder, lineupValue } from "./Lineup";
import { useEditor } from "./useEditor";

import type { Copy } from "@/core/copy";
import type { LineupPlayer, LineupValue, LineupWords } from "./Lineup";

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
  none: COPY.shared.empty.nothingOpen,
  noSquad: COPY.shared.empty.noneOne(COPY.shared.kader),
  startersFull: COPY.shared.field.max(MAX),
  nomineeLocked: COPY.template.draftUnsaved,
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
}: {
  players: LineupPlayer[];
  start?: LineupValue;
  seen?: (value: LineupValue) => void;
  locked?: Copy;
  refusals?: Record<string, Copy>;
}) {
  const [value, setValue] = useState(start);
  return (
    <Lineup
      players={players}
      value={value}
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

/** A pupil's name at the start of what names its row or describes its word or its cross, with whatever follows it there. */
const named = (nummer: number) => new RegExp(`^${nameOf(nummer)}(?!\\d)`);
const rowOf = (nummer: number) => screen.getByRole("row", { name: named(nummer) });
// Found by its description, as a screen reader tells one row's word from the next: every row's word has the same name.
const pick = (nummer: number) => userEvent.click(screen.getByRole("button", { name: WORDS.pick, description: named(nummer) }));
const tickOf = (nummer: number) => screen.getByRole<HTMLInputElement>("checkbox", { name: `${WORDS.starts} ${nameOf(nummer)}` });
const crossOf = (nummer: number) => screen.getByRole("button", { name: WORDS.remove, description: named(nummer) });

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
    expect(screen.getByText(WORDS.none)).toBeTruthy();

    // Named from the highest number down, twelve of the thirteen.
    for (let nummer = 12; nummer >= 1; nummer -= 1) await pick(nummer);
    expect(namesIn(WORDS.picked)).toStrictEqual(Array.from({ length: 12 }, (_, index) => nameOf(index + 1)));
    expect(namesIn(WORDS.rest)).toStrictEqual([nameOf(13)]);

    for (let nummer = 1; nummer <= MAX; nummer += 1) await userEvent.click(tickOf(nummer));
    const full = { picked: ids(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12), starters: ids(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11) };
    expect(seen).toHaveBeenLastCalledWith(full);

    // The twelfth: heard as unavailable before the press, and refused on its own row by it.
    expect(within(rowOf(12)).queryByText(WORDS.startersFull)).toBeNull();
    expect(screen.getByRole("checkbox", { name: `${WORDS.starts} ${nameOf(12)}`, description: WORDS.startersFull })).toBeTruthy();
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

  // The harm: a keyboard's focus dropped on `body` with each row named or taken out, back at the page's top every time.
  it("hands the focus to the row after the one that left, in either list", async () => {
    render(
      <Held
        players={squad(4)}
        start={lineupValue([idOf(1), idOf(2)], [])}
      />,
    );

    crossOf(1).focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(document.activeElement).toBe(crossOf(2)));

    const word = (nummer: number) => within(rowOf(nummer)).getByRole("button", { name: WORDS.pick });
    word(3).focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(document.activeElement).toBe(word(4)));
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

    expect(screen.getByRole("checkbox", { name: `${WORDS.starts} ${nameOf(1)}`, description: COPY.shared.failure.stale })).toBeTruthy();
    expect(within(rowOf(40)).getByText(COPY.admin.spiel.departed)).toBeTruthy();
    expect(tickOf(40).disabled).toBe(true);

    await userEvent.click(crossOf(40));
    expect(namesIn(WORDS.rest)).toStrictEqual([nameOf(2)]);
  });
});

/** The block as its page places it: bare in the editor's column, its counts on the bar, its moves the editor's count. */
function Page({ players, stored }: { players: LineupPlayer[]; stored: LineupValue }) {
  const editor = useEditor<LineupValue>({ id: "spiel-1", version: 1, values: stored }, async () => ({ ok: true, value: 2 }), {
    countOf: lineupMoves,
  });
  return (
    <EditorPage
      title={{ record: "Ahorn vs. Eiche" }}
      editor={editor}
      barText={COPY.shared.field.max(editor.draft.picked.length)}
      sections={[
        {
          id: "lineup",
          block: (
            <Lineup
              players={players}
              value={editor.draft}
              onChange={(next) => {
                editor.set("picked", next.picked);
                editor.set("starters", next.starters);
              }}
              startersMax={MAX}
              words={WORDS}
            />
          ),
        },
      ]}
    />
  );
}

describe("a line-up in its editor", () => {
  // The harm: six pupils moved reading „2 Änderungen“, the two fields, or a line-up put back as it was stored still
  // counted as changed, so the way back asks about changes nobody made.
  it("counts each pupil moved after the page's own words on the bar, and nothing once they are back", async () => {
    render(
      <Page
        players={squad(8)}
        stored={lineupValue([idOf(7), idOf(8)], [idOf(7)])}
      />,
    );
    const bar = screen.getByRole("region", { name: COPY.shared.verb.save });
    const line = () => bar.querySelector("p")?.textContent;
    expect(line()).toBe(COPY.shared.field.max(2));

    // Four named, the starter taken out, the other one starting.
    for (const nummer of [4, 1, 3, 2]) await pick(nummer);
    await userEvent.click(crossOf(7));
    await userEvent.click(tickOf(8));
    expect(line()).toBe(`${COPY.shared.field.max(5)}${COPY.template.changesPending(6)}`);

    // Back, the stored pair now named in the other order than it was stored in.
    await pick(7);
    await userEvent.click(tickOf(7));
    await userEvent.click(tickOf(8));
    for (const nummer of [1, 2, 3, 4]) await userEvent.click(crossOf(nummer));
    expect(line()).toBe(COPY.shared.field.max(2));
  });
});

describe("a line-up while it is read", () => {
  // The harm: a wait shorter or taller than the page it gives way to, which loses a reload's place.
  it("draws the block's own cards and rows, as many as the page states", () => {
    const shape = (root: HTMLElement) =>
      [...root.children].map((box) => ({
        box: box.className,
        band: box.firstElementChild?.className,
        rows: [...box.querySelectorAll("tr")].map((row) => [row.className, ...[...row.children].map((cell) => cell.className)]),
      }));
    const block = render(
      <Held
        players={squad(5)}
        start={lineupValue([idOf(1), idOf(2), idOf(3)], [])}
      />,
    );
    const landed = shape(block.container);
    block.unmount();

    const wait = render(
      <LineupPlaceholder
        words={WORDS}
        picked={3}
        rest={2}
      />,
    );

    expect(shape(wait.container)).toStrictEqual(landed);
  });
});
