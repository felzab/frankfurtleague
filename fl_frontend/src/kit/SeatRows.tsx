import { textOf } from "@/core/copy";

import { answerRows, PartyHead } from "./AnswerRows";
import { buttonLook } from "./buttonStyles";
import { cardSurface, stacked } from "./cardStyles";
import { placeholderBar, PlaceholderLine } from "./Skeleton";
import { tv } from "./tv";

import type { Copy, Words } from "@/core/copy";
import type { ReactElement } from "react";
import type { ChipProps } from "./Chip";

/** One seat of a team or an application: who holds it, where they stand, and what the page may do about it. */
export type SeatRow = {
  id: string;
  name: Words;
  /** The seat's state, and beside it, where the last mail met trouble, the delivery's. */
  chips: readonly [ChipProps, ...ChipProps[]];
  /** The muted line: the seats held, the address and where the answer stands (`COPY.admin.seatLine`). */
  line: Words;
  /** The row's one or two icon acts, the page's own. */
  acts?: ReactElement;
  /** A seat nobody holds: its name muted. */
  muted?: boolean;
};

// The acts under the words on a phone, at the row's end from `lg`, as a card's act row sets them. A seat opens no page of
// its own, so no chevron ends it.
const seatRows = tv({
  slots: {
    root: cardSurface({ class: "w-full overflow-hidden text-sm" }),
    row: `grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 lg:min-h-13 ${stacked()}`,
    words: "grid min-w-0 gap-1",
    acts: "col-start-1 row-start-2 flex items-center gap-2 lg:col-start-2 lg:row-start-1 lg:justify-self-end",
  },
});

/**
 * A record's three seats in one box: a row a seat, its name with its chips over one muted line, the words a party's in
 * `AnswerRows`, and its acts.
 */
export function SeatRows({ label, rows }: { label: Copy; rows: ReadonlyArray<SeatRow> }) {
  const s = seatRows();
  const { line } = answerRows();
  return (
    <ul
      aria-label={label}
      className={s.root()}>
      {rows.map((row) => (
        <li
          key={row.id}
          className={s.row()}>
          <span className={s.words()}>
            <PartyHead
              name={row.name}
              chips={row.chips}
              muted={row.muted === true}
            />
            <span className={line()}>{textOf(row.line)}</span>
          </span>
          {row.acts !== undefined && <span className={s.acts()}>{row.acts}</span>}
        </li>
      ))}
    </ul>
  );
}

/** The seats while they are read: three rows, each a name and a chip over the muted line, and the one act every seat has. */
export function SeatRowsPlaceholder() {
  const s = seatRows();
  const words = answerRows();
  return (
    <div className={s.root()}>
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className={s.row()}>
          <span className={s.words()}>
            <span className={words.head()}>
              <PlaceholderLine
                text={words.name()}
                width="w-24"
              />
              <span className={placeholderBar("h-5 w-16")} />
            </span>
            <PlaceholderLine
              text={words.line()}
              width="w-2/3"
            />
          </span>
          <span className={s.acts()}>
            <span className={buttonLook({ look: "placeholder", class: "w-8 px-0 pointer-coarse:w-10" })} />
          </span>
        </div>
      ))}
    </div>
  );
}
