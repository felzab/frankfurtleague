import { card, columnHead, stacked } from "./cardStyles";
import { tv } from "./tv";

/**
 * The line-up block's look, which `Lineup` and its placeholder draw from: two cards, each a table of one-line rows
 * at every width, a phone's included, where the kit's `Table` stacks a row's acts under its words. The cards, the
 * column heads and the hairlines are the shared recipes'; the cells set as `Table`'s do, 12-px padding and rows 56 px
 * high on a phone and 52 on desktop, so a line-up reads as every other list of the kit.
 */
export const lineup = tv({
  slots: {
    card: card().root(),
    band: card().head(),
    title: card().title(),
    count: card().count(),
    // `w-full`: the name's column takes the room the others leave; `overflow-x-auto` as every kit table's box.
    box: card().body({ class: "w-full overflow-x-auto" }),
    sheet: "w-full border-collapse text-sm",
    headRow: columnHead().rule(),
    head: columnHead().text(),
    row: `relative h-14 ${stacked()} lg:h-13`,
    // The name takes the room the facts leave and is cut with „…“ where it is longer.
    name: "w-full px-3 py-2",
    // Its one growing track stops at the room the line has and counts nothing towards the column's least width, the
    // mark and the chip in tracks of their own size after it, as `Table`'s name line.
    nameLine: "grid min-w-0 auto-cols-max grid-flow-col grid-cols-[minmax(0,max-content)] items-center gap-2",
    nameWords: "min-w-0 truncate",
    // The row's own line under its name, inside the row's height while it is one line. It wraps rather than being cut,
    // since a touch reaches no tooltip, and a word breaks anywhere, so the line never widens the name's column.
    line: "block text-xs wrap-anywhere",
    cell: "px-3 whitespace-nowrap",
    // The last cell, as narrow as the act it holds.
    end: "w-0 pe-3",
    acts: "flex items-center justify-end",
    // Nobody named yet: one muted sentence in a row of the list's height.
    empty: "flex min-h-14 items-center px-4 py-3 text-base text-fg-muted lg:min-h-13 lg:py-0 lg:text-sm",
  },
  variants: {
    align: {
      start: { head: "text-start", cell: "text-start" },
      // Figures and the tick stand centred under their heads, as a league table's figures do.
      centre: { head: "text-center", cell: "text-center" },
    },
    figures: { true: { cell: "font-numeric" } },
    // A shirt number's column: two figures and its padding at the least, as `Table`'s `count` width.
    count: { true: { head: "min-w-12" } },
    // Left out on a phone, whose row is the name, the number and the row's controls.
    desktop: { true: { head: "max-lg:hidden", cell: "max-lg:hidden" } },
    // A pupil the squad no longer holds.
    muted: { true: { row: "text-fg-muted" } },
    tone: {
      muted: { line: "text-fg-muted" },
      danger: { line: "text-danger" },
    },
  },
});
