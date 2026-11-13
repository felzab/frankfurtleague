import { Fragment } from "react";

import { COPY, textOf } from "@/core/copy";
import { formatNumber } from "@/core/format";

import { AddressWords, addressWords, isAddress } from "./AddressWords";
import { buttonPlaceholder } from "./buttonStyles";
import { cardHover, cardSurface, columnHead, nameWithChips, stacked } from "./cardStyles";
import { Chip } from "./Chip";
import { CutRow, CutText } from "./CutText";
import { EmptyState } from "./EmptyState";
import { Link } from "./Link";
import { RoleMark } from "./RoleMark";
import { RowEnd } from "./RowEnd";
import { RowPress } from "./RowPress";
import { SideActsScope } from "./SideActs";
import { sideActsForm } from "./sideActsForm";
import { SideActsPlaceholder } from "./SideActsPlaceholder";
import { placeholderBar, PlaceholderLine } from "./Skeleton";
import { TargetMark } from "./TargetMark";
import { TeamPlaque } from "./TeamPlaque";
import { tv } from "./tv";

import type { Copy, RecordText, Words } from "@/core/copy";
import type { Route } from "next";
import type { ReactElement } from "react";
import type { AddressText } from "./AddressWords";
import type { ChipProps } from "./Chip";
import type { Clear, EmptyStateProps } from "./EmptyState";
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
   * What the column holds, which sets the least it takes in the table and in its wait alike, so its edges stand where
   * its placeholder drew them whatever the read holds. Every column whose values are bounded by construction states it,
   * an enumerated value or a fixed-format one, a head wider than its values too, since its wait's bar would otherwise set
   * the column (`barOf`). A figures column's bar sets nothing, so one whose head is wider than its figures needs none.
   * Any other column stating none holds free text, whose width is the record's, and its wait draws a typical value's bar.
   */
  width?: "count" | "pair" | "marked" | "code" | "word" | "date" | "instant" | "phrase" | "excerpt" | "phone" | "line";
  /**
   * A value that may run longer than its column, such as a ban's Grund, an address or a club's name: as wide as its
   * longest value while the row has room, sharing what the row leaves free with the name, and cut with „…“ only once the
   * row is full, never narrower than the least `width` sets, whole in its tooltip while it is cut, which a touch never
   * shows. Its wait draws it at that least, since the words that widen it are not read yet. So a `stack` table, whose
   * rows open nothing that would show the rest, cuts no column. Every other column widens to its longest value, so only
   * a value bounded to its column's width goes uncut.
   */
  cut?: true;
} &
  /**
   * A secondary column, such as the day an administrator's access began: left out on a phone, a box narrower than
   * 42 rem on any screen, whose row keeps its name, its chips after it and at most a narrow column. Every secondary
   * column leaves at that one width, so the room it frees is the name's and its chips' wherever the row stacks. What
   * it holds stands somewhere a phone still reaches: a page or a dialog the row itself opens, or else the row's
   * `phoneLine`, after the column's label where the value alone would not say what it is.
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
    | { narrow: true; hideOnPhone?: never; phoneOnly?: never; width?: "count" | "pair" | "marked" | "code" | "word" | "date" }
  );

/** A club's won, drawn and lost counts. */
export type Counts = readonly [won: number, drawn: number, lost: number];

/**
 * A cell's value: its words; a figure some of the club's fixtures left short, such as its count of matches
 * while some were called off, carrying the mark that says how many, which its name tells a screen reader and
 * no line explains; or a club's won, drawn and lost counts in one cell, „3-1-0“, each in its own colour.
 */
type TableCell = Words | { value: Words; cancelled: number } | { counts: Counts };

/**
 * A muted line holding an address amid the catalogue's words, „Neu: <address> · bis 12.11., 15:12“: the address
 * between `before` and `after`, which an address never cut breaks after its „@“ (`AddressWords`), where a plain line
 * would break it anywhere.
 */
type AddressLine = { before: Copy; address: RecordText; after?: Copy };

const isAddressLine = (line: Words | AddressLine): line is AddressLine => typeof line !== "string" && "address" in line;

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
   * Where the row's record stands: directly after the name on its line, and in the status column of a list that names
   * one (`state`) where the list is a table.
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
  /** The muted line under the name, cut as a name is: what the row's record is, or when it takes effect. */
  line?: Words;
  /**
   * The line on a phone, a box narrower than 42 rem, alone, standing for columns a phone leaves out, such as a player's
   * position and Stufe, which from 42 rem the columns say; in `line`'s place there where the row has both. One holding
   * an address amid the catalogue's words, such as a change's new address, breaks it after its „@“ (`AddressLine`).
   */
  phoneLine?: Words | AddressLine;
} & (
  | {
      href?: Route;
      /**
       * What the whole row does where it leads to a step of the page rather than to an address, such as a bulk's check
       * page back to a card: a client page's own, since a function cannot cross from the server.
       */
      onOpen?: () => void;
      acts?: never;
      sideActs?: never;
    }
  | {
      href?: never;
      onOpen?: never;
      /**
       * What can be done to a record that opens no page of its own. A decision, such as „Zusagen“ and „Ablehnen“, is
       * one or two kit buttons, each the trigger of its dialog, as a card's act row holds them: on one line under the
       * row's words where the list is stacked, at the row's end where it is a table. Side acts (`SideActs`) are their
       * labelled buttons at the row's end where the list is a table, and one „⋯“ at its end, across its lines, where
       * it is stacked; a list some row of which carries more than its buttons hold folds them at every width
       * (`sideActsForm`). A row the reader can do nothing to takes none, and a table none of whose rows takes any draws
       * no act column.
       */
      acts?: ReactElement;
      /**
       * How many side acts `acts` draws (`SideActs`, and `RowAct`'s one), which the list reads to decide their form for
       * all its rows: the acts reach it as an element, which says nothing of what it holds. Counted by the rule the
       * acts' own module lists them by, such as `changeActKinds`, never a second condition beside it.
       */
      sideActs?: number;
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
   * side by side in it; a stacked row sets them after its name on the name's line instead.
   */
  state?: { label: Copy; delivery?: true };
  columns: ReadonlyArray<TableColumn>;
  rows: ReadonlyArray<TableRow>;
  /** What stands in the rows' place when there are none: a list's cause, or „Nichts offen.“ over a list of what waits. */
  empty: EmptyStateProps | Clear;
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
  "nameLabel" | "rankLabel" | "state" | "columns" | "compact" | "chevronOnPhone" | "plaqueAlone" | "stack"
> & {
  /** The rows open nothing, so their wait ends in no chevron. */
  linked?: false;
  /**
   * Where the rows carry the muted line under their name, which their wait draws as a line's bar: `always` where they
   * carry a `line`, at every width, and `phone` where they carry a `phoneLine` alone, on a box narrower than 42 rem.
   */
  line?: "always" | "phone";
} & (
    | {
        /** The labels of the acts a row carries, which its wait draws as buttons; the rows open nothing either. */
        acts?: ReadonlyArray<Copy>;
        sideAct?: never;
      }
    | {
        acts?: never;
        /**
         * The act every row of a list of side acts (`SideActs`) carries, whose rows open nothing: its wait draws that
         * act's button where the list is a table, and the „⋯“ where it is stacked, as the rows will stand
         * (`SideActsPlaceholder`).
         */
        sideAct: Copy;
      }
  );

/** A table's rows once read: everything but its head. */
export type TableBody = Omit<TableProps, keyof TableHead>;

/** A `prose` or a `stack` table's stacked row's two columns: its cells, then its chevron, 12 px apart. */
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
 * under its head; the muted line; a refusal; and a decision's acts on one line. The chevron spans the lines, centred on
 * the row, and so does the „⋯“ side acts fold into there. A line that holds nothing takes no height, and a head cell's
 * words stand on a 40-px line, since a grid item's stand at its top where a table cell's stand in its middle.
 *
 * A row is 56 px at the least, 52 from `lg`, its hairline among them. Chips the name's line cannot hold stand 2 px under
 * it, and a name over its chips is 42, a plaque standing beside the two lines, so at 6 px of padding, 4 from `lg`, such
 * a row stands exactly as tall as one whose chips stand after its name, and as its wait's rows. A list whose rows carry
 * their acts under their words pads its rows 12 px, as a card's act row is (`actRow`).
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
    // The name takes the room the facts leave, which it shares with a cut column (`shares`), and is cut with „…“ where
    // it is longer (`nameLine`).
    name: "w-full px-3 py-2",
    // A club's name beside its plaque, read but not drawn on a phone, where the plaque stands for it alone.
    clubName: "@max-2xl:sr-only",
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
    // The status column's cell, and the row's chips in it, side by side on one line.
    state: "px-3",
    chips: "flex items-center gap-2",
    // The same chips on the name's line (`NameCell`).
    lineChips: "",
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
    // A cut column's words stand in a track that may shrink to nothing (`Cell`), so they count nothing towards the
    // column's least width, which its head's `width` alone sets, and whole towards its widest (`shares`).
    cut: {
      true: {},
    },
    // A list holding a cut column, in its table form: the name and each cut column are the table's only automatic
    // columns, every other cell `w-0`, so its column is as wide as its values and no wider. The automatic layout gives
    // each column its least width, then grows the automatic ones together towards their widest, so no word is cut while
    // the row has room and the name and a cut value give way alike once it is full; room past every widest goes to the
    // automatic columns by their widest (CSS Tables 3, 3.9.3). The name's `w-full` would make it a percent column, which
    // the layout widens before any other column passes its least, and so cut a value beside a name with room to spare.
    shares: {
      true: {},
    },
    strong: {
      true: { cell: "font-semibold" },
    },
    // A phone is a box narrower than 42 rem, judged by the box's own width: a column has one width over all its rows,
    // so no row's name can decide.
    phone: {
      hidden: { head: "@max-2xl:hidden", cell: "@max-2xl:hidden" },
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
    // slots, a code three capitals, such as a Stufe or a club's shorthand, a word ten letters, one of a set the contract or
    // the catalogue fixes, such as a position („Mittelfeld“, 62 px measured), a group („Gruppe M“), a kit colour or a count
    // of seats („2 von 3“), a date ten characters, an instant 20, „bis“ before its date and time, a phrase of the catalogue's
    // 24, such as a link's state „Keine bestätigte Adresse“ (156 px estimated, 6.5 a letter), an excerpt 20, the start of a `cut`
    // text in a row whose acts need the room a whole line would take, a phone number 20, a line of an address 35 where
    // the box is 56 rem or wider and 20 below it, where a name beside a state, the line and a phone number would keep
    // less than its least width. A date stands at the start in the body's face, never as `figures`, which would centre
    // it and set it apart from every other date column.
    width: {
      count: { head: "min-w-12" },
      pair: { head: "min-w-16 @max-2xl:min-w-13" },
      marked: { head: "min-w-16 @max-2xl:min-w-11" },
      code: { head: "min-w-16" },
      word: { head: "min-w-24" },
      date: { head: "min-w-28" },
      instant: { head: "min-w-40" },
      phrase: { head: "min-w-48" },
      excerpt: { head: "min-w-40" },
      phone: { head: "min-w-44" },
      line: { head: "min-w-44 @4xl:min-w-72" },
      // The status column: a chip of up to 120 px in its padding, or the state's and the delivery's side by side, whose
      // widest pair is 266.
      chip: { head: "min-w-36" },
      chips: { head: "min-w-72" },
    },
    // In a box narrower than 42 rem the column heads are read but not drawn, and each cell draws its column's label
    // before its words.
    prose: {
      true: {
        head: "@max-2xl:sr-only",
        row: "@max-2xl:grid @max-2xl:h-auto @max-2xl:gap-1 @max-2xl:px-3 @max-2xl:py-3",
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
        row: "@max-2xl:grid @max-2xl:h-auto @max-2xl:grid-cols-1 @max-2xl:gap-1 @max-2xl:px-3 @max-2xl:py-3",
        name: "@max-2xl:col-start-1 @max-2xl:w-auto @max-2xl:px-0 @max-2xl:py-0",
        whole: WRAPS_CLASSES,
        cell: `@max-2xl:col-start-1 @max-2xl:grid @max-2xl:grid-cols-[4rem_minmax(0,1fr)] @max-2xl:gap-x-3 @max-2xl:px-0 @max-2xl:text-start ${PHONE_WRAPS_CLASSES}`,
        label: "text-xs text-fg-muted @2xl:hidden",
      },
    },
    // Where a list's rows are stacked; `none` is a table whose rows are one line at every width, the Tabelle's, or one
    // whose rows stack in a form of their own, a `prose` and a `stack` table's.
    stacks: {
      none: {},
      list: {
        sheet: "@max-2xl:grid",
        part: "@max-2xl:contents",
        headRow: "@max-2xl:col-span-full @max-2xl:grid @max-2xl:grid-cols-subgrid",
        head: "@max-2xl:row-start-1 @max-2xl:leading-10",
        row: "@max-2xl:col-span-full @max-2xl:grid @max-2xl:h-auto @max-2xl:min-h-14 @max-2xl:grid-cols-subgrid @max-2xl:content-center @max-2xl:items-center @max-2xl:py-1.5 lg:@max-2xl:min-h-13 lg:@max-2xl:py-1",
        name: "@max-2xl:contents",
        // A stacked row's chips stand on its name's line (`chipsOnLine`).
        state: "@max-2xl:hidden",
        line: "@max-2xl:col-start-1 @max-2xl:-col-end-2 @max-2xl:row-start-2 @max-2xl:px-3 @max-2xl:pt-0.5",
        lineWords: "@max-2xl:wrap-anywhere @max-2xl:whitespace-normal",
        refusal: "@max-2xl:col-start-1 @max-2xl:-col-end-2 @max-2xl:row-start-3 @max-2xl:px-3 @max-2xl:pt-0.5",
        cell: "@max-2xl:row-start-1",
        end: "@max-2xl:-col-start-2 @max-2xl:row-span-4 @max-2xl:row-start-1 @max-2xl:flex @max-2xl:w-auto @max-2xl:items-center",
        acts: "@max-2xl:col-start-1 @max-2xl:-col-end-1 @max-2xl:row-start-4 @max-2xl:w-auto @max-2xl:px-3",
        actsLine: "@max-2xl:pt-2 @2xl:justify-end",
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
    // A list whose rows carry acts: a decision's on a line under a stacked row's words, and side acts in the one „⋯“
    // they fold into at a stacked row's end (`SideActs`).
    acts: {
      under: {},
      folded: {},
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
    // Restated after the variants, so a `prose` or a `stack` table's stacked row, whose cells are grids there, never
    // draws a column a narrow box leaves out: the merger keeps the later of two `display` classes.
    { phone: "hidden", class: { head: "@max-2xl:hidden", cell: "@max-2xl:hidden" } },
    // In a stacked list a cut value counts nothing towards its track, which its head's least width alone sets.
    { cut: true, stacks: "list", class: { cell: "@max-2xl:contain-inline-size" } },
    // The table form alone: a stacked row's cells are grid items, which `w-0` would draw as wide as nothing.
    { shares: true, stacks: "list", class: { name: "@2xl:w-auto", cell: "@2xl:w-0", state: "@2xl:w-0" } },
    { shares: true, stacks: "list", cut: true, class: { cell: "@2xl:w-auto" } },
    { lone: true, stacks: "list", class: { head: "@max-2xl:hidden" } },
    // A stacked row with its acts under its words is padded as a card's act row.
    { acts: "under", stacks: "list", class: { row: "@max-2xl:py-3 lg:@max-2xl:py-3" } },
    // The „⋯“ stands in the row's last track, across its lines, as a chevron does. Its button is taller than a name's
    // line, and a cell spanning the lines would share that height out over them and stand a lone name above the
    // button's centre; so the cell's size counts nothing (`contain-size`), its width stated, and the button stands
    // centred on the row's lines, inside the row's least height.
    {
      acts: "folded",
      stacks: "list",
      class: {
        acts: "@max-2xl:-col-start-2 @max-2xl:row-span-4 @max-2xl:row-start-1 @max-2xl:flex @max-2xl:w-11 @max-2xl:items-center @max-2xl:px-0 @max-2xl:pe-3 @max-2xl:contain-size pointer-coarse:@max-2xl:w-13",
        actsLine: "@max-2xl:pt-0",
      },
    },
    // A prose or a stack table's stacked row stands its cells in one column and its chevron in a column of its own at
    // its end, spanning every cell's line so it is centred on the row's height (`phoneEndStyle`).
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
 * How a table's rows stack: a list's by its box, every list's at one width, and not as a list's where the table has a
 * stacked form of its own, a `prose` and a `stack` table, which stacks at the same width, or a rank column, whose rows
 * are one line.
 */
type Stacks = "none" | "list";

const stacksOf = (kind: { ranked: boolean; compact: boolean; prose: boolean; stack: boolean }): Stacks =>
  kind.ranked || kind.compact || kind.prose || kind.stack ? "none" : "list";

/**
 * Where a row's chips stand on its name's line: at every width on a table that names no status column, on the stacked
 * rows alone of a list that names one, and never on a table whose rows never stack and whose column always holds them.
 */
type ChipsOnLine = "always" | "stacked" | "never";

const chipsOnLineOf = (state: TableProps["state"], stacks: Stacks): ChipsOnLine =>
  state === undefined ? "always" : stacks === "list" ? "stacked" : "never";

/** Whether a column stands on a phone: left out, drawn there alone, drawn where it fits, or drawn at every width. */
function phoneOf(column: TableColumn) {
  if (column.hideOnPhone === true) return "hidden";
  if (column.phoneOnly === true) return "only";
  return column.narrow === true ? "narrow" : "shown";
}

/** How a column sets, for its head and its cells alike, in the table and in its placeholder. */
const columnLook = (column: TableColumn, stacks: Stacks, compact: boolean) =>
  ({
    align: column.figures === true ? "figure" : "start",
    phone: phoneOf(column),
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
 * A `prose` or a `stack` table's stacked row's chevron spans the lines of every cell the row draws, the rank, the name
 * and each column it keeps: a count no grid rule can name, since a span to the last line reaches no line the cells add
 * themselves. A grid placement, which that stacked row alone reads: a table cell ignores it.
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
function Cell({ cell, slot, cut }: { cell: TableCell | undefined; slot: boolean; cut: boolean }) {
  if (cell === undefined) return null;
  if (typeof cell === "object" && "counts" in cell) return <RecordFigures counts={cell.counts} />;
  const { value, cancelled } = typeof cell === "object" && "cancelled" in cell ? cell : { value: cell, cancelled: 0 };
  if (cut)
    return (
      // One track no wider than the words that may shrink to nothing: the words count whole towards the column's widest
      // and nothing towards its least, which a cell's own `max-width`, whose effect on a cell CSS 2.1 leaves undefined,
      // could not say apart.
      <span className="grid grid-cols-[minmax(0,max-content)]">
        <CutText
          text={textOf(value)}
          className="truncate"
        />
      </span>
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
    // A phone's Tabelle, whose plaque stands for its club, the name read but not drawn: the plaque's own least. Its chip
    // takes the next line where the column cannot hold it beside the plaque, as a name's chips do, so the column's least
    // is the wider of the two and never their sum.
    lonePlaque: { true: "@max-2xl:min-w-0 @max-2xl:flex-wrap" },
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
    // A phone's lone plaque, whose name draws nothing: the line and the group give way to their parts, so what follows
    // the plaque stands in the plaque's own row, and the name's span takes back the gap before it, which a margin does
    // in a flex row alone. The chip then stands as far from the plaque as from a name.
    lonePlaque: {
      true: { line: "@max-2xl:contents", group: "@max-2xl:contents", words: "@max-2xl:-ms-2" },
    },
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
 * a prose and a stack table's name wraps instead, and so does an address (`AddressWords`). The row's chips follow
 * directly after it on the name's line (`chipsOnLine`), and take the next line where the line cannot hold them beside
 * the name's least width. A club's plaque stands before the line, so the cut never takes it and it stands beside a name
 * over its chips, and outside the row's link; the link's stretched box still covers it, so a press on it opens the
 * row's record, which on a phone, where a club's plaque may stand alone, the link names by the club's full name. Under
 * the name line stand the muted line and a refusal.
 */
function NameCell({
  row,
  barred,
  compact,
  prose,
  stack,
  stacks,
  plaqueAlone,
  chipsOnLine,
  shares,
}: {
  row: TableRow;
  barred: TableRow["qualifies"];
  compact: boolean;
  prose: boolean;
  stack: boolean;
  stacks: Stacks;
  plaqueAlone: boolean;
  chipsOnLine: ChipsOnLine;
  /** Whether the list holds a cut column, which shares the row's free room with the name (`table`'s `shares`). */
  shares: boolean;
}) {
  const s = table({
    qualifies: barred,
    compact,
    prose,
    stack,
    stacks,
    chipsOnLine: chipsOnLine === "never" ? undefined : chipsOnLine,
    shares,
  });
  const { plaque } = row;
  const lonePlaque = plaqueAlone && plaque !== undefined;
  const name = textOf(row.name);
  const address = isAddress(row.name);
  const words = lonePlaque ? <span className={s.clubName()}>{name}</span> : address ? <AddressWords address={name} /> : name;
  const opens = row.onOpen === undefined ? words : <RowPress onPress={row.onOpen}>{words}</RowPress>;
  const shape = prose ? "wraps" : plaque === undefined ? "name" : "plaque";
  const held = nameWithChips({ address, led: true });
  const parts = nameParts({ wraps: prose, cut: !prose && !stack && !address, lonePlaque });
  return (
    <td
      role="cell"
      className={s.name()}>
      <span className={nameLine({ shape, lonePlaque, stacks, address })}>
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
            {row.mark !== undefined && <RoleMark {...row.mark} />}
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
      {row.line !== undefined && (
        // A phone's line takes its place below 42 rem.
        <span className={s.line({ class: row.phoneLine === undefined ? "" : "@max-2xl:hidden" })}>
          <CutText
            text={textOf(row.line)}
            className={s.lineWords()}
          />
        </span>
      )}
      {row.phoneLine !== undefined && (
        <span className={s.line({ class: "@2xl:hidden" })}>
          {isAddressLine(row.phoneLine) ? (
            // Shown only where the row is stacked, which wraps its lines, so it is never cut.
            <span className={addressWords()}>
              {row.phoneLine.before}
              <AddressWords address={row.phoneLine.address.record} />
              {row.phoneLine.after}
            </span>
          ) : (
            <CutText
              text={textOf(row.phoneLine)}
              className={s.lineWords()}
            />
          )}
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
 * A list of records: rows 52 px high on desktop and 56 on a phone, lines between them, under a head of muted capitals.
 * A row opens its record, a chevron at its end saying so, or, where its record has no page of its own, carries its
 * acts. Few columns: the name with its plaque, the status column where the rows carry a state, then a few facts.
 *
 * The list's own width picks its rows' form, for every row and every list alike (`table`'s `stacks`): a table from
 * 42 rem, and below it stacked rows, the name and its chips with at most a narrow column beside them, then the muted
 * line and the acts, each on a line of its own. A `prose` and a `stack` table stack their own way at the same width,
 * each cell under the name after its column's label. The table, its rows, its heads and its cells carry their table
 * roles in writing, since a stacked row's and a prose row's `display: grid` drops the semantics an engine infers from
 * the elements alone.
 */
export function Table({
  label,
  nameLabel,
  rankLabel,
  state,
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
  // Any row's acts give the whole table its column, whose head names nothing, as the chevrons' does.
  const hasActs = rows.some((row) => row.acts !== undefined);
  const stacks = stacksOf({ ranked: rankLabel !== undefined, compact, prose, stack });
  const sideActs = sideActsForm(rows);
  // Where a stacked row's acts stand: a decision's under its words, side acts' „⋯“ at its end.
  const acts = !hasActs ? undefined : sideActs.carried ? "folded" : "under";
  const shares = columns.some((column) => column.cut === true);
  const parts = table({ stacks, acts, shares });
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
    <div className={bare ? "@container w-full overflow-x-auto" : cardSurface({ class: "@container w-full overflow-x-auto" })}>
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
                  className={table({ align: "start", width: state.delivery === true ? "chips" : "chip", stacks, lone: true }).head()}>
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
                  className={table({ phone: chevronOnPhone ? "shown" : "hidden", prose, stack, stacks, lone: true }).head()}
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
                  id={row.anchor}
                  data-kit-row
                  role="row"
                  className={table({ linked: leadsOn(row), muted: row.muted === true, acts, ...phoneEnd }).row()}>
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
                      chipsOnLine={chipsOnLineOf(state, stacks)}
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
                        ...columnLook(column, stacks, compact),
                        figures: column.figures === true,
                        strong: column.strong === true,
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
                            slot={marked.has(column.key)}
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
                        {row.acts !== undefined && (
                          <div className={parts.actsLine()}>
                            <SideActsScope folds={sideActs.foldsEverywhere}>{row.acts}</SideActsScope>
                          </div>
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

/** A row's acts while the rows are read: a button's bar for each, by its label. */
function ActBars({ acts }: { acts: ReadonlyArray<Copy> }) {
  return acts.map((act) => (
    <span
      key={act}
      className={buttonPlaceholder()}>
      {act}
    </span>
  ));
}

/**
 * A column's bar while its rows are read. A figure's is a glyph's width, centred, and sets nothing. In a column stating
 * its width (`TableColumn`'s `width`) the bar never widens the column past its head: a share of a width counts nothing
 * towards a cell's least width (CSS Sizing 3, 5.2.1), so the bar fills the column up to a typical value's 80 px, and the
 * column stands as wide in the wait as on the page. A column stating none holds free text, whose words set its width on
 * the page, and its 80-px bar sets it in the wait.
 */
const barOf = (column: TableColumn) => (column.figures === true ? "mx-auto w-4" : column.width === undefined ? "w-20" : "w-full max-w-20");

/**
 * A table while its rows are read: its own head, the columns' labels as the page states them, over `rows` rows at the
 * rows' height, each cell a bar where its value will stand, set as the column sets its values: a rank and figures
 * centred, a name from the start after a club's plaque where the rows hold clubs, a chip's bar in the status column,
 * the chevron where rows lead on. Drawn with the table's own recipe and the columns' stated widths inside the table's
 * own container, so it takes the form the rows will at every width: a list's rows stacked where its box is narrow, the
 * chip's bar after the name's, the muted line's under it where the rows carry one, a phone's left-out columns left
 * out, a `stack` table's rows stacked as `Table`'s and each row's acts as buttons, which a stacked row sets on a line
 * under its words, a list of side acts its act's button in a table and the „⋯“'s at a stacked row's end
 * (`SideActsPlaceholder`). Each cell's bar stands in a line of the cell's own height, so a row holds its height
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
    columns,
    compact = false,
    chevronOnPhone = true,
    plaqueAlone = false,
    acts,
    sideAct,
    line,
    stack = false,
  } = head;
  const hasActs = acts !== undefined || sideAct !== undefined;
  const linked = head.linked !== false && !hasActs;
  const stacks = stacksOf({ ranked: rankLabel !== undefined, compact, prose: false, stack });
  const phoneEnd = { stack, stacks, chevronOnPhone: linked && chevronOnPhone };
  const actsForm = sideAct !== undefined ? "folded" : acts !== undefined ? "under" : undefined;
  const chipsOnLine = chipsOnLineOf(state, stacks);
  const lonePlaque = plaques && plaqueAlone;
  const parts = table({ stacks, acts: actsForm, chipsOnLine: chipsOnLine === "never" ? undefined : chipsOnLine });
  const held = nameWithChips({ led: true });
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
              <th className={table({ align: "start", width: state.delivery === true ? "chips" : "chip", stacks, lone: true }).head()}>
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
            {linked && <td className={table({ phone: chevronOnPhone ? "shown" : "hidden", stack, stacks, lone: true }).head()} />}
            {hasActs && <td className={table({ stacks, lone: true }).head()} />}
          </tr>
        </thead>
        <tbody className={parts.part()}>
          {Array.from({ length: rows }, (_, index) => (
            <tr
              key={index}
              className={table({ ...phoneEnd, acts: actsForm }).row()}>
              {rankLabel !== undefined && (
                <td className={table({ align: "centre", compact }).cell()}>
                  <span className={placeholderBar("mx-auto h-3 w-3")} />
                </td>
              )}
              <td className={table({ compact, stack, stacks }).name()}>
                {/* The rows' least width for the name, so the column's edges stand where the rows' will. */}
                <span className={nameLine({ shape: plaques ? "plaque" : "name", lonePlaque, stacks })}>
                  {plaques && <span className={placeholderBar("h-6 w-10")} />}
                  <span className={held.line({ class: nameParts({ lonePlaque }).line() })}>
                    <PlaceholderLine
                      textClass={lonePlaque ? "w-1/2 text-sm @max-2xl:hidden" : "w-1/2 text-sm"}
                      widthClass="w-full"
                    />
                    {/* A status column's chip stands after the name on a stacked row. */}
                    {chipsOnLine === "stacked" && (
                      <span className={held.chips({ class: parts.lineChips() })}>
                        <span className={placeholderBar("h-5 w-16")} />
                      </span>
                    )}
                  </span>
                </span>
                {line !== undefined && (
                  // In the muted line's place, in one track as wide as the line's room, so the bar's width is a share of it.
                  <span className={parts.line({ class: line === "phone" ? "grid-cols-1 @2xl:hidden" : "grid-cols-1" })}>
                    <PlaceholderLine
                      textClass=""
                      widthClass="w-1/3"
                    />
                  </span>
                )}
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
                      widthClass={barOf(column)}
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
              {hasActs && (
                <td className={parts.acts()}>
                  <span className={parts.actsLine()}>
                    {acts !== undefined && <ActBars acts={acts} />}
                    {sideAct !== undefined && <SideActsPlaceholder act={sideAct} />}
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
