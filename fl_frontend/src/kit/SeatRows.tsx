import { COPY, textOf } from "@/core/copy";

import { PartyHead, PartyHeadPlaceholder } from "./AnswerRows";
import { buttonLook } from "./buttonStyles";
import { actRow, cardSurface, stacked } from "./cardStyles";
import { EMAIL_WORDS } from "./Facts";
import { PlaceholderSentence } from "./Skeleton";
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
  /** The row's side acts, the page's own, in one „⋯“ at the row's end (`SideActs`). */
  acts?: ReactElement;
  /** A seat nobody holds: its name muted. */
  muted?: boolean;
};

// A card's act row in every part but the chevron: a seat opens no page of its own (`cardStyles.ts :: actRow`).
const seatRows = tv({
  slots: {
    root: "w-full overflow-hidden text-sm",
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
 * `AnswerRows`, and its acts. A seat's acts are side acts, up to two a row, so every row that carries any holds them in
 * one „⋯“ at its end, at every width (`SideActs`).
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
  // One form for the list: its rows keep the acts' place at their end where any of them carries acts.
  const row = actRow({ opens: false, folds: rows.some((seat) => seat.acts !== undefined) });
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
            {seat.acts !== undefined && <span className={row.acts()}>{seat.acts}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The seats while they are read: three rows, each a name and a chip over the muted line, drawn from the rows' recipe, so
 * each stands as a seat's row will. The line's words are set unseen, an address wrapping in a phone's column as it will.
 * `readOnly` is the seats of a page that only shows them: its line names the seat alone and its row ends with its words.
 * Any other draws the „⋯“'s bar at the row's end.
 */
export function SeatRowsPlaceholder({ bare = false, readOnly = false }: { bare?: boolean; readOnly?: boolean }) {
  const s = seatRows({ bare });
  const row = actRow({ opens: false, folds: !readOnly });
  return (
    <div className={s.root()}>
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className={s.row()}>
          <span className={row.frame()}>
            <span className={row.words({ class: "gap-1" })}>
              <PartyHeadPlaceholder />
              <PlaceholderSentence
                textClass={row.line()}
                words={COPY.admin.seatLine(["trainer"], readOnly ? null : EMAIL_WORDS, null)}
              />
            </span>
            {!readOnly && (
              <span className={row.acts()}>
                <span className={buttonLook({ look: "placeholder", class: "w-8 px-0 pointer-coarse:w-10" })} />
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
