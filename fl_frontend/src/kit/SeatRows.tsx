import { textOf } from "@/core/copy";

import { PartyHead } from "./AnswerRows";
import { actRow, cardSurface, stacked } from "./cardStyles";
import { Facts } from "./Facts";
import { tv } from "./tv";

import type { Copy, Words } from "@/core/copy";
import type { ReactElement } from "react";
import type { ChipProps } from "./Chip";
import type { Fact } from "./Facts";

export type SeatRow = {
  id: string;
  name: Words;
  /** The seat's state, and beside it, where the last mail met trouble, the delivery's. */
  chips: ReadonlyArray<ChipProps>;
  /** The muted line: the seats held, the address and where the answer stands (`COPY.team.seatLine`). */
  line: Words;
  /** What the seat's person answered, under the line, once they have: each choice's label over its answer. */
  facts?: ReadonlyArray<Fact>;
  /** The row's side acts, the page's own, drawn by `SideActs` in the form the list decides. */
  acts?: ReactElement;
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
 * A record's three seats in one box, a row a seat. A seat's acts are side acts, up to two a row, and the list decides
 * their form for all its rows (`SideActs`): beside the words at the row's end at every width, their labelled buttons
 * in a box of 42 rem or more and one „⋯“ in a narrower one.
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
  // Side acts stand beside the words at every width, where a „⋯“ under them would take a line of its own.
  const row = actRow({ opens: false, sideActs: rows.some((seat) => seat.acts !== undefined) });
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
              {seat.facts !== undefined && seat.facts.length > 0 && (
                // Free of a box, since the row is the list's box; a step apart from the line it follows.
                <div className="mt-1.5">
                  <Facts
                    facts={seat.facts}
                    look="free"
                  />
                </div>
              )}
            </span>
            {seat.acts !== undefined && <div className={row.acts()}>{seat.acts}</div>}
          </span>
        </li>
      ))}
    </ul>
  );
}
