import { Fragment, useId } from "react";

import { COPY, textOf } from "@/core/copy";
import { formatNumber } from "@/core/format";

import { AddressWords, addressWords, isAddress } from "./AddressWords";
import { buttonPlaceholder } from "./buttonStyles";
import { cardHover, cardSurface, columnHead, stacked } from "./cardStyles";
import { Chip } from "./Chip";
import { CutRow, CutText } from "./CutText";
import { EmptyState } from "./EmptyState";
import { Link } from "./Link";
import { RoleMark } from "./RoleMark";
import { RowActs } from "./RowActs";
import { RowEnd } from "./RowEnd";
import { RowPress } from "./RowPress";
import { placeholderBar, PlaceholderLine } from "./Skeleton";
import { TargetMark } from "./TargetMark";
import { TeamPlaque } from "./TeamPlaque";
import { tv } from "./tv";

import type { Copy, Words } from "@/core/copy";
import type { Route } from "next";
import type { ReactElement } from "react";
import type { AddressText } from "./AddressWords";
import type { ChipProps } from "./Chip";
import type { EmptyStateProps } from "./EmptyState";
import type { RoleMarkProps } from "./RoleMark";
import type { Plaque } from "./TeamPlaque";

/** A column after the name: its head, and how its values set. */
type TableColumn = {
  key: string;
  label: Copy;
  /** Figures, set in Inter with columns that line up, centred under their head as the rank is. */
  figures?: boolean;
  /** The column that decides, such as points: its figures in the strong weight. */
  strong?: boolean;
  /**
   * What the column holds, which sets the least it takes, on a table that waits: its values are the read's, so without
   * this its edges land elsewhere than its placeholder drew them. A head wider than its values needs none.
   */
  width?: "count" | "pair" | "marked" | "date" | "instant" | "excerpt" | "phone" | "line";
  /**
   * A value that may run longer than its column, such as a ban's Grund, an address or a club's name: cut with „…“ at the
   * column `width` sets, whole in its tooltip while it is cut, and wrapping on a stacked phone row, where a touch reaches
   * no tooltip. Every other column widens to its longest value, so only a value bounded to its column's width goes uncut.
   */
  cut?: true;
} &
  /**
   * Left out on a phone: of a box narrower than 42 rem, a phone's on any screen, whose row keeps its name, its chips
   * under it and at most a narrow column.
   */
  (
    | { hideOnPhone?: boolean; phoneOnly?: never; narrow?: never }
    /** Drawn on a phone alone, such as one column standing for several the phone leaves out. */
    | { phoneOnly: true; hideOnPhone?: never; narrow?: never }
    /**
     * The fact short enough to stand beside a name on a phone, left out of a box narrower than 20 rem. A list marks at
     * most one column so and leaves its others out. At most a date's width, which leaves the name 184 px at 360 px; a
     * wider column, a team's name or a phone number, leaves it too little.
     */
    | { narrow: true; hideOnPhone?: never; phoneOnly?: never; width?: "count" | "pair" | "marked" | "date" }
  );

/** A club's won, drawn and lost counts. */
export type Counts = readonly [won: number, drawn: number, lost: number];

/**
 * A cell's value: its words; a figure some of the club's fixtures left short, such as its count of matches
 * while some were called off, carrying the mark that says how many, which its name tells a screen reader and
 * no line explains; or a club's won, drawn and lost counts in one cell, „3-1-0“, each in its own colour.
 */
type TableCell = Words | { value: Words; cancelled: number } | { counts: Counts };

export type TableRow = {
  id: string;
  /** The record's name, marked where it is an address (`AddressText`); with `href` the whole row opens the record. */
  name: Words | AddressText;
  /** What a list read whole is searched by in the row's place, where a search reaches past the name; the name included. */
  words?: string;
  /** A club's plaque before its name, or before a name of the club's own, such as a scorer's. */
  plaque?: Plaque;
  /** The role a player's row holds in its squad, the boxed letter directly after the name and before any chip. */
  mark?: RoleMarkProps;
  /**
   * Where the row's record stands: in the list's status column (`state`), or, on a table that names none, such as the
   * Tabelle, directly after the name.
   */
  chip?: ChipProps;
  /** Beside `chip`, where the last mail of a row that mails met trouble: the delivery's chip, as a seat's. */
  delivery?: ChipProps;
  /** Why the row's record was turned away, on a line of its own under the name, in the danger colour. */
  refusal?: Copy;
  /** The row's values, by column key; a missing value leaves its cell empty. */
  cells: Readonly<Record<string, TableCell>>;
  /**
   * A place that qualifies, the 2-px bar at the row's left edge: in the brand's green where the place is the row's
   * alone, `settled`, and in the control grey where level clubs share it, `level`, since until the tie resolves the
   * bracket seeds none of them. Drawn in the row's first cell, so on a table whose rows are one line at every width
   * (`compact`).
   */
  qualifies?: "settled" | "level";
  /** A row that no longer counts, such as a disqualified team's: its text and its plaque muted. */
  muted?: boolean;
  /** The row's fragment, so a link elsewhere, such as a club's line in a match head, opens the page at it. */
  anchor?: string;
  /**
   * Its place in the rank column, as the record holds it: level rows share one, and a row holding none, such as a
   * club that has played no match, shows a dash.
   */
  place?: number | null;
} & (
  | {
      /** The muted line under the name, cut as a name is: what the row's record is, or when it takes effect. */
      line?: Words;
      phoneLine?: never;
    }
  | {
      line?: never;
      /**
       * The same line on a phone alone, standing for columns a phone leaves out, such as a player's position and Stufe:
       * from `lg` those columns say it.
       */
      phoneLine?: Words;
    }
) &
  (
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
         * What can be done to a record that opens no page of its own: one or two kit buttons, each the trigger of its
         * dialog, as a card's act row holds them: on one line under the row's words where the list is stacked, at the
         * row's end where it is a table. A row the reader can do nothing to takes none, and a table none of whose rows
         * takes any draws no act column.
         */
        acts?: ReactElement;
      }
  );

export type TableProps = {
  /** The table's name. */
  label: Copy;
  /** The name column's head. */
  nameLabel: Copy;
  /** A leading rank column, its head; each row's place is its `place`. */
  rankLabel?: Copy;
  /**
   * The status column of a list whose rows carry a state: its head, and whether a row may carry the delivery's chip
   * beside the state's, which is the least width the column takes. It stands directly after the name, each row's chips
   * side by side in it; a stacked row sets them on one line under its name instead.
   */
  state?: { label: Copy; delivery?: true };
  /**
   * A list whose table needs more than 42 rem holds beside a name's least width, such as two acts after two chips and
   * an instant: it stands as a table from 64 rem and keeps its stacked rows below, which from 42 rem keep every column
   * beside the name.
   */
  crowded?: boolean;
  columns: ReadonlyArray<TableColumn>;
  rows: ReadonlyArray<TableRow>;
  /** What stands in the rows' place when there are none. */
  empty: EmptyStateProps;
  /** The rows alone, without the table's own box, inside a card's body, whose box already holds them. */
  bare?: boolean;
  /**
   * A table of more figures than a phone's width holds at the standard padding, the Tabelle's: its rows are one line at
   * every width, and on a phone every column keeps its place by compact cells. Every other table keeps its 12-px cells
   * on a phone.
   */
  compact?: boolean;
  /**
   * A table of sentences rather than figures, such as the privacy notice's retention table: its cells wrap at every
   * width, and on a phone, which has no room for its columns side by side, each row stacks, its name over its cells and
   * every cell after its column's label.
   */
  prose?: boolean;
  /**
   * A table whose cells hold more than a phone's row shares with its name, such as the match editor's report: on a
   * phone each row stacks, its name line over its cells and every cell after its column's label, the name and the cells
   * wrapping.
   */
  stack?: boolean;
  /**
   * Whether a linked row's chevron stands on a phone too, as on every list opening a record. The Tabelle alone
   * leaves it out there, the whole row still the link: the owner's ruling for that table, not a matter of room,
   * since its cells hold the chevron, so `compact` does not decide it.
   */
  chevronOnPhone?: boolean;
  /**
   * Whether each row's name is its plaque's own club, as the Tabelle's: on a phone the plaque then stands for the club,
   * the name read but not drawn. Every other table draws the name beside its plaque, since a plaque says nothing of a
   * scorer.
   */
  plaqueAlone?: boolean;
};

/**
 * What a table is before its rows are read: its heads, its columns and how its cells set. A page states it once,
 * beside the rows it reads, so the table and its placeholder are drawn from the one declaration.
 */
export type TableHead = Pick<
  TableProps,
  "nameLabel" | "rankLabel" | "state" | "crowded" | "columns" | "compact" | "chevronOnPhone" | "plaqueAlone" | "stack"
> & {
  /** The rows open nothing, so their wait ends in no chevron. */
  linked?: false;
  /** The labels of the acts a row carries, which its wait draws as buttons; the rows open nothing either. */
  acts?: ReadonlyArray<Copy>;
};

/** A table's rows once read: everything but its head. */
export type TableBody = Omit<TableProps, keyof TableHead>;

/** A stacked phone row's two columns: its cells, then its chevron, the kit's 12-px gap between them. */
const PHONE_END_ROW_CLASSES = "max-lg:grid-cols-[minmax(0,1fr)_auto] max-lg:gap-x-3";

/** That chevron's column, the row's second, centring the chevron on the lines it spans. */
const PHONE_END_CLASSES = "max-lg:col-start-2 max-lg:flex max-lg:w-auto max-lg:items-center max-lg:pe-0";

/** Words on a phone wrapping rather than cut, a long address breaking anywhere rather than widening the row. */
const PHONE_WRAPS_CLASSES = "max-lg:wrap-anywhere max-lg:whitespace-normal";

/**
 * The table's look. A list's rows stand by the list's own width (`stacks`), the same for every row and never a row's
 * content or the screen, since the rail resizes the box under one viewport (`@container` on the table's box). From
 * 42 rem the list is a table: the name, the status column, the other columns, then the acts or the chevron at the
 * row's end. Below it the rows are stacked, and several lines are what no table row can be, so the table is a grid
 * there and its rows subgrids, head and rows sharing one set of tracks (`stackedTracks`). The name cell gives way to
 * its parts, `contents`, and each part of the row takes a line of its own, in one order: the name's, with the columns
 * the phone keeps beside it, each in its own track under its head; the chips, side by side; the muted line; a refusal;
 * and the acts on one line. The chevron spans the lines, centred on the row. A line that holds nothing takes no
 * height, and a head cell's words stand on a 40-px line, since a grid item's stand at its top where a table cell's
 * stand in its middle.
 *
 * A row is 56 px at the least, 52 from `lg`, its hairline among them, and a name over its chips is 42, the chips 2 px
 * under the name's line, so at 6 px of padding, 4 from `lg`, a row with a chip stands exactly as tall as one without
 * and a wait's rows land without a shift. A list whose rows carry acts pads its rows 12 px, as a card's act row is
 * (`cardStyles.ts :: actRow`).
 *
 * `crowded` is the same form from 64 rem, for the list whose table 42 rem cannot hold. Both are written out, since a
 * stylesheet is built from classes named in full: they differ in their breakpoint alone.
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
    // A row a link may point to by its fragment, marked while the address names it.
    row: `kit-target relative h-14 ${stacked()} lg:h-13`,
    cell: "px-3 whitespace-nowrap",
    // The name takes the room the facts leave and is cut with „…“ where it is longer (`nameLine`).
    name: "w-full px-3 py-2",
    // A club's name beside its plaque, read but not drawn on a phone, where the plaque stands for it alone.
    clubName: "@max-2xl:sr-only",
    // A linked row's last cell, as narrow as the chevron that says the row leads on.
    end: "w-0 pe-3",
    // A prose or a stacked cell's column label on a phone, drawn for the eye alone: the read head names the column.
    label: "",
    // Under the name line, cut as a name is, so a table's row keeps its height.
    refusal: "block truncate text-xs text-danger",
    // The name's words, which a `stack` table's phone row wraps.
    whole: "",
    lineWords: "truncate",
    // Its one track grows no wider than the words, and a track that may shrink to nothing leaves them out of the column's
    // least width, as the name's does (`nameLine`).
    line: "grid grid-cols-[minmax(0,max-content)] text-xs text-fg-muted",
    // The status column's cell, and the row's chips in it, side by side on one line.
    state: "px-3",
    chips: "flex items-center gap-2",
    // The acts' last cell, as narrow as its buttons, as the chevrons' is, and the acts in it, on one line.
    acts: "w-0 pe-3",
    actsLine: "flex items-center gap-2",
  },
  variants: {
    align: {
      start: { head: "text-start", cell: "text-start" },
      // A league table's figures stand centred under their heads: a head wider than its figures, „Pkt.“ over „4“,
      // reads as one column with them only centred over them, and the tabular figures keep each digit's width, so a
      // column's values still line up.
      figure: { head: "text-center", cell: "text-center" },
      centre: { head: "w-11 text-center", cell: "w-11 text-center text-fg-muted" },
    },
    // On a phone, 6-px padding, 12-px figures and heads at 10 px without their tracking, the rank 28 px wide.
    compact: {
      true: {
        head: "@max-2xl:px-1.5 @max-2xl:text-2xs @max-2xl:tracking-normal",
        cell: "@max-2xl:px-1.5 @max-2xl:text-xs",
        name: "@max-2xl:px-1.5",
      },
    },
    figures: {
      true: { cell: "font-numeric" },
    },
    // No width of its own: `max-w-0` leaves the words out of the column's width, which its head's `width` alone sets, and
    // the name's `w-full` takes the rest.
    cut: {
      true: { cell: "max-w-0" },
    },
    strong: {
      true: { cell: "font-semibold" },
    },
    // A phone is a box narrower than 42 rem, judged by the box's own width: a column has one width over all its rows,
    // so no row's name can decide.
    phone: {
      hidden: { head: "@max-2xl:hidden", cell: "@max-2xl:hidden" },
      // A `prose` or a `stack` table's, whose phone form the screen picks.
      screenHidden: { head: "max-lg:hidden", cell: "max-lg:hidden" },
      only: { head: "@2xl:hidden", cell: "@2xl:hidden" },
      // From 20 rem a date column, the chevron and the padding leave a name some twenty characters.
      narrow: { head: "@max-xs:hidden", cell: "@max-xs:hidden" },
      shown: {},
    },
    // A column's least width, on its head cell, which the table and its placeholder draw alike, so their edges agree
    // whatever the rows hold. A minimum, since the name's `w-full` leaves every other column its min-content width
    // (CSS Tables 3, 3.9.3), which a cell's `min-width` raises and a `<col>`'s width does not. Automatic layout, not
    // `fixed`: a value past its column widens the column and the name gives way, where `fixed` would cut it or lay it over
    // the next cell. Each holds its padding: a count two figures, a pair „12:10“ or „3-1-0“, a count with its mark's
    // slots, a date ten characters, an instant 20, „bis“ before its date and time, an excerpt 20, the start of a `cut`
    // text in a row whose acts need the room a whole line would take, a phone number 20, a line of an address 35 where
    // the box is 56 rem or wider and 20 below it, where a name beside a state, the line and a phone number would keep
    // less than its least width. A date stands at the start in the body's face, never as `figures`, which would centre
    // it and set it apart from every other date column.
    width: {
      count: { head: "min-w-12" },
      pair: { head: "min-w-16 @max-2xl:min-w-13" },
      marked: { head: "min-w-16 @max-2xl:min-w-11" },
      date: { head: "min-w-28" },
      instant: { head: "min-w-40" },
      excerpt: { head: "min-w-40" },
      phone: { head: "min-w-44" },
      line: { head: "min-w-44 @4xl:min-w-72" },
      // The status column: a chip of up to 120 px in its padding, or the state's and the delivery's side by side, whose
      // widest pair is 266.
      chip: { head: "min-w-36" },
      chips: { head: "min-w-72" },
    },
    // On a phone the column heads are read but not drawn, and each cell draws its column's label before its words.
    prose: {
      true: {
        head: "max-lg:sr-only",
        row: "max-lg:grid max-lg:h-auto max-lg:gap-1 max-lg:px-3 max-lg:py-3",
        name: "w-auto py-3 align-top max-lg:col-start-1 max-lg:px-0 max-lg:py-0 max-lg:font-semibold",
        cell: "py-3 align-top whitespace-normal max-lg:col-start-1 max-lg:grid max-lg:grid-cols-[4rem_minmax(0,1fr)] max-lg:gap-x-3 max-lg:px-0",
        label: "text-xs text-fg-muted lg:hidden",
      },
    },
    // On a phone the column heads are read but not drawn, and each row is one column of its name line and its cells,
    // each cell drawing its column's label before its words, which wrap there under their own label. The name wraps as
    // they do, since a touch reaches no tooltip, in one column of `minmax(0, 1fr)`, which a long word cannot widen.
    stack: {
      true: {
        head: "max-lg:sr-only",
        row: "max-lg:grid max-lg:h-auto max-lg:grid-cols-1 max-lg:gap-1 max-lg:px-3 max-lg:py-3",
        name: "max-lg:col-start-1 max-lg:w-auto max-lg:px-0 max-lg:py-0",
        whole: PHONE_WRAPS_CLASSES,
        cell: `max-lg:col-start-1 max-lg:grid max-lg:grid-cols-[4rem_minmax(0,1fr)] max-lg:gap-x-3 max-lg:px-0 max-lg:text-start ${PHONE_WRAPS_CLASSES}`,
        label: "text-xs text-fg-muted lg:hidden",
      },
    },
    // Where the rows are stacked; `none` is a table whose rows are one line at every width, the Tabelle's,
    // or stack by the screen, a `prose` and a `stack` table's.
    stacks: {
      none: {},
      list: {
        sheet: "@max-2xl:grid",
        part: "@max-2xl:contents",
        headRow: "@max-2xl:col-span-full @max-2xl:grid @max-2xl:grid-cols-subgrid",
        head: "@max-2xl:row-start-1 @max-2xl:leading-10",
        row: "@max-2xl:col-span-full @max-2xl:grid @max-2xl:h-auto @max-2xl:min-h-14 @max-2xl:grid-cols-subgrid @max-2xl:content-center @max-2xl:items-center @max-2xl:py-1.5 lg:@max-2xl:h-auto lg:@max-2xl:min-h-13 lg:@max-2xl:py-1",
        name: "@max-2xl:contents",
        state: "@max-2xl:col-start-1 @max-2xl:-col-end-2 @max-2xl:row-start-2",
        chips: "@max-2xl:pt-0.5",
        line: "@max-2xl:col-start-1 @max-2xl:-col-end-2 @max-2xl:row-start-3 @max-2xl:px-3 @max-2xl:pt-0.5",
        lineWords: "@max-2xl:wrap-anywhere @max-2xl:whitespace-normal",
        refusal: "@max-2xl:col-start-1 @max-2xl:-col-end-2 @max-2xl:row-start-4 @max-2xl:px-3 @max-2xl:pt-0.5",
        cell: "@max-2xl:row-start-1",
        end: "@max-2xl:-col-start-2 @max-2xl:row-span-5 @max-2xl:row-start-1 @max-2xl:flex @max-2xl:w-auto @max-2xl:items-center",
        acts: "@max-2xl:col-start-1 @max-2xl:-col-end-1 @max-2xl:row-start-5 @max-2xl:w-auto @max-2xl:px-3",
        actsLine: "@max-2xl:pt-2 @2xl:justify-end",
      },
      crowded: {
        sheet: "@max-5xl:grid",
        part: "@max-5xl:contents",
        headRow: "@max-5xl:col-span-full @max-5xl:grid @max-5xl:grid-cols-subgrid",
        head: "@max-5xl:row-start-1 @max-5xl:leading-10",
        row: "@max-5xl:col-span-full @max-5xl:grid @max-5xl:h-auto @max-5xl:min-h-14 @max-5xl:grid-cols-subgrid @max-5xl:content-center @max-5xl:items-center @max-5xl:py-1.5 lg:@max-5xl:h-auto lg:@max-5xl:min-h-13 lg:@max-5xl:py-1",
        name: "@max-5xl:contents",
        state: "@max-5xl:col-start-1 @max-5xl:-col-end-2 @max-5xl:row-start-2",
        chips: "@max-5xl:pt-0.5",
        line: "@max-5xl:col-start-1 @max-5xl:-col-end-2 @max-5xl:row-start-3 @max-5xl:px-3 @max-5xl:pt-0.5",
        lineWords: "@max-5xl:wrap-anywhere @max-5xl:whitespace-normal",
        refusal: "@max-5xl:col-start-1 @max-5xl:-col-end-2 @max-5xl:row-start-4 @max-5xl:px-3 @max-5xl:pt-0.5",
        cell: "@max-5xl:row-start-1",
        end: "@max-5xl:-col-start-2 @max-5xl:row-span-5 @max-5xl:row-start-1 @max-5xl:flex @max-5xl:w-auto @max-5xl:items-center",
        acts: "@max-5xl:col-start-1 @max-5xl:-col-end-1 @max-5xl:row-start-5 @max-5xl:w-auto @max-5xl:px-3",
        actsLine: "@max-5xl:pt-2 @5xl:justify-end",
      },
    },
    // A head that holds no track of a stacked row: the status column's, read but not drawn, and the chevrons' and the
    // acts', which name nothing.
    lone: {
      state: {},
      end: {},
    },
    // A list whose rows carry acts.
    acts: {
      true: {},
    },
    linked: {
      true: { row: cardHover() },
    },
    chevronOnPhone: {
      true: {},
      false: { end: "@max-2xl:hidden" },
    },
    muted: {
      true: { row: "text-fg-muted" },
    },
    qualifies: {
      // Drawn inside the first cell, so it takes no width and moves nothing.
      settled: { cell: "shadow-[inset_2px_0_0_var(--brand)]", name: "shadow-[inset_2px_0_0_var(--brand)]" },
      level: { cell: "shadow-[inset_2px_0_0_var(--border-control)]", name: "shadow-[inset_2px_0_0_var(--border-control)]" },
    },
  },
  compoundVariants: [
    { align: "centre", compact: true, class: { head: "@max-2xl:w-7", cell: "@max-2xl:w-7" } },
    // Restated after the variants, so a `prose` or a `stack` row's grid cell never draws a column the phone leaves out.
    { phone: "screenHidden", class: { head: "max-lg:hidden", cell: "max-lg:hidden" } },
    // A stacked row's grid cell has a width of its own, which `max-w-0` would take to nothing.
    { cut: true, stack: true, class: { cell: "max-lg:max-w-none" } },
    // In a stacked list a cut value counts nothing towards its track, which its head's least width alone sets, as
    // `max-w-0` has it in a table.
    { cut: true, stacks: "list", class: { cell: "@max-2xl:max-w-none @max-2xl:contain-inline-size" } },
    { cut: true, stacks: "crowded", class: { cell: "@max-5xl:max-w-none @max-5xl:contain-inline-size" } },
    // The status column's head is read but not drawn over stacked rows, whose chips stand under the name in no column.
    { lone: "state", stacks: "list", class: { head: "@max-2xl:sr-only" } },
    { lone: "state", stacks: "crowded", class: { head: "@max-5xl:sr-only" } },
    { lone: "end", stacks: "list", class: { head: "@max-2xl:hidden" } },
    { lone: "end", stacks: "crowded", class: { head: "@max-5xl:hidden" } },
    // A stacked row with acts is padded as a card's act row.
    { acts: true, stacks: "list", class: { row: "@max-2xl:py-3 lg:@max-2xl:py-3" } },
    { acts: true, stacks: "crowded", class: { row: "@max-5xl:py-3 lg:@max-5xl:py-3" } },
    // A prose or a stacked row on a phone stands its cells in one column and its chevron in a column of its own at its
    // end, spanning every cell's line so it is centred on the row's height (`Table`'s `phoneCells`).
    { prose: true, chevronOnPhone: true, class: { row: PHONE_END_ROW_CLASSES, end: PHONE_END_CLASSES } },
    { stack: true, chevronOnPhone: true, class: { row: PHONE_END_ROW_CLASSES, end: PHONE_END_CLASSES } },
  ],
});

/** The hyphen between a record's counts, „3-1-0“, as its head „S-U-N“ joins their letters. */
const RECORD_JOIN = "-";

/**
 * A club's won, drawn and lost counts, „3-1-0“, each in its own colour, success, warning and danger, the hyphens
 * between them in the text's: a Tabelle row's phone column and a club's tile alike.
 */
export function RecordFigures({ counts }: { counts: Counts }) {
  const [won, drawn, lost] = counts;
  return (
    <>
      <span className="font-semibold text-success">{formatNumber(won)}</span>
      {RECORD_JOIN}
      <span className="font-semibold text-warn">{formatNumber(drawn)}</span>
      {RECORD_JOIN}
      <span className="font-semibold text-danger">{formatNumber(lost)}</span>
    </>
  );
}

/**
 * How a table's rows stack: a list's by its box, a `crowded` one's from further up, and not at all where the table has
 * a phone form of its own or a rank column, whose rows are one line.
 */
type Stacks = "none" | "list" | "crowded";

const stacksOf = (kind: { ranked: boolean; compact: boolean; prose: boolean; stack: boolean; crowded: boolean }): Stacks =>
  kind.ranked || kind.compact || kind.prose || kind.stack ? "none" : kind.crowded ? "crowded" : "list";

/** Whether a column stands on a phone: left out, drawn there alone, drawn where it fits, or drawn at every width. */
function phoneOf(column: TableColumn, stacks: Stacks, compact: boolean) {
  // A table that stacks by the screen leaves a column out by the screen.
  if (column.hideOnPhone === true) return stacks === "none" && !compact ? "screenHidden" : "hidden";
  if (column.phoneOnly === true) return "only";
  return column.narrow === true ? "narrow" : "shown";
}

/** How a column sets, for its head and its cells alike, in the table and in its placeholder. */
const columnLook = (column: TableColumn, stacks: Stacks, compact: boolean) =>
  ({
    align: column.figures === true ? "figure" : "start",
    phone: phoneOf(column, stacks, compact),
    width: column.width,
    cut: column.cut === true,
    stacks,
    compact,
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
 * A stacked phone row's chevron spans the lines of every cell the phone draws, the rank, the name and each column it
 * keeps: a count no grid rule can name, since a span to the last line reaches no line the cells add themselves. A grid
 * placement, which a `prose` or a `stack` table's phone row alone reads: a table cell ignores it.
 */
function phoneEndStyle(rankLabel: Copy | undefined, columns: ReadonlyArray<TableColumn>) {
  const cells = (rankLabel === undefined ? 0 : 1) + 1 + columns.filter((column) => column.hideOnPhone !== true).length;
  return { gridRow: `1 / span ${String(cells)}` };
}

/**
 * A cell's value. In a column where some row's figure is short of fixtures called off, every row keeps the
 * mark's slot at the figure's end, so the digits stand under each other whether a row carries the mark or
 * not, and as much room at its start, so the figure stays centred under its head; the mark, a small red „+N“,
 * stands over the figure's top-right corner, three quarters of it right of the corner, over the slot and clear
 * of the digits, and its name tells a screen reader what no line explains.
 * A record is its three counts, `RecordFigures`.
 */
function Cell({ cell, slot, cut, stack }: { cell: TableCell | undefined; slot: boolean; cut: boolean; stack: boolean }) {
  if (cell === undefined) return null;
  if (typeof cell === "object" && "counts" in cell) return <RecordFigures counts={cell.counts} />;
  const { value, cancelled } = typeof cell === "object" && "cancelled" in cell ? cell : { value: cell, cancelled: 0 };
  if (cut)
    return (
      <CutText
        text={textOf(value)}
        className={stack ? `block truncate ${PHONE_WRAPS_CLASSES}` : "block truncate"}
      />
    );
  if (!slot) return textOf(value);
  return (
    <span className="inline-block px-2">
      <span className="relative inline-block">
        {textOf(value)}
        {cancelled > 0 && (
          <span
            aria-hidden
            className="absolute end-0 top-0 translate-x-3/4 -translate-y-1/2 text-2xs leading-none font-semibold text-danger">
            {COPY.shared.season.cancelledMark(cancelled)}
          </span>
        )}
      </span>
      {cancelled > 0 && <span className="sr-only">{COPY.shared.season.cancelled(cancelled)}</span>}
    </span>
  );
}

/**
 * A row's name line: the name with its plaque and its mark (`nameHead`), on one line that never wraps, so no row of a
 * list parts its line by what it holds. Its least width is the name's, 5 rem, with a plaque its 40 px and their gap
 * besides, so the table narrows the column to no less. A table that names no status column, such as the Tabelle,
 * sets a row's chip after the name on this line, the name cut before the chip gives way.
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
    // A phone's Tabelle, whose plaque stands for its club, the name read but not drawn: the plaque's own least.
    lonePlaque: { true: "@max-2xl:min-w-0" },
    // The first line of a stacked row, in the name's track (`table`'s `stacks`).
    stacks: {
      none: "",
      list: "@max-2xl:col-start-1 @max-2xl:row-start-1 @max-2xl:px-3",
      crowded: "@max-5xl:col-start-1 @max-5xl:row-start-1 @max-5xl:px-3",
    },
    // An address wraps instead (`AddressWords`), a chip beside its first line.
    address: { true: "items-start" },
  },
});

/**
 * The name with a club's plaque before it and a player's mark after it, which never part: as wide as they are and no
 * wider, so what follows stands directly after a short name, and shrinking with the line, the name cut between them.
 */
const nameHead = tv({
  base: "flex min-w-0 items-center gap-2",
  variants: {
    // A prose table's name line holds its parts itself.
    wraps: { true: "contents" },
    address: { true: "items-start" },
  },
});

/** The span holding a row's names and its link. */
const nameWords = tv({
  base: "min-w-0",
  variants: {
    // A prose table's name wraps; every other is cut with „…“.
    cut: { always: "truncate", never: "" },
    // A lone plaque's name draws nothing on a phone, so the span takes back the gap before it, and the chip stands
    // as far from the plaque as from a name.
    lonePlaque: { true: "@max-2xl:-ms-2" },
  },
});

/** A row's chips, the state's and then the delivery's. */
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
 * a prose table's name wraps instead, and so does an address (`AddressWords`). The row's chips follow on the name's line
 * only on a table with no status column (`inlineChips`). A club's plaque stands outside the span cutting the names, so
 * the cut never takes it, and outside the row's link; the link's stretched box still covers it, so a press on it opens
 * the row's record, which on a phone, where a club's plaque may stand alone, the link names by the club's full name.
 * Under the name line stand the muted line and a refusal.
 */
function NameCell({
  row,
  barred,
  compact,
  prose,
  stack,
  stacks,
  plaqueAlone,
  inlineChips,
  nameId,
}: {
  row: TableRow;
  barred: TableRow["qualifies"];
  compact: boolean;
  prose: boolean;
  stack: boolean;
  stacks: Stacks;
  plaqueAlone: boolean;
  inlineChips: boolean;
  /** The name's id, which the row's acts are described by. */
  nameId: string | undefined;
}) {
  const s = table({ qualifies: barred, compact, prose, stack, stacks });
  const { plaque } = row;
  const lonePlaque = plaqueAlone && plaque !== undefined;
  const name = textOf(row.name);
  const address = isAddress(row.name);
  const words = lonePlaque ? <span className={s.clubName()}>{name}</span> : address ? <AddressWords address={name} /> : name;
  const opens = row.onOpen === undefined ? words : <RowPress onPress={row.onOpen}>{words}</RowPress>;
  const shape = prose ? "wraps" : plaque === undefined ? "name" : "plaque";
  return (
    <td
      role="cell"
      className={s.name()}>
      <span className={nameLine({ shape, lonePlaque, stacks, address })}>
        <span className={nameHead({ wraps: prose, address })}>
          {plaque !== undefined && (
            <TeamPlaque
              plaque={plaque}
              muted={row.muted === true}
            />
          )}
          <CutText
            id={nameId}
            text={name}
            className={nameWords({
              cut: prose || address ? "never" : "always",
              lonePlaque,
              class: address ? addressWords({ class: s.whole() }) : s.whole(),
            })}>
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
          {row.mark !== undefined && <RoleMark {...row.mark} />}
        </span>
        {inlineChips && <Chips row={row} />}
      </span>
      {row.line !== undefined && (
        <span className={s.line()}>
          <CutText
            text={textOf(row.line)}
            className={s.lineWords()}
          />
        </span>
      )}
      {row.phoneLine !== undefined && (
        <span className={s.line({ class: "@2xl:hidden" })}>
          <CutText
            text={textOf(row.phoneLine)}
            className={s.lineWords()}
          />
        </span>
      )}
      {row.refusal !== undefined && <span className={s.refusal()}>{row.refusal}</span>}
    </td>
  );
}

/**
 * A list of records: rows 52 px high on desktop and 56 on a phone, lines between them, under a head of muted capitals.
 * A row opens its record, a chevron at its end saying so, or, where its record has no page of its own, carries its
 * acts. Few columns: the name with its plaque, the status column where the rows carry a state, then a few facts.
 *
 * The list's own width picks its rows' form, for every row alike (`table`'s `stacks`): a table from 42 rem, and below it stacked
 * rows, the name with at most a narrow column beside it, then the chips, the muted line and the acts, each on a line of
 * its own. The table, its rows, its heads and its cells carry their table roles in writing, since a stacked row's and a
 * prose row's `display: grid` drops the semantics an engine infers from the elements alone.
 */
export function Table({
  label,
  nameLabel,
  rankLabel,
  state,
  crowded = false,
  columns,
  rows,
  empty,
  bare = false,
  compact = false,
  prose = false,
  stack = false,
  chevronOnPhone = true,
  plaqueAlone = false,
}: TableProps) {
  // A row's name's id is the table's and the row's, for the row's acts to be described by.
  const tableId = useId();
  // Any row's acts give the whole table its column, whose head names nothing, as the chevrons' does.
  const hasActs = rows.some((row) => row.acts !== undefined);
  const stacks = stacksOf({ ranked: rankLabel !== undefined, compact, prose, stack, crowded });
  const parts = table({ stacks });
  const leadsOn = (row: TableRow) => row.href !== undefined || row.onOpen !== undefined;
  const isLinked = rows.some(leadsOn);
  // Every row keeps the chevron's room on a phone where some row draws one there.
  const phoneEnd = { prose, stack, stacks, chevronOnPhone: isLinked && chevronOnPhone };
  const endStyle = prose || stack ? phoneEndStyle(rankLabel, columns) : undefined;
  // The columns where some row carries the mark of fixtures called off, whose every row keeps its slot.
  const marked = new Set(
    columns
      .filter((column) =>
        rows.some((row) => {
          const cell = row.cells[column.key];
          return typeof cell === "object" && "cancelled" in cell;
        }),
      )
      .map((column) => column.key),
  );
  return (
    // `w-full`: a Section's grid starts its children, which would shrink the table and cut its cells.
    <div
      data-kit-focus="home"
      className={bare ? "@container w-full overflow-x-auto" : cardSurface({ class: "@container w-full overflow-x-auto" })}>
      {rows.some((row) => row.anchor !== undefined) && <TargetMark />}
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
              {rankLabel !== undefined && (
                <th
                  role="columnheader"
                  scope="col"
                  className={table({ align: "centre", compact }).head()}>
                  {rankLabel}
                </th>
              )}
              <th
                role="columnheader"
                scope="col"
                className={table({ align: "start", compact, prose, stack, stacks }).head()}>
                {nameLabel}
              </th>
              {state !== undefined && (
                <th
                  role="columnheader"
                  scope="col"
                  className={table({ align: "start", width: state.delivery === true ? "chips" : "chip", stacks, lone: "state" }).head()}>
                  {state.label}
                </th>
              )}
              {columns.map((column, index) => (
                <th
                  key={column.key}
                  role="columnheader"
                  scope="col"
                  className={table({ ...columnLook(column, stacks, compact), prose, stack }).head()}
                  style={stackedTrack(stacks, index)}>
                  {column.label}
                </th>
              ))}
              {/* The chevrons' column and the acts' name nothing, so their head is no header cell. */}
              {isLinked && (
                <td
                  role="cell"
                  className={table({ phone: chevronOnPhone ? "shown" : "hidden", prose, stack, stacks, lone: "end" }).head()}
                />
              )}
              {hasActs && (
                <td
                  role="cell"
                  className={table({ stacks, lone: "end" }).head()}
                />
              )}
            </tr>
          </thead>
          <tbody className={parts.part()}>
            {rows.map((row) => {
              const nameId = row.acts === undefined ? undefined : `${tableId}-${row.id}`;
              // A row its name's link or press stretches over: the cut words under the pointer, in any cell, are the
              // tooltip the stretched name carries (`CutRow`).
              const Stretched = leadsOn(row) ? CutRow : Fragment;
              return (
                <tr
                  key={row.id}
                  id={row.anchor}
                  data-kit-row
                  role="row"
                  className={table({ linked: leadsOn(row), muted: row.muted === true, acts: hasActs, ...phoneEnd }).row()}>
                  <Stretched>
                    {rankLabel !== undefined && (
                      <td
                        role="cell"
                        className={table({ align: "centre", figures: true, qualifies: row.qualifies, compact }).cell()}>
                        {row.place == null ? COPY.shared.noValue : formatNumber(row.place)}
                      </td>
                    )}
                    <NameCell
                      row={row}
                      barred={rankLabel === undefined ? row.qualifies : undefined}
                      compact={compact}
                      prose={prose}
                      stack={stack}
                      stacks={stacks}
                      plaqueAlone={plaqueAlone}
                      inlineChips={state === undefined}
                      nameId={nameId}
                    />
                    {state !== undefined && (
                      <td
                        role="cell"
                        className={parts.state()}>
                        {/* Drawn only where the row holds a chip, so a stacked row without one gives the line no height. */}
                        {(row.chip !== undefined || row.delivery !== undefined) && (
                          <span className={parts.chips()}>
                            <Chips row={row} />
                          </span>
                        )}
                      </td>
                    )}
                    {columns.map((column, index) => {
                      const s = table({
                        ...columnLook(column, stacks, compact),
                        figures: column.figures === true,
                        strong: column.strong === true,
                        prose,
                        stack,
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
                            slot={marked.has(column.key)}
                            cut={column.cut === true}
                            stack={stack}
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
                        {row.acts !== undefined && (
                          <RowActs
                            className={parts.actsLine()}
                            describedBy={nameId}>
                            {row.acts}
                          </RowActs>
                        )}
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

/**
 * A table while its rows are read: its own head, the columns' labels as the page states them, over `rows` rows at the
 * rows' height, each cell a bar where its value will stand, set as the column sets its values: a rank and figures
 * centred, a name from the start after a club's plaque where the rows hold clubs, a chip's bar in the status column,
 * the chevron where rows lead on. Drawn with the table's own recipe and the columns' stated widths inside the table's
 * own container, so it takes the form the rows will at every width: a list's rows stacked where its box is narrow, the
 * chip's bar under the name's, a phone's left-out columns left out, a `stack` table's rows stacked as `Table`'s and
 * each row's acts as buttons. Each cell's bar stands in a line of the cell's own height, so a row holds its height
 * wherever its lines stack.
 */
export function TablePlaceholder({
  head,
  rows,
  plaques = false,
  bare = false,
}: {
  head: TableHead;
  rows: number;
  /** Whether each row holds a plaque before its name. */
  plaques?: boolean;
  bare?: boolean;
}) {
  const {
    nameLabel,
    rankLabel,
    state,
    crowded = false,
    columns,
    compact = false,
    chevronOnPhone = true,
    plaqueAlone = false,
    acts,
    stack = false,
  } = head;
  const linked = head.linked !== false && acts === undefined;
  const stacks = stacksOf({ ranked: rankLabel !== undefined, compact, prose: false, stack, crowded });
  const phoneEnd = { stack, stacks, chevronOnPhone: linked && chevronOnPhone };
  const parts = table({ stacks });
  return (
    <div className={bare ? "@container w-full overflow-hidden" : cardSurface({ class: "@container w-full overflow-hidden" })}>
      <table
        className={parts.sheet()}
        style={stackedTracks(stacks, columns, plaques)}>
        <thead className={parts.part()}>
          <tr className={parts.headRow()}>
            {rankLabel !== undefined && <th className={table({ align: "centre", compact }).head()}>{rankLabel}</th>}
            <th className={table({ align: "start", compact, stack, stacks }).head()}>{nameLabel}</th>
            {state !== undefined && (
              <th className={table({ align: "start", width: state.delivery === true ? "chips" : "chip", stacks, lone: "state" }).head()}>
                {state.label}
              </th>
            )}
            {columns.map((column, index) => (
              <th
                key={column.key}
                className={table({ ...columnLook(column, stacks, compact), stack }).head()}
                style={stackedTrack(stacks, index)}>
                {column.label}
              </th>
            ))}
            {linked && <td className={table({ phone: chevronOnPhone ? "shown" : "hidden", stack, stacks, lone: "end" }).head()} />}
            {acts !== undefined && <td className={table({ stacks, lone: "end" }).head()} />}
          </tr>
        </thead>
        <tbody className={parts.part()}>
          {Array.from({ length: rows }, (_, index) => (
            <tr
              key={index}
              className={table({ ...phoneEnd, acts: acts !== undefined }).row()}>
              {rankLabel !== undefined && (
                <td className={table({ align: "centre", compact }).cell()}>
                  <span className={placeholderBar("mx-auto h-3 w-3")} />
                </td>
              )}
              <td className={table({ compact, stack, stacks }).name()}>
                {/* The rows' least width for the name, so the column's edges stand where the rows' will. */}
                <span className={nameLine({ shape: plaques ? "plaque" : "name", lonePlaque: plaques && plaqueAlone, stacks })}>
                  {plaques && <span className={placeholderBar("h-6 w-10")} />}
                  <PlaceholderLine
                    textClass={plaques && plaqueAlone ? "flex-1 text-sm @max-2xl:hidden" : "flex-1 text-sm"}
                    widthClass="w-1/2"
                  />
                </span>
              </td>
              {state !== undefined && (
                <td className={parts.state()}>
                  <span className={parts.chips()}>
                    <span className={placeholderBar("h-5 w-16")} />
                  </span>
                </td>
              )}
              {columns.map((column, at) => {
                const s = table({ ...columnLook(column, stacks, compact), stack });
                return (
                  <td
                    key={column.key}
                    className={s.cell()}
                    style={stackedTrack(stacks, at)}>
                    {stack && <span className={s.label()}>{column.label}</span>}
                    <PlaceholderLine
                      textClass=""
                      widthClass={column.figures === true ? "mx-auto w-4" : "w-20"}
                    />
                  </td>
                );
              })}
              {linked && (
                <td
                  className={table(phoneEnd).end()}
                  style={stack ? phoneEndStyle(rankLabel, columns) : undefined}>
                  <RowEnd />
                </td>
              )}
              {acts !== undefined && (
                <td className={parts.acts()}>
                  <span className={parts.actsLine()}>
                    {acts.map((act) => (
                      <span
                        key={act}
                        className={buttonPlaceholder()}>
                        {act}
                      </span>
                    ))}
                  </span>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
