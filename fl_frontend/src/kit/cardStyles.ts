import { hoverLook } from "./hoverStyles";
import { tv } from "./tv";

/**
 * The card's surface alone: its hairline, its corners and its fill, which every kit box standing as a card
 * wears, so a ruling on the card's surface reaches each of them from here. A box keeps its own layout and
 * padding beside it, passed as `class`.
 */
export const cardSurface = tv({ base: "rounded-lg border border-border bg-bg-card" });

/**
 * A row or a link covering a box of the card's surface, under the pointer and pressed: the one hover layer (`bg-layer`)
 * over the card, so a button standing in the row lays its own over it, a step of its own. A card's rows, a table's
 * linked rows, `LinkRows` and a card link (`Link`'s card placement, which `SpielRow`, `BracketCard` and the tiles place)
 * read it.
 */
export const cardHover = tv({ base: hoverLook({ host: "link" }) });

/** A card's head as a ground, the one band a card, Konto's box foot and the match head stand on. */
export const headGround = tv({ base: "bg-bg-card-head" });

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
 * How a row of a card holds its name and its chips, a card's act row, a seat's and a party's alike: its box's own width
 * decides (`@container` on the row or its list), the same for every row of that box, never a row's content and never
 * the screen, since the rail and a card grid resize the box under one viewport. From 32 rem the chips stand directly
 * after the name on its line, the name cut with „…“ before a chip gives way; in a narrower box, a phone's and each card
 * of two beside the rail, they take the line under the name, which then has the row's whole width. Either way the
 * chips stand side by side on one line: what parts them from the name is their own basis, the whole line.
 *
 * 32 rem is the least box that holds a name and its chip beside two acts: of its 512 px the row's padding and chevron
 * take 62 and the widest two acts 235, which leaves the words 215.
 */
export const nameWithChips = tv({
  slots: {
    line: "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 @lg:flex-nowrap",
    // A plaque and a mark keep their size around the name, which is cut between them.
    head: "flex max-w-full min-w-0 items-center gap-2",
    name: "min-w-0 truncate font-medium",
    chips: "flex basis-full items-center gap-2 @lg:shrink-0 @lg:basis-auto",
  },
});

/**
 * A card's row that carries acts, a record's and a seat's: by the same box's width as its name and chips
 * (`nameWithChips`), the acts stand beside the words, at the row's end, from 32 rem, and on one line under the words in
 * a narrower box, 8 px under them, so the words, the grey line among them, keep the row's whole width there. The
 * chevron of a row that opens a record is the row's last column in both, centred on the row's height.
 */
export const actRow = tv({
  slots: {
    // No column gap: a row without acts leaves their column empty, and a gap beside it would take 12 px off its words.
    frame: "grid min-h-14 items-center px-4 py-3 lg:min-h-13",
    words: "col-start-1 grid min-w-0 gap-0.5",
    // Positioned above a row's stretched link, so a press on an act does the act rather than open the record.
    acts: "relative z-10 col-start-1 row-start-2 mt-2 flex items-center gap-2 @lg:col-start-2 @lg:row-start-1 @lg:ms-3 @lg:mt-0",
    end: "col-start-2 row-span-2 row-start-1 ms-3 flex self-stretch @lg:col-start-3 @lg:row-span-1",
    line: "text-xs text-fg-muted",
  },
  variants: {
    // Whether the row ends in the chevron's column.
    opens: {
      true: { frame: "grid-cols-[minmax(0,1fr)_auto] @lg:grid-cols-[minmax(0,1fr)_auto_auto]" },
      false: { frame: "grid-cols-[minmax(0,1fr)] @lg:grid-cols-[minmax(0,1fr)_auto]" },
    },
  },
});

/**
 * A list row's side acts by its list's width (`SideActs`): their labelled buttons where the list is a table, and one
 * „⋯“ holding them where its rows are stacked. Both are drawn and one is shown, at the list's own stacking width
 * (`Table.tsx :: table`'s `stacks`), `list` or `crowded`; the table's wait draws its bars from the same.
 */
export const actsFold = tv({
  slots: {
    buttons: "flex items-center gap-2",
    menu: "flex",
  },
  variants: {
    at: {
      list: { buttons: "@max-2xl:hidden", menu: "@2xl:hidden" },
      crowded: { buttons: "@max-5xl:hidden", menu: "@5xl:hidden" },
    },
  },
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
    head: `grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 border-b border-border ${headGround()} px-4 py-3`,
    title: "text-base font-semibold break-words",
    count: "col-start-2 row-start-1 font-numeric text-sm text-fg-muted",
    // A chip at the head's end, in the count's place: the season card's state.
    end: "col-start-2 row-start-1 flex self-center",
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
    // down while the body shows. Under the pointer and pressed the head takes the one hover layer over its band, as
    // every pressable row answers the pointer.
    fold: {
      true: {
        root: "group/fold",
        head: `w-full cursor-pointer border-b-0 text-left ${hoverLook({ host: "aria" })}`,
        title: "flex items-center gap-2",
        body: "border-t border-border",
        chevron: "flex shrink-0 text-fg-muted transition-transform duration-(--motion-state) group-data-expanded/fold:rotate-90",
      },
    },
  },
});
