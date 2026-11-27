// @vitest-environment jsdom
import { useState } from "react";

import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy/shared";
import { renderUnderNext } from "@/test-support/nextContexts";

import { HeldForm } from "./HeldForm";
import { Lineup, lineupValue } from "./Lineup";

import type { Copy } from "@/core/copy";
import type { NextContexts } from "@/test-support/nextContexts";
import type { LineupPlayer, LineupValue, LineupWords, NamelessEntry } from "./Lineup";

const AT_ADDRESS: NextContexts = { pathname: "/area/team/aho/2027/spiele/spiel-1", params: {} };

const MAX = 11;
const WORDS: LineupWords = {
  picked: COPY.shared.spieler,
  rest: COPY.shared.kader,
  name: COPY.shared.name,
  nummer: COPY.kader.nummer,
  position: COPY.kader.position,
  starts: COPY.shared.startelf,
  pick: COPY.shared.verb.create,
  remove: COPY.shared.verb.remove,
  none: { kind: "none", plural: COPY.shared.spieler },
  noKader: { kind: "none", plural: COPY.shared.kader, one: true },
  startersFull: COPY.shared.field.max(MAX),
  nomineeLocked: COPY.template.draftUnsaved,
  anonymous: COPY.shared.anonymous,
};

/** A pupil's box as the editor names it. */
const boxOf = (id: string) => `picked.${id}`;

const nameOf = (nummer: number) => `Spieler ${String(nummer)}`;

/**
 * `count` regular pupils numbered from 1. An id sorts the other way round than its number, so the lists' order is
 * the numbers' and never the ids' or the order of naming.
 */
const kader = (count: number): LineupPlayer[] =>
  Array.from({ length: count }, (_, index) => ({ id: `p${String(99 - index)}`, name: { record: nameOf(index + 1) }, nummer: index + 1 }));

const idOf = (nummer: number) => `p${String(100 - nummer)}`;

const nominee = (nummer: number): LineupPlayer => ({
  id: `n${String(nummer)}`,
  name: { record: nameOf(nummer) },
  nummer,
  nominee: true,
  chip: { tone: "info", label: COPY.shared.state.nominee },
});

/** The block over a value held as its page's editor holds it, `seen` taking each value it raises. */
function Held({
  players,
  start = lineupValue([], []),
  seen,
  acts,
  refusals,
  nameless = [],
}: {
  players: LineupPlayer[];
  start?: LineupValue;
  seen?: (value: LineupValue) => void;
  acts?: "locked" | "out";
  refusals?: Record<string, Copy>;
  nameless?: ReadonlyArray<NamelessEntry>;
}) {
  const [value, setValue] = useState(start);
  return (
    // In its editor's form, which holds the save's refusals by each pupil's box.
    <HeldForm
      rules={{}}
      fieldErrors={
        refusals === undefined ? undefined : Object.fromEntries(Object.entries(refusals).map(([pupil, text]) => [boxOf(pupil), text]))
      }
      isBusy={false}
      onSend={() => undefined}>
      <Lineup
        boxOf={boxOf}
        players={players}
        value={value}
        nameless={nameless}
        onChange={(next) => {
          setValue(next);
          seen?.(next);
        }}
        startersMax={MAX}
        words={WORDS}
        acts={acts}
      />
    </HeldForm>
  );
}

/** A pupil's name at the start of what names its row, with whatever follows it there. */
const named = (nummer: number) => new RegExp(`^${nameOf(nummer)}(?!\\d)`);
const rowOf = (nummer: number) => screen.getByRole("row", { name: named(nummer) });
// Found in its row: every row's word and cross have the same name.
const pick = (nummer: number) => userEvent.click(within(rowOf(nummer)).getByRole("button", { name: WORDS.pick }));
const tickOf = (nummer: number) => screen.getByRole<HTMLInputElement>("checkbox", { name: `${WORDS.starts} ${nameOf(nummer)}` });
/** The box a tick draws beside its hidden input, which a person sees. */
const drawnBoxOf = (nummer: number) => tickOf(nummer).closest("label")?.querySelector('[data-kit-focus="box"]');
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
    renderUnderNext(
      <Held
        players={kader(13)}
        seen={seen}
      />,
      AT_ADDRESS,
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

// The harm: a keyboard user's every press moves its row to the other card, the focus falls to the page's body, and the
// next Tab starts from the top of the page, eleven times over for one line-up.
describe("a line-up built by the keys", () => {
  it.each([
    [
      "„Aufstellen“",
      lineupValue([], []),
      () => within(rowOf(1)).getByRole("button", { name: WORDS.pick }),
      () => within(rowOf(2)).getByRole("button", { name: WORDS.pick }),
    ],
    ["the cross", lineupValue([idOf(1), idOf(2)], []), () => crossOf(1), () => tickOf(2)],
  ] as const)("hands the focus on in the same card after %s", async (_press, start, pressed, next) => {
    renderUnderNext(
      <Held
        players={kader(3)}
        start={start}
      />,
      AT_ADDRESS,
    );
    const following = next();
    act(() => pressed().focus());

    await userEvent.keyboard("{Enter}");

    await waitFor(() => expect(document.activeElement).toBe(following));
  });
});

describe("a line-up's states", () => {
  // The harm: a press on a closed screen changing the draft, which the save then refuses with the bar's line alone.
  it("closes every act while it is locked", async () => {
    const seen = vi.fn();
    renderUnderNext(
      <Held
        players={kader(3)}
        start={lineupValue([idOf(1)], [])}
        seen={seen}
        acts="locked"
      />,
      AT_ADDRESS,
    );

    expect(tickOf(1).disabled).toBe(true);
    await userEvent.click(crossOf(1));
    await pick(2);
    expect(seen).not.toHaveBeenCalled();
  });

  // The harm: a pupil the squad lost offered again once taken out, or a refused entry with no row saying which.
  it("says a refused pupil's reason and a departed pupil's state on their own rows, and offers a departed one no more", async () => {
    const gone: LineupPlayer = { id: "g1", name: { record: nameOf(40) }, nummer: 40, gone: COPY.kader.deregistered };
    renderUnderNext(
      <Held
        players={[...kader(2), gone]}
        start={lineupValue([idOf(1), "g1"], [])}
        refusals={{ [idOf(1)]: COPY.shared.failure.stale }}
      />,
      AT_ADDRESS,
    );

    expect(within(rowOf(1)).getByText(COPY.shared.failure.stale)).toBeTruthy();
    expect(within(rowOf(40)).getByText(COPY.kader.deregistered)).toBeTruthy();
    expect(tickOf(40).disabled).toBe(true);

    await userEvent.click(crossOf(40));
    expect(namesIn(WORDS.rest)).toStrictEqual([nameOf(2)]);
  });

  // The harm: a screen reader left where the save's press left it, finding the refused pupil by itself.
  it("marks a refused pupil's tick and hands it the focus once the refusal commits", () => {
    const start = lineupValue([idOf(1), idOf(2)], []);
    const { rerender } = renderUnderNext(
      <Held
        players={kader(2)}
        start={start}
      />,
      AT_ADDRESS,
    );

    rerender(
      <Held
        players={kader(2)}
        start={start}
        refusals={{ [idOf(2)]: COPY.shared.failure.stale }}
      />,
    );

    expect(document.activeElement).toBe(tickOf(2));
    // The drawn box's red edge, which the kit draws from React Aria's invalid state.
    expect(drawnBoxOf(2)?.classList.contains("border-danger")).toBe(true);
    expect(drawnBoxOf(1)?.classList.contains("border-danger")).toBe(false);
  });
});

// The harm: the start of an entry naming nobody left out of the count, so the page lets a twelfth start and the write
// refuses it; or such an entry let into the draft, where a press could take it out or tick it.
describe("a line-up keeping entries naming nobody", () => {
  it("draws them read-only, counts them as named, starting and regular, and keeps them out of the value", async () => {
    const seen = vi.fn();
    renderUnderNext(
      <Held
        players={[...kader(11), nominee(20)]}
        start={lineupValue(ids(1, 2, 3, 4, 5, 6, 7, 8, 9, 10), ids(1, 2, 3, 4, 5, 6, 7, 8, 9, 10))}
        nameless={[{ starts: true }]}
        seen={seen}
      />,
      AT_ADDRESS,
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
