import { tv } from "./tv";

/**
 * The card's surface alone: its hairline, its corners and its fill, which every kit box standing as a card
 * wears, so a ruling on the card's surface reaches each of them from here. A box keeps its own layout and
 * padding beside it, passed as `class`.
 */
export const cardSurface = tv({ base: "rounded-lg border border-border bg-bg-card" });

/**
 * The fill under the pointer of a row or a link covering a box of the card's surface: one step above the
 * card, so it shows on the raised card as on the page. A card's rows, a table's linked rows, `LinkRows` and
 * a card link (`Link`'s card placement, which `SpielRow`, `BracketCard` and the tiles place) read it.
 */
export const cardHover = tv({ base: "transition-colors duration-(--motion-state) hover:bg-bg-muted" });

/**
 * The hairline parting parts stacked one under another inside one box, drawn above every part but the first: a
 * card's rows, a table's, a match list's, the facts' pairs, the steps and the folded line-up's groups.
 */
export const stacked = tv({ base: "border-t border-border first:border-t-0" });

/**
 * The kit's label rung: small muted capitals, set apart by their tracking. A table's column head and a card's
 * subhead wear it through `columnHead`, and so do a landing section's eyebrow, a fact card's label and the
 * classic footer's group headings, so one ruling on the rung reaches each of them from here.
 */
export const smallCaps = tv({ base: "text-xs font-medium tracking-caps text-fg-muted uppercase" });

/**
 * The column head's look: the label rung, 40 px tall, over a hairline, on the card's own fill. A table's
 * head row reads it, and so does every subhead parting the groups inside one card, such as a line-up's starters
 * and bench or the season card's last and next match, through `GroupHead`: a card's head is the one band it
 * carries, so a group inside it is headed as a column is and never by a second band.
 */
export const columnHead = tv({
  slots: {
    // On a table's head row, the row its heads share; on a subhead, the subhead itself.
    rule: "border-b border-border",
    text: smallCaps({ class: "h-10 whitespace-nowrap" }),
  },
  variants: {
    // In line with what the head stands over: a table's 12-px cells, or a card's 16-px rows such as a match's.
    inset: {
      cells: { text: "px-3" },
      rows: { text: "px-4" },
    },
  },
  defaultVariants: { inset: "cells" },
});

/**
 * A card's look, shared by the server-rendered `Card` and `CardLink` and the client `CardFold`, so a
 * ruling on the card's surface, its head's fill or a row's hover changes one recipe. Kept apart from the
 * client module, whose every export a Server Component would receive as a reference it cannot call.
 *
 * A box of the card's surface, its head one step above it. Its body is rows, or fields with the card's
 * padding around them.
 */
export const card = tv({
  slots: {
    // `content-start` packs the rows at the top: a card stretched to a grid neighbour's height gives the spare
    // height to nothing, where auto rows would split it between the head and the body and grow the head.
    root: `grid content-start overflow-hidden ${cardSurface()} text-fg`,
    head: "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 border-b border-border bg-bg-card-head px-4 py-3",
    title: "text-base font-semibold break-words",
    count: "col-start-2 row-start-1 font-numeric text-sm text-fg-muted",
    // A title with its chip after it, the chip keeping its size while the title wraps.
    named: "flex min-w-0 items-center gap-2",
    line: "col-span-2 text-sm text-fg-muted",
    // A grid item is never narrower than its content by default, so a wide table would be cut at the card's
    // edge; the body shrinks to the card instead, where the table truncates its names or scrolls as its page
    // allows.
    body: "min-w-0",
    foot: "flex justify-end p-4",
    chevron: "",
  },
  variants: {
    body: {
      rows: {},
      fields: { body: "p-4" },
    },
    // The head is the fold's button, the whole width, its title after the chevron. A folded card is its head
    // alone, so the line between head and body is the body's, and goes with it; the chevron turns to point
    // down while the body shows. Under the pointer and pressed the head lifts a step, as every pressable row
    // answers the pointer.
    fold: {
      true: {
        root: "group/fold",
        head: "w-full cursor-default border-b-0 text-left transition-colors duration-(--motion-state) data-hovered:bg-bg-card-head-hover data-pressed:bg-bg-card-head-hover",
        title: "flex items-center gap-2",
        body: "border-t border-border",
        chevron: "flex shrink-0 text-fg-muted transition-transform duration-(--motion-state) group-data-expanded/fold:rotate-90",
      },
    },
  },
});
