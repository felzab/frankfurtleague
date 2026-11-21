import { Fragment } from "react";

import { boundBy, LINE_SEPARATOR, lineOf, textOf } from "@/core/copy";
import { COPY } from "@/core/copy/shared";

import { AddressWords, addressWords, isAddress } from "./AddressWords";
import { cardHover, cardSurface, columnHead, nameWithChips, rowHeight, stacked } from "./cardStyles";
import { Chip } from "./Chip";
import { CutRow, CutText } from "./CutText";
import { EmptyState } from "./EmptyState";
import { FocusOnLeave } from "./FocusOnLeave";
import { Link } from "./Link";
import { RolleMark } from "./RolleMark";
import { RowEnd } from "./RowEnd";
import { RowPress } from "./RowPress";
import { TeamPlaque } from "./TeamPlaque";
import { tv } from "./tv";

import type { Copy, Words } from "@/core/copy";
import type { Route } from "next";
import type { ReactElement } from "react";
import type { AddressText } from "./AddressWords";
import type { ChipProps } from "./Chip";
import type { Clear, EmptyStateProps } from "./EmptyState";
import type { RolleMarkProps } from "./RolleMark";
import type { Plaque } from "./TeamPlaque";

/** A column after the name: its head, and how its values set. */
type TableColumn = {
  key: string;
  label: Copy;
  /** Figures, set in Inter with columns that line up, centred under their head. */
  figures?: boolean;
  /**
   * What the column holds, which sets the least it takes in the table: its edges stand at one place whatever the rows
   * hold while every value fits in that least, and a longer value widens the column to its own width. Every column
   * whose values are bounded by construction states it, an enumerated value or a fixed-format one. Any other column
   * stating none holds free text, whose width is the record's.
   */
  width?: "count" | "code" | "word" | "date" | "instant" | "excerpt" | "phone" | "line";
  /**
   * A value that may run longer than its column, such as a ban's Grund, an address or a club's name: as wide as its
   * longest value while the row has room, sharing what the row leaves free with the name, and cut with „…“ only once the
   * row is full, never narrower than the least `width` sets, whole in its tooltip while it is cut, which a touch never
   * shows. So a `stack` table, whose rows open nothing that would show the rest, cuts no column. Every other column
   * widens to its longest value, so only a value bounded to its column's width goes uncut.
   */
  cut?: true;
} & (
  | { hideOnPhone?: false; narrow?: never; onLine?: never }
  /**
   * A secondary column, such as the day an administrator's access began: left out on a phone, a box narrower than
   * 42 rem on any screen, whose row keeps its name, its chips after it and at most a narrow column. Every secondary
   * column leaves at that one width, so the room it frees is the name's and its chips' wherever the row stacks. What
   * it holds stands somewhere a phone still reaches: a page or a dialog the row itself opens, or else the row's line
   * (`onLine`).
   */
  | { hideOnPhone: true; narrow?: never; onLine?: LineForm }
  /**
   * The fact short enough to stand beside a name on a phone, left out of a box narrower than 20 rem. A list marks at
   * most one column so and leaves its others out. At most a date's width, which leaves the name 184 px at 360 px; a
   * wider column, a team's name or a phone number, leaves it too little. The row's line carries it (`onLine`) in a box
   * narrower than 20 rem alone.
   */
  | { narrow: true; hideOnPhone?: never; width?: "count" | "code" | "word" | "date"; onLine?: LineForm }
);

/**
 * How a column a box leaves out stands on a stacked row's muted line, the table composing the line from such cells in
 * their order, a narrow column's first, joined by „·“, the row's own `line` last: its value alone, where the value says what it is, such as a
 * position, or after its label where it does not, „Gültig bis Saison 2027“, „Nr. 19“. A column stating neither holds a
 * fact the row's own page or dialog shows. A cell holding nothing, or the words for nothing, stands on no line.
 */
type LineForm = "value" | "labelled";

export type TableRow = {
  id: string;
  /** The record's name, marked where it is an address (`AddressText`); with `href` the whole row opens the record. */
  name: Words | AddressText;
  /** What a list read whole is searched by in the row's place, where a search reaches past the name; the name included. */
  words?: string;
  /** A club's plaque before its name, or before a name of the club's own, such as a scorer's. */
  plaque?: Plaque;
  /** The role a player's row holds in its squad, the boxed letter directly after the name and before any chip. */
  mark?: RolleMarkProps;
  /**
   * Where the row's record stands: directly after the name on its line, and in the status column of a list that names
   * one (`state`) where the list is a table.
   */
  chip?: ChipProps;
  /** Beside `chip`, where the last mail of a row that mails met trouble: the delivery's chip, as a seat's. */
  delivery?: ChipProps;
  /** Why the row's record was turned away, on a line of its own under the name, in the danger colour. */
  refusal?: Copy;
  /**
   * The row's values, by column key; a missing value leaves its cell empty. An address is marked (`AddressText`), so
   * the row's line breaks it after its „@“ as every address breaks.
   */
  cells: Readonly<Record<string, Words | AddressText>>;
  /** A row that no longer counts, such as a disqualified team's: its text and its plaque muted. */
  muted?: boolean;
  /**
   * The muted line under the name, cut as a name is: what the row's record is, or when it takes effect. A stacked row's
   * line holds the columns its box leaves out before it (`onLine`).
   */
  line?: Words;
} & (
  | {
      href?: Route;
      /**
       * What the whole row does where it leads to a step of the page rather than to an address, such as a bulk's check
       * page back to a card: a client page's own, since a function cannot cross from the server.
       */
      onOpen?: () => void;
      acts?: never;
    }
  | {
      href?: never;
      onOpen?: never;
      /**
       * What can be done to a record that opens no page of its own: its side acts (`SideActs`, or `RowAct`'s one),
       * their labelled buttons at the row's end where the list is a table, and one „⋯“ at its end, across its lines,
       * where it is stacked. A row the reader can do nothing to takes none, and a table none of whose rows takes any
       * draws no act column.
       */
      acts?: ReactElement;
    }
);

export type TableProps = {
  label: Copy;
  nameLabel: Copy;
  /**
   * The status column of a list whose rows carry a state: its head, and whether a row may carry the delivery's chip
   * beside the state's. It stands directly after the name, each row's chips side by side in it, and its least width is
   * one chip's: two chips the column cannot hold side by side stand one under the other, 2 px apart, as a name's line
   * holds them, so a column that may hold two gives way as a cut column does (`shares`). A stacked row sets them after
   * its name on the name's line instead.
   */
  state?: { label: Copy; delivery?: true };
  columns: ReadonlyArray<TableColumn>;
  rows: ReadonlyArray<TableRow>;
  /** What stands in the rows' place when there are none: a list's cause, or „Nichts offen.“ over a list of what waits. */
  empty: EmptyStateProps | Clear;
  /** The rows alone, without the table's own box, inside a card's body, whose box already holds them. */
  bare?: boolean;
  /**
   * A table of sentences rather than figures, such as the privacy notice's retention table: its cells wrap at every
   * width, and in a box narrower than 42 rem, which has no room for its columns side by side, each row stacks, its name
   * over its cells and every cell after its column's label.
   */
  prose?: boolean;
  /**
   * A table whose cells hold more than a narrow row shares with its name, such as the Protokoll and the match editor's
   * report: in a box narrower than 42 rem each row stacks, its name line over its cells and every cell after its
   * column's label, the cells wrapping. Its rows open nothing, so the name wraps at every width, where a cut name's
   * rest would stand nowhere a touch reaches.
   */
  stack?: boolean;
};

/** A table's heads, its columns and how its cells set, which a page states once, beside the rows it reads. */
export type TableHead = Pick<TableProps, "nameLabel" | "state" | "columns" | "stack">;

export type TableBody = Omit<TableProps, keyof TableHead>;

/** A `prose` or a `stack` table's stacked row's two columns: its cells, then its chevron. */
const PHONE_END_ROW_CLASSES = "@max-2xl:grid-cols-[minmax(0,1fr)_auto] @max-2xl:gap-x-3";

/** That chevron's column, the row's second, centring the chevron on the lines it spans. */
const PHONE_END_CLASSES = "@max-2xl:col-start-2 @max-2xl:flex @max-2xl:w-auto @max-2xl:items-center @max-2xl:pe-0";

/** Words wrapping rather than cut, a long address breaking anywhere rather than widening the row. */
const WRAPS_CLASSES = "wrap-anywhere whitespace-normal";

/** The same words on a stacked row alone, a box narrower than 42 rem, where a touch reaches no tooltip. */
const PHONE_WRAPS_CLASSES = "@max-2xl:wrap-anywhere @max-2xl:whitespace-normal";

/**
 * The table's look. A list's rows stand by the list's own width (`stacks`), the same for every row and never a row's
 * content or the screen, since the rail resizes the box under one viewport (`@container` on the table's box). From
 * 42 rem the list is a table: the name, the status column, the other columns, then the acts or the chevron at the
 * row's end. Below it the rows are stacked, and several lines are what no table row can be, so the table is a grid
 * there and its rows subgrids, head and rows sharing one set of tracks (`stackedTracks`). The name cell gives way to
 * its parts, `contents`, and each part of the row takes a line of its own, in one order: the name's, its chips directly
 * after the name (`nameWithChips`), with the columns the phone keeps beside it, each in its own track
 * under its head; the muted line; and a refusal. The chevron spans the lines, centred on the row, and so does the „⋯“
 * side acts fold into there. A line that holds nothing takes no height, and a head cell's
 * words stand on a 40-px line, since a grid item's stand at its top where a table cell's stand in its middle.
 *
 * A row is a list row's height (`rowHeight`), its hairline among it: in a table exactly that, and stacked at the least.
 * Chips the name's line cannot hold stand 2 px under it, and a name over its chips is 42, a plaque standing beside the
 * two lines, so at 6 px of padding on the 56-px row, 4 on the 52, such a row stands exactly as tall as one whose chips
 * stand after its name.
 */
const table = tv({
  slots: {
    // The column head's look, which every subhead inside a card shares, so the column heads never compete
    // with the card's head band.
    head: columnHead().text(),
    sheet: "w-full border-collapse text-sm",
    headRow: columnHead().rule(),
    // `thead` and `tbody`, whose rows a stacked list sets in the table's own tracks.
    part: "",
    row: `relative ${rowHeight({ form: "table" })} ${stacked()}`,
    cell: "px-3 whitespace-nowrap",
    // The name takes the room the facts leave, which it shares with a column that gives way (`shares`), and is cut with
    // „…“ where it is longer (`nameLine`).
    name: "w-full px-3 py-2",
    // A linked row's last cell, as narrow as the chevron that says the row leads on.
    end: "w-0 pe-3",
    // A prose or a stack table's cell's column label on a stacked row, drawn for the eye alone: the read head names the
    // column.
    label: "",
    // Why the row was turned away, set as the muted line is (`line`) in the danger colour: cut on one line in a table, so
    // the row keeps its height, and wrapping on a stacked row, where a touch reaches no tooltip.
    refusal: "grid grid-cols-[minmax(0,max-content)] text-xs text-danger",
    // The name's words, which a `stack` table wraps.
    whole: "",
    // The muted line's words and a refusal's.
    lineWords: "truncate",
    // Its one track grows no wider than the words, and a track that may shrink to nothing leaves them out of the column's
    // least width, as the name's does (`nameWithChips`).
    line: "grid grid-cols-[minmax(0,max-content)] text-xs text-fg-muted",
    // The status column's cell, and the row's chips in it, side by side while the column holds them and one under the
    // other where it does not, as the name's line sets them (`nameWithChips`).
    state: "px-3",
    chips: nameWithChips().chips(),
    // The same chips on the name's line (`NameCell`).
    lineChips: "",
    // The acts' last cell, as narrow as its buttons, as the chevrons' is, and the acts in it, on one line.
    acts: "w-0 pe-3",
    actsLine: "flex items-center gap-2",
  },
  variants: {
    align: {
      start: { head: "text-start", cell: "text-start" },
      // Figures stand centred under their heads, as the Tabelle's do (`TableStanding`): a head wider than its figures
      // reads as one column with them only centred over them, and the tabular figures keep each digit's width, so a
      // column's values still line up.
      figure: { head: "text-center", cell: "text-center" },
    },
    figures: {
      true: { cell: "font-numeric" },
    },
    // A cut column's words stand in a track that may shrink to nothing (`Cell`), so they count nothing towards the
    // column's least width, which its head's `width` alone sets, and whole towards its widest (`shares`).
    cut: {
      true: {},
    },
    // A list holding a column that gives way, a cut column or a status column that may hold two chips, in its table
    // form: the name and each such column are the table's only automatic columns, every other cell `w-0`, so its column
    // is as wide as its values and no wider. The automatic layout gives each column its least width, then grows the
    // automatic ones together towards their widest, so no word is cut and no chip moves under another while the row has
    // room, and the name and the columns that give way do so alike once it is full; room past every widest goes to the
    // automatic columns by their widest (CSS Tables 3, 3.9.3). The name's `w-full` would make it a percent column, which
    // the layout widens before any other column passes its least, and so cut a value or part two chips beside a name
    // with room to spare.
    shares: {
      true: {},
    },
    // A status column whose rows may carry the delivery's chip beside the state's (`TableProps`'s `state`).
    pair: {
      true: {},
    },
    // A phone is a box narrower than 42 rem, judged by the box's own width: a column has one width over all its rows,
    // so no row's name can decide.
    phone: {
      hidden: { head: "@max-2xl:hidden", cell: "@max-2xl:hidden" },
      // From 20 rem a date column, the chevron and the padding leave a name some twenty characters.
      narrow: { head: "@max-xs:hidden", cell: "@max-xs:hidden" },
      shown: {},
    },
    // A column's least width, on its head cell: the column's edges stand at one place whatever the rows hold while every
    // value fits in it, and the widest value past it sets the column. A minimum, since the name's `w-full` leaves every
    // other column its min-content width (CSS Tables 3, 3.9.3), which a cell's `min-width` raises and a `<col>`'s width
    // does not. Automatic layout, not `fixed`: a value past its column widens the column and the name gives way, where
    // `fixed` would cut it or lay it over the next cell. Each holds its padding: a count two figures, a code three
    // capitals, such as a Stufe or a club's shorthand, a word ten letters, one of a set the contract or the catalogue
    // fixes, such as a position („Mittelfeld“, 62 px measured), a group („Gruppe M“), a kit colour or a count of seats
    // („2 von 3“), a date ten characters, an instant 20, „bis“ before its date and time, an excerpt 20, the start of a
    // `cut` text in a row whose acts need the room a whole line would take, a phone number 20, a line of an address 35
    // where the box is 56 rem or wider and 20 below it, where a name beside a state, the line and a phone number would
    // keep less than its least width. A date and an instant stand at the start in the numeric face, whose tabular
    // figures line a column's digits up, as every date column's do; never as `figures`, which would centre them.
    width: {
      count: { head: "min-w-12" },
      code: { head: "min-w-16" },
      word: { head: "min-w-24" },
      date: { head: "min-w-28", cell: "font-numeric" },
      instant: { head: "min-w-40", cell: "font-numeric" },
      excerpt: { head: "min-w-40" },
      phone: { head: "min-w-44" },
      line: { head: "min-w-44 @4xl:min-w-72" },
      // The status column: a chip of 120 px in its padding, the state's and the delivery's standing one under the other
      // where the column holds no more. A longer chip, such as a link's „Keine bestätigte Adresse“, widens the column.
      chip: { head: "min-w-36" },
    },
    // In a box narrower than 42 rem the column heads are read but not drawn, and each cell draws its column's label
    // before its words.
    prose: {
      true: {
        head: "@max-2xl:sr-only",
        row: "@max-2xl:grid @max-2xl:gap-1 @max-2xl:px-3 @max-2xl:py-3",
        name: "w-auto py-3 align-top @max-2xl:col-start-1 @max-2xl:px-0 @max-2xl:py-0 @max-2xl:font-semibold",
        cell: "py-3 align-top whitespace-normal @max-2xl:col-start-1 @max-2xl:grid @max-2xl:grid-cols-[4rem_minmax(0,1fr)] @max-2xl:gap-x-3 @max-2xl:px-0",
        label: "text-xs text-fg-muted @2xl:hidden",
      },
    },
    // In a box narrower than 42 rem the column heads are read but not drawn, and each row is one column of its name
    // line and its cells, each cell drawing its column's label before its words, which wrap there under their own
    // label, in one column of `minmax(0, 1fr)`, which a long word cannot widen. The name wraps at every width.
    stack: {
      true: {
        head: "@max-2xl:sr-only",
        row: "@max-2xl:grid @max-2xl:grid-cols-1 @max-2xl:gap-1 @max-2xl:px-3 @max-2xl:py-3",
        name: "@max-2xl:col-start-1 @max-2xl:w-auto @max-2xl:px-0 @max-2xl:py-0",
        whole: WRAPS_CLASSES,
        cell: `@max-2xl:col-start-1 @max-2xl:grid @max-2xl:grid-cols-[4rem_minmax(0,1fr)] @max-2xl:gap-x-3 @max-2xl:px-0 @max-2xl:text-start ${PHONE_WRAPS_CLASSES}`,
        label: "text-xs text-fg-muted @2xl:hidden",
      },
    },
    // Where a list's rows are stacked; `none` is a table whose rows stack in a form of their own, a `prose` and a `stack`
    // table's.
    stacks: {
      none: {},
      list: {
        sheet: "@max-2xl:grid",
        part: "@max-2xl:contents",
        headRow: "@max-2xl:col-span-full @max-2xl:grid @max-2xl:grid-cols-subgrid",
        head: "@max-2xl:row-start-1 @max-2xl:leading-10",
        row: `@max-2xl:col-span-full @max-2xl:grid ${rowHeight({ form: "stacked" })} @max-2xl:grid-cols-subgrid @max-2xl:content-center @max-2xl:items-center @max-2xl:py-1 pointer-coarse:@max-2xl:py-1.5`,
        name: "@max-2xl:contents",
        // A stacked row's chips stand on its name's line (`chipsOnLine`).
        state: "@max-2xl:hidden",
        line: "@max-2xl:col-start-1 @max-2xl:-col-end-2 @max-2xl:row-start-2 @max-2xl:px-3 @max-2xl:pt-0.5",
        lineWords: "@max-2xl:wrap-anywhere @max-2xl:whitespace-normal",
        refusal: "@max-2xl:col-start-1 @max-2xl:-col-end-2 @max-2xl:row-start-3 @max-2xl:px-3 @max-2xl:pt-0.5",
        cell: "@max-2xl:row-start-1",
        end: "@max-2xl:-col-start-2 @max-2xl:row-span-4 @max-2xl:row-start-1 @max-2xl:flex @max-2xl:w-auto @max-2xl:items-center",
        // The „⋯“ stands in the row's last track, across its lines, as a chevron does. Its button is taller than a
        // name's line, and a cell spanning the lines would share that height out over them and stand a lone name above
        // the button's centre; so the cell's size counts nothing (`contain-size`), its width stated, and the button
        // stands centred on the row's lines, inside the row's least height.
        acts: "@max-2xl:-col-start-2 @max-2xl:-col-end-1 @max-2xl:row-span-4 @max-2xl:row-start-1 @max-2xl:flex @max-2xl:w-11 @max-2xl:items-center @max-2xl:px-0 @max-2xl:pe-3 @max-2xl:contain-size pointer-coarse:@max-2xl:w-13",
        actsLine: "@2xl:justify-end",
      },
    },
    // Where the chips on the name's line show: at every width on a table that names no status column, and on the
    // stacked rows alone of a list that names one, whose column holds them from 42 rem.
    chipsOnLine: {
      always: {},
      stacked: { lineChips: "@2xl:hidden" },
    },
    // A head that holds no track of a stacked row: the status column's, whose chips stand on the name's line there, and
    // the chevrons' and the acts', which name nothing.
    lone: {
      true: {},
    },
    linked: {
      true: { row: cardHover() },
    },
    // A table some row of which opens its record, which draws the chevrons' column.
    chevrons: {
      true: {},
    },
    muted: {
      true: { row: "text-fg-muted" },
    },
  },
  compoundVariants: [
    // Restated after the variants, so a `prose` or a `stack` table's stacked row, whose cells are grids there, never
    // draws a column a narrow box leaves out: the merger keeps the later of two `display` classes.
    { phone: "hidden", class: { head: "@max-2xl:hidden", cell: "@max-2xl:hidden" } },
    // In a stacked list a cut value counts nothing towards its track, which its head's least width alone sets.
    { cut: true, stacks: "list", class: { cell: "@max-2xl:contain-inline-size" } },
    // The table form alone: a stacked row's cells are grid items, which `w-0` would draw as wide as nothing.
    { shares: true, stacks: "list", class: { name: "@2xl:w-auto", cell: "@2xl:w-0", state: "@2xl:w-0" } },
    { shares: true, stacks: "list", cut: true, class: { cell: "@2xl:w-auto" } },
    { shares: true, stacks: "list", pair: true, class: { state: "@2xl:w-auto" } },
    { lone: true, stacks: "list", class: { head: "@max-2xl:hidden" } },
    // A prose or a stack table's stacked row stands its cells in one column and its chevron in a column of its own at
    // its end, spanning every cell's line so it is centred on the row's height (`phoneEndStyle`).
    { prose: true, chevrons: true, class: { row: PHONE_END_ROW_CLASSES, end: PHONE_END_CLASSES } },
    { stack: true, chevrons: true, class: { row: PHONE_END_ROW_CLASSES, end: PHONE_END_CLASSES } },
  ],
});

/**
 * How a table's rows stack: a list's by its box, every list's at one width, and not as a list's where the table has a
 * stacked form of its own, a `prose` and a `stack` table, which stacks at the same width.
 */
type Stacks = "none" | "list";

const stacksOf = (kind: { prose: boolean; stack: boolean }): Stacks => (kind.prose || kind.stack ? "none" : "list");

/**
 * Where a row's chips stand on its name's line: at every width on a table that names no status column, on the stacked
 * rows alone of a list that names one, and never on a table whose rows never stack and whose column always holds them.
 */
type ChipsOnLine = "always" | "stacked" | "never";

const chipsOnLineOf = (state: TableProps["state"], stacks: Stacks): ChipsOnLine =>
  state === undefined ? "always" : stacks === "list" ? "stacked" : "never";

/** Whether a column stands on a phone: left out, drawn where it fits, or drawn at every width. */
function phoneOf(column: TableColumn) {
  if (column.hideOnPhone === true) return "hidden";
  return column.narrow === true ? "narrow" : "shown";
}

/** How a column sets, for its head and its cells alike. */
const columnLook = (column: TableColumn, stacks: Stacks) =>
  ({
    align: column.figures === true ? "figure" : "start",
    phone: phoneOf(column),
    width: column.width,
    cut: column.cut === true,
    stacks,
  }) as const;

/**
 * The tracks of a stacked list: the name's, which takes the room the others leave, as `w-full` does in a table, and
 * never less than a name's least width, 5 rem, with a plaque 8; one for each column, a column the phone leaves out
 * drawing nothing and so holding none of the width; and the chevron's. Inline, for a count no class can name; a table
 * ignores it.
 */
function stackedTracks(stacks: Stacks, columns: ReadonlyArray<TableColumn>, plaques: boolean) {
  if (stacks === "none") return undefined;
  const name = `minmax(${plaques ? "8rem" : "5rem"}, 1fr)`;
  // `repeat` counts from 1: a count of 0 voids the whole declaration, the name's track with it.
  return { gridTemplateColumns: columns.length === 0 ? `${name} auto` : `${name} repeat(${String(columns.length)}, auto) auto` };
}

/**
 * A column's track in a stacked list, for its head and its cells alike: stated, since the grid's own placement would
 * stand a cell in the first free track. A grid placement, which a table cell ignores.
 */
const stackedTrack = (stacks: Stacks, index: number) => (stacks === "none" ? undefined : { gridColumnStart: index + 2 });

/**
 * A `prose` or a `stack` table's stacked row's chevron spans the lines of every cell the row draws, the name and each
 * column it keeps: a count no grid rule can name, since a span to the last line reaches no line the cells add
 * themselves. A grid placement, which that stacked row alone reads: a table cell ignores it.
 */
function phoneEndStyle(columns: ReadonlyArray<TableColumn>) {
  const cells = 1 + columns.filter((column) => column.hideOnPhone !== true).length;
  return { gridRow: `1 / span ${String(cells)}` };
}

/** A cell's value: its words, cut with „…“ in a cut column. */
function Cell({ cell, cut }: { cell: Words | undefined; cut: boolean }) {
  if (cell === undefined) return null;
  if (cut)
    return (
      // One track no wider than the words that may shrink to nothing: the words count whole towards the column's widest
      // and nothing towards its least, which a cell's own `max-width`, whose effect on a cell CSS 2.1 leaves undefined,
      // could not say apart.
      <span className="grid grid-cols-[minmax(0,max-content)]">
        <CutText
          text={textOf(cell)}
          className="truncate"
        />
      </span>
    );
  return textOf(cell);
}

/** A part of a stacked row's line standing for a column its box leaves out (`onLine`). */
type LinePart = { key: string; words: Words | AddressText; label?: Copy; narrow: boolean };

/** The words a cell holds where it holds nothing, which state no fact on a line. */
const NOTHING: ReadonlySet<string> = new Set([COPY.shared.noValue, COPY.shared.notProvided, ""]);

/**
 * The parts of a row's line, each column's that states its form (`onLine`) and holds a value. A narrow column's part
 * leads, since it shows in a box narrower than 20 rem alone, where every other part shows too, so whatever follows a
 * part shows wherever the part does, and the „·“ after it with it.
 */
function linePartsOf(columns: ReadonlyArray<TableColumn>, row: TableRow): LinePart[] {
  const parts = columns.flatMap((column) => {
    const words = row.cells[column.key];
    if (column.onLine === undefined || words === undefined || NOTHING.has(textOf(words))) return [];
    return [{ key: column.key, words, narrow: column.narrow === true, ...(column.onLine === "labelled" ? { label: column.label } : {}) }];
  });
  return [...parts.filter((part) => part.narrow), ...parts.filter((part) => !part.narrow)];
}

/** Where a line of parts alone leaves: where the widest-shown of its columns shows again. */
const lineGone = (parts: readonly LinePart[]) => (parts.some((part) => !part.narrow) ? "@2xl:hidden" : "@xs:hidden");

const partText = (part: LinePart) => (part.label === undefined ? textOf(part.words) : boundBy(part.label, textOf(part.words)));

/**
 * The muted line under the name: the parts standing for the columns the box leaves out, each shown where its column is
 * not, then the row's own `line`, at every width. A line of parts alone takes no room where the box shows every column.
 * An address among the parts breaks after its „@“ (`AddressWords`), where a plain line would break it anywhere.
 */
function RowLine({ parts, line, className }: { parts: readonly LinePart[]; line: Words | undefined; className: string }) {
  const own = line === undefined ? null : textOf(line);
  return (
    <CutText
      text={own ?? lineOf(parts.map(partText))}
      className={className}>
      {parts.map((part, index) => (
        <span
          key={part.key}
          className={part.narrow ? "@xs:hidden" : "@2xl:hidden"}>
          {isAddress(part.words) ? (
            <>
              {/* The label bound to the address's start, which breaks after its „@“ alone. */}
              {part.label === undefined ? null : boundBy(part.label, "")}
              <AddressWords address={textOf(part.words)} />
            </>
          ) : (
            partText(part)
          )}
          {index < parts.length - 1 || own !== null ? LINE_SEPARATOR : null}
        </span>
      ))}
      {own}
    </CutText>
  );
}

/**
 * A row's name line: a club's plaque, then the name with its mark and the chips after it, as every row holds them
 * (`nameWithChips`). Its least width is the name's, 5 rem, with a plaque its 40 px and their gap
 * besides, so the table narrows the column to no less: the name's words count nothing towards it, where a cut name in
 * a flex row would count whole, a table cell being never narrower than its content's least width, and push the table
 * past its box.
 */
const nameLine = tv({
  base: "flex items-center gap-2",
  variants: {
    shape: {
      // A prose table's name wraps, and its longest word is the least width of its column.
      wraps: "min-w-0",
      name: "min-w-20",
      plaque: "min-w-32",
    },
    // The first line of a stacked row, in the name's track (`table`'s `stacks`).
    stacks: {
      none: "",
      list: "@max-2xl:col-start-1 @max-2xl:row-start-1 @max-2xl:px-3",
    },
    // An address wraps instead (`AddressWords`), a chip beside its first line.
    address: { true: "items-start" },
  },
});

/** What a table's name line sets apart from every other row's (`nameWithChips`): its wrapping line and the name's group in it. */
const nameParts = tv({
  slots: {
    line: "",
    group: "",
    // The span holding a row's names and its link.
    words: "min-w-0",
  },
  variants: {
    // A prose table's name wraps, a part of the line itself.
    wraps: {
      true: { group: "contents" },
    },
    // A prose and a stack table's name and an address wrap; every other name is cut with „…“.
    cut: {
      true: { words: "truncate" },
    },
  },
});

function Chips({ row }: { row: TableRow }) {
  return (
    <>
      {row.chip !== undefined && <Chip {...row.chip} />}
      {row.delivery !== undefined && <Chip {...row.delivery} />}
    </>
  );
}

/**
 * The name, cut with „…“ where its column is too narrow and whole in its `title` while it is cut, then a player's mark;
 * a prose and a stack table's name wraps instead, and so does an address (`AddressWords`). The row's chips follow
 * directly after it on the name's line (`chipsOnLine`), and take the next line where the line cannot hold them beside
 * the name's least width. A club's plaque stands before the line, so the cut never takes it and it stands beside a name
 * over its chips, and outside the row's link; the link's stretched box still covers it, so a press on it opens the
 * row's record. Under the name line stand the muted line and a refusal.
 */
function NameCell({
  row,
  prose,
  stack,
  stacks,
  chipsOnLine,
  shares,
  lineParts,
}: {
  row: TableRow;
  prose: boolean;
  stack: boolean;
  stacks: Stacks;
  chipsOnLine: ChipsOnLine;
  lineParts: readonly LinePart[];
  /** Whether the list holds a column that gives way, which shares the row's free room with the name (`table`'s `shares`). */
  shares: boolean;
}) {
  const s = table({
    prose,
    stack,
    stacks,
    chipsOnLine: chipsOnLine === "never" ? undefined : chipsOnLine,
    shares,
  });
  const { plaque } = row;
  const name = textOf(row.name);
  const address = isAddress(row.name);
  const words = address ? <AddressWords address={name} /> : name;
  const opens =
    row.onOpen === undefined ? (
      words
    ) : (
      // The step its press opens can end the row, or the press it offers, while the step holds the focus.
      <FocusOnLeave>
        <RowPress onPress={row.onOpen}>{words}</RowPress>
      </FocusOnLeave>
    );
  const shape = prose ? "wraps" : plaque === undefined ? "name" : "plaque";
  const held = nameWithChips({ address, led: true });
  const parts = nameParts({ wraps: prose, cut: !prose && !stack && !address });
  return (
    <td
      role="cell"
      className={s.name()}>
      <span className={nameLine({ shape, stacks, address })}>
        {plaque !== undefined && (
          <TeamPlaque
            plaque={plaque}
            muted={row.muted === true}
          />
        )}
        <span className={held.line({ class: parts.line() })}>
          <span className={held.head({ class: parts.group() })}>
            <CutText
              text={name}
              className={parts.words({ class: address ? addressWords({ class: s.whole() }) : s.whole() })}>
              {row.href === undefined ? (
                opens
              ) : (
                <Link
                  href={row.href}
                  placement="row">
                  {words}
                </Link>
              )}
            </CutText>
            {row.mark !== undefined && <RolleMark {...row.mark} />}
          </span>
          {/* A list with a status column draws a row's chips twice, here for its stacked rows and in the column's cell
              for its table: a stacked row's chips wrap with its name in this line, a table's stand in a cell of their
              own, and no CSS moves a box between the two. Exactly one shows at any width of the box, and the other is
              `display: none`, so it is not read either. */}
          {chipsOnLine !== "never" && (row.chip !== undefined || row.delivery !== undefined) && (
            <span className={held.chips({ class: s.lineChips() })}>
              <Chips row={row} />
            </span>
          )}
        </span>
      </span>
      {(row.line !== undefined || lineParts.length > 0) && (
        <span className={s.line({ class: row.line === undefined ? lineGone(lineParts) : "" })}>
          <RowLine
            parts={lineParts}
            line={row.line}
            className={s.lineWords()}
          />
        </span>
      )}
      {row.refusal !== undefined && (
        <span className={s.refusal()}>
          <CutText
            text={row.refusal}
            className={s.lineWords()}
          />
        </span>
      )}
    </td>
  );
}

/**
 * A list of records. A row opens its record, a chevron at its end saying so, or, where its record has no page of its
 * own, carries its acts. Few columns: the name with its plaque, the status column where the rows carry a state, then a
 * few facts.
 *
 * The list's own width picks its rows' form, for every row and every list alike (`table`'s `stacks`): a table from
 * 42 rem, and below it stacked rows, the name and its chips with at most a narrow column beside them, then the muted
 * line on a line of its own, and the acts' „⋯“ at the row's end. A `prose` and a `stack` table stack their own way at the same width,
 * each cell under the name after its column's label. The table, its rows, its heads and its cells carry their table
 * roles in writing, since a stacked row's and a prose row's `display: grid` drops the semantics an engine infers from
 * the elements alone.
 */
export function Table({ label, nameLabel, state, columns, rows, empty, bare = false, prose = false, stack = false }: TableProps) {
  // Any row's acts give the whole table its column, whose head names nothing, as the chevrons' does.
  const hasActs = rows.some((row) => row.acts !== undefined);
  const stacks = stacksOf({ prose, stack });
  const pair = state?.delivery === true;
  const shares = pair || columns.some((column) => column.cut === true);
  const parts = table({ stacks, shares, pair });
  const leadsOn = (row: TableRow) => row.href !== undefined || row.onOpen !== undefined;
  const isLinked = rows.some(leadsOn);
  // Every row keeps the chevron's room on a phone where some row draws one there.
  const phoneEnd = { prose, stack, stacks, chevrons: isLinked };
  const endStyle = prose || stack ? phoneEndStyle(columns) : undefined;
  return (
    // `w-full`: a Section's grid starts its children, which would shrink the table and cut its cells.
    <div className={bare ? "@container w-full overflow-x-auto" : cardSurface({ class: "@container w-full overflow-x-auto" })}>
      {rows.length === 0 ? (
        <EmptyState {...empty} />
      ) : (
        <table
          role="table"
          aria-label={label}
          className={parts.sheet()}
          style={stackedTracks(
            stacks,
            columns,
            rows.some((row) => row.plaque !== undefined),
          )}>
          <thead className={parts.part()}>
            <tr
              role="row"
              className={parts.headRow()}>
              <th
                role="columnheader"
                scope="col"
                className={table({ align: "start", prose, stack, stacks }).head()}>
                {nameLabel}
              </th>
              {state !== undefined && (
                <th
                  role="columnheader"
                  scope="col"
                  className={table({ align: "start", width: "chip", stacks, lone: true }).head()}>
                  {state.label}
                </th>
              )}
              {columns.map((column, index) => (
                <th
                  key={column.key}
                  role="columnheader"
                  scope="col"
                  className={table({ ...columnLook(column, stacks), prose, stack }).head()}
                  style={stackedTrack(stacks, index)}>
                  {column.label}
                </th>
              ))}
              {/* The chevrons' column and the acts' name nothing, so their head is no header cell. */}
              {isLinked && (
                <td
                  role="cell"
                  className={table({ prose, stack, stacks, lone: true }).head()}
                />
              )}
              {hasActs && (
                <td
                  role="cell"
                  className={table({ stacks, lone: true }).head()}
                />
              )}
            </tr>
          </thead>
          <tbody className={parts.part()}>
            {rows.map((row) => {
              // A row its name's link or press stretches over: the cut words under the pointer, in any cell, are the
              // tooltip the stretched name carries (`CutRow`).
              const Stretched = leadsOn(row) ? CutRow : Fragment;
              return (
                <tr
                  key={row.id}
                  data-kit-row
                  role="row"
                  className={table({ linked: leadsOn(row), muted: row.muted === true, ...phoneEnd }).row()}>
                  <Stretched>
                    <NameCell
                      row={row}
                      prose={prose}
                      stack={stack}
                      stacks={stacks}
                      chipsOnLine={chipsOnLineOf(state, stacks)}
                      lineParts={linePartsOf(columns, row)}
                      shares={shares}
                    />
                    {state !== undefined && (
                      <td
                        role="cell"
                        className={parts.state()}>
                        <span className={parts.chips()}>
                          <Chips row={row} />
                        </span>
                      </td>
                    )}
                    {columns.map((column, index) => {
                      const s = table({
                        ...columnLook(column, stacks),
                        figures: column.figures === true,
                        prose,
                        stack,
                        shares,
                      });
                      return (
                        <td
                          key={column.key}
                          role="cell"
                          className={s.cell()}
                          style={stackedTrack(stacks, index)}>
                          {(prose || stack) && (
                            <span
                              aria-hidden
                              className={s.label()}>
                              {column.label}
                            </span>
                          )}
                          <Cell
                            cell={row.cells[column.key]}
                            cut={column.cut === true}
                          />
                        </td>
                      );
                    })}
                    {isLinked && (
                      <td
                        role="cell"
                        className={table(phoneEnd).end()}
                        style={endStyle}>
                        {leadsOn(row) && <RowEnd />}
                      </td>
                    )}
                    {hasActs && (
                      <td
                        role="cell"
                        className={parts.acts()}>
                        {row.acts !== undefined && <div className={parts.actsLine()}>{row.acts}</div>}
                      </td>
                    )}
                  </Stretched>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
