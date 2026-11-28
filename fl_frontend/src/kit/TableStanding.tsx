import { textOf } from "@/core/copy";
import { COPY } from "@/core/copy/shared";
import { formatOrdinal } from "@/core/format";

import { cardHover, columnHead, nameWithChips, rowHeight, stacked } from "./cardStyles";
import { Chip } from "./Chip";
import { CutRow, CutText } from "./CutText";
import { EmptyState } from "./EmptyState";
import { Link } from "./Link";
import { RecordFigures } from "./RecordFigures";
import { RowEnd } from "./RowEnd";
import { TargetMark } from "./TargetMark";
import { TeamPlaque } from "./TeamPlaque";
import { tv } from "./tv";

import type { Copy, Words } from "@/core/copy";
import type { Route } from "next";
import type { ChipProps } from "./Chip";
import type { EmptyStateProps } from "./EmptyState";
import type { Counts } from "./RecordFigures";
import type { Plaque } from "./TeamPlaque";

/** A column after the club: its head, and how its figures set, centred under their head as the place is. */
type StandingColumn = {
  key: string;
  label: Copy;
  /** The column that decides, the points: its figures in the strong weight. */
  strong?: true;
  /**
   * What the column holds, which sets the least it takes: a count two figures, a pair „12:10“ or „3-1-0“, a count with
   * its mark's slots. Its edges then stand at one place whatever the rows hold.
   */
  width?: "count" | "pair" | "marked";
  /** Left out on a phone, a box narrower than 42 rem, or drawn there alone, as „S-U-N“ stands for S, U and N. */
  phone?: "hidden" | "only";
};

/**
 * A cell's value: its figure; a figure some of the club's fixtures left short, such as its count of matches while some
 * were called off, carrying the mark that says how many, which its name tells a screen reader; or a club's won, drawn
 * and lost counts in one cell, „3-1-0“, each in its own colour.
 */
type StandingCell = Words | { value: Words; cancelled: number } | { counts: Counts };

export type TableStandingRow = {
  /** The club's id, and the row's fragment, so a link elsewhere, such as a club's line in a match head, opens it. */
  id: string;
  name: Words;
  /** The club's plaque, which on a phone stands for the club, the name read but not drawn. */
  plaque: Plaque;
  /** The club's page, which the whole row opens. */
  href: Route;
  /**
   * Its place, as the record holds it: level clubs share one, and a club that has played no match holds none and
   * shows a dash.
   */
  place: number | null;
  /**
   * A place that qualifies, the 2-px bar at the row's left edge, in the rank cell: in the brand's green where the place
   * is the club's alone, `settled`, and in the control grey where level clubs share it, `level`, since until the tie
   * resolves the bracket seeds none of them. A screen reader hears each tone in words after the place.
   */
  qualifies?: "settled" | "level";
  /** A club that no longer counts, such as a disqualified one: its text and its plaque muted. */
  muted?: boolean;
  /** Where the club stands in the season, such as its exit, directly after its name. */
  chip?: ChipProps;
  /** The row's figures, by column key. */
  cells: Readonly<Record<string, StandingCell>>;
};

export type TableStandingProps = {
  label: Copy;
  rankLabel: Copy;
  nameLabel: Copy;
  columns: ReadonlyArray<StandingColumn>;
  rows: ReadonlyArray<TableStandingRow>;
  /** What stands in the rows' place when there are none. */
  empty: EmptyStateProps;
};

/** The standing's heads and columns, which a page states once, beside each group's rows. */
export type TableStandingHead = Pick<TableStandingProps, "rankLabel" | "nameLabel" | "columns">;

/**
 * The standing's look. Its rows are one line at every width: it holds more figures than a phone's width holds at a
 * list's padding, so on a phone every column keeps its place by compact cells, 6 px a side, and a club is its plaque
 * alone. The whole row opens the club's page, its chevron at the row's end left out on a phone: the owner's ruling for
 * this table, not a matter of room. The column heads are every subhead's inside a card (`columnHead`), as a list's are.
 */
const standing = tv({
  slots: {
    head: columnHead().text(),
    sheet: "w-full border-collapse text-sm",
    headRow: columnHead().rule(),
    // A row a link may point to by its fragment, marked while the address names it.
    row: `kit-target relative ${rowHeight({ form: "fixed" })} ${stacked()} ${cardHover()}`,
    cell: "px-3 whitespace-nowrap @max-2xl:px-1.5 @max-2xl:text-xs",
    // The club takes the room the figures leave.
    name: "w-full px-3 py-2 @max-2xl:px-1.5",
    // The club's name beside its plaque, read but not drawn on a phone, where the plaque stands for it alone.
    teamName: "@max-2xl:sr-only",
    // The chevron's cell, as narrow as the chevron.
    end: "w-0 pe-3 @max-2xl:hidden",
  },
  variants: {
    // The heads of the place, the club and the figures, each in its compact cell on a phone; the chevron's head
    // names nothing and takes none.
    compact: {
      true: { head: "@max-2xl:px-1.5 @max-2xl:text-2xs @max-2xl:tracking-normal" },
    },
    align: {
      rank: { head: "w-11 text-center @max-2xl:w-7", cell: "w-11 text-center font-numeric text-fg-muted @max-2xl:w-7" },
      start: { head: "text-start" },
      // A figure stands centred under its head: a head wider than its figures, „Pkt.“ over „4“, reads as one column
      // with them only centred over them, and the tabular figures keep each digit's width, so a column's values still
      // line up.
      figure: { head: "text-center", cell: "text-center font-numeric" },
    },
    phone: {
      hidden: { head: "@max-2xl:hidden", cell: "@max-2xl:hidden" },
      only: { head: "@2xl:hidden", cell: "@2xl:hidden" },
    },
    // A column's least width, on its head cell (`Table`'s `width`).
    width: {
      count: { head: "min-w-12" },
      pair: { head: "min-w-16 @max-2xl:min-w-13" },
      marked: { head: "min-w-16 @max-2xl:min-w-11" },
    },
    strong: {
      true: { cell: "font-semibold" },
    },
    muted: {
      true: { row: "text-fg-muted" },
    },
    qualifies: {
      // Drawn inside the rank cell, so it takes no width and moves nothing.
      settled: { cell: "shadow-[inset_2px_0_0_var(--brand)]" },
      level: { cell: "shadow-[inset_2px_0_0_var(--border-control)]" },
    },
  },
});

/** How a column sets, for its head and its cells alike. */
const columnLook = (column: StandingColumn) => ({ align: "figure", phone: column.phone, width: column.width }) as const;

/**
 * A cell's figure. In a column where some row's figure is short of fixtures called off, every row keeps the mark's
 * slot at the figure's end, so the digits stand under each other whether a row carries the mark or not, and as much
 * room at its start, so the figure stays centred under its head; the mark, a small red „+N“, stands over the figure's
 * top-right corner, three quarters of it right of the corner, over the slot and clear of the digits, and its name tells
 * a screen reader what the mark says.
 */
function Cell({ cell, slot }: { cell: StandingCell | undefined; slot: boolean }) {
  if (cell === undefined) return null;
  if (typeof cell === "object" && "counts" in cell) return <RecordFigures counts={cell.counts} />;
  const { value, cancelled } = typeof cell === "object" && "cancelled" in cell ? cell : { value: cell, cancelled: 0 };
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
 * The club: its plaque, then its name, cut with „…“ where its column is too narrow and whole in its `title` while it
 * is cut, and its chip directly after it (`nameWithChips`). The column is never narrower than the plaque, the name's
 * 5 rem and their gap, so the cut name's words count nothing towards it. On a phone the plaque stands for the club, the
 * name read but not drawn: the line and the name's group give way to their parts, so a chip stands in the plaque's own
 * row, as far from it as from a name, and takes the next line where the column cannot hold it beside the plaque, so the
 * column's least is the wider of the two and never their sum. The plaque stands outside the link, whose stretched box
 * still covers it, so a press on it opens the club, which the link names by the club's full name.
 */
function NameCell({ row }: { row: TableStandingRow }) {
  const s = standing();
  const name = textOf(row.name);
  const held = nameWithChips({ led: true });
  return (
    <td
      role="cell"
      className={s.name()}>
      <span className="flex min-w-32 items-center gap-2 @max-2xl:min-w-0 @max-2xl:flex-wrap">
        <TeamPlaque
          plaque={row.plaque}
          muted={row.muted === true}
        />
        <span className={held.line({ class: "@max-2xl:contents" })}>
          <span className={held.head({ class: "@max-2xl:contents" })}>
            <CutText
              text={name}
              className="min-w-0 truncate @max-2xl:-ms-2">
              <Link
                href={row.href}
                placement="row">
                <span className={s.teamName()}>{name}</span>
              </Link>
            </CutText>
          </span>
          {row.chip !== undefined && (
            <span className={held.chips()}>
              <Chip {...row.chip} />
            </span>
          )}
        </span>
      </span>
    </td>
  );
}

/**
 * A group's standing, the Tabelle's: its place, its club and its figures, every row opening its club, inside the
 * group's card, whose box holds it. The table, its rows, its heads and its cells carry their table roles in writing, as
 * `Table`'s do.
 */
export function TableStanding({ label, rankLabel, nameLabel, columns, rows, empty }: TableStandingProps) {
  const s = standing();
  const head = standing({ compact: true });
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
    <div className="@container w-full overflow-x-auto">
      {rows.length === 0 ? (
        <EmptyState {...empty} />
      ) : (
        <>
          <TargetMark />
          <table
            role="table"
            aria-label={label}
            className={s.sheet()}>
            <thead>
              <tr
                role="row"
                className={s.headRow()}>
                <th
                  role="columnheader"
                  scope="col"
                  className={head.head({ align: "rank" })}>
                  {rankLabel}
                </th>
                <th
                  role="columnheader"
                  scope="col"
                  className={head.head({ align: "start" })}>
                  {nameLabel}
                </th>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    role="columnheader"
                    scope="col"
                    className={head.head(columnLook(column))}>
                    {column.label}
                  </th>
                ))}
                {/* The chevrons' column names nothing, so its head is no header cell. */}
                <td
                  role="cell"
                  className={s.head({ phone: "hidden" })}
                />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  id={row.id}
                  data-kit-row
                  role="row"
                  className={s.row({ muted: row.muted === true })}>
                  {/* The row the club's link stretches over: the cut name under the pointer is its tooltip (`CutRow`). */}
                  <CutRow>
                    <td
                      role="cell"
                      className={s.cell({ align: "rank", qualifies: row.qualifies })}>
                      {row.place === null ? COPY.shared.noValue : formatOrdinal(row.place)}
                      {/* The edge is a colour alone, which a screen reader hears as these words; the space before them
                          stands in the read text, never beside the centred place. */}
                      {row.qualifies !== undefined && <span className="sr-only"> {COPY.shared.season.qualifies[row.qualifies]}</span>}
                    </td>
                    <NameCell row={row} />
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        role="cell"
                        className={s.cell({ ...columnLook(column), strong: column.strong === true })}>
                        <Cell
                          cell={row.cells[column.key]}
                          slot={marked.has(column.key)}
                        />
                      </td>
                    ))}
                    <td
                      role="cell"
                      className={s.end()}>
                      <RowEnd />
                    </td>
                  </CutRow>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
