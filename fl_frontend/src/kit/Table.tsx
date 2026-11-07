import { COPY, textOf } from "@/core/copy";
import { formatNumber } from "@/core/format";

import { buttonPlaceholder } from "./buttonStyles";
import { cardHover, cardSurface, columnHead, stacked } from "./cardStyles";
import { Chip } from "./Chip";
import { CutText } from "./CutText";
import { EmptyState } from "./EmptyState";
import { Link } from "./Link";
import { RowEnd } from "./RowEnd";
import { RowPress } from "./RowPress";
import { placeholderBar, PlaceholderLine } from "./Skeleton";
import { TargetMark } from "./TargetMark";
import { TeamPlaque } from "./TeamPlaque";
import { tv } from "./tv";

import type { Copy, Words } from "@/core/copy";
import type { Route } from "next";
import type { ReactElement } from "react";
import type { ChipProps } from "./Chip";
import type { EmptyStateProps } from "./EmptyState";
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
  width?: "count" | "pair" | "marked" | "date" | "phone" | "line";
  /**
   * Free text of any length, such as a ban's Grund: cut with „…“ at the column `width` sets, whole in its tooltip while
   * it is cut. Every other column widens to its longest value.
   */
  cut?: true;
} &
  /** Left out on a phone, whose row is its name, its chip and at most a narrow column. */
  (
    | { hideOnPhone?: boolean; phoneOnly?: never; narrow?: never }
    /** Drawn on a phone alone, such as one column standing for several the phone leaves out. */
    | { phoneOnly: true; hideOnPhone?: never; narrow?: never }
    /**
     * The fact short enough to stand beside a name and its chip on a phone, left out of a box too narrow to hold the
     * three. A list marks at most one column so and leaves its others out.
     */
    | { narrow: true; hideOnPhone?: never; phoneOnly?: never }
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
  /** The record's name; with `href` the whole row opens the record. */
  name: Words;
  /** What a list read whole is searched by in the row's place, where a search reaches past the name; the name included. */
  words?: string;
  /** A club's plaque before its name, or before a name of the club's own, such as a scorer's. */
  plaque?: Plaque;
  chip?: ChipProps;
  /** Beside `chip`, where the last mail of a row that mails met trouble: the delivery's chip, as a seat's. */
  delivery?: ChipProps;
  /** The muted line under the name, cut as a name is: what the row's record is, or when it takes effect. */
  line?: Words;
  /** Why the row's record was turned away, on a line of its own under the name, in the danger colour. */
  refusal?: Copy;
  /** The row's values, by column key; a missing value leaves its cell empty. */
  cells: Readonly<Record<string, TableCell>>;
  /**
   * A place that qualifies, the 2-px bar at the row's left edge: in the brand's green where the place is the row's
   * alone, `settled`, and in the control grey where level clubs share it, `level`, since until the tie resolves the
   * bracket seeds none of them.
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
       * dialog, as a card's act row holds them: under the row's words on a phone, at the row's end from `lg`. A row the
       * reader can do nothing to takes none, and a table none of whose rows takes any draws no act column.
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
  columns: ReadonlyArray<TableColumn>;
  rows: ReadonlyArray<TableRow>;
  /** What stands in the rows' place when there are none. */
  empty: EmptyStateProps;
  /** The rows alone, without the table's own box, inside a card's body, whose box already holds them. */
  bare?: boolean;
  /**
   * A table of more figures than a phone's width holds at the standard padding, the Tabelle's: on a phone every
   * column keeps its place by compact cells. Every other table keeps its 12-px cells on a phone.
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
   * phone each row stacks, its name line over its cells and every cell after its column's label, the cells wrapping
   * under it.
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
export type TableHead = Pick<TableProps, "nameLabel" | "rankLabel" | "columns" | "compact" | "chevronOnPhone" | "plaqueAlone" | "stack"> & {
  /** The rows open nothing, so their wait ends in no chevron. */
  linked?: false;
  /** The labels of the acts a row carries, which its wait draws as buttons; the rows open nothing either. */
  acts?: ReadonlyArray<Copy>;
};

/** A table's rows once read: everything but its head. */
export type TableBody = Omit<TableProps, keyof TableHead>;

/** A stacked phone row's two columns: its cells, then its chevron, the kit's 12-px gap between them. */
const PHONE_END_ROW = "max-lg:grid-cols-[minmax(0,1fr)_auto] max-lg:gap-x-3";

/** That chevron's column, the row's second, centring the chevron on the lines it spans. */
const PHONE_END = "max-lg:col-start-2 max-lg:flex max-lg:w-auto max-lg:items-center max-lg:pe-0";

const table = tv({
  slots: {
    // The column head's look, which every subhead inside a card shares, so the column heads never compete
    // with the card's head band.
    head: columnHead().text(),
    sheet: "w-full border-collapse text-sm",
    headRow: columnHead().rule(),
    // `thead` and `tbody`, whose rows a phone's act table sets in the table's own tracks.
    part: "",
    // A row a link may point to by its fragment, marked while the address names it.
    row: `kit-target relative h-14 ${stacked()} lg:h-13`,
    cell: "px-3 whitespace-nowrap",
    // The name takes the room the facts leave and is cut with „…“ where it is longer (`nameLine`).
    name: "w-full px-3 py-2",
    // A club's name beside its plaque, read but not drawn on a phone, where the plaque stands for it alone.
    clubName: "max-lg:sr-only",
    // A linked row's last cell, as narrow as the chevron that says the row leads on.
    end: "w-0 pe-3",
    // A prose or a stacked cell's column label on a phone, drawn for the eye alone: the read head names the column.
    label: "",
    // Under the name line, cut as a name is: the row keeps its height at the least, and a phone's width cuts no chip.
    refusal: "block truncate text-xs text-danger",
    // Its one track grows no wider than the words, and a track that may shrink to nothing leaves them out of the column's
    // least width, as the name's does (`nameLine`).
    line: "grid grid-cols-[minmax(0,max-content)] text-xs text-fg-muted",
    // The acts' last cell, as narrow as its buttons, as the chevrons' is.
    acts: "w-0 pe-3",
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
        head: "max-lg:px-1.5 max-lg:text-2xs max-lg:tracking-normal",
        cell: "max-lg:px-1.5 max-lg:text-xs",
        name: "max-lg:px-1.5",
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
    phone: {
      hidden: { head: "max-lg:hidden", cell: "max-lg:hidden" },
      only: { head: "lg:hidden", cell: "lg:hidden" },
      // Judged by the box's own width: a column has one width over all its rows, so no row's name can decide. From
      // 20 rem a date column, the chevron, the padding and a chip leave a name some nine characters.
      narrow: { head: "@max-xs:hidden", cell: "@max-xs:hidden" },
      shown: {},
    },
    // A column's least width, on its head cell, which the table and its placeholder draw alike, so their edges agree
    // whatever the rows hold. A minimum, since the name's `w-full` leaves every other column its min-content width
    // (CSS Tables 3, 3.9.3), which a cell's `min-width` raises and a `<col>`'s width does not. Automatic layout, not
    // `fixed`: a value past its column widens the column and the name gives way, where `fixed` would cut it or lay it over
    // the next cell. Each holds its padding: a count two figures, a pair „12:10“ or „3-1-0“, a count with its mark's
    // slots, a date ten characters, a phone number 20, a line of an address 35. A date stands at the start in the body's
    // face, never as `figures`, which would centre it and set it apart from every other date column.
    width: {
      count: { head: "min-w-12" },
      pair: { head: "min-w-16 max-lg:min-w-13" },
      marked: { head: "min-w-16 max-lg:min-w-11" },
      date: { head: "min-w-28" },
      phone: { head: "min-w-44" },
      line: { head: "min-w-72" },
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
    // each cell drawing its column's label before its words, which wrap there under their own label. The one column
    // is `minmax(0, 1fr)`, so the name line is cut at the phone's width rather than widening the row.
    stack: {
      true: {
        head: "max-lg:sr-only",
        row: "max-lg:grid max-lg:h-auto max-lg:grid-cols-1 max-lg:gap-1 max-lg:px-3 max-lg:py-3",
        name: "max-lg:col-start-1 max-lg:w-auto max-lg:px-0 max-lg:py-0",
        cell: "max-lg:col-start-1 max-lg:grid max-lg:grid-cols-[4rem_minmax(0,1fr)] max-lg:gap-x-3 max-lg:px-0 max-lg:text-start max-lg:whitespace-normal",
        label: "text-xs text-fg-muted lg:hidden",
      },
    },
    // A phone's act row is two lines, which no table row can be: the table is a grid there, its rows subgrids, so head
    // and rows still share one set of tracks, the name's and the narrow column's, and the acts' cell takes a line of
    // its own under them. A table keeps its table layout from `lg`, the acts its row's last cell.
    acts: {
      // A row with no acts in such a table: the list's plain row, its acts' cell left out on a phone.
      table: {
        sheet: "max-lg:grid",
        part: "max-lg:contents",
        headRow: "max-lg:col-span-full max-lg:grid max-lg:grid-cols-subgrid",
        head: "max-lg:grid max-lg:items-center",
        row: "max-lg:col-span-full max-lg:grid max-lg:grid-cols-subgrid max-lg:items-center",
        acts: "max-lg:hidden",
      },
      // The kit's act row, as `Card.tsx`'s and `SeatRows.tsx`'s: 12 px over the words and under the acts, 8 between them.
      row: {
        row: "max-lg:col-span-full max-lg:grid max-lg:h-auto max-lg:grid-cols-subgrid max-lg:items-center max-lg:pb-3",
        name: "max-lg:pt-3",
        acts: "max-lg:col-span-full max-lg:w-auto max-lg:px-3",
      },
    },
    linked: {
      true: { row: cardHover() },
    },
    chevronOnPhone: {
      true: {},
      false: { end: "max-lg:hidden" },
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
    { align: "centre", compact: true, class: { head: "max-lg:w-7", cell: "max-lg:w-7" } },
    // Restated after the variants, so a stacked row's grid cell never draws a column the phone leaves out.
    { phone: "hidden", class: { head: "max-lg:hidden", cell: "max-lg:hidden" } },
    // A prose or a stacked row on a phone stands its cells in one column and its chevron in a column of its own at its
    // end, spanning every cell's line so it is centred on the row's height (`Table`'s `phoneCells`).
    { prose: true, chevronOnPhone: true, class: { row: PHONE_END_ROW, end: PHONE_END } },
    { stack: true, chevronOnPhone: true, class: { row: PHONE_END_ROW, end: PHONE_END } },
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

/** Whether a column stands on a phone: left out, drawn there alone, drawn where it fits, or drawn at every width. */
function phoneOf(column: TableColumn) {
  if (column.hideOnPhone === true) return "hidden";
  if (column.phoneOnly === true) return "only";
  return column.narrow === true ? "narrow" : "shown";
}

/** How a column sets, for its head and its cells alike, in the table and in its placeholder. */
const columnLook = (column: TableColumn) =>
  ({ align: column.figures === true ? "figure" : "start", phone: phoneOf(column), width: column.width, cut: column.cut === true }) as const;

/**
 * The tracks of an act table on a phone: the name's, taking the room the others leave as `w-full` does in a table, and
 * one for each column the phone keeps. Inline, for a count no class can name; a table ignores it from `lg`.
 */
function phoneTracks(columns: ReadonlyArray<TableColumn>) {
  const kept = columns.filter((column) => column.hideOnPhone !== true).length;
  return { gridTemplateColumns: `minmax(0, 1fr) repeat(${String(kept)}, auto)` };
}

/**
 * A stacked phone row's chevron spans the lines of every cell the phone draws, the rank, the name and each column it
 * keeps: a count no grid rule can name, since a span to the last line reaches no line the cells add themselves. A grid
 * placement, which a stacked phone row alone reads: a table cell ignores it.
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
      <CutText
        text={textOf(value)}
        className="block truncate"
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

/** Whether a table carries an act column, and of its rows whether this one fills it. */
type TableActs = "table" | "row" | undefined;

/**
 * A row's name line. The name's track grows to the name and stops at the room the line has, so a chip stands directly
 * after a short name and a long one is cut. Its least size of nothing leaves the name out of the line's least width
 * while the plaque and the chip, in tracks of their own size, count towards it, so the table can narrow the column to
 * no less than they need and a chip never lies over the next cell, however little the facts leave the name.
 */
const nameLine = tv({
  base: "min-w-0 items-center gap-2",
  variants: {
    shape: {
      // A prose table's name wraps, and its longest word is the least width of its column.
      wraps: "flex",
      name: "grid auto-cols-max grid-flow-col grid-cols-[minmax(0,max-content)]",
      plaque: "grid auto-cols-max grid-flow-col grid-cols-[max-content_minmax(0,max-content)]",
    },
    // A flex row on a phone, where a lone plaque's name draws nothing: a margin takes back a gap in a flex row alone,
    // since a grid's track stands where it stands whatever its item's margin.
    lonePlaque: { true: "max-lg:flex" },
  },
});

/** The span holding a row's names and its link. */
const nameWords = tv({
  base: "min-w-0",
  variants: {
    // A prose table's name wraps; every other is cut with „…“.
    cut: { true: "truncate" },
    // A lone plaque's name draws nothing on a phone, so the span takes back the gap before it, and the chip stands
    // as far from the plaque as from a name.
    lonePlaque: { true: "max-lg:-ms-2" },
  },
});

/**
 * The name, cut with „…“ where its column is too narrow and whole in its `title` while it is cut, then the chip, which keeps
 * its size and its line; a prose table's name wraps instead. A club's plaque stands outside the span cutting the names, so the cut never takes it, and outside
 * the row's link; the link's stretched box still covers it, so a press on it opens the row's record, which on a phone,
 * where a club's plaque may stand alone, the link names by the club's full name.
 */
function NameCell({
  row,
  barred,
  compact,
  prose,
  stack,
  plaqueAlone,
  acts,
}: {
  row: TableRow;
  barred: TableRow["qualifies"];
  compact: boolean;
  prose: boolean;
  stack: boolean;
  plaqueAlone: boolean;
  acts: TableActs;
}) {
  const s = table({ qualifies: barred, compact, prose, stack, acts });
  const { plaque } = row;
  const lonePlaque = plaqueAlone && plaque !== undefined;
  const name = textOf(row.name);
  const words = lonePlaque ? <span className={s.clubName()}>{name}</span> : name;
  const opens = row.onOpen === undefined ? words : <RowPress onPress={row.onOpen}>{words}</RowPress>;
  const shape = prose ? "wraps" : plaque === undefined ? "name" : "plaque";
  return (
    <td
      role="cell"
      className={s.name()}>
      <span className={nameLine({ shape, lonePlaque })}>
        {plaque !== undefined && (
          <TeamPlaque
            plaque={plaque}
            muted={row.muted === true}
          />
        )}
        <CutText
          text={name}
          className={nameWords({ cut: !prose, lonePlaque })}>
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
        {row.chip !== undefined && <Chip {...row.chip} />}
        {row.delivery !== undefined && <Chip {...row.delivery} />}
      </span>
      {row.line !== undefined && (
        <span className={s.line()}>
          <CutText
            text={textOf(row.line)}
            className="truncate"
          />
        </span>
      )}
      {row.refusal !== undefined && <span className={s.refusal()}>{row.refusal}</span>}
    </td>
  );
}

/**
 * A list of records: rows 52 px high on desktop and 56 on a phone, lines between them, under a head of
 * muted capitals. A row opens its record, a chevron at its end saying so. Few columns: the name with its plaque
 * and chip, then a few facts, of which a list's phone row keeps a narrow column where it fits, the name cut before its
 * chip gives way. The table, its rows, its heads and its cells carry their table roles in writing, since a
 * prose row's `display: grid` on a phone drops the semantics an engine infers from the elements alone.
 */
export function Table({
  label,
  nameLabel,
  rankLabel,
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
  const tableActs = hasActs ? "table" : undefined;
  const parts = table({ acts: tableActs });
  const nameHead = table({ align: "start", compact, prose, stack, acts: tableActs }).head();
  const leadsOn = (row: TableRow) => row.href !== undefined || row.onOpen !== undefined;
  const isLinked = rows.some(leadsOn);
  // Every row keeps the chevron's room on a phone where some row draws one there.
  const phoneEnd = { prose, stack, chevronOnPhone: isLinked && chevronOnPhone };
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
          style={hasActs ? phoneTracks(columns) : undefined}>
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
                className={nameHead}>
                {nameLabel}
              </th>
              {columns.map((column) => (
                <th
                  key={column.key}
                  role="columnheader"
                  scope="col"
                  className={table({ ...columnLook(column), compact, prose, stack, acts: tableActs }).head()}>
                  {column.label}
                </th>
              ))}
              {/* The chevrons' column and the acts' name nothing, so their head is no header cell. */}
              {isLinked && (
                <td
                  role="cell"
                  className={table({ phone: chevronOnPhone ? "shown" : "hidden", prose, stack }).head()}
                />
              )}
              {hasActs && (
                <td
                  role="cell"
                  className={table({ phone: "hidden" }).head()}
                />
              )}
            </tr>
          </thead>
          <tbody className={parts.part()}>
            {rows.map((row) => {
              const acts: TableActs = !hasActs ? undefined : row.acts === undefined ? "table" : "row";
              const marks = { linked: leadsOn(row), muted: row.muted === true, acts };
              return (
                <tr
                  key={row.id}
                  id={row.anchor}
                  role="row"
                  className={table({ ...marks, ...phoneEnd }).row()}>
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
                    plaqueAlone={plaqueAlone}
                    acts={acts}
                  />
                  {columns.map((column) => {
                    const s = table({
                      ...columnLook(column),
                      figures: column.figures === true,
                      strong: column.strong === true,
                      compact,
                      prose,
                      stack,
                    });
                    return (
                      <td
                        key={column.key}
                        role="cell"
                        className={s.cell()}>
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
                      className={table({ acts }).acts()}>
                      {row.acts !== undefined && <span className="flex items-center gap-2 lg:justify-end">{row.acts}</span>}
                    </td>
                  )}
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
 * centred, a name from the start after a club's plaque where the rows hold clubs, the chevron where rows lead on.
 * Drawn with the table's own recipe and the columns' stated widths, so it stands as the table will at every width, a
 * phone's left-out columns left out, a `stack` table's rows stacked as `Table`'s and each row's acts as buttons.
 */
export function TablePlaceholder({
  head,
  rows,
  plaques = false,
  bare = false,
  linked = head.linked !== false && head.acts === undefined,
  stack = head.stack === true,
}: {
  head: TableHead;
  rows: number;
  /** Whether each row holds a plaque before its name. */
  plaques?: boolean;
  bare?: boolean;
  /** Whether the rows lead on, each ending in its chevron. */
  linked?: boolean;
  stack?: boolean;
}) {
  const { nameLabel, rankLabel, columns, compact = false, chevronOnPhone = true, plaqueAlone = false, acts } = head;
  const phoneEnd = { stack, chevronOnPhone: linked && chevronOnPhone };
  const tableActs = acts === undefined ? undefined : "table";
  const rowActs = acts === undefined ? undefined : "row";
  const parts = table({ acts: tableActs });
  return (
    <div className={bare ? "@container w-full overflow-hidden" : cardSurface({ class: "@container w-full overflow-hidden" })}>
      <table
        className={parts.sheet()}
        style={acts === undefined ? undefined : phoneTracks(columns)}>
        <thead className={parts.part()}>
          <tr className={parts.headRow()}>
            {rankLabel !== undefined && <th className={table({ align: "centre", compact }).head()}>{rankLabel}</th>}
            <th className={table({ align: "start", compact, stack, acts: tableActs }).head()}>{nameLabel}</th>
            {columns.map((column) => (
              <th
                key={column.key}
                className={table({ ...columnLook(column), compact, stack, acts: tableActs }).head()}>
                {column.label}
              </th>
            ))}
            {linked && <td className={table({ phone: chevronOnPhone ? "shown" : "hidden", stack }).head()} />}
            {acts !== undefined && <td className={table({ phone: "hidden" }).head()} />}
          </tr>
        </thead>
        <tbody className={parts.part()}>
          {Array.from({ length: rows }, (_, index) => (
            <tr
              key={index}
              className={table({ ...phoneEnd, acts: rowActs }).row()}>
              {rankLabel !== undefined && (
                <td className={table({ align: "centre", compact }).cell()}>
                  <span className={placeholderBar("mx-auto h-3 w-3")} />
                </td>
              )}
              <td className={table({ compact, stack, acts: rowActs }).name()}>
                <span className="flex min-w-0 items-center gap-2">
                  {plaques && <span className={placeholderBar("h-6 w-10")} />}
                  <PlaceholderLine
                    text={plaques && plaqueAlone ? "flex-1 text-sm max-lg:hidden" : "flex-1 text-sm"}
                    width="w-1/2"
                  />
                </span>
              </td>
              {columns.map((column) => {
                const s = table({ ...columnLook(column), compact, stack });
                return (
                  <td
                    key={column.key}
                    className={s.cell()}>
                    {stack && <span className={s.label()}>{column.label}</span>}
                    <span className={placeholderBar(column.figures === true ? "mx-auto h-3 w-4" : "h-3 w-20")} />
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
                <td className={table({ acts: rowActs }).acts()}>
                  <span className="flex items-center gap-2 lg:justify-end">
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
