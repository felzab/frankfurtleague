import { textOf } from "@/core/copy";

import { PartyHead } from "./AnswerRows";
import { actRow, cardSurface, stacked } from "./cardStyles";
import { SideActsScope } from "./SideActs";
import { sideActsForm } from "./sideActsForm";
import { tv } from "./tv";

import type { Copy, Words } from "@/core/copy";
import type { ReactElement } from "react";
import type { ChipProps } from "./Chip";

/** One seat of a team or an application: who holds it, where they stand, and what the page may do about it. */
export type SeatRow = {
  id: string;
  name: Words;
  /** The seat's state, and beside it, where the last mail met trouble, the delivery's. */
  chips: ReadonlyArray<ChipProps>;
  /** The muted line: the seats held, the address and where the answer stands (`COPY.admin.seatLine`). */
  line: Words;
  /** The row's side acts, the page's own, drawn by `SideActs` in the form the list decides. */
  acts?: ReactElement;
  /**
   * How many side acts `acts` draws, which the list reads to decide their form for all its rows: the acts reach it as an
   * element, which says nothing of what it holds. Counted by the rule the acts' own module lists them by
   * (`seatActKinds`), never a second condition beside it.
   */
  sideActs?: number;
  /** A seat nobody holds: its name muted. */
  muted?: boolean;
};

// The list is the container its rows read, a card's act row in every part but the chevron: a seat opens no page of its
// own (`actRow`).
const seatRows = tv({
  slots: {
    root: "@container w-full overflow-hidden text-sm",
    row: stacked(),
  },
  variants: {
    bare: {
      true: {},
      false: { root: cardSurface() },
    },
  },
});

/**
 * A record's three seats in one box: a row a seat, its name with its chips over one muted line, the words a party's in
 * `AnswerRows`, and its acts. A seat's acts are side acts, up to two a row, and the list decides their form for all its
 * rows (`SideActs`): beside the words at the row's end at every width, their labelled buttons in a box of 42 rem or
 * more and one „⋯“ in a narrower one.
 */
export function SeatRows({
  label,
  rows,
  bare = false,
}: {
  label: Copy;
  rows: ReadonlyArray<SeatRow>;
  /** The rows alone, without their own box, inside a card's body, whose box already holds them. */
  bare?: boolean;
}) {
  const s = seatRows({ bare });
  const sideActs = sideActsForm(rows);
  // Side acts stand beside the words at every width, where a „⋯“ under them would take a line of its own.
  const row = actRow({ opens: false, sideActs: sideActs.carried });
  return (
    <ul
      aria-label={label}
      className={s.root()}>
      {rows.map((seat) => (
        <li
          key={seat.id}
          className={s.row()}>
          <span className={row.frame()}>
            <span className={row.words({ class: "gap-1" })}>
              <PartyHead
                name={seat.name}
                chips={seat.chips}
                muted={seat.muted === true}
              />
              <span className={row.line()}>{textOf(seat.line)}</span>
            </span>
            {seat.acts !== undefined && (
              <div className={row.acts()}>
                <SideActsScope folds={sideActs.foldsEverywhere}>{seat.acts}</SideActsScope>
              </div>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
