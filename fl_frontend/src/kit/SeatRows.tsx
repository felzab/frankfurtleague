import { useId } from "react";

import { COPY, textOf } from "@/core/copy";

import { PartyHead, PartyHeadPlaceholder } from "./AnswerRows";
import { buttonPlaceholder } from "./buttonStyles";
import { actRow, cardSurface, stacked } from "./cardStyles";
import { EMAIL_WORDS } from "./Facts";
import { RowActs } from "./RowActs";
import { SideActsScope } from "./SideActs";
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
  /** The row's side acts, the page's own, drawn by `SideActs` in the form the list decides. */
  acts?: ReactElement;
  /**
   * How many side acts `acts` draws, which the list reads to decide their form for all its rows: the acts reach it as an
   * element, which says nothing of what it holds. Derived from the one value that decides the acts themselves, such as
   * the seat's fresh link, never a second condition beside it.
   */
  sideActs?: number;
  /** A seat nobody holds: its name muted. */
  muted?: boolean;
};

// The list is the container its rows read, a card's act row in every part but the chevron: a seat opens no page of its
// own (`cardStyles.ts :: actRow`).
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
 * rows (`SideActs`): where some row carries two, every row that carries any holds them in one „⋯“ at its end, at every
 * width; where none does, each row's one act is its button, on a line under the words in a box narrower than 32 rem and
 * at the row's end from it, as every card's act row holds it. The acts are described by the seat's name and its line:
 * every row's carries the same name, and a seat nobody holds is told from the next by its line alone.
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
  const listId = useId();
  const s = seatRows({ bare });
  // One form for the list, decided once for all its rows: one „⋯“ on every row where some row carries two side acts.
  const folds = rows.some((seat) => (seat.sideActs ?? 0) > 1);
  const row = actRow({ opens: false, folds });
  return (
    <ul
      aria-label={label}
      className={s.root()}>
      {rows.map((seat) => {
        const nameId = `${listId}-${seat.id}`;
        const lineId = `${nameId}-line`;
        return (
          <li
            key={seat.id}
            className={s.row()}>
            <span className={row.frame()}>
              <span className={row.words({ class: "gap-1" })}>
                <PartyHead
                  id={nameId}
                  name={seat.name}
                  chips={seat.chips}
                  muted={seat.muted === true}
                />
                <span
                  id={lineId}
                  className={row.line()}>
                  {textOf(seat.line)}
                </span>
              </span>
              {seat.acts !== undefined && (
                <RowActs
                  className={row.acts()}
                  describedBy={`${nameId} ${lineId}`}>
                  <SideActsScope folds={folds}>{seat.acts}</SideActsScope>
                </RowActs>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The seats while they are read: three rows, each a name and a chip over the muted line, drawn from the rows' recipe, so
 * each stands as a seat's row will. The line's words are set unseen, an address wrapping in a phone's column as it will.
 * `readOnly` is the seats of a page that only shows them: its line names the seat alone and its row ends with its words.
 * Any other draws the one act every seat carries, „Sitz bearbeiten“, as its button: whether the list folds its acts
 * into a „⋯“ is the read's to tell, and the button, under the words in a narrow box, is the taller of the two forms.
 */
export function SeatRowsPlaceholder({ bare = false, readOnly = false }: { bare?: boolean; readOnly?: boolean }) {
  const s = seatRows({ bare });
  const row = actRow({ opens: false });
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
                <span className={buttonPlaceholder()}>{COPY.shared.withObject(COPY.team.seat, "edit")}</span>
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
